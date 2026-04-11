/** Tilt trim from cloud (commands poll); replaces PAN_TILT_TILT_OFFSET_DEG in .env. */
let mountTiltOffsetDeg = 0;

/** True-north offset: view uses mount_pan + north_offset; aim subtracts it from geographic azimuth. */
let mountNorthOffsetDeg = 0;

export function setMountTiltOffsetFromCloud(deg: number): void {
  if (Number.isFinite(deg)) {
    mountTiltOffsetDeg = deg;
  }
}

export function getMountTiltOffsetDeg(): number {
  return mountTiltOffsetDeg;
}

export function setMountNorthOffsetFromCloud(deg: number): void {
  if (Number.isFinite(deg)) {
    mountNorthOffsetDeg = deg;
  }
}

export function getMountNorthOffsetDeg(): number {
  return mountNorthOffsetDeg;
}
