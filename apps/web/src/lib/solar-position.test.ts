import { describe, expect, it } from "vitest";
import { getSunPositionTrueNorth, sunElevationSufficient } from "./solar-position";

describe("getSunPositionTrueNorth", () => {
  it("matches reference solar noon-ish at San Francisco (approx south azimuth near midday)", () => {
    // 2024-06-21 20:00 UTC ≈ solar noon PDT at ~37.77°N: sun south of observer → azimuth near 180°
    const when = new Date("2024-06-21T20:00:00.000Z");
    const { sun_azimuth_true_deg, sun_elevation_deg } = getSunPositionTrueNorth(
      when,
      37.7749,
      -122.4194,
    );
    expect(sun_elevation_deg).toBeGreaterThan(60);
    expect(sun_azimuth_true_deg).toBeGreaterThan(160);
    expect(sun_azimuth_true_deg).toBeLessThan(200);
  });

  it("returns low elevation at polar night latitude in winter", () => {
    const when = new Date("2024-12-21T12:00:00.000Z");
    const { sun_elevation_deg } = getSunPositionTrueNorth(when, 89.5, 0);
    expect(sun_elevation_deg).toBeLessThan(0);
  });
});

describe("sunElevationSufficient", () => {
  it("rejects below threshold", () => {
    expect(sunElevationSufficient(2, 3)).toBe(false);
    expect(sunElevationSufficient(3, 3)).toBe(true);
  });
});
