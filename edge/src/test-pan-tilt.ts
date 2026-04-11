import { config } from "./config.js";
import * as panTilt from "./pan-tilt/index.js";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

async function main() {
  const dwell = config.panTiltTestDwellMs;
  const sweepSteps = config.panTiltTestSweepSteps;
  const panMin = config.panMin;
  const panMax = config.panMax;
  const tiltMin = config.tiltMin;
  const tiltMax = config.tiltMax;
  const panMid = (panMin + panMax) / 2;
  const tiltMid = (tiltMin + tiltMax) / 2;

  console.log("Pan/tilt long test — full configured envelope (same code path as cloud commands)");
  console.log("  PAN_TILT_DRIVER=", config.panTiltDriver);
  console.log("  Logical range: pan", panMin, "…", panMax, "°  tilt", tiltMin, "…", tiltMax, "°");
  console.log("  Dwell", dwell, "ms/pose  |  sweep segments", sweepSteps, "(", sweepSteps + 1, "positions per sweep)");
  if (config.panTiltDriver === "mock") {
    console.warn("  Mock driver — no hardware motion.");
  }

  async function pose(pan: number, tilt: number, label: string) {
    console.log(label, { pan: +pan.toFixed(2), tilt: +tilt.toFixed(2) });
    await panTilt.applyAbsolute(pan, tilt);
    await sleep(dwell);
  }

  async function sweepPan(
    from: number,
    to: number,
    tiltHold: number,
    direction: string,
  ) {
    console.log(`Pan sweep ${direction} (${sweepSteps + 1} stops), tilt held at`, tiltHold);
    for (let i = 0; i <= sweepSteps; i++) {
      const t = i / sweepSteps;
      const pan = lerp(from, to, t);
      await pose(pan, tiltHold, `  [${i + 1}/${sweepSteps + 1}]`);
    }
  }

  async function sweepTilt(
    from: number,
    to: number,
    panHold: number,
    direction: string,
  ) {
    console.log(`Tilt sweep ${direction} (${sweepSteps + 1} stops), pan held at`, panHold);
    for (let i = 0; i <= sweepSteps; i++) {
      const t = i / sweepSteps;
      const tilt = lerp(from, to, t);
      await pose(panHold, tilt, `  [${i + 1}/${sweepSteps + 1}]`);
    }
  }

  console.log("\n— Phase 1: HOME —");
  console.log("HOME (logical 0,0)");
  await panTilt.safeHome();
  await sleep(dwell);

  console.log("\n— Phase 2: center, then axis extremes (tilt mid / pan mid) —");
  await pose(panMid, tiltMid, "Center");
  await pose(panMin, tiltMid, "Pan minimum, tilt mid");
  await pose(panMax, tiltMid, "Pan maximum, tilt mid");
  await pose(panMid, tiltMid, "Back to center");
  await pose(panMid, tiltMin, "Pan mid, tilt minimum");
  await pose(panMid, tiltMax, "Pan mid, tilt maximum");
  await pose(panMid, tiltMid, "Center");

  console.log("\n— Phase 3: four corners of the allowed box —");
  await pose(panMin, tiltMin, "Corner panMin / tiltMin");
  await pose(panMax, tiltMin, "Corner panMax / tiltMin");
  await pose(panMax, tiltMax, "Corner panMax / tiltMax");
  await pose(panMin, tiltMax, "Corner panMin / tiltMax");
  await pose(panMid, tiltMid, "Center");

  console.log("\n— Phase 4: full pan sweep (both directions) at tilt mid —");
  await sweepPan(panMin, panMax, tiltMid, "min → max");
  await sweepPan(panMax, panMin, tiltMid, "max → min");

  console.log("\n— Phase 5: full tilt sweep (both directions) at pan mid —");
  await sweepTilt(tiltMin, tiltMax, panMid, "min → max");
  await sweepTilt(tiltMax, tiltMin, panMid, "max → min");

  console.log("\n— Phase 6: HOME —");
  console.log("HOME");
  await panTilt.safeHome();
  await sleep(dwell);

  console.log("\nDone. Reported pose:", panTilt.getPose());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
