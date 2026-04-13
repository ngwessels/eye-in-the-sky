import test from "node:test";
import assert from "node:assert/strict";
import { countCamerasFromListOutput } from "./omni-camera-list-parse.js";

test("countCamerasFromListOutput parses libcamera-style list", () => {
  const text = `Available cameras
-----------------
0 : imx477 [4656x3496] (/base/...)
1 : imx477 [4656x3496] (/base/...)
`;
  assert.equal(countCamerasFromListOutput(text), 2);
});

test("countCamerasFromListOutput returns 0 for empty", () => {
  assert.equal(countCamerasFromListOutput(""), 0);
  assert.equal(countCamerasFromListOutput("no cameras here"), 0);
});
