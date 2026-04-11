/*
 * Eye in the Sky — PCA9685 pan/tilt serial bridge for Arduino-class boards.
 *
 * PWM math matches ArduCAM's Raspberry Pi reference (PCA9685.c) from:
 * https://github.com/ArduCAM/PCA9685
 *
 * Protocol (115200 8N1, newline-terminated lines):
 *   HOME          — go to neutral for pan=0, tilt=0 (same mapping as SET)
 *   SET <pan> <tilt> — pan/tilt in degrees (same ranges the edge agent clamps to)
 *
 * Default channel map (ArduCAM kit): tilt = PCA9685 channel 0, pan = channel 1.
 */

#include <Wire.h>

static const uint8_t kPcaAddr = 0x40;

static const uint8_t kRegMode1 = 0x00;
static const uint8_t kRegPrescale = 0xFE;
static const uint8_t kRegLed0OnL = 0x06;

// Match edge agent defaults in config (PAN_MIN/MAX, TILT_MIN/MAX).
static const float kInPanMin = -180.0f;
static const float kInPanMax = 180.0f;
static const float kInTiltMin = -10.0f;
static const float kInTiltMax = 90.0f;

// Mechanical limits from ArduCAM PCA9685.h (keyboard demo); tune if your servos differ.
static const uint8_t kServoTiltCh = 0;
static const uint8_t kServoPanCh = 1;
static const uint8_t kOutTiltMin = 15;
static const uint8_t kOutTiltMax = 145;
static const uint8_t kOutPanMin = 0;
static const uint8_t kOutPanMax = 180;

static bool writeReg(uint8_t reg, uint8_t val) {
  Wire.beginTransmission(kPcaAddr);
  Wire.write(reg);
  Wire.write(val);
  return Wire.endTransmission() == 0;
}

static bool readReg(uint8_t reg, uint8_t *out) {
  Wire.beginTransmission(kPcaAddr);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(static_cast<int>(kPcaAddr), 1) != 1) return false;
  *out = static_cast<uint8_t>(Wire.read());
  return true;
}

static void pca9685Reset() {
  writeReg(kRegMode1, static_cast<uint8_t>(0x80));
  delay(10);
}

// Ported from ArduCAM example/rpi/PCA9685.c
static void pca9685SetPWMFreq(float freq) {
  freq *= 0.8449f;
  float prescaleval = 25000000.0f;
  prescaleval /= 4096.0f;
  prescaleval /= freq;
  prescaleval -= 1.0f;
  auto prescale = static_cast<uint8_t>(static_cast<int>(prescaleval + 0.5f));

  uint8_t oldmode = 0;
  readReg(kRegMode1, &oldmode);
  uint8_t newmode = static_cast<uint8_t>((oldmode & 0x7F) | 0x10);
  writeReg(kRegMode1, newmode);
  writeReg(kRegPrescale, prescale);
  writeReg(kRegMode1, oldmode);
  delayMicroseconds(5000);
  writeReg(kRegMode1, static_cast<uint8_t>(oldmode | 0xA0));
}

static void pca9685SetPWM(uint8_t num, uint16_t on, uint16_t off) {
  const uint8_t base = static_cast<uint8_t>(kRegLed0OnL + 4U * num);
  writeReg(base, static_cast<uint8_t>(on & 0xFF));
  writeReg(static_cast<uint8_t>(base + 1), static_cast<uint8_t>(on >> 8));
  writeReg(static_cast<uint8_t>(base + 2), static_cast<uint8_t>(off & 0xFF));
  writeReg(static_cast<uint8_t>(base + 3), static_cast<uint8_t>(off >> 8));
}

static void setServoPulse(uint8_t n, double pulse) {
  double pulselength = 1000.0;
  pulselength /= 60.0;
  pulselength /= 4096.0;
  pulse *= 1000.0;
  pulse /= pulselength;
  pca9685SetPWM(n, 0, static_cast<uint16_t>(pulse));
}

static void setServoDegree(uint8_t n, uint8_t degree) {
  if (degree >= 180) {
    degree = 180;
  } else if (degree <= 0) {
    degree = 0;
  }
  double pulse = (static_cast<double>(degree) + 45.0) / (90.0 * 1000.0);
  setServoPulse(n, pulse);
}

static float clampf(float v, float lo, float hi) {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

static uint8_t mapPanToServo(float panDeg) {
  float p = clampf(panDeg, kInPanMin, kInPanMax);
  float t = (p - kInPanMin) / (kInPanMax - kInPanMin);
  auto out = static_cast<int>(lroundf(t * (kOutPanMax - kOutPanMin) + kOutPanMin));
  if (out < kOutPanMin) out = kOutPanMin;
  if (out > kOutPanMax) out = kOutPanMax;
  return static_cast<uint8_t>(out);
}

static uint8_t mapTiltToServo(float tiltDeg) {
  float tIn = clampf(tiltDeg, kInTiltMin, kInTiltMax);
  float u = (tIn - kInTiltMin) / (kInTiltMax - kInTiltMin);
  auto out = static_cast<int>(lroundf(u * (kOutTiltMax - kOutTiltMin) + kOutTiltMin));
  if (out < kOutTiltMin) out = kOutTiltMin;
  if (out > kOutTiltMax) out = kOutTiltMax;
  return static_cast<uint8_t>(out);
}

static void drivePose(float panDeg, float tiltDeg) {
  setServoDegree(kServoTiltCh, mapTiltToServo(tiltDeg));
  setServoDegree(kServoPanCh, mapPanToServo(panDeg));
}

static void applyHome() { drivePose(0.0f, 0.0f); }

void setup() {
  Serial.begin(115200);
  Wire.begin();
  delay(50);
  pca9685Reset();
  pca9685SetPWMFreq(60);
  applyHome();
}

void loop() {
  if (!Serial.available()) return;

  String line = Serial.readStringUntil('\n');
  line.trim();
  if (line.length() == 0) return;

  if (line == "HOME") {
    applyHome();
    return;
  }

  if (line.startsWith("SET ")) {
    const String rest = line.substring(4);
    const int sp = rest.indexOf(' ');
    if (sp > 0) {
      const float panDeg = rest.substring(0, sp).toFloat();
      const float tiltDeg = rest.substring(sp + 1).toFloat();
      drivePose(panDeg, tiltDeg);
    }
  }
}
