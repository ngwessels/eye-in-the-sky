import { MongoClient, type Db } from "mongodb";
import { getEnv } from "./env";

let client: MongoClient | null = null;
let clientPromise: Promise<MongoClient> | null = null;

function getClientPromise(): Promise<MongoClient> {
  if (clientPromise) return clientPromise;
  const uri = getEnv().MONGODB_URI;
  client = new MongoClient(uri);
  clientPromise = client.connect();
  return clientPromise;
}

export async function getDb(): Promise<Db> {
  const c = await getClientPromise();
  return c.db("eyeinthesky");
}

export async function createIndexes(): Promise<void> {
  const db = await getDb();
  await db.collection("stations").createIndex({ stationId: 1 }, { unique: true });
  await db.collection("stations").createIndex({ apiKeyFingerprint: 1 }, { unique: true });
  await db.collection("commands").createIndex(
    { stationId: 1, state: 1, createdAt: 1 },
    { name: "cmd_poll" },
  );
  await db.collection("captures").createIndex({ stationId: 1, capturedAt: -1 });
  await db.collection("captures").createIndex({ stationId: 1, analysis: 1 });
  await db.collection("sensor_readings").createIndex({ createdAt: 1 }, { expireAfterSeconds: 86400 * 14 });
  await db.collection("api_hits").createIndex({ at: 1 }, { expireAfterSeconds: 120 });
}
