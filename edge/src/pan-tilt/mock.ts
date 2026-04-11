import { config } from "../config.js";

let pan = 0;
let tilt = 0;

export function getPose() {
  return { pan, tilt };
}

export async function safeHome(): Promise<void> {
  pan = 0;
  tilt = 0;
}

export async function applyAbsolute(azimuthDeg: number, elevationDeg: number): Promise<void> {
  pan = clamp(azimuthDeg, config.panMin, config.panMax);
  tilt = clamp(elevationDeg, config.tiltMin, config.tiltMax);
}

export async function applyDelta(deltaPanDeg: number, deltaTiltDeg: number): Promise<void> {
  pan = clamp(pan + deltaPanDeg, config.panMin, config.panMax);
  tilt = clamp(tilt + deltaTiltDeg, config.tiltMin, config.tiltMax);
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}
