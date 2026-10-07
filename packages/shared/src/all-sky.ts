import { z } from "zod";

/**
 * Sidecar metadata for the meteorological all-sky camera (one zenith ~180° fisheye).
 * Not yet a request body on POST /api/stations/me/captures — keep JSON next to the
 * derived JPEG on disk, then attach when the API grows a field or a second object.
 *
 * Docs: docs/capture.md, docs/hardware.md
 */
export const allSkyCaptureMetaSchema = z.object({
  schemaVersion: z.literal(1),
  capturedAt: z.string().datetime(),
  site: z.object({
    /** WGS84; null until GNSS or a registered station location is wired. */
    lat: z.number().min(-90).max(90).nullable(),
    lon: z.number().min(-180).max(180).nullable(),
    name: z.string().min(1),
    note: z.string().optional(),
  }),
  camera: z.object({
    sensor: z.string().min(1),
    lens: z.string().min(1),
    fov_deg: z.number().positive(),
    facing: z.literal("zenith"),
  }),
  exposure: z.object({
    hdr: z.boolean(),
    shutter_us: z.number().positive(),
    gain: z.number().positive(),
    brackets_us: z.array(z.number().positive()).optional(),
  }),
  projection: z.object({
    raw: z.literal("fisheye_circular"),
    derived: z.enum(["equirectangular", "stereographic"]),
    circle: z.object({
      cx: z.number().nonnegative(),
      cy: z.number().nonnegative(),
      r: z.number().positive(),
    }),
    convention: z.string().min(1),
  }),
  cloudCover: z.object({
    /** Null until a real estimator exists — do not invent a fraction. */
    fraction: z.number().min(0).max(1).nullable(),
    method: z.literal("stub").or(z.string()),
  }),
});

export type AllSkyCaptureMeta = z.infer<typeof allSkyCaptureMetaSchema>;

/** Placeholder payload for Forest Grove / Hillsboro bring-up. */
export function stubAllSkyCaptureMeta(
  capturedAt: string,
  exposure: AllSkyCaptureMeta["exposure"],
): AllSkyCaptureMeta {
  return allSkyCaptureMetaSchema.parse({
    schemaVersion: 1,
    capturedAt,
    site: {
      lat: null,
      lon: null,
      name: "forest-grove-or",
      note: "Placeholder until GNSS or a registered station location is wired.",
    },
    camera: {
      sensor: "imx477",
      lens: "M25156H18",
      fov_deg: 180,
      facing: "zenith",
    },
    exposure,
    projection: {
      raw: "fisheye_circular",
      derived: "stereographic",
      circle: { cx: 2028, cy: 1520, r: 1480 },
      convention: "north_up",
    },
    cloudCover: { fraction: null, method: "stub" },
  });
}
