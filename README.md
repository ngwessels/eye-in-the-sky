# Eye on the Sky

Open-source weather camera mesh: Raspberry Pi **edge** agents (Node.js) upload sky imagery to **AWS S3**, poll **MongoDB-backed commands** from a **Next.js** app on Vercel, and report **GPS + optional sensors**. The server uses **Apple Weather Kit** (optional) for orchestration, **Vercel AI Gateway** for vision analysis, and **closed-loop** aim/capture commands.

## Meteorological all-sky camera (first hardware build)

**One camera looking up** — a ~180° horizon-to-horizon hemisphere for weather, not a tourist street-level 360 and not a night-sky astronomy all-sky (those leave a raw circular fisheye, use long exposures, and ignore sun/cloud HDR).

First build: **Raspberry Pi 5** + **12 MP HQ-class CSI** + **named ~180° M12 fisheye** + **weatherproof dome** + **dew/rain heater** (Oregon: Forest Grove / Hillsboro). Short daylight HDR stills about every **30 s**, remap the circle to a usable sky image, upload with timestamp and site metadata. Power the outdoor station with **PoE** (or another clean indoor-to-outdoor path), not a USB brick on a wet outlet.

| Doc | Contents |
|-----|----------|
| **[docs/hardware.md](./docs/hardware.md)** | Why this camera, parts list (roles + 2026-available SKUs), dome/heater, PoE, Tailscale note, Insta360 prototype, later 4-cam stitch |
| **[docs/capture.md](./docs/capture.md)** | Exposure, HDR, dew, un-warp, raw + derived, upload API sketch, what “good” looks like |

Sidecar JSON contract: `packages/shared/src/all-sky.ts`. Pi OS and the existing edge agent: **[RASPBERRY_PI.md](./RASPBERRY_PI.md)**. True 4K of **horizon** clouds is a later four-camera stitch (`OMNI_QUAD`); an Insta360 is optional only to exercise upload/AI — the stitch seam is a problem if you mount it like a 360 cam.

## Monorepo layout

| Path | Description |
|------|-------------|
| `docs/` | All-sky hardware + capture pipeline (first camera build) |
| `apps/web` | Next.js App Router — station APIs, crons, orchestrator |
| `packages/shared` | Zod schemas and shared types |
| `edge` | Node.js station agent (telemetry, commands, captures; opt-in mocks for testing) |

## Prerequisites

- Node 20+
- MongoDB Atlas (or local) URI
- AWS S3 bucket + IAM user with `s3:PutObject`, `s3:GetObject` on that bucket
- (Optional) Apple Weather Kit credentials + `.p8` key file path
- (Optional) `AI_GATEWAY_API_KEY` for capture analysis

## Setup

1. Copy [`.env.example`](./.env.example) to `apps/web/.env.local` and fill values.
2. `npm install`
3. `npm run build -w @eye/shared`
4. Register a station:

   ```bash
   curl -s -X POST "$ORIGIN/api/stations/register" \
     -H "Content-Type: application/json" \
     -H "x-admin-secret: $ADMIN_SECRET" \
     -d '{"name":"lab-1"}'
   ```

5. Copy `edge/.env.example` to `edge/.env`, set `STATION_API_KEY` and `CLOUD_BASE_URL`.
6. `npm run edge:dev` (with web dev server running).

## Scripts

- `npm run dev` — build shared + start Next dev server
- `npm run build` — production build
- `npm run test` — shared + edge unit tests
- `npm run edge:dev` — edge agent with hot reload

## Crons (Vercel)

[`apps/web/vercel.json`](apps/web/vercel.json) defines schedules for orchestrator, analysis, and closed-loop. Set `CRON_SECRET` in Vercel; the platform sends `Authorization: Bearer <CRON_SECRET>` when configured.

## Raspberry Pi (edge station)

Step-by-step Pi setup (OS, Node, systemd, GPS, camera notes): **[RASPBERRY_PI.md](./RASPBERRY_PI.md)**.

## Hardware

**Order-of-parts all-sky (zenith fisheye):** [docs/hardware.md](./docs/hardware.md). **Capture / HDR / un-warp / upload:** [docs/capture.md](./docs/capture.md).

See [RASPBERRY_PI.md](./RASPBERRY_PI.md) for Arducam / libcamera, fixed or omni multi-camera rigs, USB/UART GPS, and optional BME280 / rain / wind / lightning. The stock `edge` agent sends **no** environmental sensor readings until you add real drivers in `edge/src/sensors/collect.ts`. It does **not** send a mock JPEG unless you set **`MOCK_CAMERA=1`**. GNSS comes from code you add in `gps.ts`; without it, the agent **defaults to Wi-Fi + Mozilla MLS** for coarse fixes (set **`WIFI_POSITIONING=0`** to turn that off). Use **`CAPTURE_STILL_CMD`** for real stills.

## Privacy

See [PRIVACY.md](./PRIVACY.md).

## License

[MIT](./LICENSE)
