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
