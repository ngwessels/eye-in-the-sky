import type { GpsSnapshot } from "@eye/shared";
import { config } from "./config.js";
import { log } from "./logger.js";
import { stationFetch } from "./http.js";
import { resolveTelemetryPositionSnapshot } from "./position-snapshot.js";
import { getJpegForRealCamera } from "./capture-jpeg.js";
import { uploadMockCapture, uploadStationCapture } from "./upload-capture.js";
import { collectSensorReadings } from "./sensors/collect.js";
import { runCalibrationSequence } from "./calibration-flow.js";
import * as panTilt from "./pan-tilt/index.js";
import { normalizeAzimuthDeg } from "@eye/shared";
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

/** Map geographic azimuth [0, 360) to mount pan [-180, 180] before driver clamp. */
function azimuthToPanDeg(azimuthDeg: number): number {
  const a = ((azimuthDeg % 360) + 360) % 360;
  return a > 180 ? a - 360 : a;
}

/** Commanded true-north azimuth (clockwise) to logical mount pan given calibration.north_offset_deg. */
function geographicAzimuthToMountPanDeg(geoAzDeg: number, northOffsetDeg: number): number {
  const mountAz = normalizeAzimuthDeg(geoAzDeg - northOffsetDeg);
  return azimuthToPanDeg(mountAz);
}

/** Latest fix from start of each poll cycle (GNSS preferred, else cached Wi-Fi MLS). */
let latestPositionSnapshot: GpsSnapshot | undefined;

function isPositionBadForAim(gps: GpsSnapshot | undefined): boolean {
  if (!gps || gps.fix_type === "none") return true;
  if (gps.position_source === "wifi" && !config.allowWifiForAim) return true;
  return false;
}

/** Why `aim_absolute` treats position as unusable (for console debugging on device). */
function positionBadReason(gps: GpsSnapshot | undefined): string {
  if (!gps) return "no_snapshot";
  if (gps.fix_type === "none") return "fix_type_none";
  if (gps.position_source === "wifi" && !config.allowWifiForAim) return "wifi_fix_but_allowWifiForAim_false";
  return "ok";
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

async function handleCommand(cmd: Command) {
  const gps = latestPositionSnapshot;
  const gpsBad = isPositionBadForAim(gps);

  try {
    switch (cmd.type) {
      case "safe_home":
        await panTilt.safeHome();
        await ack(cmd.commandId, true, { pose: panTilt.getPose() });
        break;
      case "aim_absolute": {
        // #region agent log
        console.log(
          "[eye-debug] H3_H4 aim_absolute precheck",
          JSON.stringify({
            hypothesisId: "H3_H4",
            commandId: cmd.commandId,
            trace_id: cmd.trace_id ?? null,
            gpsBad,
            badReason: positionBadReason(gps),
            allowWifiForAim: config.allowWifiForAim,
            wifiPositioningEnabled: config.wifiPositioningEnabled,
            snapshot: gps
              ? {
                  fix_type: gps.fix_type,
                  position_source: gps.position_source ?? null,
                  lat: gps.lat,
                  lon: gps.lon,
                  accuracy_m: gps.accuracy_m ?? null,
                  observedAt: gps.observedAt ?? null,
                }
              : null,
          }),
        );
        // #endregion
        if (gpsBad) {
          // #region agent log
          console.log(
            "[eye-debug] H3_H4 aim_absolute ack gps_degraded",
            JSON.stringify({
              hypothesisId: "H3_H4",
              commandId: cmd.commandId,
              badReason: positionBadReason(gps),
            }),
          );
          // #endregion
          await ack(cmd.commandId, false, undefined, "gps_degraded");
          break;
        }
        const az = Number(cmd.payload.azimuthDeg);
        const el = Number(cmd.payload.elevationDeg);
        const pan = geographicAzimuthToMountPanDeg(az, getMountNorthOffsetDeg());
        await panTilt.applyAbsolute(pan, el);
        await ack(cmd.commandId, true, { pose: panTilt.getPose() });
        break;
      }
      case "aim_delta": {
        const dp = Number(cmd.payload.deltaPanDeg ?? 0);
        const dt = Number(cmd.payload.deltaTiltDeg ?? 0);
        await panTilt.applyDelta(dp, dt);
        await ack(cmd.commandId, true, { pose: panTilt.getPose() });
        break;
      }
      case "capture_now": {
        const pose = panTilt.getPose();
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
        await ack(cmd.commandId, true, { pose: panTilt.getPose() });
        break;
      }
      case "run_calibration":
        await runCalibrationSequence(cmd);
        await ack(cmd.commandId, true, { pose: panTilt.getPose() });
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

log.info("Eye in the Sky edge agent ready", {
  cloud: config.cloudBaseUrl,
  pollMs: config.commandPollIntervalMs,
  panTiltDriver: config.panTiltDriver,
  panTiltBackend: panTilt.panTiltBackend,
  mockCamera: config.mockCamera,
  wifiPositioning: config.wifiPositioningEnabled,
  allowWifiForAim: config.allowWifiForAim,
});

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
