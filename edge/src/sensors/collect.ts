import type { SensorDriver, SensorReading } from "./types.js";

/** Register real hardware drivers here. No mock/env-synthesized readings are sent. */
const drivers: SensorDriver[] = [];

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
