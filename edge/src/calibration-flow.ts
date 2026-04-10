import { stationFetch } from "./http.js";
import { uploadMockCapture } from "./upload-capture.js";
import { config } from "./config.js";

type Command = {
  commandId: string;
  trace_id?: string;
};

/** Multi-step self-calibration: progress heartbeats + multiple calibration frames + server AI validation keys. */
export async function runCalibrationSequence(cmd: Command): Promise<void> {
  const keys: string[] = [];

  const phases = [
    { phase: "sweep_start", percent: 5 },
    { phase: "grid_1", percent: 35 },
    { phase: "grid_2", percent: 65 },
    { phase: "grid_3", percent: 90 },
  ];

  for (const p of phases) {
    await stationFetch("/api/stations/me/calibration/progress", {
      method: "POST",
      body: JSON.stringify(p),
    });
    if (config.mockCamera) {
      const { s3Key } = await uploadMockCapture({
        trace_id: cmd.trace_id,
        command_id: cmd.commandId,
        kind: "calibration",
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
      method: ["mock_grid_sweep", "multi_frame"],
      calibration_s3_keys: keys,
    }),
  });
}
