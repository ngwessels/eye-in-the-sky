import { config } from "./config.js";
import * as panTilt from "./pan-tilt/index.js";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

export type PanTiltPosePhase =
  | "home_start"
  | "axes"
  | "corners"
  | "pan_sweep_fwd"
  | "pan_sweep_back"
  | "tilt_sweep_fwd"
  | "tilt_sweep_back"
  | "home_end";

export type PanTiltPoseContext = {
  pan: number;
  tilt: number;
  label: string;
  phase: PanTiltPosePhase;
  /** Index along current sweep leg (0 … sweepSegmentCount). */
  sweepIndex?: number;
  /** Same as config sweep segments (positions = count + 1). */
  sweepSegmentCount: number;
};

export type RunPanTiltEnvelopeOptions = {
  /** Called after mount settles and dwell (e.g. capture + upload). */
  onAfterPose?: (ctx: PanTiltPoseContext) => void | Promise<void>;
};

/**
 * Same motion as the long pan/tilt hardware test: full logical envelope, corners, bidirectional sweeps.
 */
export async function runPanTiltEnvelopeTest(
  opts: RunPanTiltEnvelopeOptions = {},
): Promise<void> {
  const { onAfterPose } = opts;
  const dwell = config.panTiltTestDwellMs;
  const sweepSteps = config.panTiltTestSweepSteps;
  const panMin = config.panMin;
  const panMax = config.panMax;
  const tiltMin = config.tiltMin;
  const tiltMax = config.tiltMax;
  const panMid = (panMin + panMax) / 2;
  const tiltMid = (tiltMin + tiltMax) / 2;

  async function notify(
    pan: number,
    tilt: number,
    label: string,
    phase: PanTiltPosePhase,
    sweepIndex?: number,
  ) {
    if (!onAfterPose) return;
    const ctx: PanTiltPoseContext = {
      pan,
      tilt,
      label,
      phase,
      sweepIndex,
      sweepSegmentCount: sweepSteps,
    };
    await onAfterPose(ctx);
  }

  async function pose(
    pan: number,
    tilt: number,
    label: string,
    phase: PanTiltPosePhase,
    sweepIndex?: number,
  ) {
    console.log(label, { pan: +pan.toFixed(2), tilt: +tilt.toFixed(2) });
    await panTilt.applyAbsolute(pan, tilt);
    await sleep(dwell);
    await notify(pan, tilt, label, phase, sweepIndex);
  }

  async function sweepPan(
    from: number,
    to: number,
    tiltHold: number,
    direction: string,
    phase: "pan_sweep_fwd" | "pan_sweep_back",
  ) {
    console.log(`Pan sweep ${direction} (${sweepSteps + 1} stops), tilt held at`, tiltHold);
    for (let i = 0; i <= sweepSteps; i++) {
      const t = i / sweepSteps;
      const pan = lerp(from, to, t);
      await pose(pan, tiltHold, `  [${i + 1}/${sweepSteps + 1}]`, phase, i);
    }
  }

  async function sweepTilt(
    from: number,
    to: number,
    panHold: number,
    direction: string,
    phase: "tilt_sweep_fwd" | "tilt_sweep_back",
  ) {
    console.log(`Tilt sweep ${direction} (${sweepSteps + 1} stops), pan held at`, panHold);
    for (let i = 0; i <= sweepSteps; i++) {
      const t = i / sweepSteps;
      const tilt = lerp(from, to, t);
      await pose(panHold, tilt, `  [${i + 1}/${sweepSteps + 1}]`, phase, i);
    }
  }

  console.log("\n— Phase 1: HOME —");
  console.log("HOME (logical 0,0)");
  await panTilt.safeHome();
  await sleep(dwell);
  await notify(0, 0, "HOME (logical 0,0)", "home_start");

  console.log("\n— Phase 2: center, then axis extremes (tilt mid / pan mid) —");
  await pose(panMid, tiltMid, "Center", "axes");
  await pose(panMin, tiltMid, "Pan minimum, tilt mid", "axes");
  await pose(panMax, tiltMid, "Pan maximum, tilt mid", "axes");
  await pose(panMid, tiltMid, "Back to center", "axes");
  await pose(panMid, tiltMin, "Pan mid, tilt minimum", "axes");
  await pose(panMid, tiltMax, "Pan mid, tilt maximum", "axes");
  await pose(panMid, tiltMid, "Center", "axes");

  console.log("\n— Phase 3: four corners of the allowed box —");
  await pose(panMin, tiltMin, "Corner panMin / tiltMin", "corners");
  await pose(panMax, tiltMin, "Corner panMax / tiltMin", "corners");
  await pose(panMax, tiltMax, "Corner panMax / tiltMax", "corners");
  await pose(panMin, tiltMax, "Corner panMin / tiltMax", "corners");
  await pose(panMid, tiltMid, "Center", "corners");

  console.log("\n— Phase 4: full pan sweep (both directions) at tilt mid —");
  await sweepPan(panMin, panMax, tiltMid, "min → max", "pan_sweep_fwd");
  await sweepPan(panMax, panMin, tiltMid, "max → min", "pan_sweep_back");

  console.log("\n— Phase 5: full tilt sweep (both directions) at pan mid —");
  await sweepTilt(tiltMin, tiltMax, panMid, "min → max", "tilt_sweep_fwd");
  await sweepTilt(tiltMax, tiltMin, panMid, "max → min", "tilt_sweep_back");

  console.log("\n— Phase 6: HOME —");
  console.log("HOME");
  await panTilt.safeHome();
  await sleep(dwell);
  await notify(0, 0, "HOME", "home_end");

  console.log("\nDone. Reported pose:", panTilt.getPose());
}
