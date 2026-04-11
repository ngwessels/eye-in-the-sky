import { NextResponse } from "next/server";
import { z } from "zod";
import { getStationFromAuth } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import type { StationDoc } from "@/lib/types";

const patchBody = z.object({
  mount_tilt_offset_deg: z.number().finite().min(-60).max(60),
});

/** Read mount trim (same values embedded on GET /commands; useful for debugging). */
export async function GET(request: Request) {
  const station = await getStationFromAuth(request);
  if (!station) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const tiltOff = station.calibration?.mount_tilt_offset_deg ?? 0;
  const northOff = station.calibration?.north_offset_deg ?? 0;
  return NextResponse.json({
    mount_tilt_offset_deg: Number.isFinite(tiltOff) ? tiltOff : 0,
    north_offset_deg: Number.isFinite(northOff) ? northOff : 0,
  });
}

/** Set tilt trim in station calibration (station API key). Positive aims the mount higher. */
export async function PATCH(request: Request) {
  const station = await getStationFromAuth(request);
  if (!station) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = patchBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });
  }

  const db = await getDb();
  const nextCal: StationDoc["calibration"] = {
    ...station.calibration,
    mount_tilt_offset_deg: parsed.data.mount_tilt_offset_deg,
    updatedAt: new Date(),
  };

  await db.collection<StationDoc>("stations").updateOne(
    { stationId: station.stationId },
    { $set: { calibration: nextCal } },
  );

  return NextResponse.json({
    mount_tilt_offset_deg: parsed.data.mount_tilt_offset_deg,
  });
}
