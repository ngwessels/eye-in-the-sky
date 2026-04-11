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

  console.log("HOME");
  await panTilt.safeHome();
  await sleep(1500);

  console.log("aim_delta +10° pan, +5° tilt");
  await panTilt.applyDelta(10, 5);
  await sleep(1500);

  console.log("aim_delta -10° pan, -5° tilt");
  await panTilt.applyDelta(-10, -5);
  await sleep(1500);

  console.log("HOME");
  await panTilt.safeHome();

  console.log("Done. Reported pose:", panTilt.getPose());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
