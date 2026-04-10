import type { SensorDriver, SensorReading } from "./types.js";

/** BME280-style mock via env (no I2C wiring required for dev). */
export class MockBme280Driver implements SensorDriver {
  readonly id = "mock-bme280";

  async read(): Promise<SensorReading[]> {
    const t = process.env.MOCK_BME280_TEMP_C;
    const p = process.env.MOCK_BME280_PRESSURE_HPA;
    const h = process.env.MOCK_BME280_HUMIDITY_PCT;
    const at = new Date().toISOString();
    const out: SensorReading[] = [];
    if (t !== undefined) {
      out.push({
        sensorId: this.id,
        type: "temperature_c",
        value: Number(t),
        unit: "C",
        observedAt: at,
      });
    }
    if (p !== undefined) {
      out.push({
        sensorId: this.id,
        type: "pressure_hpa",
        value: Number(p),
        unit: "hPa",
        observedAt: at,
      });
    }
    if (h !== undefined) {
      out.push({
        sensorId: this.id,
        type: "humidity_pct",
        value: Number(h),
        unit: "%",
        observedAt: at,
      });
    }
    return out;
  }
}

export class MockRainDriver implements SensorDriver {
  readonly id = "mock-rain";

  async read(): Promise<SensorReading[]> {
    const v = process.env.MOCK_RAIN_MM;
    if (v === undefined) return [];
    return [
      {
        sensorId: this.id,
        type: "rain_mm",
        value: Number(v),
        unit: "mm",
        observedAt: new Date().toISOString(),
      },
    ];
  }
}

export class MockWindDriver implements SensorDriver {
  readonly id = "mock-wind";

  async read(): Promise<SensorReading[]> {
    const speed = process.env.MOCK_WIND_MPS;
    if (speed === undefined) return [];
    return [
      {
        sensorId: this.id,
        type: "wind_speed_mps",
        value: Number(speed),
        unit: "m/s",
        observedAt: new Date().toISOString(),
      },
    ];
  }
}

export class MockLightningDriver implements SensorDriver {
  readonly id = "mock-lightning";

  async read(): Promise<SensorReading[]> {
    const d = process.env.MOCK_LIGHTNING_KM;
    if (d === undefined) return [];
    return [
      {
        sensorId: this.id,
        type: "lightning_distance_km",
        value: Number(d),
        unit: "km",
        observedAt: new Date().toISOString(),
      },
    ];
  }
}
