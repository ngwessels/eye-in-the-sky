import { NextResponse } from "next/server";
import { z } from "zod";
import { getStationFromAuth } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import { recomputeQualityTier } from "@/lib/tier";
import type { StationDoc } from "@/lib/types";
import { presignGet } from "@/lib/s3";
import { runCalibrationFrameValidation } from "@/lib/calibration-analysis";
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
  let conf = parsed.data.confidence;
  const methods = [...parsed.data.method];
  let serverValidation: Record<string, unknown> | null = null;

  const firstKey = parsed.data.calibration_s3_keys?.[0];
  if (firstKey && env.AI_GATEWAY_API_KEY) {
    try {
      const url = await presignGet(firstKey);
      const { output, model } = await runCalibrationFrameValidation(url);
      serverValidation = { ...output, model };
      conf = Math.min(conf, output.calibration_consistency_score);
      if (!output.horizon_plausible) {
        conf *= 0.55;
      }
      methods.push("server_ai_validation");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      serverValidation = { error: msg };
      conf *= 0.65;
      methods.push("server_ai_validation_failed");
    }
  }

  const db = await getDb();
  const now = new Date();
  const nextCal: StationDoc["calibration"] = {
    ...station.calibration,
    state: conf >= 0.3 ? "ready" : "degraded",
    north_offset_deg: parsed.data.north_offset_deg,
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
  });
}
