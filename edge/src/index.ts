import type { GpsSnapshot } from "@eye/shared";
import { normalizeAzimuthDeg } from "@eye/shared";
import { config, resolveOmniSlotOffsets } from "./config.js";
import { getOmniCameraCount } from "./omni-camera-count.js";
import { log } from "./logger.js";
import { stationFetch } from "./http.js";
import { resolveTelemetryPositionSnapshot } from "./position-snapshot.js";
import { getJpegForRealCamera, getJpegForRealCameraAtIndex } from "./capture-jpeg.js";
import { uploadMockCapture, uploadStationCapture } from "./upload-capture.js";
import type { StationCaptureUploadOpts } from "./upload-capture.js";
import { collectSensorReadings } from "./sensors/collect.js";
import { runCalibrationSequence } from "./calibration-flow.js";
import {
  getMountNorthOffsetDeg,
  setMountNorthOffsetFromCloud,
  setMountTiltOffsetFromCloud,
} from "./mount-settings-cache.js";

type Command = {
  commandId: string;
  type: string;
  payload: Record<string, unknown>;
  trace_id?: string;
};

/** Nominal mount pose for fixed cameras (no pan/tilt hardware). */
function nominalMountPose(): { pan: number; tilt: number } {
  return { pan: 0, tilt: 0 };
}

/** Latest fix from start of each poll cycle (GNSS preferred, else cached Wi-Fi MLS). */
let latestPositionSnapshot: GpsSnapshot | undefined;

function isPositionBadForAim(gps: GpsSnapshot | undefined): boolean {
  if (!gps || gps.fix_type === "none") return true;
  if (gps.position_source === "wifi" && !config.allowWifiForAim) return true;
  return false;
}

function positionBadReason(gps: GpsSnapshot | undefined): string {
  if (!gps) return "no_snapshot";
  if (gps.fix_type === "none") return "fix_type_none";
  if (gps.position_source === "wifi" && !config.allowWifiForAim) return "wifi_fix_but_allowWifiForAim_false";
  return "ok";
}

function aimAbsoluteAckError(badReason: string): string {
  if (badReason === "no_snapshot") return "no_position_fix";
  if (badReason === "wifi_fix_but_allowWifiForAim_false") return "wifi_not_allowed_for_aim";
  return "gps_degraded";
}

async function sendTelemetry() {
  const gps = latestPositionSnapshot;
  const readings = await collectSensorReadings();
  const body: Record<string, unknown> = {
    readings,
    time_quality: {
      synced: true,
      offset_ms_estimate: 0,
      last_ntp_sync: new Date().toISOString(),
    },
  };
  if (gps) body.gps = gps;

  const res = await stationFetch("/api/stations/me/telemetry", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    log.error("telemetry failed", { status: res.status, body: await res.text() });
  }
}

async function pollCommands() {
  const res = await stationFetch("/api/stations/me/commands", { method: "GET" });
  if (!res.ok) {
    log.error("poll failed", { status: res.status, body: await res.text() });
    return;
  }
  const data = (await res.json()) as {
    commands: Command[];
    mount?: { tilt_offset_deg?: number; north_offset_deg?: number };
  };
  const tiltOff = data.mount?.tilt_offset_deg;
  if (tiltOff != null && Number.isFinite(tiltOff)) {
    setMountTiltOffsetFromCloud(tiltOff);
  }
  const northOff = data.mount?.north_offset_deg;
  if (northOff != null && Number.isFinite(northOff)) {
    setMountNorthOffsetFromCloud(northOff);
  }
  for (const cmd of data.commands) {
    await handleCommand(cmd);
  }
}

function delayMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r));
}

async function ack(
  commandId: string,
  ok: boolean,
  result?: Record<string, unknown>,
  error?: string,
) {
  await stationFetch(`/api/stations/me/commands/${commandId}/ack`, {
    method: "POST",
    body: JSON.stringify({ ok, result, error }),
  });
}

/**
 * One still per camera index, strictly sequential (multiplexed adapters cannot use all sensors at once).
 */
async function uploadOmniSlots(
  kind: "science" | "calibration_probe",
  cmd: Command,
): Promise<number> {
  const north = getMountNorthOffsetDeg();
  const n = await getOmniCameraCount();
  const offsets = resolveOmniSlotOffsets(n);
  const elev = config.omniCaptureElevationDeg;
  log.info("omni sequential capture start", { cameras: n, kind });
  for (let i = 0; i < n; i++) {
    const slotOffset = offsets[i]!;
    const azimuth_true_deg = normalizeAzimuthDeg(north + slotOffset);
    const uploadOpts: StationCaptureUploadOpts = {
      trace_id: cmd.trace_id,
      command_id: cmd.commandId,
      kind,
      azimuth_true_deg,
      ...(elev != null ? { elevation_deg: elev } : {}),
    };
    log.info("omni capture slot", { index: i, of: n });
    if (config.mockCamera) {
      await uploadMockCapture(uploadOpts);
    } else {
      const jpeg = await getJpegForRealCameraAtIndex(i);
      await uploadStationCapture(jpeg, uploadOpts);
    }
  }
  log.info("omni sequential capture done", { cameras: n });
  return n;
}

