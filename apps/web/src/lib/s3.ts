import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getEnv } from "./env";

let client: S3Client | null = null;

function s3(): S3Client {
  if (!client) {
    const e = getEnv();
    client = new S3Client({
      region: e.AWS_REGION,
      credentials: {
        accessKeyId: e.AWS_ACCESS_KEY_ID,
        secretAccessKey: e.AWS_SECRET_ACCESS_KEY,
      },
    });
  }
  return client;
}

export function captureKey(stationId: string, captureId: string, ext: string): string {
  return `stations/${stationId}/captures/${captureId}.${ext}`;
}

export function calibrationKey(stationId: string, part: string): string {
  return `stations/${stationId}/calibration/${part}`;
}

export function resolveCaptureObjectKey(
  stationId: string,
  captureId: string,
  ext: string,
  kind: "science" | "calibration",
): string {
  if (kind === "calibration") {
    return calibrationKey(stationId, `${captureId}.${ext}`);
  }
  return captureKey(stationId, captureId, ext);
}

export async function presignPut(
  key: string,
  contentType: string,
  expiresIn = 3600,
): Promise<string> {
  const e = getEnv();
  const cmd = new PutObjectCommand({
    Bucket: e.S3_BUCKET,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(s3(), cmd, { expiresIn });
}

export async function presignGet(key: string, expiresIn = 900): Promise<string> {
  const e = getEnv();
  const cmd = new GetObjectCommand({
    Bucket: e.S3_BUCKET,
    Key: key,
  });
  return getSignedUrl(s3(), cmd, { expiresIn });
}
