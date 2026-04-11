# Eye in the Sky

Open-source weather camera mesh: Raspberry Pi **edge** agents (Node.js) upload sky imagery to **AWS S3**, poll **MongoDB-backed commands** from a **Next.js** app on Vercel, and report **GPS + optional sensors**. The server uses **Apple Weather Kit** (optional) for orchestration, **Vercel AI Gateway** for vision analysis, and **closed-loop** aim/capture commands.

## Monorepo layout

| Path | Description |
|------|-------------|
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
- `npm run edge:dev` — edge agent with hot reload

## Crons (Vercel)

[`apps/web/vercel.json`](apps/web/vercel.json) defines schedules for orchestrator, analysis, and closed-loop. Set `CRON_SECRET` in Vercel; the platform sends `Authorization: Bearer <CRON_SECRET>` when configured.

## Raspberry Pi (edge station)

Step-by-step Pi setup (OS, Node, systemd, GPS, camera notes): **[RASPBERRY_PI.md](./RASPBERRY_PI.md)**.

## Hardware

See [RASPBERRY_PI.md](./RASPBERRY_PI.md) and the project plan for Arducam 64MP, pan/tilt, USB/UART GPS, and optional BME280 / rain / wind / lightning. The stock `edge` agent sends **no** environmental sensor readings until you add real drivers in `edge/src/sensors/collect.ts`. It does **not** send a mock JPEG unless you set **`MOCK_CAMERA=1`**. GNSS comes from code you add in `gps.ts`; without it, use **`WIFI_POSITIONING=1`** for coarse fixes. Use **`CAPTURE_STILL_CMD`** for real stills.

## Privacy

See [PRIVACY.md](./PRIVACY.md).

## License

[MIT](./LICENSE)
