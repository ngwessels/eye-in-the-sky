# Meteorological all-sky camera — capture pipeline

Hardware and parts: **[hardware.md](./hardware.md)**. This document is the capture path: expose, HDR, dew, un-warp, archive, upload.

The stock edge agent today captures **on cloud command** (`capture_now`) and uploads a JPEG. The all-sky station adds a **local ~30 s daylight loop**, **HDR**, **remap**, and a **sidecar JSON**. That loop is **not wired into** `edge/src/index.ts` yet. The TypeScript contract lives in [`packages/shared/src/all-sky.ts`](../packages/shared/src/all-sky.ts). Use the existing presign API to get bytes into S3 on day one.

## What “good” looks like

A reviewer should be able to reject a frame in ten seconds:

| Good | Bad (common failure) |
|------|----------------------|
| **Sun does not wipe the frame.** Disk is a compact highlight; nearby cirrus still has texture. | Single auto-exposure: sun is a white blob, rest of sky is ink, or the whole JPEG is haze. |
| **Clouds stay sharp.** Edges of cumulus / stratus are crisp at 4K/HD. | Smeared circle: long night-sky exposure, rain on the dome, missed focus, or `--immediate` on an AF module. |
| **Horizon is usable after un-warp.** Trees, ridges, and cloud bases sit on a level horizon; you can tell NW from SE using the north mark. | Raw circular fisheye shipped as the science image; horizon is a warped ring; astronomy-style unprocessed disk. |
| **4K or HD still of the sky**, not a tiny inscribed circle in a black square. | Uploading the uncropped sensor JPEG with black corners as if that were the product. |

This is **not** a night-sky all-sky: no 15–30 s star exposures, no “leave the fisheye circular for meteors,” no ignoring daytime HDR.

## Pipeline (daylight)

```
 dew heater on? ──► short HDR stills (circle) ──► keep RAW + circular JPEG
                                              ──► remap (equirect or stereographic)
                                              ──► derived JPEG + sidecar JSON
                                              ──► HTTPS upload (or local queue)
```

Cadence: about **every 30 seconds** while the sun is up (civil daylight is enough). Night can drop to a slower interval or skip until a later night-aware pass — do not reuse astronomy exposure tables.

Zenith metadata: `elevation_deg` **90**, `azimuth_true_deg` = housing yaw from the **north mark** (0 = north on the top of the un-warped frame, whichever convention you pick — document it in the sidecar `orientation`).

## 1. Expose (short daylight, not stars)

On Raspberry Pi OS with `libcamera-apps` / `rpicam-still`:

- Install: `sudo apt install -y libcamera-apps`
- Confirm the HQ module: `rpicam-still --list-cameras` (IMX477).
- **Focus once** on a distant cloud/horizon using the M12 ring + HQ back-focus, then **lock the set screw**. All-sky is fixed focus at infinity.
- **Do not** use `--autofocus-on-capture` (HQ + M12 is manual). **Do not** use long `--shutter` values meant for the Milky Way.

Bring-up (single frame, stdout JPEG — same pattern as `CAPTURE_STILL_CMD` in `edge/.env.example`):

```bash
# Pi 5 ISP HDR (works with current rpicam-apps on Pi 5; if you see
# "unable to set HDR mode", update packages and retry).
rpicam-still -e jpg -n -t 1500 --hdr --width 4056 --height 3040 -o /data/allsky/preview.jpg

# Archive a DNG alongside JPEG (-r). Keep this for the raw circular frame.
rpicam-still -e jpg -n -t 1500 --hdr -r --width 4056 --height 3040 \
  -o /data/allsky/circ.jpg
# writes circ.jpg + circ.dng
```

If `--hdr` is unavailable, use **explicit short brackets** (µs) at **gain 1** and merge later (or pick the mid frame for v1):

```bash
for us in 200 800 3200; do
  rpicam-still -e jpg -n --immediate --shutter "$us" --gain 1 --awbgains 1.5,1.5 \
    --width 4056 --height 3040 -o "/data/allsky/br_${us}.jpg"
done
```

