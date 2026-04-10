import { NextResponse } from "next/server";
import { getStationFromAuth } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import { assertRateLimit, RateLimitError } from "@/lib/rate-limit";
import { getEnv } from "@/lib/env";
import type { CommandDoc } from "@/lib/types";

export async function GET(request: Request) {
  const station = await getStationFromAuth(request);
  if (!station) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const env = getEnv();
  try {
    await assertRateLimit(
      station.stationId,
      "/commands",
      env.RATE_POLL_PER_MIN,
    );
  } catch (e) {
    if (e instanceof RateLimitError) {
      return NextResponse.json({ error: "rate_limited" }, { status: 429 });
    }
    throw e;
  }

  const db = await getDb();
  const now = new Date();
  await db.collection("stations").updateOne(
    { stationId: station.stationId },
    { $set: { lastSeenAt: now } },
  );

  const cmds = await db
    .collection<CommandDoc>("commands")
    .find({
      stationId: station.stationId,
      state: "pending",
      expiresAt: { $gt: now },
    })
    .sort({ createdAt: 1 })
    .limit(20)
    .toArray();

  return NextResponse.json({
    commands: cmds.map((c) => ({
      commandId: c.commandId,
      type: c.type,
      payload: c.payload,
      createdAt: c.createdAt.toISOString(),
      expiresAt: c.expiresAt.toISOString(),
      trace_id: c.trace_id,
    })),
  });
}
