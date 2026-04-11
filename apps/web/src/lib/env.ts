import { z } from "zod";

const schema = z.object({
  MONGODB_URI: z.string().min(1),
  AWS_REGION: z.string().min(1),
  /** If set, used for S3 presigns only (bucket may live in a different region than other AWS resources). */
  S3_BUCKET_REGION: z.string().min(1).optional(),
  AWS_ACCESS_KEY_ID: z.string().min(1),
  AWS_SECRET_ACCESS_KEY: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  ADMIN_SECRET: z.string().min(8),
  CRON_SECRET: z.string().min(8).optional(),
  AI_GATEWAY_API_KEY: z.string().optional(),
  AI_VISION_MODEL: z.string().default("openai/gpt-4o"),
  APPLE_TEAM_ID: z.string().optional(),
  APPLE_SERVICE_ID: z.string().optional(),
  APPLE_KEY_ID: z.string().optional(),
  /** Full PEM contents (use in Vercel / CI; never commit). Literal \\n in the value is normalized to newlines. */
  APPLE_PRIVATE_KEY: z.string().optional(),
  /** Local dev: path to AuthKey_*.p8 */
  APPLE_PRIVATE_KEY_PATH: z.string().optional(),
  RATE_POLL_PER_MIN: z.coerce.number().default(30),
  RATE_TELEMETRY_PER_MIN: z.coerce.number().default(40),
  RATE_PRESIGN_PER_MIN: z.coerce.number().default(20),
  MAX_FOLLOWUPS_PER_TRACE: z.coerce.number().default(5),
  GPS_MAX_HDOP: z.coerce.number().default(5),
  GPS_MIN_SATS: z.coerce.number().default(4),
  CLOCK_SKEW_REJECT_MS: z.coerce.number().default(120_000),
  /** reject = HTTP 400; downrank = accept capture, flag station */
  CLOCK_SKEW_MODE: z.enum(["reject", "downrank"]).default("reject"),
  MAX_CAPTURE_BYTES: z.coerce.number().default(40 * 1024 * 1024),
  /** Below this calibration confidence, orchestrator may schedule sky probes / recalibration. */
  CALIBRATION_CONFIDENCE_NEED_THRESHOLD: z.coerce.number().min(0).max(1).default(0.35),
  /** Min time between sky-probe commands per station (ms). */
  CALIBRATION_PROBE_MIN_INTERVAL_MS: z.coerce.number().default(2 * 3600 * 1000),
  /** Min time between `run_calibration` enqueues triggered by probe success (ms). */
  CALIBRATION_RUN_MIN_INTERVAL_MS: z.coerce.number().default(3600 * 1000),
  /** GNSS move vs `calibration.anchor` above this (m) sets suspected_location_shift. */
  CALIBRATION_ANCHOR_MOVE_M: z.coerce.number().default(40),
  /** Cap stations considered per orchestrator cron tick. */
  CALIBRATION_ORCHESTRATOR_MAX_STATIONS_PER_TICK: z.coerce.number().int().positive().default(50),
  CALIBRATION_HORIZON_LOW_THRESHOLD: z.coerce.number().min(0).max(1).default(0.35),
  CALIBRATION_HORIZON_LOW_MIN_CAPTURES: z.coerce.number().int().positive().default(5),
  CALIBRATION_HORIZON_LOW_MIN_COUNT: z.coerce.number().int().positive().default(3),
  /** Probe vision must meet this to enqueue full calibration. */
  CALIBRATION_PROBE_CONFIDENCE_GATE: z.coerce.number().min(0).max(1).default(0.45),
  /** Do not enqueue sky probe when sun is below this elevation (deg). */
  CALIBRATION_PROBE_SUN_ELEVATION_MIN: z.coerce.number().default(5),
  /** Captures with elevation at or below this (deg above horizon) use surface/ground vision. */
  GROUND_ANALYSIS_ELEVATION_MAX_DEG: z.coerce.number().default(12),
  /** Commanded elevation for periodic ground samples (deg above horizon). */
  GROUND_CRON_ELEVATION_DEG: z.coerce.number().default(-5),
  /** Min time between ground-observation cron commands per station (ms). */
  GROUND_CRON_MIN_INTERVAL_MS: z.coerce.number().default(4 * 3600 * 1000),
  /** Max age of latest science capture used for bearing (ms). */
  GROUND_CRON_BEARING_MAX_AGE_MS: z.coerce.number().default(24 * 3600 * 1000),
  /** Cap command pairs (aim + capture) considered per ground-observation cron tick. */
  GROUND_CRON_MAX_STATIONS_PER_TICK: z.coerce.number().int().positive().default(50),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.flatten().fieldErrors;
    throw new Error(`Invalid env: ${JSON.stringify(msg)}`);
  }
  cached = parsed.data;
  return cached;
}
