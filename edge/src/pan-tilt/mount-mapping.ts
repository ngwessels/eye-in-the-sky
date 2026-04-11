import { config } from "../config.js";
import { getMountTiltOffsetDeg } from "../mount-settings-cache.js";

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Convert cloud/logical pan to values the PCA9685 / serial bridge maps to PWM.
 * Optional invert mirrors within [panMin, panMax] (fixes left/right swapped travel).
 */
export function logicalToDrivePan(panLogical: number): number {
  const lo = config.panMin;
  const hi = config.panMax;
  let p = clamp(panLogical, lo, hi);
  if (config.panTiltInvertPan) {
    p = lo + hi - p;
  }
  return clamp(p, lo, hi);
}

/**
 * Convert cloud/logical elevation (deg above horizon) for servo mapping.
 * Offset (from station calibration, commands poll) shifts the curve when mechanical
 * zero ≠ software horizon; invert flips PWM direction within [tiltMin, tiltMax].
 */
export function logicalToDriveTilt(tiltLogical: number): number {
  const lo = config.tiltMin;
  const hi = config.tiltMax;
  let t = clamp(tiltLogical + getMountTiltOffsetDeg(), lo, hi);
  if (config.panTiltInvertTilt) {
    t = lo + hi - t;
  }
  return clamp(t, lo, hi);
}
