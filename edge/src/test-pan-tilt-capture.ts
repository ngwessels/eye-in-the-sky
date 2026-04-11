import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { getJpegForUpload } from "./capture-jpeg.js";
import * as panTilt from "./pan-tilt/index.js";
import {
  runPanTiltEnvelopeTest,
  type PanTiltPoseContext,
} from "./pan-tilt-test-sequence.js";
import { uploadStationCapture } from "./upload-capture.js";

function shouldUploadCapture(ctx: PanTiltPoseContext): boolean {
  if (config.panTiltCaptureMode === "all") return true;

  const sweepPhases = new Set([
    "pan_sweep_fwd",
    "pan_sweep_back",
    "tilt_sweep_fwd",
    "tilt_sweep_back",
  ]);
  if (!sweepPhases.has(ctx.phase)) return true;

  const i = ctx.sweepIndex;
  if (i === undefined) return true;
  const last = ctx.sweepSegmentCount;
  const stride = config.panTiltCaptureSweepStride;
  return i % stride === 0 || i === last;
}

async function main() {
  const traceId = randomUUID();
  let uploadN = 0;

  console.log("Pan/tilt + capture upload test (presign → S3 PUT → finalize)");
  console.log("  PAN_TILT_DRIVER=", config.panTiltDriver);
  console.log("  Capture mode:", config.panTiltCaptureMode);
  if (config.panTiltCaptureMode === "sparse") {
    console.log(
      "    Sweep sampling: every",
      config.panTiltCaptureSweepStride,
      "stops + last (avoid RATE_PRESIGN_PER_MIN on the web app)",
    );
  } else {
    console.warn("    Mode=all can exceed default presign rate limits; raise RATE_PRESIGN_PER_MIN or use sparse.");
  }
  console.log(
    "  Image source:",
    process.env.CAPTURE_STILL_CMD?.trim()
      ? "CAPTURE_STILL_CMD (stdout JPEG)"
      : "built-in mock JPEG (set CAPTURE_STILL_CMD for real stills)",
  );
  console.log("  trace_id (all uploads this run):", traceId);

  await runPanTiltEnvelopeTest({
    onAfterPose: async (ctx: PanTiltPoseContext) => {
      if (!shouldUploadCapture(ctx)) return;

      const jpeg = await getJpegForUpload();
      const pose = panTilt.getPose();
      const { captureId, s3Key } = await uploadStationCapture(jpeg, {
        trace_id: traceId,
        kind: "science",
        mount_pan_deg: pose.pan,
        mount_tilt_deg: pose.tilt,
      });
      uploadN += 1;
      console.log(
        `  ↑ upload #${uploadN} captureId=${captureId} key=${s3Key} mount=(${pose.pan.toFixed(2)}°, ${pose.tilt.toFixed(2)}°)`,
      );
    },
  });

  console.log("\nTotal uploads this run:", uploadN);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
