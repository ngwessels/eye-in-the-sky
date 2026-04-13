import { normalizeAzimuthDeg } from "@eye/shared";
import { stationFetch } from "./http.js";
import { getJpegForRealCamera, getJpegForRealCameraAtIndex } from "./capture-jpeg.js";
import { uploadMockCapture, uploadStationCapture } from "./upload-capture.js";
import type { StationCaptureUploadOpts } from "./upload-capture.js";
import { config, resolveOmniSlotOffsets } from "./config.js";
import { getOmniCameraCount } from "./omni-camera-count.js";
import { getMountNorthOffsetDeg } from "./mount-settings-cache.js";

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
): Promise<void> {
  const north = getMountNorthOffsetDeg();
  const n = await getOmniCameraCount();
  const offsets = resolveOmniSlotOffsets(n);
  const elev = config.omniCaptureElevationDeg;

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
    if (config.mockCamera) {
      const { s3Key } = await uploadMockCapture(uploadOpts);
      keys.push(s3Key);
    } else {
      const jpeg = await getJpegForRealCameraAtIndex(i);
      const { s3Key } = await uploadStationCapture(jpeg, uploadOpts);
      keys.push(s3Key);
    }
  }
}

/** Fixed single camera: one still per phase. */
async function uploadSingleCameraCalibrationPhase(
  cmd: Command,
  keys: string[],
): Promise<void> {
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
    const jpeg = await getJpegForRealCamera();
    const { s3Key } = await uploadStationCapture(jpeg, uploadOpts);
    keys.push(s3Key);
  }
}

/**
 * Multi-phase calibration: progress heartbeats + calibration frames + server `/calibration/complete`.
 * Omni: each phase captures **all** camera slots in order (first S3 key = slot 0 for sun / north_offset).
 */
export async function runCalibrationSequence(cmd: Command): Promise<void> {
  const keys: string[] = [];

  await delayMs(config.calibrationHomeSettleMs);

  const phases = [
    { phase: "sweep_start", percent: 5 },
    { phase: "grid_1", percent: 35 },
    { phase: "grid_2", percent: 65 },
    { phase: "grid_3", percent: 90 },
  ];

  for (const p of phases) {
    await delayMs(config.calibrationPhaseSettleMs);

    await stationFetch("/api/stations/me/calibration/progress", {
      method: "POST",
      body: JSON.stringify(p),
    });

    if (config.omniQuad) {
      await uploadOmniCalibrationPhase(cmd, keys);
    } else {
      await uploadSingleCameraCalibrationPhase(cmd, keys);
    }
  }

  const method = config.omniQuad
    ? ["omni_quad", "fixed_mount_settle", "multi_slot_per_phase", "multi_frame"]
    : ["fixed_mount_settle", "multi_frame_calibration", "multi_frame"];

  await stationFetch("/api/stations/me/calibration/complete", {
    method: "POST",
    body: JSON.stringify({
      north_offset_deg: 0,
      horizon_deg: 0,
      confidence: 0.72,
      method,
      calibration_s3_keys: keys,
    }),
  });
}
