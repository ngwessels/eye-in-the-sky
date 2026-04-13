/** Count `0 :`, `1 :`, … lines from `rpicam-still --list-cameras` (or similar) output. */
export function countCamerasFromListOutput(text: string): number {
  let n = 0;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*\d+\s*:/.test(line)) n += 1;
  }
  return n;
}
