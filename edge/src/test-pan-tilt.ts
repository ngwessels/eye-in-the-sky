import { config } from "./config.js";
import * as panTilt from "./pan-tilt/index.js";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log("Pan/tilt hardware test (same code path as cloud commands)");
  console.log("  PAN_TILT_DRIVER=", config.panTiltDriver);
  if (config.panTiltDriver === "mock") {
    console.warn("  Mock driver — set PAN_TILT_DRIVER=serial or pca9685 in .env for real motion.");
  }

  const dp = config.panTiltTestDeltaPan;
  const dt = config.panTiltTestDeltaTilt;
  console.log(
    `Test deltas: pan ±${dp}°, tilt ±${dt}° logical (override with PAN_TILT_TEST_DELTA_PAN / PAN_TILT_TEST_DELTA_TILT)`,
  );
  console.log(
    "Note: pan maps 360° logical range → servo 0–180°, so small logical steps barely twitch; defaults above are sized to be obvious.",
  );

  console.log("HOME");
  await panTilt.safeHome();
  await sleep(1500);

  console.log(`aim_delta +${dp}° pan, +${dt}° tilt`);
  await panTilt.applyDelta(dp, dt);
  await sleep(2000);

  console.log(`aim_delta -${dp}° pan, -${dt}° tilt`);
  await panTilt.applyDelta(-dp, -dt);
  await sleep(2000);

  console.log("HOME");
  await panTilt.safeHome();

  console.log("Done. Reported pose:", panTilt.getPose());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
