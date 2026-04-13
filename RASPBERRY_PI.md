# Eye on the Sky — Raspberry Pi station setup

This guide walks through running the **edge agent** on a Raspberry Pi so it registers with your deployed cloud API, uploads captures to **S3**, reports **GPS** and optional **sensors**, using a **fixed camera** (single module or **omni quad** multi-camera adapter). Pan/tilt hardware is not supported.

## What you need

| Item | Notes |
|------|--------|
| Raspberry Pi | Pi 4 or Pi 5 recommended (4 GB+ RAM). **64-bit** Raspberry Pi OS (Bookworm). |
| Power | Adequate supply; USB hubs can brown out GPS/camera. |
| Network | Ethernet or stable Wi‑Fi; Pi must reach your `CLOUD_BASE_URL` over **HTTPS** in production. |
| GNSS GPS | USB dongle (u-blox, etc.) or UART module; **clear sky** view for a 3D fix. |
| Camera | Single module or **multi-camera adapter** (e.g. Arducam Multi Camera Adapter on Pi 4/5); requires vendor / `libcamera` stack. Use **`OMNI_QUAD=1`** and **`"omni_quad": true`** at registration for quad rigs ([§8.1](#81-omni-quad-arducam-multi-camera-adapter)). |
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
git clone <your-repo-url> eye-on-the-sky
cd eye-on-the-sky
npm install
npm run build -w @eye/shared
npm run build -w @eye/edge
```

Smoke test:

```bash
cd ~/eye-on-the-sky
# After .env is configured (next section):
node edge/start.mjs
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

# Fixed quad-camera rig (no pan/tilt): set capabilities on the station so cloud jobs use capture-only paths.
curl -s -X POST "$ORIGIN/api/stations/register" \
  -H "Content-Type: application/json" \
  -H "x-admin-secret: $ADMIN_SECRET" \
  -d '{"name":"pi-omni-field","omni_quad":true}'
```

Save the returned `apiKey` (**shown once**). You will put it in `STATION_API_KEY` on the Pi. Use **`omni_quad: true`** only when the edge device is configured with **`OMNI_QUAD=1`** (see [§8.1](#81-omni-quad-arducam-multi-camera-adapter)).

## 5. Configure the edge agent on the Pi

```bash
cd ~/eye-on-the-sky/edge
cp .env.example .env
nano .env   # or use your editor
```

| Variable | Production Pi | Development |
|----------|----------------|-------------|
| `CLOUD_BASE_URL` | `https://your-app.vercel.app` (no trailing slash) | `http://192.168.1.x:3000` |
| `STATION_API_KEY` | Key from registration | Same |
| `COMMAND_POLL_INTERVAL_MS` | `180000`–`300000` (3–5 minutes) | Any |
| `MOCK_CAMERA` | **unset** — real stills via `CAPTURE_STILL_CMD` | `1` uploads a tiny JPEG (pipeline tests only) |
| `WIFI_POSITIONING` | **Unset = on** — Mozilla MLS when GNSS has no fix (see Wi-Fi paragraph). Set **`0`** / **`false`** to disable | Air-gapped or no MLS |
| `WIFI_SCAN_IFACE` | Wireless interface for `iw dev <iface> scan` (often **`wlan0`**) | — |
| `ALLOW_WIFI_FOR_AIM` | Unset / **`1`** allow `calibration_sky_probe` with Wi-Fi-only fix; **`0`** = reject | Production GNSS users may set `0` |
| `OMNI_QUAD` | **`1`** / **`true`**: multi-camera rig; each `capture_now` runs **one exposure per camera, in order** (adapter multiplexes). | Must match station `capabilities.omni_quad` in Mongo / registration |
| `OMNI_CAMERA_COUNT` | **Unset / `auto`**: detect via `rpicam-still --list-cameras` (or `libcamera-still` / `rpicam-hello`), cached **5 minutes** (`OMNI_CAMERA_DETECT_CACHE_MS`). **Integer**: fixed count, no probe. **`MOCK_CAMERA=1` + auto**: uses how many entries you listed in `OMNI_SLOT_AZIMUTH_DEG`. | Must match physical modules / adapter |
| `OMNI_SLOT_AZIMUTH_DEG` | Comma-separated **relative** azimuths from slot 0 boresight (default **`0,90,180,270`**) | Must list **at least** as many values as the active camera count |
| `CAPTURE_STILL_CMD_TEMPLATE` | Shell command with literal **`{{INDEX}}`** for `rpicam-still --camera` (or equivalent) | Required for real omni capture (unless `MOCK_CAMERA=1`) |
| `OMNI_CAPTURE_ELEVATION_DEG` | Optional; if set, sent on finalize for every slot | Approximate elevation for wide FOV sky cameras |

**GNSS:** plug in the USB GNSS receiver. The stock agent does **not** yet parse NMEA in code; implement reading from `/dev/ttyACM0` / `/dev/serial0` and populate the fields the API expects (`lat`, `lon`, `hdop`, `sat_count`, `fix_type`, `observedAt`, optional `position_source: "gnss"`) in `edge/src/gps.ts`. Until then, **Wi-Fi fallback is enabled by default** for coarse position when there is no GNSS fix (set **`WIFI_POSITIONING=0`** to disable).

**Wi-Fi based positioning (default on):** when there is **no GNSS fix**, the agent scans nearby access points, calls **Mozilla Location Service** (`https://location.services.mozilla.com/v1/geolocate`), and reports `position_source: "wifi"` in telemetry. Accuracy is typically **tens to hundreds of meters** — useful for a rough station location on the map, **not** a substitute for GNSS.

- **Server behavior:** the cloud stores `location_source: "wifi"`, keeps **`gps.degraded: true`**, and does **not** promote quality tier or auto-enqueue bootstrap calibration (those still require a non-degraded GNSS fix).
- **`calibration_sky_probe`:** by default allowed with a Wi-Fi-only fix (`ALLOW_WIFI_FOR_AIM` unset). Set **`ALLOW_WIFI_FOR_AIM=0`** to reject unless GNSS has a real fix (telemetry can still upload Wi-Fi position).
- **Scan permissions:** `iw dev <iface> scan` usually needs **root** or **`CAP_NET_ADMIN`** on the Node binary. Typical setups: install **`iw`** (`sudo apt install -y iw`), set **`WIFI_IW_USE_SUDO=1`**, and add a **passwordless** `/usr/sbin/iw` rule for the service user in **`sudoers`**, or run the edge service as root (less ideal). Optional **`WIFI_SCAN_CMD`** can wrap a script that prints `iw` scan output or one line per AP: `aa:bb:cc:dd:ee:ff -72`. See **`edge/.env.example`**. If `iw` fails, the agent may fall back to **`nmcli -t -f BSSID,SIGNAL dev wifi list`** when NetworkManager is present.
- **Rate limiting:** **`WIFI_GEOLOC_MIN_INTERVAL_MS`** (default 10 minutes) reuses the last MLS result between scans.

**NTP reporting:** the agent sends `time_quality` with each telemetry batch. Ensure the system clock is synced (step 1).

## 6. Run as a systemd service (recommended)

Create `/etc/systemd/system/eye-on-the-sky-edge.service`:

```ini
[Unit]
Description=Eye on the Sky edge agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/eye-on-the-sky
EnvironmentFile=/home/pi/eye-on-the-sky/edge/.env
ExecStart=/usr/bin/node edge/start.mjs
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Adjust `User=` and paths if your home directory differs.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now eye-on-the-sky-edge.service
sudo systemctl status eye-on-the-sky-edge.service
journalctl -u eye-on-the-sky-edge.service -f
```

After updating code:

```bash
cd ~/eye-on-the-sky && npm run build -w @eye/shared && npm run build -w @eye/edge
sudo systemctl restart eye-on-the-sky-edge.service
```

## 7. Device permissions (serial GNSS, optional I²C sensors, Wi-Fi scan)

**Serial** (GNSS modules on USB or UART): add the service user to **`dialout`** so Node can open **`/dev/ttyACM0`**, **`/dev/serial0`**, etc.

```bash
sudo usermod -aG dialout $USER
# log out and back in (or reboot)
ls -l /dev/ttyACM0 /dev/serial0 2>/dev/null
ls -l /dev/serial/by-id/ 2>/dev/null
```

If multiple USB serial devices are present, use stable **`/dev/serial/by-id/...`** paths in your GNSS configuration and avoid two processes opening the same port.

**I²C** (optional future sensors such as BME280): enable I²C in `raspi-config`, add the user to **`i2c`**, re-login:

```bash
sudo usermod -aG i2c $USER
ls -l /dev/i2c-1
```

**Wi-Fi scan** (default unless `WIFI_POSITIONING=0`): the `pi` user normally **cannot** run `iw dev wlan0 scan` without extra privileges. Prefer **`sudoers`** allowing **`NOPASSWD: /usr/sbin/iw`** (or your distro’s `iw` path — check `command -v iw`) for the service account, or set capabilities on the **`node`** binary (advanced). Without this, MLS is never called and telemetry omits position when GNSS is absent.

## 8. Camera notes (Arducam / libcamera)

The repository’s edge agent uses **`CAPTURE_STILL_CMD`** for real stills by default. For pipeline testing without a camera, set **`MOCK_CAMERA=1`** to upload a minimal JPEG.

For **real** stills from a Pi camera stack, you typically:

1. Install camera support: [Arducam Pi docs](https://docs.arducam.com/) if applicable, plus **`sudo apt install -y libcamera-apps`**. On Bookworm, the still binary is often **`rpicam-still`** (not `libcamera-still`); run `command -v rpicam-still libcamera-still` to see which exists.
2. Set **`CAPTURE_STILL_CMD`** in `edge/.env` to a command that writes JPEG bytes to **stdout** (e.g. `… -o -`). With **`rpicam-still`**, use **`-e jpg`** (not `jpeg` — that encoding name is rejected). The agent appends **`-q`** for JPEG quality unless your command already includes `-q` / `--quality`; override with **`CAPTURE_JPEG_QUALITY`** (`98` = less compression; `none` = disable auto-append). Examples are in `edge/.env.example`.
3. Upload uses the same **presign → PUT → finalize** flow as in `edge/src/upload-capture.ts`.

**Blurry or “no detail” despite large files:** raising JPEG **`-q` only reduces compression artifacts**; a soft image is usually **focus or resolution**. For **Arducam 64MP AF** (and similar), **avoid `--immediate`** (it captures before autofocus). Prefer **`-t 6000`** (or several seconds) plus **`--autofocus-on-capture`**, and use a **higher still resolution** (e.g. 4624×3472 or full sensor) if RAM and **`MAX_CAPTURE_BYTES`** allow. See **`edge/.env.example`** for a recommended command line.

That wiring is **hardware-specific**; keep captures under the size limits your API enforces (`MAX_CAPTURE_BYTES` on the server).

### 8.1 Omni quad (Arducam multi-camera adapter)

For a **fixed** set of cameras (typically four, 90° apart on the horizon), the adapter **multiplexes** sensors: only one is active at a time. The edge agent runs **sequential** still commands (one per slot), then **presign → PUT → finalize** for each JPEG. Wall time is roughly **N×** a single exposure plus switching.

1. Register the station with **`"omni_quad": true`** (see [§4](#4-register-a-station-one-time)).
2. On the Pi set **`OMNI_QUAD=1`**, **`OMNI_SLOT_AZIMUTH_DEG`**, and **`CAPTURE_STILL_CMD_TEMPLATE`** with **`{{INDEX}}`**. Leave **`OMNI_CAMERA_COUNT`** unset so the agent **counts** sensors from **`rpicam-still --list-cameras`** (or set **`OMNI_CAMERA_COUNT=N`** to override). Example:

   ```bash
   OMNI_QUAD=1
   OMNI_SLOT_AZIMUTH_DEG=0,90,180,270
   # Example only — verify --camera indices for your adapter + OS:
   CAPTURE_STILL_CMD_TEMPLATE=rpicam-still -e jpg -n --immediate --camera {{INDEX}} --width 1920 --height 1080 -o -
   ```

3. **`CAPTURE_STILL_CMD`** is still used when **`OMNI_QUAD`** is off. With **`OMNI_QUAD=1`**, real capture uses **only** the template. Stills are taken **sequentially** (slot 0, then 1, …): the hardware cannot expose every sensor simultaneously.
4. Each upload gets **`azimuth_true_deg`** = calibrated north offset + slot offset (same convention as slot 0 = former “pan home” boresight). Optional **`OMNI_CAPTURE_ELEVATION_DEG`** sets a shared elevation on finalize.
5. **`run_calibration`**: each progress phase captures **all** camera slots in order (same as `capture_now`). The **first** uploaded object in `calibration_s3_keys` is always **slot 0** so server sun calibration matches the reference boresight. Requires **`CAPTURE_STILL_CMD_TEMPLATE`** when not using `MOCK_CAMERA`. Bootstrap auto-calibration runs for omni stations too once GNSS is healthy.

## Hardware integration (not yet in stock agent)

| Component | Stock agent | Next step on Pi |
|-----------|-------------|------------------|
| Fixed camera / omni | Supported in stock agent | Single `CAPTURE_STILL_CMD` or **`OMNI_QUAD`** + template; see §8.1 |
| Real GPS | No NMEA in stock `gps.ts` yet | Read NMEA from serial, build `GpsSnapshot` |
| Wi-Fi position | **On by default** when GNSS has no fix; set `WIFI_POSITIONING=0` to disable | `iw` / `nmcli` scan → Mozilla MLS; see §5 |
| BME280 / I2C | None in stock agent | Add a driver in `edge/src/sensors/collect.ts` (`i2c-bus` or sidecar) |
| Lightning AS3935 | None in stock agent | Same pattern: driver → `collect.ts` → telemetry |

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
| `no_position_fix` / failed `calibration_sky_probe` | No lat/lon: check Wi-Fi scan + MLS (`iw`, `WIFI_IW_USE_SUDO`, etc.) or implement GNSS in `edge/src/gps.ts`. |
| `pan_tilt_not_supported` | Cloud or an old client enqueued **`aim_absolute`**, **`aim_delta`**, or **`safe_home`**; pan/tilt hardware is removed — use **`capture_now`** only. |
| `CAPTURE_STILL_CMD_TEMPLATE` / `{{INDEX}}` errors | Set a template with **`{{INDEX}}`** for omni real capture, or use **`MOCK_CAMERA=1`** for pipeline tests. |
| `gps_degraded` | Snapshot exists but `fix_type` is `none` (GNSS no fix). Improve sky view / antenna. |
| `wifi_not_allowed_for_aim` | Wi-Fi fix present but `ALLOW_WIFI_FOR_AIM=0`; **`calibration_sky_probe`** needs a fix or set `ALLOW_WIFI_FOR_AIM=1`. |
| Legacy `gps_degraded` in old acks | Same family as above; new edge versions use the specific errors in the rows above. |
| No Wi-Fi position / scan errors | `command -v iw`; run `iw dev wlan0 scan` as the service user; use `WIFI_IW_USE_SUDO=1` + sudoers, or `WIFI_SCAN_CMD`. |
| Service exits immediately | `journalctl -u eye-on-the-sky-edge -e`; verify `node` path and `WorkingDirectory`. |

## Related docs

- [README.md](./README.md) — monorepo overview and cloud setup  
- [PRIVACY.md](./PRIVACY.md) — camera field of view and retention  
- [SECURITY.md](./SECURITY.md) — API keys and reporting issues  
- [edge/.env.example](./edge/.env.example) — all edge environment variables  
