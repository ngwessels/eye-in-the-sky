# Eye in the Sky — Raspberry Pi station setup

This guide walks through running the **edge agent** on a Raspberry Pi so it registers with your deployed cloud API, uploads captures to **S3**, reports **GPS** and optional **sensors**, and executes **pan/tilt** commands.

## What you need

| Item | Notes |
|------|--------|
| Raspberry Pi | Pi 4 or Pi 5 recommended (4 GB+ RAM). **64-bit** Raspberry Pi OS (Bookworm). |
| Power | Adequate supply; USB hubs can brown out GPS/camera. |
| Network | Ethernet or stable Wi‑Fi; Pi must reach your `CLOUD_BASE_URL` over **HTTPS** in production. |
| GNSS GPS | USB dongle (u-blox, etc.) or UART module; **clear sky** view for a 3D fix. |
| Camera | Arducam 64MP Hawkeye (or other) per your build; requires vendor / `libcamera` stack on the Pi. |
| Pan/tilt | Arducam (or similar) mount; control is usually **UART** or **GPIO PWM** (not yet wired in the stock Node agent—see [Hardware integration](#hardware-integration-not-yet-in-stock-agent)). |
| Cloud already running | Vercel (or other) hosting `apps/web`, with MongoDB, S3, and a **station API key** from registration. |

## 1. Install Raspberry Pi OS

1. Flash **Raspberry Pi OS (64-bit)** with Raspberry Pi Imager.
2. First boot: enable SSH, set locale/timezone, run `sudo apt update && sudo apt full-upgrade -y`.
3. **Time sync**: use the default **systemd-timesyncd** or install **Chrony** (`sudo apt install -y chrony`). Bad time breaks GPS and `capturedAt` checks.

```bash
sudo timedatectl set-ntp true
timedatectl status
```

## 2. Install Node.js (20+)

The edge agent targets **Node 20+**.

**Option A — NodeSource (Bookworm)**

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # should be v20+ or v22+
```

**Option B — nvm** (if you prefer user-local Node)

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 22
```

## 3. Get the code on the Pi

Clone the repository (or copy the project). You need the **workspace** so `@eye/shared` resolves.

```bash
cd ~
git clone <your-repo-url> eye-in-the-sky
cd eye-in-the-sky
npm install
npm run build -w @eye/shared
npm run build -w @eye/edge
```

Smoke test:

```bash
cd ~/eye-in-the-sky
# After .env is configured (next section):
node edge/dist/index.js
```

For development with auto-reload on the Pi:

```bash
npm run dev -w @eye/edge
```

## 4. Register a station (one-time)

On your laptop or CI (anywhere with `curl`), call your deployed API with the **admin secret**:

```bash
export ORIGIN="https://your-app.vercel.app"
export ADMIN_SECRET="your-long-admin-secret"

curl -s -X POST "$ORIGIN/api/stations/register" \
  -H "Content-Type: application/json" \
  -H "x-admin-secret: $ADMIN_SECRET" \
  -d '{"name":"pi-garage-west"}'
```

Save the returned `apiKey` (**shown once**). You will put it in `STATION_API_KEY` on the Pi.

## 5. Configure the edge agent on the Pi

```bash
cd ~/eye-in-the-sky/edge
cp .env.example .env
nano .env   # or use your editor
```

| Variable | Production Pi | Development |
|----------|----------------|-------------|
| `CLOUD_BASE_URL` | `https://your-app.vercel.app` (no trailing slash) | `http://192.168.1.x:3000` |
| `STATION_API_KEY` | Key from registration | Same |
| `COMMAND_POLL_INTERVAL_MS` | `180000`–`300000` (3–5 minutes) | Any |
| `GPS_MOCK` | **`0` or unset** — use real GPS | `1` for testing without GPS |
| `MOCK_CAMERA` | **`0`** when using real capture scripts | `1` uploads a tiny JPEG |

Optional mock sensors (only for bench testing):

- `MOCK_BME280_TEMP_C`, `MOCK_BME280_PRESSURE_HPA`, `MOCK_BME280_HUMIDITY_PCT`, etc.

**GPS without mock:** plug in the USB GNSS receiver. The stock agent does **not** yet parse NMEA in code; until a serial reader is added, you can:

- Keep `GPS_MOCK=1` only for lab demos, or  
- Implement reading from `/dev/ttyACM0` / `/dev/serial0` and populate the same fields the API expects (`lat`, `lon`, `hdop`, `sat_count`, `fix_type`, `observedAt`) in `edge/src/gps.ts`.

**NTP reporting:** the agent sends `time_quality` with each telemetry batch. Ensure the system clock is synced (step 1).

## 6. Run as a systemd service (recommended)

Create `/etc/systemd/system/eye-in-the-sky-edge.service`:

```ini
[Unit]
Description=Eye in the Sky edge agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/eye-in-the-sky
EnvironmentFile=/home/pi/eye-in-the-sky/edge/.env
ExecStart=/usr/bin/node edge/dist/index.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Adjust `User=` and paths if your home directory differs.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now eye-in-the-sky-edge.service
sudo systemctl status eye-in-the-sky-edge.service
journalctl -u eye-in-the-sky-edge.service -f
```

After updating code:

```bash
cd ~/eye-in-the-sky && npm run build -w @eye/shared && npm run build -w @eye/edge
sudo systemctl restart eye-in-the-sky-edge.service
```

## 7. USB permissions (GPS / serial)

If you add a USB serial GPS:

```bash
sudo usermod -aG dialout $USER
# log out and back in
ls -l /dev/ttyACM0
```

## 8. Camera notes (Arducam / libcamera)

The repository’s edge agent currently supports:

- **`MOCK_CAMERA=1`**: uploads a minimal JPEG for pipeline testing.

For **real** stills from a Pi camera stack, you typically:

1. Install Arducam / `libcamera` packages per [Arducam’s Pi docs](https://docs.arducam.com/).
2. Capture with `rpicam-still` (or `libcamera-still`) to a file, then upload via the same **presign → PUT → finalize** flow as in `edge/src/upload-capture.ts`.

That wiring is **hardware-specific**; keep captures under the size limits your API enforces (`MAX_CAPTURE_BYTES` on the server). Prefer resizing large 64 MP frames on the Pi before upload.

## Hardware integration (not yet in stock agent)

| Component | Stock agent | Next step on Pi |
|-----------|-------------|------------------|
| Pan/tilt | Mock angles in memory | `serialport` or GPIO library + Arducam controller protocol |
| Real GPS | Mock unless you extend `gps.ts` | Read NMEA from serial, build `GpsSnapshot` |
| BME280 / I2C | Mock env vars | `i2c-bus` or Python sidecar; push readings into telemetry |
| Lightning AS3935 | Mock | Same pattern: driver → telemetry readings |

## 9. Security on the Pi

- Use **HTTPS** for `CLOUD_BASE_URL` in production.
- Protect `edge/.env` (`chmod 600 .env`); never commit it.
- Keep the Pi OS patched: `sudo apt update && sudo apt upgrade -y`.

## 10. Troubleshooting

| Symptom | What to check |
|---------|----------------|
| `telemetry failed 401` | `STATION_API_KEY` wrong or rotated; re-register if needed. |
| `poll failed` / network errors | `CLOUD_BASE_URL`, DNS, firewall, TLS interception. |
| `finalize failed` / `clock_skew` | System time (`timedatectl`); or set server `CLOCK_SKEW_MODE=downrank` if you must accept skew temporarily. |
| `gps_degraded` / no `aim_absolute` | No fix or HDOP/sats below server thresholds; improve antenna sky view. |
| Service exits immediately | `journalctl -u eye-in-the-sky-edge -e`; verify `node` path and `WorkingDirectory`. |

## Related docs

- [README.md](./README.md) — monorepo overview and cloud setup  
- [PRIVACY.md](./PRIVACY.md) — camera field of view and retention  
- [SECURITY.md](./SECURITY.md) — API keys and reporting issues  
- [edge/.env.example](./edge/.env.example) — all edge environment variables  
