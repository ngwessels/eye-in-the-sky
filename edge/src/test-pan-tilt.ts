import { config } from "./config.js";
import { runPanTiltEnvelopeTest } from "./pan-tilt-test-sequence.js";

async function main() {
  const dwell = config.panTiltTestDwellMs;
  const sweepSteps = config.panTiltTestSweepSteps;

  console.log("Pan/tilt long test — full configured envelope (same code path as cloud commands)");
  console.log("  PAN_TILT_DRIVER=", config.panTiltDriver);
  console.log(
    "  Logical range: pan",
    config.panMin,
    "…",
    config.panMax,
    "°  tilt",
    config.tiltMin,
    "…",
    config.tiltMax,
    "°",
  );
  console.log("  Dwell", dwell, "ms/pose  |  sweep segments", sweepSteps, "(", sweepSteps + 1, "positions per sweep)");
  if (config.panTiltDriver === "mock") {
    console.warn("  Mock driver — no hardware motion.");
  }

  await runPanTiltEnvelopeTest();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
