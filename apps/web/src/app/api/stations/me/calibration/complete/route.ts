import { NextResponse } from "next/server";
import { z } from "zod";
import { getStationFromAuth } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import { recomputeQualityTier } from "@/lib/tier";
import type { CaptureDoc, StationDoc } from "@/lib/types";
import { presignGet } from "@/lib/s3";
import { runCalibrationFrameValidation } from "@/lib/calibration-analysis";
import {
  northOffsetFromBoresightAndMountPan,
  runSunCalibrationAnalysis,
} from "@/lib/sun-calibration-analysis";
import { getSunPositionTrueNorth, sunElevationSufficient } from "@/lib/solar-position";
import { getEnv } from "@/lib/env";

const bodySchema = z.object({
  north_offset_deg: z.number(),
  horizon_deg: z.number(),
  confidence: z.number().min(0).max(1),
  method: z.array(z.string()),
  calibration_s3_keys: z.array(z.string()).optional(),
});

export async function POST(request: Request) {
  const station = await getStationFromAuth(request);
  if (!station) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const json = await request.json();
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const env = getEnv();
  const db = await getDb();
  let conf = parsed.data.confidence;
  const methods = [...parsed.data.method];
  let serverValidation: Record<string, unknown> | null = null;

  const firstKey = parsed.data.calibration_s3_keys?.[0];
  let viewFromCapture: CaptureDoc["view"] | undefined;
  let firstCapture: CaptureDoc | null = null;

  if (firstKey) {
    firstCapture = await db.collection<CaptureDoc>("captures").findOne({
      stationId: station.stationId,
      s3Key: firstKey,
    });
    viewFromCapture = firstCapture?.view;
  }

  let northOffsetDeg = parsed.data.north_offset_deg;
  const sunTrace: Record<string, unknown> = { attempted: false };

  if (
    firstKey &&
    firstCapture &&
    station.location &&
    env.AI_GATEWAY_API_KEY
  ) {
    const lat = station.location.lat;
    const lon = station.location.lon;
    const when = firstCapture.capturedAt;
    const ephemeris = getSunPositionTrueNorth(when, lat, lon);
    sunTrace.attempted = true;
    sunTrace.ephemeris = ephemeris;
    sunTrace.capturedAt = when.toISOString();

    const mountPan = firstCapture.mount_pan_deg ?? 0;
    const mountTilt = firstCapture.mount_tilt_deg ?? 0;
    sunTrace.mount_pan_deg = mountPan;
    sunTrace.mount_tilt_deg = mountTilt;

    if (!sunElevationSufficient(ephemeris.sun_elevation_deg, 3)) {
      sunTrace.outcome = "skipped_low_sun_elevation";
      methods.push("sun_calibration_skipped_low_elevation");
    } else if (firstCapture.clock_untrusted) {
      sunTrace.outcome = "skipped_clock_untrusted";
      methods.push("sun_calibration_skipped_clock_untrusted");
    } else {
      try {
        const url = await presignGet(firstKey);
        const { output, model } = await runSunCalibrationAnalysis(url, {
          capturedAtIso: when.toISOString(),
          latDeg: lat,
          lonDeg: lon,
          mount_pan_deg: mountPan,
          mount_tilt_deg: mountTilt,
          sun_azimuth_true_deg: ephemeris.sun_azimuth_true_deg,
          sun_elevation_deg: ephemeris.sun_elevation_deg,
        });
        sunTrace.vision = { ...output, model };
        if (
          output.sun_visible &&
          output.confidence >= 0.35 &&
          Number.isFinite(output.boresight_true_azimuth_deg)
        ) {
          northOffsetDeg = northOffsetFromBoresightAndMountPan(
            output.boresight_true_azimuth_deg,
            mountPan,
          );
          sunTrace.outcome = "applied";
          sunTrace.north_offset_deg = northOffsetDeg;
          conf = Math.min(conf, output.confidence);
          methods.push("sun_calibration");
        } else {
          sunTrace.outcome = "rejected_low_confidence_or_no_sun";
          conf *= 0.85;
          methods.push("sun_calibration_rejected");
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        sunTrace.outcome = "error";
        sunTrace.error = msg;
        conf *= 0.8;
        methods.push("sun_calibration_failed");
      }
    }
  } else if (firstKey && (!station.location || !env.AI_GATEWAY_API_KEY)) {
    sunTrace.attempted = false;
    sunTrace.outcome = "skipped_missing_location_or_ai";
  }

  if (firstKey && env.AI_GATEWAY_API_KEY) {
    try {
      const url = await presignGet(firstKey);
      const { output, model } = await runCalibrationFrameValidation(url, {
        view: viewFromCapture,
      });
      const horizonBlock = { ...output, model };
      serverValidation = {
        horizon_validation: horizonBlock,
        sun_calibration: sunTrace,
      };
      conf = Math.min(conf, output.calibration_consistency_score);
      if (!output.horizon_plausible) {
        conf *= 0.55;
      }
      methods.push("server_ai_validation");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      serverValidation = {
        horizon_validation: { error: msg },
        sun_calibration: sunTrace,
      };
      conf *= 0.65;
      methods.push("server_ai_validation_failed");
    }
  } else if (Object.keys(sunTrace).length > 1) {
    serverValidation = { sun_calibration: sunTrace };
  }

  const now = new Date();
  const nextCal: StationDoc["calibration"] = {
    ...station.calibration,
    state: conf >= 0.3 ? "ready" : "degraded",
    north_offset_deg: northOffsetDeg,
    horizon_deg: parsed.data.horizon_deg,
    confidence: conf,
    method: methods,
    updatedAt: now,
  };

  const merged: StationDoc = {
    ...station,
    calibration: nextCal,
  };
  const { quality_tier, tier_reasons } = recomputeQualityTier(merged);

  const setDoc: Record<string, unknown> = {
    calibration: nextCal,
    quality_tier,
    tier_reasons,
    calibration_s3_keys: parsed.data.calibration_s3_keys ?? [],
    lastSeenAt: now,
  };
  if (serverValidation != null) {
    setDoc.calibration_server_validation = serverValidation;
  }

  await db.collection<StationDoc>("stations").updateOne(
    { stationId: station.stationId },
    { $set: setDoc },
  );

  return NextResponse.json({
    ok: true,
    quality_tier,
    tier_reasons,
    confidence_used: conf,
    server_validation: serverValidation,
    north_offset_deg: northOffsetDeg,
  });
}
