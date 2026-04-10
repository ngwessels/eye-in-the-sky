import { createHash, randomBytes, timingSafeEqual } from "crypto";

export function generateApiKey(): string {
  return `eis_${randomBytes(32).toString("base64url")}`;
}

export function fingerprintApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey, "utf8").digest("hex");
}

export function verifyApiKeyFingerprint(apiKey: string, storedHex: string): boolean {
  const fp = fingerprintApiKey(apiKey);
  try {
    const a = Buffer.from(fp, "hex");
    const b = Buffer.from(storedHex, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
