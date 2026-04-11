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
  "calibration_sky_probe",
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
  /** Omitted or `"gnss"` = satellite fix; `"wifi"` = Wi-Fi geolocation; `"registered"` = cloud `stations.location` fallback on edge. */
  position_source: z.enum(["gnss", "wifi", "registered"]).optional(),
  /** Circular accuracy (m), e.g. from Mozilla geolocate `accuracy`. */
  accuracy_m: z.number().positive().optional(),
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

/** True-north azimuth + elevation (same semantics as aim_absolute). */
export const calibrationSkyProbePayloadSchema = z.object({
  azimuthDeg: z.number(),
  elevationDeg: z.number(),
});

export const commandPayloadSchema = z.union([
  aimAbsolutePayloadSchema,
  aimDeltaPayloadSchema,
  capturePayloadSchema,
  calibrationSkyProbePayloadSchema,
]);

/** Shared by sky and surface vision outputs for closed-loop aim + recapture. */
export const recommendedNextAimSchema = z.object({
  deltaPanDeg: z.number().optional(),
  deltaTiltDeg: z.number().optional(),
  absoluteAzimuthDeg: z.number().optional(),
  absoluteElevationDeg: z.number().optional(),
  rationale: z.string(),
  confidence: z.number().min(0).max(1),
});

export type RecommendedNextAim = z.infer<typeof recommendedNextAimSchema>;

export const analysisOutputSchema = z.object({
  analysis_target: z.literal("sky").optional(),
  phenomena: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  motion_hint: z.string().optional(),
  recommended_next_aim: recommendedNextAimSchema.optional(),
  recapture_after_sec: z.number().int().positive().optional(),
  horizon_consistency_score: z.number().min(0).max(1).optional(),
});

export const surfaceMoistureEvidenceSchema = z.enum([
  "dry",
  "damp",
  "wet",
  "standing_water",
  "snow",
  "ice",
  "ambiguous",
]);

export const surfaceAnalysisOutputSchema = z.object({
  analysis_target: z.literal("surface"),
  surface_visible: z.boolean(),
  surface_types: z.array(z.string()),
  moisture_evidence: surfaceMoistureEvidenceSchema,
  precipitation_at_surface_likelihood: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  notes: z.string().optional(),
  recommended_next_aim: recommendedNextAimSchema.optional(),
  recapture_after_sec: z.number().int().positive().optional(),
});

/** Server-side validation of a calibration frame (AI Gateway). */
export const calibrationValidationOutputSchema = z.object({
  horizon_plausible: z.boolean(),
  calibration_consistency_score: z.number().min(0).max(1),
  sun_direction_agreement_deg: z.number().optional(),
  notes: z.string().optional(),
});

/** Vision + ephemeris: horizontal boresight true azimuth (clockwise from true north). */
export const sunCalibrationOutputSchema = z.object({
  boresight_true_azimuth_deg: z.number(),
  confidence: z.number().min(0).max(1),
  sun_visible: z.boolean(),
  notes: z.string().optional(),
});

export type AnalysisOutput = z.infer<typeof analysisOutputSchema>;
export type SurfaceAnalysisOutput = z.infer<typeof surfaceAnalysisOutputSchema>;
export type SurfaceMoistureEvidence = z.infer<typeof surfaceMoistureEvidenceSchema>;
export type GpsSnapshot = z.infer<typeof gpsSnapshotSchema>;
export type QualityTier = z.infer<typeof qualityTierSchema>;
export type CalibrationValidationOutput = z.infer<
  typeof calibrationValidationOutputSchema
>;
export type SunCalibrationOutput = z.infer<typeof sunCalibrationOutputSchema>;

/** Opportunistic calibration window check from a sky-probe frame. */
export const calibrationProbeOutputSchema = z.object({
  is_daytime: z.boolean(),
  mostly_clear: z.boolean(),
  heavy_occlusion: z.boolean(),
  sun_disc_or_glare_visible: z.boolean(),
  suitable_for_calibration_attempt: z.boolean(),
  confidence: z.number().min(0).max(1),
  notes: z.string().optional(),
});

export type CalibrationProbeOutput = z.infer<typeof calibrationProbeOutputSchema>;
