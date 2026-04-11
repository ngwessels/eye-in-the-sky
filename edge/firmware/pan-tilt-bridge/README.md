# Pan/tilt serial bridge (Arduino + PCA9685)

Firmware for an Arduino-class board that drives an **I2C PCA9685** (for example the Arducam pan-tilt kit) and listens for commands from the **Eye in the Sky edge agent** over USB serial.

Upstream PWM reference logic is aligned with [ArduCAM/PCA9685](https://github.com/ArduCAM/PCA9685) (`example/rpi/PCA9685.c`). That repository is primarily C examples for the Raspberry Pi; this sketch ports the same register and pulse math to **Arduino `Wire`**.

## Wiring

- **Arduino ↔ PCA9685**: SDA → SDA, SCL → SCL, **3.3 V or 5 V** and **GND** per your board’s PCA9685 module (many modules are 5 V tolerant on I2C; follow the module datasheet).
- **Raspberry Pi ↔ Arduino**: USB cable from the Pi to the Arduino’s USB port is enough for serial. If you use **UART** instead (GPIO serial), connect **TX ↔ RX**, **RX ↔ TX**, and **common GND**; match the baud rate (`115200`).

## Flashing

1. Install the [Arduino IDE](https://www.arduino.cc/en/software) or [Arduino CLI](https://arduino.github.io/arduino-cli/).
2. Open `pan-tilt-bridge.ino`.
3. Select your board and port, then upload.
4. On the Pi, find the device (often `/dev/ttyACM0` or `/dev/ttyUSB0`) and add the user to `dialout` if needed (see main [RASPBERRY_PI.md](../../../RASPBERRY_PI.md)).

## Serial protocol

- `115200` baud, 8N1, **newline-terminated** lines.
- `HOME` — move to the neutral pose for logical pan=0°, tilt=0° (mapped to your servo ranges in the sketch).
- `SET <panDeg> <tiltDeg>` — e.g. `SET 45.0 12.5`. Angles use the same semantics the cloud sends; the sketch maps them to servo channels **0 = tilt**, **1 = pan** (ArduCAM-style).

If your mechanical limits differ, edit the `kIn*` and `kOut*` constants at the top of the `.ino` file (keep them in sync with `PAN_MIN_DEG` / `PAN_MAX_DEG` / `TILT_*` in `edge/.env` if you override defaults).

## Edge agent configuration

In `edge/.env`:

```bash
PAN_TILT_DRIVER=serial
PAN_TILT_SERIAL_PATH=/dev/ttyACM0
PAN_TILT_SERIAL_BAUD=115200
```

Rebuild and restart the edge service after changes.
