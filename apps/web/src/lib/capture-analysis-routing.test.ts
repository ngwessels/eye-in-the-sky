import { describe, expect, it } from "vitest";
import {
  effectiveElevationDegForAnalysis,
  shouldUseSurfaceAnalysis,
} from "./capture-analysis-routing";
import type { CaptureDoc } from "./types";

describe("effectiveElevationDegForAnalysis", () => {
  it("prefers view.elevation_deg", () => {
    const c = {
      view: { azimuth_true_deg: 90, elevation_deg: 8, cardinal16: "E", source: "edge_finalize" as const },
      mount_tilt_deg: 45,
    } satisfies Pick<CaptureDoc, "view" | "mount_tilt_deg">;
    expect(effectiveElevationDegForAnalysis(c)).toBe(8);
  });

  it("falls back to mount_tilt_deg", () => {
    const c = {
      view: {
        azimuth_true_deg: 90,
        cardinal16: "E",
        source: "edge_finalize" as const,
      },
      mount_tilt_deg: 5,
    } satisfies Pick<CaptureDoc, "view" | "mount_tilt_deg">;
    expect(effectiveElevationDegForAnalysis(c)).toBe(5);
  });

  it("returns undefined when neither is set", () => {
    const c = {
      view: {
        azimuth_true_deg: 90,
        cardinal16: "E",
        source: "edge_finalize" as const,
      },
    } satisfies Pick<CaptureDoc, "view" | "mount_tilt_deg">;
    expect(effectiveElevationDegForAnalysis(c)).toBeUndefined();
  });
});

describe("shouldUseSurfaceAnalysis", () => {
  it("is false when elevation unknown", () => {
    expect(shouldUseSurfaceAnalysis(undefined, 12)).toBe(false);
  });

  it("is true at threshold", () => {
    expect(shouldUseSurfaceAnalysis(12, 12)).toBe(true);
  });

  it("is false above threshold", () => {
    expect(shouldUseSurfaceAnalysis(13, 12)).toBe(false);
  });
});
