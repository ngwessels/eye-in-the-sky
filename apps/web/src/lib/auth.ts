import { getDb } from "./mongodb";
import type { StationDoc } from "./types";
import { fingerprintApiKey } from "./api-key";

export async function getStationFromAuth(
  request: Request,
): Promise<StationDoc | null> {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  const fp = fingerprintApiKey(token);
  const db = await getDb();
  return db.collection<StationDoc>("stations").findOne({ apiKeyFingerprint: fp });
}
