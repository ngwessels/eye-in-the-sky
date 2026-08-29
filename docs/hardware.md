# Meteorological all-sky camera — hardware

This is the **first hardware build** for Eye on the Sky: one camera looking **up**, covering the hemisphere from horizon to horizon (~180°). It is a weather instrument, not a tourist 360 video camera and not a night-sky astronomy all-sky.

Site context for the prototype: **Forest Grove / Hillsboro, Oregon** — frequent rain, fog, and dew. Plan the dome and heater as first-class parts, not afterthoughts.

Pi OS, Node, systemd, and the existing edge agent: **[RASPBERRY_PI.md](../RASPBERRY_PI.md)**. Capture / HDR / un-warp / upload: **[capture.md](./capture.md)**.

## 1. Why this camera

| Approach | What it is | Use here? |
|----------|------------|-----------|
| **Meteorological all-sky (this build)** | One **zenith-pointing** camera, ~180° fisheye, short **daylight** stills, then **un-warp** the circular image into a usable sky (equirectangular or stereographic). | **Yes — first build.** Cloud cover, sun, fog, and horizon weather in one frame. |
| Night-sky / astronomy all-sky | Same dome shape, but **long exposures**, raw **circular fisheye** left as-is, stars as the subject. Sun/cloud HDR is ignored; daytime frames look mangled. | **No.** Those images are the failure mode we are designing against. |
| Insta360 / consumer 360 | Dual-lens stitch for **street-level** walk-around video. Seam and zenith/nadir holes are baked into the product. | **Optional weekend prototype only** — to exercise upload + AI. Do not mount it like a 360 cam and expect a clean sky. The stitch seam cuts through clouds. |
| 4-camera horizon stitch | Four side-looking cameras (this repo already has `OMNI_QUAD` for that). True **4K of horizon clouds**. | **Later.** Different geometry: horizon panorama, not a hemisphere. More cost, muxing, and alignment. |

