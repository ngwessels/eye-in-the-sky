import { stationFetch } from "./http.js";
import { getJpegForRealCamera } from "./capture-jpeg.js";
import { uploadMockCapture, uploadStationCapture } from "./upload-capture.js";
import { config } from "./config.js";
import * as panTilt from "./pan-tilt/index.js";
import { sessionDebug } from "./debug-session-log.js";

type Command = {
  commandId: string;
  trace_id?: string;
};

function delayMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function clampCal(pan: number, tilt: number): { pan: number; tilt: number } {
  return {
    pan: Math.min(config.panMax, Math.max(config.panMin, pan)),
    tilt: Math.min(config.tiltMax, Math.max(config.tiltMin, tilt)),
  };
}

/**
 * Distinct logical poses per phase so servos move and frames differ (previously every shot was at home).
 * Spans a fraction of configured pan/tilt limits centered on mid-range.
 */
function poseForCalibrationPhase(phase: string): { pan: number; tilt: number } {
  const panSpan = (config.panMax - config.panMin) * 0.45;
  const tiltSpan = (config.tiltMax - config.tiltMin) * 0.35;
  const panMid = (config.panMin + config.panMax) / 2;
  const tiltMid = (config.tiltMin + config.tiltMax) / 2;
  switch (phase) {
    case "sweep_start":
      return clampCal(panMid - panSpan * 0.95, tiltMid + tiltSpan * 0.25);
    case "grid_1":
      return clampCal(panMid - panSpan * 0.4, tiltMid + tiltSpan * 0.65);
    case "grid_2":
      return clampCal(panMid + panSpan * 0.4, tiltMid + tiltSpan * 0.65);
    case "grid_3":
      return clampCal(panMid + panSpan * 0.95, tiltMid + tiltSpan * 0.25);
    default:
      return clampCal(panMid, tiltMid);
  }
}

/** Multi-step self-calibration: progress heartbeats + multiple calibration frames + server AI validation keys. */
export async function runCalibrationSequence(cmd: Command): Promise<void> {
  const keys: string[] = [];

  sessionDebug("C", "calibration-flow.ts:runCalibrationSequence", "calibration sequence start", {
    panTiltBackend: panTilt.panTiltBackend,
    mockCamera: config.mockCamera,
    settleMs: config.calibrationHomeSettleMs,
  });
  await panTilt.safeHome();
  sessionDebug("C", "calibration-flow.ts:afterSafeHome", "after safeHome", {
    pose: panTilt.getPose(),
  });
  await delayMs(config.calibrationHomeSettleMs);
  sessionDebug("C", "calibration-flow.ts:afterHomeSettle", "after home settle delay", {});

  const phases = [
    { phase: "sweep_start", percent: 5 },
    { phase: "grid_1", percent: 35 },
    { phase: "grid_2", percent: 65 },
    { phase: "grid_3", percent: 90 },
  ];

  for (const p of phases) {
    const target = poseForCalibrationPhase(p.phase);
    await panTilt.applyAbsolute(target.pan, target.tilt);
    await delayMs(config.calibrationPhaseSettleMs);
    sessionDebug("C", "calibration-flow.ts:phasePose", "pose for phase", {
      phase: p.phase,
      target,
      actual: panTilt.getPose(),
    });

    const progRes = await stationFetch("/api/stations/me/calibration/progress", {
      method: "POST",
      body: JSON.stringify(p),
    });
    sessionDebug("C", "calibration-flow.ts:progress", "calibration progress POST", {
      phase: p.phase,
      ok: progRes.ok,
      status: progRes.status,
    });

    const pose = panTilt.getPose();
    const uploadOpts = {
      trace_id: cmd.trace_id,
      command_id: cmd.commandId,
      kind: "calibration" as const,
      mount_pan_deg: pose.pan,
      mount_tilt_deg: pose.tilt,
    };
    if (config.mockCamera) {
      const { s3Key } = await uploadMockCapture(uploadOpts);
      keys.push(s3Key);
    } else {
      sessionDebug("C", "calibration-flow.ts:beforeCapture", "before getJpegForRealCamera", {
        phase: p.phase,
      });
      const jpeg = await getJpegForRealCamera();
      sessionDebug("C", "calibration-flow.ts:afterCapture", "after getJpegForRealCamera", {
        phase: p.phase,
        jpegBytes: jpeg.length,
      });
      const { s3Key } = await uploadStationCapture(jpeg, uploadOpts);
      sessionDebug("C", "calibration-flow.ts:afterUpload", "uploaded calibration frame", {
        phase: p.phase,
        s3KeySuffix: s3Key.slice(-24),
      });
      keys.push(s3Key);
    }
  }

  await stationFetch("/api/stations/me/calibration/complete", {
    method: "POST",
    body: JSON.stringify({
      north_offset_deg: 0,
      horizon_deg: 0,
      confidence: 0.72,
      method: ["pan_tilt_home_settle", "calibration_grid_poses", "multi_frame"],
      calibration_s3_keys: keys,
    }),
  });
}
