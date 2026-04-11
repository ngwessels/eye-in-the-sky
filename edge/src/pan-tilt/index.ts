import { config } from "../config.js";
import * as mock from "./mock.js";
import { createSerialPanTilt } from "./serial.js";
import type { PanTiltDriver } from "./types.js";

const driver: PanTiltDriver =
  config.panTiltDriver === "serial" ? createSerialPanTilt() : mock;

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