A tourist 360 looks *out* at the street. This camera looks **up** at the sky. If the horizon is a thin ring at the edge of a dark circle and the sun blows out half the frame, the build is wrong — see [What “good” looks like](./capture.md#what-good-looks-like).

## 2. First-build parts list

Prices below are **estimates** (USD, 2026, before tax/shipping) unless a vendor list price is cited. **Verify stock and price before ordering.** Prefer currently sold Raspberry Pi 5–era parts.

### Compute and imaging

| Part | Role | Notes | Price |
|------|------|--------|-------|
| **Raspberry Pi 5** (8 GB RAM recommended; 4 GB works) | Station computer | 64-bit Raspberry Pi OS (Bookworm or later). Pi 5 ISP can do onboard HDR (`rpicam-still --hdr`) with current `rpicam-apps`. 16 GB is optional. | Estimate: $80–95 (8 GB) |
| **Raspberry Pi Active Cooler** | 24/7 thermal | Pi 5 throttles in a sealed outdoor box without a heatsink/fan. | Estimate: $10 |
| **Raspberry Pi High Quality Camera** (Sony **IMX477**, 12.3 MP, 4056×3040, C/CS mount) | 12 MP / 4K-class CSI sensor | Official HQ module. Fixed-focus once you set back-focus + M12 focus ring. Do **not** start with Camera Module 3: its lens is not a swappable 180° M12 (Module 3 Wide is ~120°). Skip 64 MP AF for this build (focus/timeout issues; that kit is for the other rig in `RASPBERRY_PI.md`). | Estimate: $50 |
| **Pi 5 camera cable** (official **Raspberry Pi Camera Cable**, 200–500 mm, 22-pin Pi 5 ↔ 15-pin camera) | CSI interconnect | **Pi 4 camera cables do not fit Pi 5.** Use 300 mm or 500 mm so the board can sit lower in the enclosure than the dome. | Estimate: $5–12 |
| **Arducam LN031** lens **M25156H18** — 1.56 mm, F/2.0, **180° HFoV** on 1/2.3″, M12, plus the included **M12 adapter for the HQ camera** | Named ~180° M12 fisheye | [Arducam product page](https://www.arducam.com/arducam-180-degree-fisheye-1-2-3-m12-mount-with-lens-adapter-for-raspberry-pi-high-quality-camera.html) lists **$19.99** for lens + adapter. Optical format matches HQ. If LN031 is out of stock, substitute another **1.55–1.8 mm M12 180°** on **1/2.3″** (same adapter); confirm the illuminated circle fills the sensor without a dark ring. | Vendor list: $19.99 (verify) |
| **microSD** 64 GB+ **A2 / endurance** | OS + logs | Do not use the card as the only disk for 30 s stills. | Estimate: $10–20 |

**Alternate camera board (if official HQ + LN031 is unavailable):** a currently sold **IMX477 M12** board with a factory **180°** lens (Waveshare and Arducam have offered these kits). Same pipeline; still needs the **Pi 5 camera cable**.

### Outdoor envelope (Oregon rain and fog)

| Part | Role | Notes | Price |
|------|------|--------|-------|
| **3.5″ or 4.0″ clear acrylic CCTV dome with flange** | Weather window | [Dew Control 4.0″ acrylic dome](https://www.dewcontrol.com/product/40-clear-acrylic-cctv-dome) is a typical all-sky size (~£21 list). 4″ gives more room for a heater ring and drip edge. Acrylic is the usual first dome; **glass** is a later upgrade (harder, heavier, better long-term UV). Apply a **hydrophobic** treatment on the outside. | Estimate: $20–30 |
| **Dew / rain heater ring, 12 V** | Stops fog on the **inside** of the dome and helps dry rain on the outside | Oregon failure mode: a perfect lens behind a fogged dome. **Dew Control “Dew Heater Module – All Sky Camera”**: 12 V, **0.23 A / 2.8 W**, inner Ø **52 mm**, outer Ø **72 mm**, [list £15.75](https://www.dewcontrol.com/product/dew-heater-module---all-sky-camera). For 4″+ domes use the **Large** ring (70/90 mm, 3.5 W). | Vendor list: ~£16 (verify) |
| **IP65/IP66 enclosure** | Keep Pi and connectors dry | Example: Dew Control [All Sky Camera Enclosure](https://www.dewcontrol.com/product/all-sky-camera-enclosure) 120×120×90 mm (lid can be rebated for a ~3.1″ dome), or a larger Hammond/Bud box if the Pi 5 + PoE HAT + SSD must live in the same housing. **Gasket + cable glands**, not silicone-as-the-only-seal. | Estimate: $25–60 |
| **O-ring / gasket matched to the dome flange** | Watertight dome joint | Size to the dome you actually buy (do not assume 100 mm). | Estimate: $5 |
| **Desiccant pack** (replaceable) | Moisture that still gets in | Replace on a schedule; a saturated pack + no heater = indoor rain on the dome. | Estimate: $5 |
| **Cable glands, outdoor-rated Cat6/Cat6A, waterproof RJ45 coupler** | One wet-side cable | Gland the Ethernet (and 12 V if separate) through the box; drip loop below the entry. | Estimate: $15–30 |

### Power — PoE or a clean outdoor path

Do **not** hang a USB-C wall wart off an outdoor outlet. Forest Grove rain will find that joint.

| Part | Role | Notes | Price |
|------|------|--------|-------|
| **Indoor 802.3at PoE+ injector or PoE switch** | Power + data on one cable | Injector lives **indoors**. One outdoor-rated Ethernet run to the station. | Estimate: $25–40 |
| **Pi 5 PoE+ HAT** (third-party; there is no official Pi 5 PoE HAT as of 2026) | 5 V for the Pi from PoE | Examples sold now: **Waveshare PoE HAT** for Pi 5, **52Pi M.2 NVMe PoE+ HAT** (PoE+ and 2230/2242 SSD together). Needs **802.3at** for Pi 5 + SSD + cooler. **Do not also plug USB-C power** while the PoE HAT is connected. | Estimate: $25–40 |
| **or PoE splitter** (802.3at → 5 V USB-C, plus a 12 V tap if offered) | Same idea without a HAT | Useful if you want the official M.2 HAT+ on the GPIO stack instead of a combo board. Use a splitter **known not to overvolt** Pi 5 (cheap no-name splitters have killed boards). | Estimate: $20–35 |
| **12 V for the dew heater** | Separate from Pi 5 V | 2.8–3.5 W is modest. Options: a PoE HAT/splitter with 12 V aux; a small indoor 12 V supply with outdoor-rated two-conductor; or a 12 V rail from a weatherproof midspan. Switch the heater with a **MOSFET or relay** from GPIO later; for first light, a constant-on 12 V ring is acceptable in Oregon winter. | Estimate: $10–25 |
| **Official Raspberry Pi 27 W USB-C PSU** | Bench / indoor bring-up only | Use on the workbench. Not the outdoor power path. | Estimate: $12 |

Budget a **drip loop**, strain relief, and a way to kill power from indoors (PoE port disable or injector switch).

### Storage

| Part | Role | Notes | Price |
|------|------|--------|-------|
| **USB 3 SSD (256 GB+) or NVMe 2230/2242 on [Raspberry Pi M.2 HAT+](https://www.raspberrypi.com/products/m2-hat-plus/)** | Raw + derived stills | 30 s daylight HDR + DNG fills a microSD quickly and wears it out. Keep a **ring buffer** of raw circular frames and derived sky JPEGs on SSD; upload the derived still. | Estimate: $25–60 |

### Optional / later

| Part | Role |
|------|------|
| **SHT31 or BME280** inside the enclosure | Dew-point–aware heater control (not in the stock edge agent yet; see `edge/src/sensors/collect.ts`). |
| **Hydrophobic dome coating** (e.g. treatments sold with all-sky kits) | Rain beads and clears faster. |
| **Insta360 X-series** | Weekend **upload/AI** prototype only — see §5. |
| **Four horizon cameras + mux** | Later 4K cloud-base stitch — see §6 and `OMNI_QUAD` in `RASPBERRY_PI.md`. |

## 3. Mechanical layout (looking UP)

1. **Zenith on axis.** The sensor looks **straight up**. The circular fisheye should show a **full horizon ring**, not a parking lot and a sliver of sky.
2. **Lens close to the dome, not touching.** Too much air gap → internal reflections and a smaller usable sky. Touching → scratches and a thermal bridge that fogs.
3. **Level the box.** An un-warp cannot invent a level horizon if the housing is tilted 8°.
4. **North mark** on the enclosure (permanent marker or engraved). Zenith cameras still need a yaw reference for “which way is the Columbia Gorge.”
5. **Heater ring** around the lens, aimed at the **inner** dome surface. Keep wiring away from the optical path.
6. **Pi below the camera** so heat rises toward the dome (helps dew) without cooking the sensor. Active cooler exhaust should not blow directly on the acrylic (dust).
7. **Service hatch.** You will clean the dome and replace desiccant. Prefer a gasketed lid over a glued ABS tube.

## 4. Tailscale and the Pi you already have

Nate already has a host named **`raspberrypi`** on the Tailscale tailnet. It is **often offline**. Treat Tailscale as **SSH / debug when the box is up**, not as the capture transport.

- Captures should upload over **HTTPS** to `CLOUD_BASE_URL` (Vercel) whenever WAN works — independent of Tailscale.
- When the Pi is offline, **queue** stills on the SSD (see [capture.md](./capture.md#offline-and-store-and-forward)).
- Do not block the hardware bring-up on that node being reachable.

## 5. Insta360 — optional weekend prototype

Use a consumer 360 **only** to prove **presign → S3 → analyze** without waiting on the dome.

- Export a **still** (not a stitched video file) and feed it through the existing edge upload path (`CAPTURE_STILL_CMD` can `cat` a JPEG).
- If you mount it **like a 360 cam** (lenses on the horizon), the **stitch seam** runs through the sky. Clouds get a scar; the sun may sit on the glue line. That is a product bug for meteorology, not something to “fix in AI.”
- Do not order the Insta360 as the station camera.

## 6. Later: four-camera 4K horizon

True 4K of **horizon clouds** wants four side-looking modules (or a larger optic), not more pixels in the zenith fisheye. This repo already models that as **`OMNI_QUAD`**. Build the **single up-looking** camera first; do not combine both in one enclosure until the hemisphere pipeline is producing good stills.
