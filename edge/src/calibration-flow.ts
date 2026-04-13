import { normalizeAzimuthDeg } from "@eye/shared";
import { stationFetch } from "./http.js";
import {
  getJpegForCalibrationStill,
  getJpegForCalibrationStillAtIndex,
} from "./capture-jpeg.js";
import { uploadMockCapture, uploadStationCapture } from "./upload-capture.js";
import type { StationCaptureUploadOpts } from "./upload-capture.js";
import { config, resolveOmniSlotOffsets } from "./config.js";
import { getOmniCameraCount } from "./omni-camera-count.js";
import { getMountNorthOffsetDeg } from "./mount-settings-cache.js";
import { log } from "./logger.js";

// #region agent log
function debugCal(
  message: string,
  hypothesisId: string,
  data: Record<string, unknown>,
): void {
  fetch("http://127.0.0.1:7932/ingest/c5819765-bc3d-4bb6-91da-21204e2311a3", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "5044f5" },
    body: JSON.stringify({
      sessionId: "5044f5",
      location: "calibration-flow.ts",
      message,
      hypothesisId,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {});
}
// #endregion

type Command = {
  commandId: string;
  trace_id?: string;
};

function delayMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r));
}

/** Per phase: all omni slots sequentially; `keys` order is slot0..slotN-1 so first key is reference boresight for sun calibration. */
async function uploadOmniCalibrationPhase(
  cmd: Command,
  keys: string[],
  phaseLabel: string,
): Promise<void> {
  const north = getMountNorthOffsetDeg();
  const n = await getOmniCameraCount();
  const offsets = resolveOmniSlotOffsets(n);
  const elev = config.omniCaptureElevationDeg;

  log.info("calibration omni phase uploads starting", {
    commandId: cmd.commandId,
    trace_id: cmd.trace_id ?? null,
    phase: phaseLabel,
    cameraCount: n,
    north_offset_cached_deg: north,
    mockCamera: config.mockCamera,
  });
  // #region agent log
  debugCal("omni_phase_uploads_start", "H2", {
    commandId: cmd.commandId,
    phase: phaseLabel,
    cameraCount: n,
  });
  // #endregion

  for (let i = 0; i < n; i++) {
    const slotOffset = offsets[i]!;
    const azimuth_true_deg = normalizeAzimuthDeg(north + slotOffset);
    const uploadOpts: StationCaptureUploadOpts = {
      trace_id: cmd.trace_id,
      command_id: cmd.commandId,
      kind: "calibration",
      azimuth_true_deg,
      ...(elev != null ? { elevation_deg: elev } : {}),
    };
    log.info("calibration omni slot shutter", {
      commandId: cmd.commandId,
      phase: phaseLabel,
      slotIndex: i,
      azimuth_true_deg,
    });
    if (config.mockCamera) {
      const { s3Key } = await uploadMockCapture(uploadOpts);
      keys.push(s3Key);
    } else {
      const jpeg = await getJpegForCalibrationStillAtIndex(i);
      const { s3Key } = await uploadStationCapture(jpeg, uploadOpts);
      keys.push(s3Key);
    }
    log.info("calibration omni slot uploaded", {
      commandId: cmd.commandId,
      phase: phaseLabel,
      slotIndex: i,
      keysTotal: keys.length,
    });
  }
  // #region agent log
  debugCal("omni_phase_uploads_done", "H1", {
    commandId: cmd.commandId,
    phase: phaseLabel,
    keysTotal: keys.length,
  });
  // #endregion
}

/** Fixed single camera: one still per phase. */
async function uploadSingleCameraCalibrationPhase(
  cmd: Command,
  keys: string[],
  phaseLabel: string,
): Promise<void> {
  log.info("calibration single-camera phase upload starting", {
    commandId: cmd.commandId,
    trace_id: cmd.trace_id ?? null,
    phase: phaseLabel,
    mockCamera: config.mockCamera,
  });
  const uploadOpts = {
    trace_id: cmd.trace_id,
    command_id: cmd.commandId,
    kind: "calibration" as const,
    mount_pan_deg: 0,
    mount_tilt_deg: 0,
  };
  if (config.mockCamera) {
    const { s3Key } = await uploadMockCapture(uploadOpts);
    keys.push(s3Key);
  } else {
    const jpeg = await getJpegForCalibrationStill();
    const { s3Key } = await uploadStationCapture(jpeg, uploadOpts);
    keys.push(s3Key);
  }
  log.info("calibration single-camera phase uploaded", {
    commandId: cmd.commandId,
    phase: phaseLabel,
    keysTotal: keys.length,
  });
}

