import { readFile } from "fs/promises";
import { SignJWT, importPKCS8 } from "jose";
import { getEnv } from "../env";

export interface WeatherSnapshot {
  precipProbability: number;
  windSpeedMps?: number;
  windDirectionDeg?: number;
  hasAlert: boolean;
  raw?: unknown;
}

let cachedKey: Awaited<ReturnType<typeof importPKCS8>> | null = null;

async function getPrivateKey(): Promise<Awaited<ReturnType<typeof importPKCS8>> | null> {
  if (cachedKey) return cachedKey;
  const env = getEnv();
  if (!env.APPLE_TEAM_ID || !env.APPLE_SERVICE_ID || !env.APPLE_KEY_ID || !env.APPLE_PRIVATE_KEY_PATH) {
    return null;
  }
  const pem = await readFile(env.APPLE_PRIVATE_KEY_PATH, "utf8");
  cachedKey = await importPKCS8(pem, "ES256");
  return cachedKey;
}

export async function getAppleWeatherJwt(): Promise<string | null> {
  const env = getEnv();
  const key = await getPrivateKey();
  if (!key || !env.APPLE_TEAM_ID || !env.APPLE_SERVICE_ID || !env.APPLE_KEY_ID) {
    return null;
  }
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: env.APPLE_KEY_ID, typ: "JWT" })
    .setIssuer(env.APPLE_TEAM_ID)
    .setSubject(env.APPLE_SERVICE_ID)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);
}

export async function fetchWeatherSnapshot(
  lat: number,
  lon: number,
): Promise<WeatherSnapshot | null> {
  const token = await getAppleWeatherJwt();
  if (!token) return null;

  const url = new URL(
    `https://weatherkit.apple.com/api/v1/weather/en/${lat}/${lon}`,
  );
  url.searchParams.set(
    "dataSets",
    "currentWeather,forecastHourly,weatherAlerts",
  );

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    next: { revalidate: 300 },
  });

  if (!res.ok) {
    console.error("WeatherKit error", res.status, await res.text());
    return null;
  }

  const data = (await res.json()) as Record<string, unknown>;
  const current = data.currentWeather as Record<string, unknown> | undefined;
  const hourly = data.forecastHourly as
    | { hours?: Record<string, unknown>[] }
    | undefined;
  const alerts = data.weatherAlerts as unknown[] | undefined;

  const h0 = hourly?.hours?.[0] as Record<string, unknown> | undefined;

  const precipProbability = Number(
    h0?.precipitationChance ?? current?.precipitationIntensity ?? 0,
  );

  return {
    precipProbability: Math.min(1, Math.max(0, precipProbability)),
    windSpeedMps: Number(current?.windSpeed ?? 0) || undefined,
    windDirectionDeg: Number(current?.windDirection ?? NaN) || undefined,
    hasAlert: Array.isArray(alerts) && alerts.length > 0,
    raw: data,
  };
}
