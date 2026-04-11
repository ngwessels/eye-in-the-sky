import { config } from "../config.js";
import * as mock from "./mock.js";
import { createPca9685PanTilt } from "./pca9685-i2c.js";
import { createSerialPanTilt } from "./serial.js";
import type { PanTiltDriver } from "./types.js";

function createPanTiltDriver(): PanTiltDriver {
  if (config.panTiltDriver === "serial") return createSerialPanTilt();
  if (config.panTiltDriver === "pca9685") return createPca9685PanTilt();
  return mock;
}

const driver: PanTiltDriver = createPanTiltDriver();

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
