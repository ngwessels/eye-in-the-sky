import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { runGroundObservationTick } from "@/lib/ground-observation";

export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  const secret = getEnv().CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await runGroundObservationTick();
  return NextResponse.json(result);
}