async function handleCommand(cmd: Command) {
  const gps = latestPositionSnapshot;
  const gpsBad = isPositionBadForAim(gps);

  try {
    switch (cmd.type) {
      case "safe_home":
        await ack(cmd.commandId, false, undefined, "pan_tilt_not_supported");
        break;
      case "aim_absolute":
      case "aim_delta":
        await ack(cmd.commandId, false, undefined, "pan_tilt_not_supported");
        break;
      case "capture_now": {
        if (config.omniQuad) {
          const omni_slots = await uploadOmniSlots("science", cmd);
          await ack(cmd.commandId, true, {
            pose: nominalMountPose(),
            omni_slots,
          });
          break;
        }
        const pose = nominalMountPose();
        const uploadOpts = {
          trace_id: cmd.trace_id,
          command_id: cmd.commandId,
          kind: "science" as const,
          mount_pan_deg: pose.pan,
          mount_tilt_deg: pose.tilt,
        };
        if (config.mockCamera) {
          await uploadMockCapture(uploadOpts);
        } else {
          const jpeg = await getJpegForRealCamera();
          await uploadStationCapture(jpeg, uploadOpts);
        }
        await ack(cmd.commandId, true, { pose });
        break;
      }
      case "calibration_sky_probe": {
        if (gpsBad) {
          const br = positionBadReason(gps);
          await ack(cmd.commandId, false, undefined, aimAbsoluteAckError(br));
          break;
        }
        if (config.omniQuad) {
          const omni_slots = await uploadOmniSlots("calibration_probe", cmd);
          await ack(cmd.commandId, true, {
            pose: nominalMountPose(),
            omni_slots,
          });
          break;
        }
        await delayMs(config.calibrationSkyProbeSettleMs);
        const pose = nominalMountPose();
        const uploadOpts = {
          trace_id: cmd.trace_id,
          command_id: cmd.commandId,
          kind: "calibration_probe" as const,
          mount_pan_deg: pose.pan,
          mount_tilt_deg: pose.tilt,
        };
        if (config.mockCamera) {
          await uploadMockCapture(uploadOpts);
        } else {
          const jpeg = await getJpegForRealCamera();
          await uploadStationCapture(jpeg, uploadOpts);
        }
        await ack(cmd.commandId, true, { pose });
        break;
      }
      case "run_calibration":
        await runCalibrationSequence(cmd);
        await ack(cmd.commandId, true, { pose: nominalMountPose() });
        break;
      default:
        await ack(cmd.commandId, false, undefined, "unknown_command");
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await ack(cmd.commandId, false, undefined, msg);
  }
}

async function loop() {
  log.info("poll cycle starting");
  latestPositionSnapshot = await resolveTelemetryPositionSnapshot();
  await sendTelemetry();
  await pollCommands();
  const pos = latestPositionSnapshot;
  log.info("poll cycle complete", {
    pollIntervalMs: config.commandPollIntervalMs,
    fix_type: pos?.fix_type ?? "none",
    position_source: pos?.position_source,
  });
}

async function pullMountSettingsOnce() {
  try {
    const res = await stationFetch("/api/stations/me/mount", { method: "GET" });
    if (!res.ok) return;
    const j = (await res.json()) as {
      mount_tilt_offset_deg?: number;
      north_offset_deg?: number;
    };
    if (typeof j.mount_tilt_offset_deg === "number" && Number.isFinite(j.mount_tilt_offset_deg)) {
      setMountTiltOffsetFromCloud(j.mount_tilt_offset_deg);
    }
    if (typeof j.north_offset_deg === "number" && Number.isFinite(j.north_offset_deg)) {
      setMountNorthOffsetFromCloud(j.north_offset_deg);
    }
  } catch {
    /* offline or transient */
  }
}

log.info("Eye on the Sky edge agent ready", {
  cloud: config.cloudBaseUrl,
  pollMs: config.commandPollIntervalMs,
  mockCamera: config.mockCamera,
  omniQuad: config.omniQuad,
  omniCameraCountEnv: process.env.OMNI_CAMERA_COUNT?.trim() || "auto",
  wifiPositioning: config.wifiPositioningEnabled,
  wifiIpGeoFallback: config.wifiIpGeoFallbackEnabled,
  allowWifiForProbe: config.allowWifiForAim,
});
if (!config.wifiPositioningEnabled) {
  log.info(
    "Wi-Fi positioning disabled (WIFI_POSITIONING=0). Without a GNSS fix in gps.ts, telemetry may omit position and calibration_sky_probe may fail with no_position_fix.",
  );
}

process.on("unhandledRejection", (reason) => {
  log.error("unhandledRejection", { reason: reason instanceof Error ? reason.message : String(reason) });
});

process.on("uncaughtException", (err) => {
  log.error("uncaughtException", { message: err.message, stack: err.stack });
  process.exit(1);
});

void (async () => {
  try {
    await pullMountSettingsOnce();
    await loop();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error("main loop fatal", { message: msg, stack: e instanceof Error ? e.stack : undefined });
    process.exit(1);
  }
})();
setInterval(() => {
  void (async () => {
    try {
      await loop();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error("poll cycle error", { message: msg, stack: e instanceof Error ? e.stack : undefined });
    }
  })();
}, config.commandPollIntervalMs);
