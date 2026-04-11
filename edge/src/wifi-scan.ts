import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "./config.js";

const execFileAsync = promisify(execFile);

export type WifiAccessPoint = { macAddress: string; signalStrength: number };

/** Normalize BSSID to lowercase colon-separated hex (Mozilla MLS shape). */
export function normalizeBssid(raw: string): string | null {
  const t = raw.trim().toLowerCase().replace(/0x/g, "");
  const hexOnly = t.replace(/[^0-9a-f]/g, "");
  if (hexOnly.length !== 12) return null;
  const parts = hexOnly.match(/.{2}/g);
  if (!parts) return null;
  return parts.join(":");
}

/** Parse `iw dev … scan` / `iw … scan` style output. */
export function parseIwScanOutput(text: string): WifiAccessPoint[] {
  const out: WifiAccessPoint[] = [];
  const lines = text.split("\n");
  let pendingMac: string | null = null;
  for (const line of lines) {
    const bss = line.match(/^\s*BSS ([0-9a-f]{2}(:[0-9a-f]{2}){5})/i);
    if (bss) {
      const norm = normalizeBssid(bss[1]);
      pendingMac = norm;
      continue;
    }
    const sig = line.match(/^\s*signal:\s*(-?[0-9.]+)\s*dBm/i);
    if (sig && pendingMac) {
      const signalStrength = Math.round(Number.parseFloat(sig[1]));
      out.push({ macAddress: pendingMac, signalStrength });
      pendingMac = null;
    }
  }
  return out;
}

/** One line per AP: `aa:bb:cc:dd:ee:ff -72` */
export function parseSimpleScanLines(text: string): WifiAccessPoint[] {
  const out: WifiAccessPoint[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(
      /^([0-9a-f]{2}(:[0-9a-f]{2}){5})\s+(-?\d+)\s*$/i,
    );
    if (!m) continue;
    const mac = normalizeBssid(m[1]);
    if (!mac) continue;
    out.push({ macAddress: mac, signalStrength: Number.parseInt(m[3], 10) });
  }
  return out;
}

async function runIwScan(iface: string, useSudo: boolean): Promise<string> {
  const args = useSudo
    ? (["-n", "iw", "dev", iface, "scan"] as string[])
    : (["dev", iface, "scan"] as string[]);
  const bin = useSudo ? "sudo" : "iw";
  const { stdout } = await execFileAsync(bin, args, {
    maxBuffer: 8 * 1024 * 1024,
    timeout: 45_000,
  });
  return stdout;
}

/** Try `nmcli -t` rows; BSSID colons are escaped as `\:` — signal is after the last `:`. */
export function parseNmcliTerseWifi(text: string): WifiAccessPoint[] {
  const out: WifiAccessPoint[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const lastColon = line.lastIndexOf(":");
    if (lastColon <= 0) continue;
    const signalStrength = Number.parseInt(line.slice(lastColon + 1), 10);
    if (!Number.isFinite(signalStrength)) continue;
    const bssidRaw = line.slice(0, lastColon).replace(/\\:/g, ":");
    const mac = normalizeBssid(bssidRaw);
    if (!mac) continue;
    out.push({ macAddress: mac, signalStrength });
  }
  return out;
}

async function tryNmcliScan(): Promise<WifiAccessPoint[] | null> {
  try {
    const { stdout } = await execFileAsync(
      "nmcli",
      ["-t", "-f", "BSSID,SIGNAL", "dev", "wifi", "list"],
      { maxBuffer: 2 * 1024 * 1024, timeout: 30_000 },
    );
    const aps = parseNmcliTerseWifi(stdout);
    return aps.length > 0 ? aps : null;
  } catch {
    return null;
  }
}

async function runShellScan(cmd: string): Promise<string> {
  const { stdout } = await execFileAsync("sh", ["-c", cmd], {
    maxBuffer: 8 * 1024 * 1024,
    timeout: 45_000,
  });
  return stdout;
}

/** Mozilla MLS (and similar) rarely resolve a fix from a single BSSID — merge in `nmcli` rows when `iw` is sparse. */
const SPARSE_SCAN_MERGE_THRESHOLD = 2;

function mergeApsByBestSignal(a: WifiAccessPoint[], b: WifiAccessPoint[]): WifiAccessPoint[] {
  const map = new Map<string, WifiAccessPoint>();
  for (const ap of a) {
    map.set(ap.macAddress, ap);
  }
  for (const ap of b) {
    const cur = map.get(ap.macAddress);
    if (!cur || ap.signalStrength > cur.signalStrength) {
      map.set(ap.macAddress, ap);
    }
  }
  return [...map.values()];
}

async function maybeMergeNmcliIfSparse(aps: WifiAccessPoint[]): Promise<WifiAccessPoint[]> {
  if (aps.length >= SPARSE_SCAN_MERGE_THRESHOLD) return aps;
  const nmcli = await tryNmcliScan();
  if (nmcli && nmcli.length > 0) {
    return mergeApsByBestSignal(aps, nmcli);
  }
  return aps;
}

/**
 * Collect visible BSSIDs + RSSI for geolocation. Requires `iw` (and often root or `sudo -n`) on Pi.
 */
export async function scanWifiAccessPoints(): Promise<WifiAccessPoint[]> {
  const iface = config.wifiScanIface;

  if (config.wifiScanShellCmd) {
    try {
      const stdout = await runShellScan(config.wifiScanShellCmd);
      const simple = parseSimpleScanLines(stdout);
      const parsed = simple.length > 0 ? simple : parseIwScanOutput(stdout);
      return await maybeMergeNmcliIfSparse(parsed);
    } catch {
      return [];
    }
  }

  let aps: WifiAccessPoint[] = [];

  try {
    const stdout = await runIwScan(iface, false);
    aps = parseIwScanOutput(stdout);
  } catch {
    if (config.wifiIwUseSudo) {
      try {
        const stdout = await runIwScan(iface, true);
        aps = parseIwScanOutput(stdout);
      } catch {
        aps = [];
      }
    }
  }

  if (aps.length === 0) {
    try {
      const { stdout } = await execFileAsync("iw", [iface, "scan"], {
        maxBuffer: 8 * 1024 * 1024,
        timeout: 45_000,
      });
      aps = parseIwScanOutput(stdout);
    } catch {
      /* fall through */
    }
  }

  if (aps.length === 0) {
    const nmcli = await tryNmcliScan();
    if (nmcli && nmcli.length > 0) return nmcli;
    return [];
  }

  return await maybeMergeNmcliIfSparse(aps);
}