/**
 * Multi-phase calibration: progress heartbeats + calibration frames + server `/calibration/complete`.
 * Omni: each phase captures **all** camera slots in order (first S3 key = slot 0 for sun / north_offset).
 */
export async function runCalibrationSequence(cmd: Command): Promise<void> {
  const keys: string[] = [];

  log.info("calibration sequence start", {
    commandId: cmd.commandId,
    trace_id: cmd.trace_id ?? null,
    omniQuad: config.omniQuad,
    mockCamera: config.mockCamera,
    homeSettleMs: config.calibrationHomeSettleMs,
    phaseSettleMs: config.calibrationPhaseSettleMs,
  });
  // #region agent log
  debugCal("sequence_start", "H4", {
    commandId: cmd.commandId,
    omniQuad: config.omniQuad,
    homeSettleMs: config.calibrationHomeSettleMs,
  });
  // #endregion

  await delayMs(config.calibrationHomeSettleMs);

  log.info("calibration home settle done", { commandId: cmd.commandId });

  const phases = [
    { phase: "sweep_start", percent: 5 },
    { phase: "grid_1", percent: 35 },
    { phase: "grid_2", percent: 65 },
    { phase: "grid_3", percent: 90 },
  ];

  for (const p of phases) {
    await delayMs(config.calibrationPhaseSettleMs);

    log.info("calibration posting progress", {
      commandId: cmd.commandId,
      phase: p.phase,
      percent: p.percent,
    });
    const progRes = await stationFetch("/api/stations/me/calibration/progress", {
      method: "POST",
      body: JSON.stringify(p),
    });
    const progBody = await progRes.text();
    if (!progRes.ok) {
      log.warn("calibration progress HTTP not ok", {
        commandId: cmd.commandId,
        phase: p.phase,
        status: progRes.status,
        bodySnippet: progBody.slice(0, 800),
      });
    } else {
      log.info("calibration progress ok", {
        commandId: cmd.commandId,
        phase: p.phase,
        status: progRes.status,
      });
    }
    // #region agent log
    debugCal("progress_response", "H3", {
      commandId: cmd.commandId,
      phase: p.phase,
      ok: progRes.ok,
      statusCode: progRes.status,
    });
    // #endregion

    if (config.omniQuad) {
      await uploadOmniCalibrationPhase(cmd, keys, p.phase);
    } else {
      await uploadSingleCameraCalibrationPhase(cmd, keys, p.phase);
    }

    log.info("calibration phase capture batch finished", {
      commandId: cmd.commandId,
      phase: p.phase,
      keysSoFar: keys.length,
    });
    // #region agent log
    debugCal("phase_batch_done", "H4", {
      commandId: cmd.commandId,
      phase: p.phase,
      keysSoFar: keys.length,
    });
    // #endregion
  }

  const method = config.omniQuad
    ? ["omni_quad", "fixed_mount_settle", "multi_slot_per_phase", "multi_frame"]
    : ["fixed_mount_settle", "multi_frame_calibration", "multi_frame"];

  log.info("calibration posting complete", {
    commandId: cmd.commandId,
    keyCount: keys.length,
    method,
  });
  // #region agent log
  debugCal("complete_request", "H5", { commandId: cmd.commandId, keyCount: keys.length });
  // #endregion

  const completeRes = await stationFetch("/api/stations/me/calibration/complete", {
    method: "POST",
    body: JSON.stringify({
      north_offset_deg: 0,
      horizon_deg: 0,
      confidence: 0.72,
      method,
      calibration_s3_keys: keys,
    }),
  });
  const completeBody = await completeRes.text();
  if (!completeRes.ok) {
    log.warn("calibration complete HTTP not ok", {
      commandId: cmd.commandId,
      status: completeRes.status,
      bodySnippet: completeBody.slice(0, 1200),
    });
  } else {
    log.info("calibration complete ok", {
      commandId: cmd.commandId,
      status: completeRes.status,
      bodySnippet: completeBody.slice(0, 400),
    });
  }
  // #region agent log
  debugCal("complete_response", "H5", {
    commandId: cmd.commandId,
    httpOk: completeRes.ok,
    statusCode: completeRes.status,
  });
  // #endregion
}
