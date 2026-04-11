import * as mock from "./mock.js";
import { createPca9685PanTilt } from "./pca9685-i2c.js";
import { resolvePanTiltBackend, type PanTiltBackend } from "./resolve-driver.js";
import { createSerialPanTilt } from "./serial.js";
import type { PanTiltDriver } from "./types.js";
import { sessionDebug } from "../debug-session-log.js";

export type { PanTiltBackend };

sessionDebug("I2C", "pan-tilt/index.ts", "before resolvePanTiltBackend", {});
export const panTiltBackend: PanTiltBackend = resolvePanTiltBackend();
sessionDebug("I2C", "pan-tilt/index.ts", "after resolvePanTiltBackend", {
  panTiltBackend,
});

const driver: PanTiltDriver =
  panTiltBackend === "serial"
    ? createSerialPanTilt()
    : panTiltBackend === "pca9685"
      ? createPca9685PanTilt()
      : mock;

export function getPose() {
  return driver.getPose();
}

export function safeHome() {
  return driver.safeHome();
}

export function applyAbsolute(azimuthDeg: number, elevationDeg: number) {
  return driver.applyAbsolute(azimuthDeg, elevationDeg);
}

export function applyDelta(deltaPanDeg: number, deltaTiltDeg: number) {
  return driver.applyDelta(deltaPanDeg, deltaTiltDeg);
}
