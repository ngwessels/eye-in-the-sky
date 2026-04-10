import { stationFetch } from "./http.js";
import { MOCK_JPEG } from "./camera-mock.js";

export async function uploadMockCapture(opts: {
  trace_id?: string;
  command_id?: string;
  kind?: "science" | "calibration";
  /** Mount pan/tilt in degrees at shutter time; server applies north_offset for true azimuth. */
  mount_pan_deg?: number;
  mount_tilt_deg?: number;
}): Promise<{ captureId: string; s3Key: string }> {
  const presignRes = await stationFetch("/api/stations/me/captures", {
    method: "POST",
    body: JSON.stringify({
      action: "presign",
      mediaType: "image",
      contentType: "image/jpeg",
      kind: opts.kind ?? "science",
    }),
  });
  if (!presignRes.ok) {
    throw new Error(`presign failed: ${presignRes.status} ${await presignRes.text()}`);
  }
  const presign = (await presignRes.json()) as {
    captureId: string;
    uploadUrl: string;
    s3Key: string;
    headers: { "Content-Type": string };
  };

  const put = await fetch(presign.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "image/jpeg" },
    body: MOCK_JPEG,
  });
  if (!put.ok) {
    throw new Error(`S3 PUT failed: ${put.status}`);
  }

  const fin = await stationFetch("/api/stations/me/captures", {
    method: "POST",
    body: JSON.stringify({
      action: "finalize",
      captureId: presign.captureId,
      byteSize: MOCK_JPEG.length,
      capturedAt: new Date().toISOString(),
      trace_id: opts.trace_id,
      command_id: opts.command_id,
      kind: opts.kind ?? "science",
      contentType: "image/jpeg",
      ...(opts.mount_pan_deg != null ? { mount_pan_deg: opts.mount_pan_deg } : {}),
      ...(opts.mount_tilt_deg != null ? { mount_tilt_deg: opts.mount_tilt_deg } : {}),
    }),
  });
  if (!fin.ok) {
    throw new Error(`finalize failed: ${fin.status} ${await fin.text()}`);
  }

  return { captureId: presign.captureId, s3Key: presign.s3Key };
}
