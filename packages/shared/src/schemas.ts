import { z } from "zod";

export const qualityTierSchema = z.enum([
  "gps_degraded",
  "bronze",
  "silver",
  "gold",
]);

export const commandTypeSchema = z.enum([
  "aim_absolute",
  "aim_delta",
  "capture_now",
  "safe_home",
  "run_calibration",
]);

export const commandStateSchema = z.enum(["pending", "ack", "failed", "expired"]);

export const gpsSnapshotSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  alt_msl: z.number().optional(),
  hdop: z.number().positive().optional(),
  sat_count: z.number().int().nonnegative().optional(),
  fix_type: z.enum(["none", "2d", "3d", "dgps", "rtk"]).or(z.string()),
  observedAt: z.string().datetime(),
});

export const telemetryReadingSchema = z.object({
  sensorId: z.string(),
  type: z.string(),
  value: z.number(),
  unit: z.string(),
  observedAt: z.string().datetime(),
});

export const telemetryBodySchema = z.object({
  gps: gpsSnapshotSchema.optional(),
  readings: z.array(telemetryReadingSchema).default([]),
  time_quality: z
    .object({
      synced: z.boolean(),
      offset_ms_estimate: z.number().optional(),
      last_ntp_sync: z.string().datetime().optional(),
    })
    .optional(),
});

export const aimAbsolutePayloadSchema = z.object({
  azimuthDeg: z.number(),
  elevationDeg: z.number(),
});

export const aimDeltaPayloadSchema = z.object({
  deltaPanDeg: z.number(),
  deltaTiltDeg: z.number(),
});

export const capturePayloadSchema = z.object({}).optional();

export const commandPayloadSchema = z.union([
  aimAbsolutePayloadSchema,
  aimDeltaPayloadSchema,
  capturePayloadSchema,
]);

export const analysisOutputSchema = z.object({
  phenomena: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  motion_hint: z.string().optional(),
  recommended_next_aim: z
    .object({
      deltaPanDeg: z.number().optional(),
      deltaTiltDeg: z.number().optional(),
      absoluteAzimuthDeg: z.number().optional(),
      absoluteElevationDeg: z.number().optional(),
      rationale: z.string(),
      confidence: z.number().min(0).max(1),
    })
    .optional(),
  recapture_after_sec: z.number().int().positive().optional(),
  horizon_consistency_score: z.number().min(0).max(1).optional(),
});

/** Server-side validation of a calibration frame (AI Gateway). */
export const calibrationValidationOutputSchema = z.object({
  horizon_plausible: z.boolean(),
  calibration_consistency_score: z.number().min(0).max(1),
  sun_direction_agreement_deg: z.number().optional(),
  notes: z.string().optional(),
});

export type AnalysisOutput = z.infer<typeof analysisOutputSchema>;
export type GpsSnapshot = z.infer<typeof gpsSnapshotSchema>;
export type QualityTier = z.infer<typeof qualityTierSchema>;
export type CalibrationValidationOutput = z.infer<
  typeof calibrationValidationOutputSchema
>;
