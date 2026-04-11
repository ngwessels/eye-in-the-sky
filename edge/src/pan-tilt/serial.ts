import { SerialPort } from "serialport";
import { config } from "../config.js";
import type { PanTiltDriver, PanTiltPose } from "./types.js";

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

export function createSerialPanTilt(): PanTiltDriver {
  const path = config.panTiltSerialPath?.trim();
  if (!path) {
    throw new Error("PAN_TILT_SERIAL_PATH is required when PAN_TILT_DRIVER=serial");
  }

  let pan = 0;
  let tilt = 0;

  const port = new SerialPort({
    path,
    baudRate: config.panTiltSerialBaud,
    autoOpen: false,
  });

  let opening: Promise<void> | null = null;

  function ensureOpen(): Promise<void> {
    if (port.isOpen) return Promise.resolve();
    if (!opening) {
      opening = new Promise<void>((resolve, reject) => {
        port.open((err) => {
          opening = null;
          if (err) reject(err);
          else resolve();
        });
      });
    }
    return opening;
  }

  function writeLine(line: string): Promise<void> {
    return new Promise((resolve, reject) => {
      port.write(Buffer.from(`${line}\n`, "utf8"), (err) => {
        if (err) {
          reject(err);
          return;
        }
        port.drain((drainErr) => {
          if (drainErr) reject(drainErr);
          else resolve();
        });
      });
    });
  }

  return {
    getPose(): PanTiltPose {
      return { pan, tilt };
    },

    async safeHome(): Promise<void> {
      pan = 0;
      tilt = 0;
      await ensureOpen();
      await writeLine("HOME");
    },

    async applyAbsolute(azimuthDeg: number, elevationDeg: number): Promise<void> {
      pan = clamp(azimuthDeg, config.panMin, config.panMax);
      tilt = clamp(elevationDeg, config.tiltMin, config.tiltMax);
      await ensureOpen();
      await writeLine(`SET ${pan} ${tilt}`);
    },

    async applyDelta(deltaPanDeg: number, deltaTiltDeg: number): Promise<void> {
      pan = clamp(pan + deltaPanDeg, config.panMin, config.panMax);
      tilt = clamp(tilt + deltaTiltDeg, config.tiltMin, config.tiltMax);
      await ensureOpen();
      await writeLine(`SET ${pan} ${tilt}`);
    },
  };
}
