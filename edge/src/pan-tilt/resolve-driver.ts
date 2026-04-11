import { openSync } from "i2c-bus";
import { config } from "../config.js";

export type PanTiltBackend = "serial" | "pca9685" | "mock";

const REG_MODE1 = 0x00;

function probePca9685OnBus(busNum: number, addr: number): boolean {
  try {
    const bus = openSync(busNum);
    try {
      bus.readByteSync(addr, REG_MODE1);
      return true;
    } finally {
      bus.closeSync();
    }
  } catch {
    return false;
  }
}

/**
 * Resolves which pan/tilt implementation to use. `auto`: I²C PCA9685 first, then serial if path set, else mock.
 */
export function resolvePanTiltBackend(): PanTiltBackend {
  const mode = config.panTiltDriver;
  if (mode === "serial") return "serial";
  if (mode === "pca9685") return "pca9685";
  if (mode === "mock") return "mock";

  if (probePca9685OnBus(config.panTiltI2cBus, config.panTiltPca9685Addr)) {
    return "pca9685";
  }
  if (config.panTiltSerialPath.trim() !== "") {
    return "serial";
  }
  return "mock";
}
