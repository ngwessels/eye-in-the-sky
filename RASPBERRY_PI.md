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
| Pan/tilt | **PCA9685 on I2C to the Arduino** (servos); **Pi → Arduino** uses **serial** (USB or GPIO UART), not I2C. Details: [§5.1](#51-pan--tilt-arduino--pca9685-i2c--serial-to-pi). |
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
| `MOCK_CAMERA` | **unset** — real stills via `CAPTURE_STILL_CMD` | `1` uploads a tiny JPEG (pipeline tests only) |
| `PAN_TILT_DRIVER` | **unset or `auto`** (default): probe I²C for PCA9685 → else serial if `PAN_TILT_SERIAL_PATH` set → else mock | Same; laptop with no I²C + no path → mock |
| `PAN_TILT_SERIAL_PATH` | Set for **Arduino ↔ Pi serial** (auto or `serial`). USB Arduino often `/dev/ttyACM0`; **GPIO UART** often `/dev/serial0`. Not auto-guessed (avoids opening the wrong USB serial, e.g. GPS). | — |
| `PAN_TILT_SERIAL_BAUD` | Optional; default `115200` | Must match firmware |
| `PAN_TILT_I2C_BUS` | Used for **auto** probe and `pca9685` (often **`1`** → `/dev/i2c-1`) | — |
| `PAN_TILT_PCA9685_ADDR` | Used for **auto** probe and `pca9685` — decimal **`64`** or `0x40` | — |
| `WIFI_POSITIONING` | **`1`** to use Mozilla MLS when GNSS has no fix (see Wi-Fi paragraph below) | Handy on a laptop without GNSS |
| `WIFI_SCAN_IFACE` | Wireless interface for `iw dev <iface> scan` (often **`wlan0`**) | — |
| `ALLOW_WIFI_FOR_AIM` | Unset / **`1`** allow `aim_absolute` with Wi-Fi-only fix; **`0`** = reject | Production GNSS users may set `0` |

**GNSS:** plug in the USB GNSS receiver. The stock agent does **not** yet parse NMEA in code; implement reading from `/dev/ttyACM0` / `/dev/serial0` and populate the fields the API expects (`lat`, `lon`, `hdop`, `sat_count`, `fix_type`, `observedAt`, optional `position_source: "gnss"`) in `edge/src/gps.ts`. Until then, use **`WIFI_POSITIONING=1`** for coarse position when you have no GNSS fix.

**Wi-Fi based positioning (optional):** with **`WIFI_POSITIONING=1`**, when there is **no GNSS fix** the agent scans nearby access points, calls **Mozilla Location Service** (`https://location.services.mozilla.com/v1/geolocate`), and reports `position_source: "wifi"` in telemetry. Accuracy is typically **tens to hundreds of meters** — useful for a rough station location on the map, **not** a substitute for GNSS.

- **Server behavior:** the cloud stores `location_source: "wifi"`, keeps **`gps.degraded: true`**, and does **not** promote quality tier or auto-enqueue bootstrap calibration (those still require a non-degraded GNSS fix).
- **Pan/tilt:** by default, **`aim_absolute` is allowed** with a Wi-Fi-only fix (`ALLOW_WIFI_FOR_AIM` unset). Set **`ALLOW_WIFI_FOR_AIM=0`** to reject slews unless GNSS has a real fix (telemetry can still upload Wi-Fi position).
- **Scan permissions:** `iw dev <iface> scan` usually needs **root** or **`CAP_NET_ADMIN`** on the Node binary. Typical setups: install **`iw`** (`sudo apt install -y iw`), set **`WIFI_IW_USE_SUDO=1`**, and add a **passwordless** `/usr/sbin/iw` rule for the service user in **`sudoers`**, or run the edge service as root (less ideal). Optional **`WIFI_SCAN_CMD`** can wrap a script that prints `iw` scan output or one line per AP: `aa:bb:cc:dd:ee:ff -72`. See **`edge/.env.example`**. If `iw` fails, the agent may fall back to **`nmcli -t -f BSSID,SIGNAL dev wifi list`** when NetworkManager is present.
- **Rate limiting:** **`WIFI_GEOLOC_MIN_INTERVAL_MS`** (default 10 minutes) reuses the last MLS result between scans.

**NTP reporting:** the agent sends `time_quality` with each telemetry batch. Ensure the system clock is synced (step 1).

### 5.1 Pan / tilt: Arduino + PCA9685 (I2C + serial to Pi)

The **PCA9685** speaks **I²C**. Either the **Arduino** drives it (Pi talks to the Arduino over **serial** — set **`PAN_TILT_SERIAL_PATH`**; default **`auto`** uses serial after an I²C probe miss), or the **Pi** drives the chip directly on **`/dev/i2c-*`** (**`auto`** selects **`pca9685`** when the probe sees the chip at **`PAN_TILT_PCA9685_ADDR`**). Force a mode with **`PAN_TILT_DRIVER=serial`**, **`pca9685`**, or **`mock`** if needed (see env table).

You need **two separate links**:

| Link | Purpose |
|------|--------|
| **Arduino ↔ PCA9685** | **I²C** (SDA, SCL, GND, power). The flashed sketch uses `Wire` to drive PWM for the servos. |
| **Raspberry Pi ↔ Arduino** | **Serial** at **115200 baud** (text lines `HOME` and `SET pan tilt`). The edge agent uses the Node `serialport` package — same code whether that serial link is **USB** or **GPIO UART**. |

**No code change is required** for “it’s I²C”: set `PAN_TILT_SERIAL_PATH` to whatever device exposes **Pi → Arduino serial**, not the I²C bus.

**A. Wire Arduino to PCA9685 (I²C)**  
Connect **GND**, **SDA**, **SCL**, and **VCC** per your PCA9685 module datasheet. Servos go on the PCA9685 outputs (the bridge sketch uses **channel 0 = tilt**, **channel 1 = pan**).

**B. Wire Pi to Arduino (serial) — pick one**

1. **USB (simplest if available)**  
   USB cable from Pi to Arduino → often **`/dev/ttyACM0`** (sometimes `/dev/ttyUSB0`). Flash the sketch from a PC first if the Arduino only exposes USB for programming.

2. **GPIO UART (when USB is not used for runtime)**  
   - **GND** ↔ **GND**  
   - Pi **TX** (GPIO **14**, physical pin **8**) ↔ Arduino **RX**  
   - Pi **RX** (GPIO **15**, physical pin **10**) ↔ Arduino **TX**  
   - Pi GPIO is **3.3 V**. A **5 V** Arduino’s **RX** may need a **level shifter** on the Pi→Arduino line; many 3.3 V boards are fine with both directions at 3.3 V.  
   - On the Pi, enable the serial port: `sudo raspi-config` → **Interface Options** → **Serial Port** → **disable** login shell over serial, **enable** serial port hardware → **reboot**.  
   - Set **`PAN_TILT_SERIAL_PATH=/dev/serial0`** (or `/dev/ttyAMA0` on some images if `serial0` is absent).

**C. Flash firmware**  
From the repo: [`edge/firmware/pan-tilt-bridge/pan-tilt-bridge.ino`](edge/firmware/pan-tilt-bridge/pan-tilt-bridge.ino) — see [`edge/firmware/pan-tilt-bridge/README.md`](edge/firmware/pan-tilt-bridge/README.md).

**D. Edge `.env`**

```bash
# Default auto is fine: omit PAN_TILT_DRIVER, set only the serial device.
PAN_TILT_SERIAL_PATH=/dev/serial0    # or /dev/ttyACM0 over USB
PAN_TILT_SERIAL_BAUD=115200
```

**E. Permissions**  
Add your user to **`dialout`** (see [§7](#7-serial-permissions-usb-uart-gnss-and-pan-tilt)) so Node can open the serial device.

**If the PCA9685 is on the Pi’s I²C bus only (no Arduino)**  
Enable I²C in `raspi-config`; confirm the chip with `i2cdetect -y 1` (often address **0x40**). **Default `auto`** will select **`pca9685`** when the probe succeeds. To force it (or skip probing), set **`PAN_TILT_DRIVER=pca9685`**. Example:

```bash
PAN_TILT_I2C_BUS=1
PAN_TILT_PCA9685_ADDR=64
```

The edge agent uses the same PWM mapping as [`pan-tilt-bridge.ino`](edge/firmware/pan-tilt-bridge/pan-tilt-bridge.ino). Add your user to the **`i2c`** group (or run with sufficient access to `/dev/i2c-*`) so Node can open the bus.

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
ExecStart=/usr/bin/node edge/start.mjs
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

## 7. Device permissions (serial, I²C pan/tilt, GNSS, Wi-Fi scan)

**Serial** (resolved **`serial`** when `PAN_TILT_SERIAL_PATH` is set under **`auto`**, or `PAN_TILT_DRIVER=serial`; also GNSS when wired): the agent needs access to **`/dev/ttyACM0`**, **`/dev/serial0`**, etc.

```bash
sudo usermod -aG dialout $USER
# log out and back in (or reboot)
ls -l /dev/ttyACM0 /dev/serial0 2>/dev/null
ls -l /dev/serial/by-id/ 2>/dev/null
```

- **USB Arduino:** often `/dev/ttyACM0`.  
- **Pi GPIO UART to Arduino:** often `/dev/serial0` after enabling UART in `raspi-config` ([§5.1](#51-pan--tilt-arduino--pca9685-i2c--serial-to-pi)).  
- If **GPS** and **Arduino** both use USB serial, pick the correct device with **`/dev/serial/by-id/...`** in `PAN_TILT_SERIAL_PATH` (and avoid two apps opening the same port).

**I²C** (resolved **`pca9685`** when **`auto`** probe finds the chip, or `PAN_TILT_DRIVER=pca9685`): add your user to the **`i2c`** group (and enable I²C in `raspi-config`), then re-login:

```bash
sudo usermod -aG i2c $USER
ls -l /dev/i2c-1
```

Pan/tilt over serial + Arduino: [`edge/firmware/pan-tilt-bridge/pan-tilt-bridge.ino`](edge/firmware/pan-tilt-bridge/pan-tilt-bridge.ino). The **`pca9685`** driver uses the same PWM math in Node; `npm install` pulls in **`i2c-bus`** (native build tools on the Pi: `build-essential` if install fails).

**Wi-Fi scan** (`WIFI_POSITIONING=1`): the `pi` user normally **cannot** run `iw dev wlan0 scan` without extra privileges. Prefer **`sudoers`** allowing **`NOPASSWD: /usr/sbin/iw`** (or your distro’s `iw` path — check `command -v iw`) for the service account, or set capabilities on the **`node`** binary (advanced). Without this, MLS is never called and telemetry omits position when GNSS is absent.

## 8. Camera notes (Arducam / libcamera)

The repository’s edge agent uses **`CAPTURE_STILL_CMD`** for real stills by default. For pipeline testing without a camera, set **`MOCK_CAMERA=1`** to upload a minimal JPEG.

For **real** stills from a Pi camera stack, you typically:

1. Install camera support: [Arducam Pi docs](https://docs.arducam.com/) if applicable, plus **`sudo apt install -y libcamera-apps`**. On Bookworm, the still binary is often **`rpicam-still`** (not `libcamera-still`); run `command -v rpicam-still libcamera-still` to see which exists.
2. Set **`CAPTURE_STILL_CMD`** in `edge/.env` to a command that writes JPEG bytes to **stdout** (e.g. `… -o -`). With **`rpicam-still`**, use **`-e jpg`** (not `jpeg` — that encoding name is rejected). The agent appends **`-q`** for JPEG quality unless your command already includes `-q` / `--quality`; override with **`CAPTURE_JPEG_QUALITY`** (`98` = less compression; `none` = disable auto-append). Examples are in `edge/.env.example`.
3. Upload uses the same **presign → PUT → finalize** flow as in `edge/src/upload-capture.ts`.

**Blurry or “no detail” despite large files:** raising JPEG **`-q` only reduces compression artifacts**; a soft image is usually **focus or resolution**. For **Arducam 64MP AF** (and similar), **avoid `--immediate`** (it captures before autofocus). Prefer **`-t 6000`** (or several seconds) plus **`--autofocus-on-capture`**, and use a **higher still resolution** (e.g. 4624×3472 or full sensor) if RAM and **`MAX_CAPTURE_BYTES`** allow. See **`edge/.env.example`** for a recommended command line.

That wiring is **hardware-specific**; keep captures under the size limits your API enforces (`MAX_CAPTURE_BYTES` on the server).

## Hardware integration (not yet in stock agent)

| Component | Stock agent | Next step on Pi |
|-----------|-------------|------------------|
| Pan/tilt | **`auto`**: I²C PCA9685 on Pi, else serial if `PAN_TILT_SERIAL_PATH` set, else mock | [`edge/firmware/pan-tilt-bridge`](edge/firmware/pan-tilt-bridge) + `serialport` or Pi I²C `pca9685`; see [§5.1](#51-pan--tilt-arduino--pca9685-i2c--serial-to-pi) |
| Real GPS | No NMEA in stock `gps.ts` yet | Read NMEA from serial, build `GpsSnapshot` |
| Wi-Fi position | Off unless `WIFI_POSITIONING=1` | `iw` / `nmcli` scan → Mozilla MLS; see §5 |
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
| `gps_degraded` / no `aim_absolute` | No fix or HDOP/sats below server thresholds; improve antenna sky view. With Wi-Fi-only fix: set `ALLOW_WIFI_FOR_AIM=1` (default) or expect `gps_degraded` ack when `ALLOW_WIFI_FOR_AIM=0`. |
| No Wi-Fi position / scan errors | `command -v iw`; run `iw dev wlan0 scan` as the service user; use `WIFI_IW_USE_SUDO=1` + sudoers, or `WIFI_SCAN_CMD`. |
| Service exits immediately | `journalctl -u eye-in-the-sky-edge -e`; verify `node` path and `WorkingDirectory`. |

## Related docs

- [README.md](./README.md) — monorepo overview and cloud setup  
- [PRIVACY.md](./PRIVACY.md) — camera field of view and retention  
- [SECURITY.md](./SECURITY.md) — API keys and reporting issues  
- [edge/.env.example](./edge/.env.example) — all edge environment variables  
