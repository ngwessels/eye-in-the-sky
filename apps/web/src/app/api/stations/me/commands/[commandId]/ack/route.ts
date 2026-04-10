import { NextResponse } from "next/server";
import { getStationFromAuth } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import type { CommandDoc } from "@/lib/types";

type Params = { params: Promise<{ commandId: string }> };

export async function POST(request: Request, { params }: Params) {
  const station = await getStationFromAuth(request);
  if (!station) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { commandId } = await params;
  let body: { ok?: boolean; error?: string; result?: Record<string, unknown> } =
    {};
  try {
    body = await request.json();
  } catch {
    /* optional body */
  }

  const db = await getDb();
  const cmd = await db.collection<CommandDoc>("commands").findOne({
    commandId,
    stationId: station.stationId,
  });

  if (!cmd) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const state = body.ok === false ? "failed" : "ack";
  await db.collection<CommandDoc>("commands").updateOne(
    { commandId },
    {
      $set: {
        state,
        ackAt: new Date(),
        ackResult: {
          ok: body.ok !== false,
          error: body.error,
          result: body.result,
        },
      },
    },
  );

  return NextResponse.json({ ok: true });
}
