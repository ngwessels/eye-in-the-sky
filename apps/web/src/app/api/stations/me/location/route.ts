import { NextResponse } from "next/server";
import { getStationFromAuth } from "@/lib/auth";

/** Last-known `stations.location` for edge fallback when live GNSS / Wi-Fi / IP geolocation fail. */
export async function GET(request: Request) {
  const station = await getStationFromAuth(request);
  if (!station) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const loc = station.location;
  if (
    !loc ||
    typeof loc.lat !== "number" ||
    typeof loc.lon !== "number" ||
    !Number.isFinite(loc.lat) ||
    !Number.isFinite(loc.lon)
  ) {
    return NextResponse.json({ location: null });
  }

  return NextResponse.json({
    location: {
      lat: loc.lat,
      lon: loc.lon,
      ...(loc.alt != null && Number.isFinite(loc.alt) ? { alt: loc.alt } : {}),
    },
  });
}
