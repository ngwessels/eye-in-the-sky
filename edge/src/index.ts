import { config } from "./config.js";
import { stationFetch } from "./http.js";
import { readGpsSnapshot } from "./gps.js";
import { uploadMockCapture } from "./upload-capture.js";
import { collectSensorReadings } from "./sensors/collect.js";
import { runCalibrationSequence } from "./calibration-flow.js";
import * as panTilt from "./pan-tilt/index.js";

type Command = {
  commandId: string;
  type: string;
  payload: Record<string, unknown>;
  trace_id?: string;
};

async function sendTelemetry() {
  const gps = readGpsSnapshot();
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
    console.error("telemetry failed", res.status, await res.text());
  }
}

async function pollCommands() {
  const res = await stationFetch("/api/stations/me/commands", { method: "GET" });
  if (!res.ok) {
    console.error("poll failed", res.status, await res.text());
    return;
  }
  const data = (await res.json()) as { commands: Command[] };
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
  const gps = readGpsSnapshot();
  const gpsBad = !gps || gps.fix_type === "none";

  try {
    switch (cmd.type) {
      case "safe_home":
        await panTilt.safeHome();
        await ack(cmd.commandId, true, { pose: panTilt.getPose() });
        break;
      case "aim_absolute": {
        if (gpsBad) {
          await ack(cmd.commandId, false, undefined, "gps_degraded");
          break;
        }
        const az = Number(cmd.payload.azimuthDeg);
        const el = Number(cmd.payload.elevationDeg);
        await panTilt.applyAbsolute(az, el);
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
      case "capture_now":
        if (config.mockCamera) {
          const pose = panTilt.getPose();
          await uploadMockCapture({
            trace_id: cmd.trace_id,
            command_id: cmd.commandId,
            kind: "science",
            mount_pan_deg: pose.pan,
            mount_tilt_deg: pose.tilt,
          });
        }
        await ack(cmd.commandId, true, { pose: panTilt.getPose() });
        break;
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
  await sendTelemetry();
  await pollCommands();
}

console.log("Eye in the Sky edge agent starting", {
  cloud: config.cloudBaseUrl,
  pollMs: config.commandPollIntervalMs,
  gpsMock: config.gpsMock,
});

void loop();
setInterval(() => void loop(), config.commandPollIntervalMs);
