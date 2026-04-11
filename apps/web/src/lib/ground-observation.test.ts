import { describe, expect, it } from "vitest";
import { azimuthFromLatestScienceCapture } from "./ground-observation";
import type { CaptureDoc } from "./types";

describe("azimuthFromLatestScienceCapture", () => {
  const now = Date.UTC(2026, 3, 11, 12, 0, 0);

  it("returns null when capture is missing", () => {
    expect(azimuthFromLatestScienceCapture(null, 86_400_000, now)).toBeNull();
  });

  it("returns null when kind is not science", () => {
    const c = {
      kind: "calibration" as const,
      capturedAt: new Date(now - 3600_000),
      view: { azimuth_true_deg: 180, cardinal16: "S", source: "edge_finalize" as const },
    };
    expect(azimuthFromLatestScienceCapture(c, 86_400_000, now)).toBeNull();
  });

  it("returns null when azimuth missing", () => {
    const c = {
      kind: "science" as const,
      capturedAt: new Date(now - 3600_000),
      view: { cardinal16: "S", source: "edge_finalize" as const },
    } as Pick<CaptureDoc, "kind" | "capturedAt" | "view">;
    expect(azimuthFromLatestScienceCapture(c, 86_400_000, now)).toBeNull();
  });

  it("returns null when capture is too old", () => {
    const c = {
      kind: "science" as const,
      capturedAt: new Date(now - 48 * 3600_000),
      view: { azimuth_true_deg: 90, cardinal16: "E", source: "edge_finalize" as const },
    };
    expect(azimuthFromLatestScienceCapture(c, 24 * 3600_000, now)).toBeNull();
  });

  it("returns azimuth when recent", () => {
    const c = {
      kind: "science" as const,
      capturedAt: new Date(now - 3600_000),
      view: { azimuth_true_deg: 42.7, cardinal16: "NE", source: "edge_finalize" as const },
    } satisfies Pick<CaptureDoc, "kind" | "capturedAt" | "view">;
    expect(azimuthFromLatestScienceCapture(c, 86_400_000, now)).toBe(42.7);
  });
});
