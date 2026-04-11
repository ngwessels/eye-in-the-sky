import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { fetchWeatherSnapshot, getAppleWeatherJwt } from "@/lib/weather/apple-weather-kit";

/**
 * GET ?lat=&lon= — verify Apple WeatherKit JWT + REST call (x-admin-secret).
 * Example: curl -sS "http://localhost:3000/api/admin/weatherkit-test?lat=37.323&lon=-122.032" -H "x-admin-secret: $ADMIN_SECRET"
 */
export async function GET(request: Request) {
  const admin = request.headers.get("x-admin-secret");
  if (!admin || admin !== getEnv().ADMIN_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const lat = Number(url.searchParams.get("lat"));
  const lon = Number(url.searchParams.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json(
      { error: "missing_or_invalid_lat_lon", hint: "Add ?lat=37.323&lon=-122.032" },
      { status: 400 },
    );
  }

  const jwt = await getAppleWeatherJwt();
  if (!jwt) {
    return NextResponse.json({
      ok: false,
      error: "jwt_missing",
      hint: "Set APPLE_TEAM_ID, APPLE_SERVICE_ID, APPLE_KEY_ID, and APPLE_PRIVATE_KEY (Vercel) or APPLE_PRIVATE_KEY_PATH (local .p8).",
    });
  }

  const snapshot = await fetchWeatherSnapshot(lat, lon);
  if (!snapshot) {
    return NextResponse.json({
      ok: false,
      error: "weatherkit_request_failed",
      jwt_ok: true,
      hint: "Check server logs for WeatherKit HTTP status and response body.",
    });
  }

  return NextResponse.json({
    ok: true,
    precipProbability: snapshot.precipProbability,
    windSpeedMps: snapshot.windSpeedMps,
    windDirectionDeg: snapshot.windDirectionDeg,
    hasAlert: snapshot.hasAlert,
  });
}
