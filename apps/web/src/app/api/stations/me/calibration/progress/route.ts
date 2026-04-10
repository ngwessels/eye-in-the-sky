import { NextResponse } from "next/server";
import { z } from "zod";
import { getStationFromAuth } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";

const bodySchema = z.object({
  phase: z.string().optional(),
  percent: z.number().min(0).max(100).optional(),
  message: z.string().optional(),
});

export async function POST(request: Request) {
  const station = await getStationFromAuth(request);
  if (!station) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const json = await request.json();
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const db = await getDb();
  await db.collection("stations").updateOne(
    { stationId: station.stationId },
    {
      $set: {
        calibration_progress: {
          ...parsed.data,
          updatedAt: new Date(),
        },
        lastSeenAt: new Date(),
      },
    },
  );

  return NextResponse.json({ ok: true });
}