Daylight shutter is typically **hundreds of microseconds to a few milliseconds**, not seconds. Tune so the **sun is not a flood** and **cloud bases are not black**. Oregon overcast will want a longer bracket than a clear August noon — record `shutter_us` / `gain` in the sidecar every frame.

JPEG quality: the edge agent defaults to appending `-q 96`. For all-sky stills keep quality high; file size is fine under the server default `MAX_CAPTURE_BYTES` (40 MB).

## 2. HDR

Goal: **one** tone-mapped circular image per tick where the solar disk does not erase the rest of the hemisphere.

| Method | When |
|--------|------|
| **`rpicam-still --hdr` on Pi 5** | First try. Pi 5 has onboard multi-frame HDR for CSI cameras. Camera Module 3 also has on-sensor HDR; that module is the wrong optic for 180°. |
| **3-frame shutter bracket + merge** | Fallback, or if noon sun still clips with `--hdr`. Merge with OpenCV / a small Python sidecar; do not invent a new Node ISP. |
| **Single auto-exposure** | Indoor testing only. Will fail outdoors with sun in frame. |

Keep the **pre-merge brackets** on SSD for a few hours so you can debug blown highlights.

## 3. Dew and rain control

Oregon: if the **dome** is wet or fogged, no amount of HDR helps.

- **Heater ring 12 V** at the inner dome (see [hardware.md](./hardware.md)). First light: leave it **on** in cool/fog season. Later: GPIO MOSFET + enclosure humidity vs dew point.
- **Hydrophobic** outside coating; rinse, do not wipe grit across acrylic.
- **Desiccant** inside; replace when the pack is saturated.
- Capture code should **skip or flag** frames when a dome-temp/humidity sensor (optional) says the glass is at dew point — better a gap than a smeared-circle archive.
- After rain, short cadence still helps AI see **virga vs fog vs overcast** once the outer surface beads off.

This is **control hardware + ops**, not an exposure trick.

## 4. Un-warp (circle → usable sky)

The sensor image is a **circle** (fisheye) in a 4:3 rectangle. Astronomy workflows often **stop here**. We do not.

1. **Measure once:** circle center `(cx, cy)` and radius `r` in pixels (the horizon ring). Store in calibration; it changes if you refocus or reseat the lens.
2. **Crop** to the circle (no black corners in the science JPEG).
3. **Remap** to one of:
   - **Stereographic (zenith-centered)** — natural “looking up,” horizon as a circle, good for humans and many vision models.
   - **Equirectangular hemisphere** — 360° azimuth × 90° elevation, familiar to 360 tooling. Horizon is the **bottom** row if zenith is the top; pick a convention and set `projection.convention` in JSON.

Implementation note: **Node `sharp` cannot** do a fisheye→equirect map. Typical Pi path is **OpenCV** (`cv2.remap` with a precomputed map) in Python, or a one-shot C++ helper. TypeScript owns **metadata + upload**. Recompute the map only when `cx, cy, r` change.

North: rotate the remapped image so **north is a documented edge or angle** (sidecar `orientation.north_up`).

## 5. Keep raw + derived

On the SSD, per tick (example layout):

```text
/data/allsky/2026-08-29T17-03-02Z/
  circular.jpg      # tone-mapped fisheye (science archive)
  circular.dng      # sensor raw if -r was used
  sky.jpg           # un-warped HD/4K still (upload this)
  meta.json         # AllSkyCaptureMeta (see shared schema)
```

Retain **circular + DNG** locally (ring buffer, e.g. 48 h). Upload **`sky.jpg` + `meta.json`**. If bandwidth is tight, upload derived JPEG always and DNG only on command.

Do not overwrite the only copy of the circular frame after remap — you will need it when the map is wrong.

## 6. Upload API

### What the cloud already accepts

Existing station flow (`edge/src/upload-capture.ts`, `POST /api/stations/me/captures`):

