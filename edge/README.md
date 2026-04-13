# Edge agent

Node.js station process: telemetry (position, sensors), command polling, camera upload, calibration flow. Environmental readings only from real drivers in `sensors/collect.ts`. Tiny JPEG uploads are **opt-in** via `MOCK_CAMERA=1` (see `.env.example`). Position uses GNSS when implemented in `gps.ts`, else optional Wi-Fi MLS.

**Raspberry Pi installation, systemd, GPS, and camera:** see the repo root guide **[../RASPBERRY_PI.md](../RASPBERRY_PI.md)**.

Local quick start: copy [`.env.example`](./.env.example) to `.env`, then from repo root:

```bash
npm run build -w @eye/shared && npm run dev -w @eye/edge
```

Tests: `npm run test -w @eye/edge` (omni camera-list parser).
