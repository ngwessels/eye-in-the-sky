import { NextResponse, after } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { getStationFromAuth } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import { assertRateLimit, RateLimitError } from "@/lib/rate-limit";
import { getEnv } from "@/lib/env";
import { presignPut, resolveCaptureObjectKey } from "@/lib/s3";
import type { CaptureDoc, CaptureViewDoc, StationDoc } from "@/lib/types";
import { azimuthToCardinal16, normalizeAzimuthDeg } from "@eye/shared";
import { z } from "zod";
import { analyzeCaptureById } from "@/lib/jobs/analyze-capture-id";
import { analyzeCalibrationCaptureById } from "@/lib/jobs/analyze-calibration-capture-id";
import { recomputeQualityTier } from "@/lib/tier";

const presignBody = z.object({
  action: z.literal("presign"),
  mediaType: z.enum(["image", "video"]),
  contentType: z.string().min(3),
  kind: z.enum(["science", "calibration"]).default("science"),
  captureId: z.string().uuid().optional(),
});

const finalizeBody = z.object({
  action: z.literal("finalize"),
  captureId: z.string().uuid(),
  byteSize: z.number().int().positive(),
  etag: z.string().optional(),
  capturedAt: z.string().datetime(),
  trace_id: z.string().optional(),
  command_id: z.string().optional(),
  kind: z.enum(["science", "calibration"]),
  sha256: z.string().optional(),
  contentType: z.string(),
  /** True-north azimuth in degrees (clockwise); if set, north_offset is not applied. */
  azimuth_true_deg: z.number().finite().optional(),
  elevation_deg: z.number().finite().optional(),
  /** Mount pan in degrees; combined with station calibration.north_offset_deg for true azimuth. */
  mount_pan_deg: z.number().finite().optional(),
  mount_tilt_deg: z.number().finite().optional(),
});

/**
 * True azimuth = mount pan + north_offset_deg (offset is how far mount "zero" is east of true north).
 */
function resolveCaptureView(
  station: StationDoc,
  d: {
    azimuth_true_deg?: number;
    elevation_deg?: number;
    mount_pan_deg?: number;
    mount_tilt_deg?: number;
  },
): CaptureViewDoc | undefined {
  const fin = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

  if (fin(d.azimuth_true_deg)) {
    const az = normalizeAzimuthDeg(d.azimuth_true_deg);
    const view: CaptureViewDoc = {
      azimuth_true_deg: az,
      cardinal16: azimuthToCardinal16(az),
      source: "edge_finalize",
    };
    if (fin(d.elevation_deg)) view.elevation_deg = d.elevation_deg;
    return view;
  }

  if (fin(d.mount_pan_deg)) {
    const offset = station.calibration?.north_offset_deg ?? 0;
    const az = normalizeAzimuthDeg(d.mount_pan_deg + offset);
    const view: CaptureViewDoc = {
      azimuth_true_deg: az,
      cardinal16: azimuthToCardinal16(az),
      source: "edge_finalize",
    };
    if (fin(d.elevation_deg)) {
      view.elevation_deg = d.elevation_deg;
    } else if (fin(d.mount_tilt_deg)) {
      view.elevation_deg = d.mount_tilt_deg;
    }
    return view;
  }

  return undefined;
}

function extForCt(ct: string): string {
  if (ct.includes("jpeg")) return "jpg";
  if (ct.includes("jpg")) return "jpg";
  if (ct.includes("png")) return "png";
  if (ct.includes("webp")) return "webp";
  if (ct.includes("mp4")) return "mp4";
  return "bin";
}

