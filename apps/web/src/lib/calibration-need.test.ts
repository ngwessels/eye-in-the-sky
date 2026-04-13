import { describe, expect, it } from "vitest";
import { buildSkyProbeAim, scoreRecalibrationNeed } from "./calibration-need";
import type { StationDoc } from "./types";

function baseStation(over: Partial<StationDoc> = {}): StationDoc {
  return {
    stationId: "s1",
    name: "t",
    apiKeyFingerprint: "x",
    createdAt: new Date(),
    lastSeenAt: new Date(),
    location_source: "gps",
    location: { lat: 45.53, lon: -123.08 },
    gps: {
      fix_type: "3d",
      degraded: false,
    },
    capabilities: {
      sensors: [],
    },
    calibration: {
      state: "ready",
      confidence: 0.8,
      method: [],
    },
    quality_tier: "silver",
    tier_reasons: [],
    health: { uploadSuccessEma: 1 },
    sequence: 1,
    sensor_anomaly_flags: [],
    ...over,
  } as StationDoc;
}

describe("scoreRecalibrationNeed", () => {
  it("returns false for pending calibration", () => {
    const s = baseStation({
      calibration: { state: "pending", confidence: 0, method: [] },
    });
    expect(scoreRecalibrationNeed(s, { confidenceThreshold: 0.35, lowHorizonFromCaptures: false })).toEqual({
      needed: false,
      reasons: [],
    });
  });

  it("flags degraded state", () => {
    const s = baseStation({
      calibration: { state: "degraded", confidence: 0.5, method: [] },
    });
    const r = scoreRecalibrationNeed(s, { confidenceThreshold: 0.35, lowHorizonFromCaptures: false });
    expect(r.needed).toBe(true);
    expect(r.reasons).toContain("calibration_state_degraded");
  });

  it("flags low confidence", () => {
    const s = baseStation({
      calibration: { state: "ready", confidence: 0.1, method: [] },
    });
    const r = scoreRecalibrationNeed(s, { confidenceThreshold: 0.35, lowHorizonFromCaptures: false });
    expect(r.needed).toBe(true);
    expect(r.reasons).toContain("low_calibration_confidence");
  });

  it("flags horizon validation", () => {
    const s = baseStation({
      calibration: { state: "ready", confidence: 0.9, method: [] },
      calibration_server_validation: {
        horizon_validation: { horizon_plausible: false },
      },
    });
    const r = scoreRecalibrationNeed(s, { confidenceThreshold: 0.35, lowHorizonFromCaptures: false });
    expect(r.reasons).toContain("horizon_not_plausible");
  });
});

describe("buildSkyProbeAim", () => {
  it("returns null at night", () => {
    const s = baseStation();
    const when = new Date("2026-01-15T12:00:00.000Z");
    const aim = buildSkyProbeAim(s, when, {
      sunElevMinDeg: 5,
      targetElMin: 40,
      targetElMax: 55,
    });
    expect(aim).toBeNull();
  });

  it("returns sun direction by day", () => {
    const s = baseStation();
    const when = new Date("2026-06-21T20:00:00.000Z");
    const aim = buildSkyProbeAim(s, when, {
      sunElevMinDeg: 5,
      targetElMin: 40,
      targetElMax: 55,
    });
    expect(aim).not.toBeNull();
    expect(aim!.azimuthDeg).toBeGreaterThanOrEqual(0);
    expect(aim!.azimuthDeg).toBeLessThan(360);
    expect(aim!.elevationDeg).toBeGreaterThanOrEqual(40);
    expect(aim!.elevationDeg).toBeLessThanOrEqual(55);
  });
});
