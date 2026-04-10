import { getDb } from "./mongodb";

export class RateLimitError extends Error {
  constructor() {
    super("rate_limited");
    this.name = "RateLimitError";
  }
}

export async function assertRateLimit(
  stationId: string,
  path: string,
  maxPerMinute: number,
): Promise<void> {
  if (maxPerMinute <= 0) return;
  const db = await getDb();
  const since = new Date(Date.now() - 60_000);
  const n = await db.collection("api_hits").countDocuments({
    stationId,
    path,
    at: { $gte: since },
  });
  if (n >= maxPerMinute) {
    throw new RateLimitError();
  }
  await db.collection("api_hits").insertOne({
    stationId,
    path,
    at: new Date(),
  });
}
