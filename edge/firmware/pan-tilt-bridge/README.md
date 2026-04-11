# Pan/tilt serial bridge (Arduino + PCA9685)

Firmware for an Arduino-class board that drives an **I²C PCA9685** (for example the Arducam pan-tilt kit) and listens for commands from the **Eye on the Sky edge agent** over **serial** (not I²C).

## I²C vs serial (read this first)

| Connection | Bus | Role |
|------------|-----|------|
| **Arduino ↔ PCA9685** | **I²C** (SDA/SCL) | Sketch uses `Wire` to set servo PWM. This is the “it’s I²C” part. |
| **Raspberry Pi ↔ Arduino** | **Serial** (115200 8N1, newline-terminated lines) | Edge agent opens `PAN_TILT_SERIAL_PATH` and sends `HOME` / `SET pan tilt`. **No repo code change** is needed for I²C on the PCA9685 link. |

If the Pi cannot use **USB** to the Arduino, use **GPIO UART** on the Pi and set e.g. `PAN_TILT_SERIAL_PATH=/dev/serial0`. Full steps: [RASPBERRY_PI.md — section 5.1](../../../RASPBERRY_PI.md#51-pan--tilt-arduino--pca9685-i2c--serial-to-pi).

If the **PCA9685 is wired only to the Pi’s I²C** (no Arduino), **default `auto`** will use the Pi **`pca9685`** driver when the I²C probe succeeds (see `edge/.env.example` for `PAN_TILT_I2C_BUS` / `PAN_TILT_PCA9685_ADDR`). Set **`PAN_TILT_DRIVER=pca9685`** to force it; the Arduino sketch is not used in that layout.

Upstream PWM math is aligned with [ArduCAM/PCA9685](https://github.com/ArduCAM/PCA9685) (`example/rpi/PCA9685.c`). That repo is mainly Pi C examples; this sketch ports the same register/pulse logic to **Arduino `Wire`**.

## Wiring

- **Arduino ↔ PCA9685**: SDA → SDA, SCL → SCL, **GND**, and **power** per your PCA9685 module (follow the datasheet for 3.3 V vs 5 V).
- **Raspberry Pi ↔ Arduino (serial)** — choose one:
  - **USB:** Pi USB → Arduino USB → often `/dev/ttyACM0` on the Pi.
  - **UART:** Pi **TX (GPIO 14)** → Arduino **RX**, Pi **RX (GPIO 15)** → Arduino **TX**, **common GND**; enable UART in `raspi-config` (no login on serial); use `/dev/serial0` in `.env`. Use a **level shifter** if the Arduino RX is strict 5 V-only.

## Flashing

1. Install the [Arduino IDE](https://www.arduino.cc/en/software) or [Arduino CLI](https://arduino.github.io/arduino-cli/).
2. Open `pan-tilt-bridge.ino`.
3. Select your board and port, then upload (USB to a laptop is fine for flashing only).
4. On the Pi: add user to `dialout`, set `PAN_TILT_SERIAL_PATH` to your **serial** device (USB or `/dev/serial0`). See [RASPBERRY_PI.md](../../../RASPBERRY_PI.md).

## Serial protocol

- `115200` baud, 8N1, **newline-terminated** lines.
- `HOME` — neutral for logical pan=0°, tilt=0° (mapped in sketch).
- `SET <panDeg> <tiltDeg>` — e.g. `SET 45.0 12.5`. **Channel 0 = tilt**, **1 = pan** (ArduCAM-style).

Tune `kIn*` / `kOut*` in the `.ino` if your mechanics differ; keep them consistent with `PAN_MIN_DEG` / `TILT_*` in `edge/.env` if you override defaults.

## Edge agent configuration

In `edge/.env`:

```bash
PAN_TILT_DRIVER=serial
PAN_TILT_SERIAL_PATH=/dev/serial0
# or: PAN_TILT_SERIAL_PATH=/dev/ttyACM0
PAN_TILT_SERIAL_BAUD=115200
```

Rebuild and restart the edge service after changes.
