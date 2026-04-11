import { openPromisified, type PromisifiedBus } from "i2c-bus";
import { config } from "../config.js";
import { logicalToDrivePan, logicalToDriveTilt } from "./mount-mapping.js";
import type { PanTiltDriver, PanTiltPose } from "./types.js";

/** Matches `pan-tilt-bridge.ino` — ArduCAM-style channel map (tilt=0, pan=1). */
const SERVO_TILT_CH = 0;
const SERVO_PAN_CH = 1;

const REG_MODE1 = 0x00;
const REG_PRESCALE = 0xfe;
const REG_LED0_ON_L = 0x06;

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

export function createPca9685PanTilt(): PanTiltDriver {
  const busNum = config.panTiltI2cBus;
  const addr = config.panTiltPca9685Addr;

  let pan = 0;
  let tilt = 0;
  let bus: PromisifiedBus | null = null;
  let busReadyPromise: Promise<PromisifiedBus> | null = null;

  /** Open I²C bus once and run the same PCA9685 reset + 60 Hz init as the Arduino sketch. */
  async function busReady(): Promise<PromisifiedBus> {
    if (bus) return bus;
    if (!busReadyPromise) {
      busReadyPromise = (async () => {
        const b = await openPromisified(busNum);
        await writeReg(b, addr, REG_MODE1, 0x80);
        await delayMs(10);
        await setPwmFreq(b, addr, 60);
        bus = b;
        return b;
      })();
    }
    return busReadyPromise;
  }

  async function writeReg(b: PromisifiedBus, a: number, reg: number, val: number) {
    await b.writeByte(a, reg, val & 0xff);
  }

  async function readReg(b: PromisifiedBus, a: number, reg: number): Promise<number> {
    return b.readByte(a, reg);
  }

  async function setPwmFreq(b: PromisifiedBus, a: number, freq: number) {
    const f = freq * 0.8449;
    let prescaleval = 25_000_000 / 4096 / f - 1;
    const prescale = Math.round(prescaleval) & 0xff;

    const oldmode = await readReg(b, a, REG_MODE1);
    const newmode = (oldmode & 0x7f) | 0x10;
    await writeReg(b, a, REG_MODE1, newmode);
    await writeReg(b, a, REG_PRESCALE, prescale);
    await writeReg(b, a, REG_MODE1, oldmode);
    await delayMs(5);
    await writeReg(b, a, REG_MODE1, oldmode | 0xa0);
  }

  async function setPwm(b: PromisifiedBus, a: number, num: number, on: number, off: number) {
    const base = REG_LED0_ON_L + 4 * num;
    await writeReg(b, a, base, on & 0xff);
    await writeReg(b, a, base + 1, (on >> 8) & 0xff);
    await writeReg(b, a, base + 2, off & 0xff);
    await writeReg(b, a, base + 3, (off >> 8) & 0xff);
  }

  async function setServoPulse(b: PromisifiedBus, a: number, n: number, pulse: number) {
    const pulselength = 1000.0 / 60.0 / 4096.0;
    const ticks = (pulse * 1000.0) / pulselength;
    await setPwm(b, a, n, 0, Math.round(ticks) & 0xffff);
  }

  async function setServoDegree(b: PromisifiedBus, a: number, n: number, degree: number) {
    const d = clamp(Math.round(degree), 0, 180);
    const pulse = (d + 45) / (90 * 1000);
    await setServoPulse(b, a, n, pulse);
  }

  function mapPanToServo(panDeg: number): number {
    const lo = config.panMin;
    const hi = config.panMax;
    const span = hi - lo || 1;
    const outLo = config.panTiltServoPanOutMin;
    const outHi = config.panTiltServoPanOutMax;
    const p = clamp(panDeg, lo, hi);
    const t = (p - lo) / span;
    return Math.round(t * (outHi - outLo) + outLo);
  }

  function mapTiltToServo(tiltDeg: number): number {
    const lo = config.tiltMin;
    const hi = config.tiltMax;
    const span = hi - lo || 1;
    const outLo = config.panTiltServoTiltOutMin;
    const outHi = config.panTiltServoTiltOutMax;
    const tIn = clamp(tiltDeg, lo, hi);
    const u = (tIn - lo) / span;
    return Math.round(u * (outHi - outLo) + outLo);
  }

  async function drivePose(panLogical: number, tiltLogical: number) {
    const b = await busReady();
    const panD = logicalToDrivePan(panLogical);
    const tiltD = logicalToDriveTilt(tiltLogical);
    await setServoDegree(b, addr, SERVO_TILT_CH, mapTiltToServo(tiltD));
    await setServoDegree(b, addr, SERVO_PAN_CH, mapPanToServo(panD));
  }

  return {
    getPose(): PanTiltPose {
      return { pan, tilt };
    },

    async safeHome(): Promise<void> {
      pan = 0;
      tilt = 0;
      await drivePose(0, 0);
    },

    async applyAbsolute(azimuthDeg: number, elevationDeg: number): Promise<void> {
      pan = clamp(azimuthDeg, config.panMin, config.panMax);
      tilt = clamp(elevationDeg, config.tiltMin, config.tiltMax);
      await drivePose(pan, tilt);
    },

    async applyDelta(deltaPanDeg: number, deltaTiltDeg: number): Promise<void> {
      pan = clamp(pan + deltaPanDeg, config.panMin, config.panMax);
      tilt = clamp(tilt + deltaTiltDeg, config.tiltMin, config.tiltMax);
      await drivePose(pan, tilt);
    },
  };
}

function delayMs(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
