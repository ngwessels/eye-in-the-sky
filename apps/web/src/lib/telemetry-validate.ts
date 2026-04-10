import { z } from "zod";
import { telemetryBodySchema } from "@eye/shared";

type Reading = z.infer<typeof telemetryBodySchema>["readings"][number];

export interface TelemetryValidationResult {
  ok: boolean;
  anomalies: string[];
  filteredReadings: Reading[];
}

/** Drop out-of-range readings and record anomaly codes for station flagging. */
export function validateTelemetryReadings(readings: Reading[]): TelemetryValidationResult {
  const anomalies: string[] = [];
  const filtered: Reading[] = [];

  for (const r of readings) {
    const v = r.value;
    let bad = false;

    switch (r.type) {
      case "temperature_c":
        if (v < -85 || v > 70) {
          bad = true;
          anomalies.push(`temperature_c_out_of_range:${v}`);
        }
        break;
      case "humidity_pct":
        if (v < 0 || v > 100) {
          bad = true;
          anomalies.push(`humidity_pct_out_of_range:${v}`);
        }
        break;
      case "pressure_hpa":
        if (v < 800 || v > 1100) {
          bad = true;
          anomalies.push(`pressure_hpa_out_of_range:${v}`);
        }
        break;
      case "wind_speed_mps":
        if (v < 0 || v > 120) {
          bad = true;
          anomalies.push(`wind_speed_mps_out_of_range:${v}`);
        }
        break;
      case "rain_mm":
        if (v < 0 || v > 500) {
          bad = true;
          anomalies.push(`rain_mm_out_of_range:${v}`);
        }
        break;
      case "lightning_distance_km":
        if (v < 0 || v > 400) {
          bad = true;
          anomalies.push(`lightning_distance_km_out_of_range:${v}`);
        }
        break;
      default:
        if (!Number.isFinite(v)) {
          bad = true;
          anomalies.push(`non_finite:${r.type}`);
        }
    }

    if (!bad) filtered.push(r);
  }

  return {
    ok: anomalies.length === 0,
    anomalies,
    filteredReadings: filtered,
  };
}
