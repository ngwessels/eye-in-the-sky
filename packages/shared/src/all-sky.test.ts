import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { allSkyCaptureMetaSchema, stubAllSkyCaptureMeta } from "./all-sky.js";

describe("allSkyCaptureMetaSchema", () => {
  it("parses the Forest Grove stub with null site and cloud-cover placeholders", () => {
    const meta = stubAllSkyCaptureMeta("2026-08-29T17:03:02.000Z", {
      hdr: true,
      shutter_us: 800,
      gain: 1,
      brackets_us: [200, 800, 3200],
    });
    assert.equal(meta.site.lat, null);
    assert.equal(meta.site.lon, null);
    assert.equal(meta.cloudCover.fraction, null);
    assert.equal(meta.camera.facing, "zenith");
    assert.equal(meta.projection.raw, "fisheye_circular");
    assert.equal(allSkyCaptureMetaSchema.parse(meta).schemaVersion, 1);
  });
});
