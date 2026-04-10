import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { processPendingCaptures } from "@/lib/jobs/process-captures";

export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  const secret = getEnv().CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const processed = await processPendingCaptures();
  return NextResponse.json({ processed });
}
