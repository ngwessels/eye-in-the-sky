# Edge agent

Node.js station process: telemetry (GPS, sensors), command polling, mock camera upload, calibration flow.

**Raspberry Pi installation, systemd, GPS, and camera:** see the repo root guide **[../RASPBERRY_PI.md](../RASPBERRY_PI.md)**.

Local quick start: copy [`.env.example`](./.env.example) to `.env`, then from repo root:

```bash
npm run build -w @eye/shared && npm run dev -w @eye/edge
```

Hardware checks (from `edge/` after `npm run build`): `npm run test-pan-tilt` (motion only), `npm run test-pan-tilt-capture` (motion + presign/S3/finalize per pose; see `.env.example`).
