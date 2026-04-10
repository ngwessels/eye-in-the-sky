import { config } from "./config.js";

let pan = 0;
let tilt = 0;

export function getPose() {
  return { pan, tilt };
}

export function safeHome(): void {
  pan = 0;
  tilt = 0;
}

export function applyAbsolute(azimuthDeg: number, elevationDeg: number): void {
  pan = clamp(azimuthDeg, config.panMin, config.panMax);
  tilt = clamp(elevationDeg, config.tiltMin, config.tiltMax);
}

export function applyDelta(deltaPanDeg: number, deltaTiltDeg: number): void {
  pan = clamp(pan + deltaPanDeg, config.panMin, config.panMax);
  tilt = clamp(tilt + deltaTiltDeg, config.tiltMin, config.tiltMax);
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}
