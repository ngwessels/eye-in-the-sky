/** Clockwise from true north, in degrees. */
export function normalizeAzimuthDeg(deg: number): number {
  const x = deg % 360;
  return x < 0 ? x + 360 : x;
}

const CARDINAL_16 = [
  "N",
  "NNE",
  "NE",
  "ENE",
  "E",
  "ESE",
  "SE",
  "SSE",
  "S",
  "SSW",
  "SW",
  "WSW",
  "W",
  "WNW",
  "NW",
  "NNW",
] as const;

/** Standard 16-point compass abbreviation for a true-north azimuth in degrees. */
export function azimuthToCardinal16(deg: number): string {
  const a = normalizeAzimuthDeg(deg);
  const idx = Math.round(a / 22.5) % 16;
  return CARDINAL_16[idx]!;
}
