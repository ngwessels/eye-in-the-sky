import { v4 as uuidv4 } from "uuid";
import { getDb } from "../mongodb";
import { presignGet } from "../s3";
import { runSkyImageAnalysis } from "../analysis";
import { runGroundSurfaceAnalysis } from "../ground-surface-analysis";
import { getEnv } from "../env";
import {
  effectiveElevationDegForAnalysis,
  shouldUseSurfaceAnalysis,
} from "../capture-analysis-routing";
import type { CaptureDoc, StationDoc } from "../types";

/** Background job: vision analysis for one capture (science or calibration). */
export async function analyzeCaptureById(captureId: string): Promise<void> {
  const env = getEnv();
  if (!env.AI_GATEWAY_API_KEY) return;

  const db = await getDb();
  const c = await db.collection<CaptureDoc>("captures").findOne({ captureId });
  if (!c || c.kind !== "science") return;
  if (c.analysis != null) return;

  const station = await db
    .collection<StationDoc>("stations")
    .findOne({ stationId: c.stationId });

  const elev = effectiveElevationDegForAnalysis(c);
  const useSurface = shouldUseSurfaceAnalysis(
    elev,
    env.GROUND_ANALYSIS_ELEVATION_MAX_DEG,
  );

  try {
    const url = await presignGet(c.s3Key);
    const analysis_id = uuidv4();

    if (useSurface) {
      const { output, model } = await runGroundSurfaceAnalysis(url, {
        view: c.view,
        station: station ?? undefined,
      });
      await db.collection<CaptureDoc>("captures").updateOne(
        { captureId },
        {
          $set: {
            analysis: output as unknown as CaptureDoc["analysis"],
            analysis_model: model,
            analyzedAt: new Date(),
            analysis_id,
          },
        },
      );
      return;
    }

    const { output, model } = await runSkyImageAnalysis(url, {
      view: c.view,
      station: station ?? undefined,
    });
    await db.collection<CaptureDoc>("captures").updateOne(
      { captureId },
      {
        $set: {
          analysis: {
            ...output,
            analysis_target: "sky" as const,
          } as unknown as CaptureDoc["analysis"],
          analysis_model: model,
          analyzedAt: new Date(),
          analysis_id,
        },
      },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (useSurface) {
      await db.collection<CaptureDoc>("captures").updateOne(
        { captureId },
        {
          $set: {
            analysis: {
              analysis_target: "surface",
              surface_visible: false,
              surface_types: [],
              moisture_evidence: "ambiguous",
              precipitation_at_surface_likelihood: 0,
              confidence: 0,
              parse_error: true,
              error: msg,
            } as unknown as CaptureDoc["analysis"],
            analyzedAt: new Date(),
          },
        },
      );
      return;
    }

    await db.collection<CaptureDoc>("captures").updateOne(
      { captureId },
      {
        $set: {
          analysis: {
            analysis_target: "sky",
            phenomena: [],
            confidence: 0,
            parse_error: true,
            error: msg,
          } as unknown as CaptureDoc["analysis"],
          analyzedAt: new Date(),
        },
      },
    );
  }
}
