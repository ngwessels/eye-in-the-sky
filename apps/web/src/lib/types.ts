import type { QualityTier } from "@eye/shared";

export type CaptureViewSource = "edge_finalize" | "inferred";

/** Camera boresight relative to true north (clockwise), persisted at ingest. */
export interface CaptureViewDoc {
  azimuth_true_deg: number;
  elevation_deg?: number;
  cardinal16: string;
  source: CaptureViewSource;
}

export type CommandType =
  | "aim_absolute"
  | "aim_delta"
  | "capture_now"
  | "safe_home"
  | "run_calibration";

export type CommandState = "pending" | "ack" | "failed" | "expired";

export interface StationDoc {
  _id?: import("mongodb").ObjectId;
  stationId: string;
  name: string;
  /** sha256 hex of full API key (lookup); keep keys long & random */
  apiKeyFingerprint: string;
  createdAt: Date;
  lastSeenAt: Date;
  location?: { lat: number; lon: number; alt?: number };
  location_source: "gps";
  gps: {
    fix_type: string;
    hdop?: number;
    sat_count?: number;
    last_fix_at?: Date;
    degraded: boolean;
  };
  capabilities: {
    sensors: string[];
    panTilt?: { panMin: number; panMax: number; tiltMin: number; tiltMax: number };
  };
  calibration: {
    state: "pending" | "ready" | "degraded";
    north_offset_deg?: number;
    horizon_deg?: number;
    confidence: number;
    updatedAt?: Date;
    method: string[];
  };
  quality_tier: QualityTier;
  tier_reasons: string[];
  time_quality?: {
    synced: boolean;
    offset_ms_estimate?: number;
    last_ntp_sync?: Date;
  };
  health: { uploadSuccessEma: number };
  sequence: number;
  clock_untrusted?: boolean;
  sensor_anomaly_flags?: string[];
  calibration_server_validation?: Record<string, unknown>;
}

export interface CommandDoc {
  _id?: import("mongodb").ObjectId;
  commandId: string;
  stationId: string;
  type: CommandType;
  payload: Record<string, unknown>;
  state: CommandState;
  createdAt: Date;
  expiresAt: Date;
  trace_id?: string;
  parent_command_id?: string;
  watch_target?: Record<string, unknown>;
  selection_reason?: string;
  followup_depth?: number;
  ackAt?: Date;
  ackResult?: Record<string, unknown>;
}

export interface CaptureDoc {
  _id?: import("mongodb").ObjectId;
  captureId: string;
  stationId: string;
  s3Bucket: string;
  s3Key: string;
  mediaType: "image" | "video";
  contentType: string;
  byteSize: number;
  etag?: string;
  capturedAt: Date;
  trace_id?: string;
  command_id?: string;
  kind: "science" | "calibration";
  clock_skew_ms?: number;
  sha256?: string;
  analysis?: Record<string, unknown> | null;
  analysis_model?: string;
  analyzedAt?: Date;
  followups_enqueued?: number;
  closed_loop_applied?: boolean;
  /** Monotonic per-station ingest sequence */
  sequence?: number;
  analysis_id?: string;
  clock_untrusted?: boolean;
  calibration_ai?: Record<string, unknown>;
  calibration_analysis_model?: string;
  calibration_analyzedAt?: Date;
  view?: CaptureViewDoc;
}