export async function POST(request: Request) {
  const station = await getStationFromAuth(request);
  if (!station) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const env = getEnv();
  try {
    await assertRateLimit(
      station.stationId,
      "/captures",
      env.RATE_PRESIGN_PER_MIN,
    );
  } catch (e) {
    if (e instanceof RateLimitError) {
      return NextResponse.json({ error: "rate_limited" }, { status: 429 });
    }
    throw e;
  }

  const json = await request.json();
  const action = json?.action;

  if (action === "presign") {
    const parsed = presignBody.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const captureId = parsed.data.captureId ?? uuidv4();
    const ext = extForCt(parsed.data.contentType);
    const key = resolveCaptureObjectKey(
      station.stationId,
      captureId,
      ext,
      parsed.data.kind,
    );
    const url = await presignPut(key, parsed.data.contentType);
    const bucket = getEnv().S3_BUCKET;
    return NextResponse.json({
      captureId,
      uploadUrl: url,
      s3Key: key,
      s3Bucket: bucket,
      headers: { "Content-Type": parsed.data.contentType },
    });
  }

  if (action === "finalize") {
    const parsed = finalizeBody.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const d = parsed.data;

    if (d.byteSize > env.MAX_CAPTURE_BYTES) {
      return NextResponse.json(
        { error: "capture_too_large", max: env.MAX_CAPTURE_BYTES },
        { status: 400 },
      );
    }

    const skew = Math.abs(new Date(d.capturedAt).getTime() - Date.now());
    let captureClockUntrusted = false;

    if (skew > env.CLOCK_SKEW_REJECT_MS) {
      if (env.CLOCK_SKEW_MODE === "reject") {
        return NextResponse.json(
          { error: "clock_skew", skew_ms: skew },
          { status: 400 },
        );
      }
      captureClockUntrusted = true;
    }

    const ext = extForCt(d.contentType);
    const key = resolveCaptureObjectKey(
      station.stationId,
      d.captureId,
      ext,
      d.kind,
    );
    const db = await getDb();
    const bucket = env.S3_BUCKET;

    const updatedStation = await db.collection<StationDoc>("stations").findOneAndUpdate(
      { stationId: station.stationId },
      { $inc: { sequence: 1 } },
      { returnDocument: "after" },
    );

    const seq =
      updatedStation?.sequence ??
      (station.sequence ?? 0) + 1;

    const view = resolveCaptureView(station, d);

    const doc: CaptureDoc = {
      captureId: d.captureId,
      stationId: station.stationId,
      s3Bucket: bucket,
      s3Key: key,
      mediaType: d.contentType.startsWith("video") ? "video" : "image",
      contentType: d.contentType,
      byteSize: d.byteSize,
      etag: d.etag,
      capturedAt: new Date(d.capturedAt),
      trace_id: d.trace_id,
      command_id: d.command_id,
      kind: d.kind,
      clock_skew_ms: skew,
      sha256: d.sha256,
      analysis: null,
      followups_enqueued: 0,
      sequence: seq,
      clock_untrusted: captureClockUntrusted,
      ...(view ? { view } : {}),
    };

    await db.collection<CaptureDoc>("captures").insertOne(doc);

    const alpha = 0.15;
    const prev = station.health?.uploadSuccessEma ?? 1;
    const ema = prev * (1 - alpha) + alpha;

    const stationPatch: Record<string, unknown> = {
      "health.uploadSuccessEma": ema,
      lastSeenAt: new Date(),
    };

    if (captureClockUntrusted) {
      stationPatch.clock_untrusted = true;
      const tr = Array.from(
        new Set([...(station.tier_reasons ?? []), "clock_skew_observed"]),
      );
      const mergedStation: StationDoc = {
        ...station,
        clock_untrusted: true,
        tier_reasons: tr,
        health: { ...station.health, uploadSuccessEma: ema },
      };
      const tier = recomputeQualityTier(mergedStation);
      stationPatch.tier_reasons = tier.tier_reasons;
      stationPatch.quality_tier = tier.quality_tier;
    }

    await db.collection<StationDoc>("stations").updateOne(
      { stationId: station.stationId },
      { $set: stationPatch },
    );

    if (d.kind === "science") {
      after(() => analyzeCaptureById(d.captureId));
    } else {
      after(() => analyzeCalibrationCaptureById(d.captureId));
    }

    return NextResponse.json({
      ok: true,
      captureId: d.captureId,
      sequence: seq,
      clock_untrusted: captureClockUntrusted,
    });
  }

  return NextResponse.json({ error: "invalid_action" }, { status: 400 });
}