1. **Presign** — `{ action: "presign", mediaType: "image", contentType: "image/jpeg", kind: "science" }`
2. **PUT** JPEG bytes to `uploadUrl` (`Content-Type: image/jpeg`)
3. **Finalize** — `{ action: "finalize", captureId, byteSize, capturedAt, kind, contentType, azimuth_true_deg?, elevation_deg? }`

Auth: `Authorization: Bearer <STATION_API_KEY>`. `capturedAt` must be close to server time (NTP on the Pi; see `RASPBERRY_PI.md`) or finalize returns `clock_skew`.

For this camera, finalize **`elevation_deg: 90`**. Set **`azimuth_true_deg`** from the north mark once you know housing yaw.

### Sidecar JSON (sketch — not on the wire yet)

Until the API grows a metadata field or a second presign (`contentType: application/json`), write **`meta.json` next to the JPEG on disk** and include the same `capturedAt`. Proposed shape (Zod: `allSkyCaptureMetaSchema`):

```json
{
  "schemaVersion": 1,
  "capturedAt": "2026-08-29T17:03:02.000Z",
  "site": {
    "lat": null,
    "lon": null,
    "name": "forest-grove-or",
    "note": "Placeholder until GNSS or a registered station location is wired."
  },
  "camera": {
    "sensor": "imx477",
    "lens": "M25156H18",
    "fov_deg": 180,
    "facing": "zenith"
  },
  "exposure": {
    "hdr": true,
    "shutter_us": 800,
    "gain": 1,
    "brackets_us": [200, 800, 3200]
  },
  "projection": {
    "raw": "fisheye_circular",
    "derived": "stereographic",
    "circle": { "cx": 2028, "cy": 1520, "r": 1480 },
    "convention": "north_up"
  },
  "cloudCover": {
    "fraction": null,
    "method": "stub"
  }
}
```

`site.lat` / `site.lon` stay **null placeholders** until `edge/src/gps.ts` or station registration supplies a fix. `cloudCover.fraction` stays **null** until a real estimator exists (color + texture, or the existing Vercel AI Gateway analysis on the server). Do not fake 0.37.

When adding an API field, send this object as `all_sky` on finalize or as a sibling S3 object `…/meta.json`. Do not break the current JPEG-only path.

## 7. Interval loop vs today’s agent

| Today (`edge/src/index.ts`) | All-sky first build |
|-----------------------------|---------------------|
| Poll commands every few minutes | **Local timer ~30 s** in daylight |
| One `CAPTURE_STILL_CMD` JPEG | HDR + remap, then upload **derived** JPEG |
| Optional `OMNI_QUAD` sequential cameras | **Single** zenith camera (`OMNI_QUAD` unset) |

Bring-up without new daemons: point `CAPTURE_STILL_CMD` at a script that prints **`sky.jpg`** bytes to stdout (after remap), and enqueue `capture_now` from the cloud on a short cron. That is enough to test S3 + AI. A dedicated 30 s loop can replace command-driven capture once stills look good.

`UPLOAD_JPEG_ROTATE_DEG` defaults to **180** for an inverted camera. A zenith fisheye may need **`0`** plus remap rotation instead — set `UPLOAD_JPEG_ROTATE_DEG=0` so you do not double-rotate.

## 8. Offline and store-and-forward

The Tailscale node **`raspberrypi` is often offline**. WAN to Vercel can be down independently.

1. Always write the tick directory on SSD **first**.
2. Try presign → PUT → finalize.
3. On failure, leave the directory in a `queue/` folder; retry with backoff. Do not block the next 30 s capture on a hung HTTPS call (timeout the upload).

## 9. Quality checklist before you call the build done

- [ ] Noon: sun is small; opposite-horizon clouds still have detail.
- [ ] Overcast Oregon day: stratus texture, not a gray pancake from motion blur.
- [ ] After remap: horizon is a usable line; north mark matches the sidecar.
- [ ] Uploaded object is **HD or 4K sky**, not a black square with a marble in the middle.
- [ ] Raw circular JPEG/DNG still on disk for that tick.
- [ ] `capturedAt` is UTC and passes server clock skew.
- [ ] Dome is clear (heater + hydrophobic); no internal fog in the sample set.
