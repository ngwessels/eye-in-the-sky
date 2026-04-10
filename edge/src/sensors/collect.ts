import type { SensorReading } from "./types.js";
import {
  MockBme280Driver,
  MockLightningDriver,
  MockRainDriver,
  MockWindDriver,
} from "./mock-drivers.js";

const drivers = [
  new MockBme280Driver(),
  new MockRainDriver(),
  new MockWindDriver(),
  new MockLightningDriver(),
];

export async function collectSensorReadings(): Promise<SensorReading[]> {
  const all: SensorReading[] = [];
  for (const d of drivers) {
    try {
      all.push(...(await d.read()));
    } catch (e) {
      console.error(`sensor ${d.id}`, e);
    }
  }
  return all;
}
