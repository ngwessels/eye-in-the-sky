import { v4 as uuidv4 } from "uuid";
import { getDb } from "./mongodb";
import type { StationDoc } from "./types";
import { fetchWeatherSnapshot } from "./weather/apple-weather-kit";
import { stationEligibleForGeometry } from "./gps-policy";
import {
  destinationFromBearingKm,
  elevationFromObserverDeg,
  greatCircleDistanceKm,
  initialBearingDeg,
} from "./geometry";
import { enqueueCommand } from "./commands";

const MAX_RANGE_KM = 220;
const ANCHOR_DISTANCE_KM = 45;
const TARGET_ALT_M = 8000;

function scoreStation(
  station: StationDoc,
  anchorLat: number,
  anchorLon: number,
): { score: number; bearing: number; elevation: number; distance: number } | null {
  if (!station.location) return null;
  const { lat, lon, alt } = station.location;
  const dist = greatCircleDistanceKm(lat, lon, anchorLat, anchorLon);
  if (dist > MAX_RANGE_KM) return null;
  const bearing = initialBearingDeg(lat, lon, anchorLat, anchorLon);
  const observerAltM = alt ?? 0;
  const elev = elevationFromObserverDeg(dist, TARGET_ALT_M - observerAltM);
  const horizon = (station.calibration?.horizon_deg ?? 0) + 2;
  if (elev < horizon) return null;

  const tierW =
    station.quality_tier === "gold" ? 1.4 : station.quality_tier === "silver" ? 1.15 : 1;
  const calW = 0.5 + (station.calibration?.confidence ?? 0);
  const healthW = 0.5 + (station.health?.uploadSuccessEma ?? 1);
  const distW = 1 / (1 + dist / 80);
  const sensorW =
    (station.capabilities?.sensors?.length ?? 0) >= 1 ? 1 : 0.84;
  const clockW = station.clock_untrusted ? 0.72 : 1;
  const score = tierW * calW * healthW * distW * sensorW * clockW;
  return { score, bearing, elevation: elev, distance: dist };
}

export async function runOrchestratorTick(): Promise<{ enqueued: number }> {
  const db = await getDb();
  const stations = await db
    .collection<StationDoc>("stations")
    .find({})
    .toArray();

  let enqueued = 0;

  for (const seed of stations) {
    if (!seed.location) continue;
    const wx = await fetchWeatherSnapshot(seed.location.lat, seed.location.lon);
    if (!wx) continue;

    const precip = wx.precipProbability > 1 ? wx.precipProbability / 100 : wx.precipProbability;
    const trigger = wx.hasAlert || precip > 0.55;
    if (!trigger) continue;

    const windBearing = wx.windDirectionDeg ?? 270;
    const anchor = destinationFromBearingKm(
      seed.location.lat,
      seed.location.lon,
      windBearing,
      ANCHOR_DISTANCE_KM,
    );

    const trace_id = uuidv4();
    const watch_target = {
      anchorLat: anchor.lat,
      anchorLon: anchor.lon,
      bearingDeg: windBearing,
      rangeKm: ANCHOR_DISTANCE_KM,
      validUntil: new Date(Date.now() + 2 * 3600 * 1000).toISOString(),
      source: "weatherkit_orchestrator",
    };

    const ranked: { station: StationDoc; meta: NonNullable<ReturnType<typeof scoreStation>> }[] =
      [];
    for (const s of stations) {
      if (!stationEligibleForGeometry(s)) continue;
      const meta = scoreStation(s, anchor.lat, anchor.lon);
      if (meta) ranked.push({ station: s, meta });
    }
    ranked.sort((a, b) => b.meta.score - a.meta.score);
    const top = ranked.slice(0, 5);

    for (const { station, meta } of top) {
      const throttle = await db.collection("commands").findOne({
        stationId: station.stationId,
        selection_reason: { $regex: "weatherkit" },
        createdAt: { $gt: new Date(Date.now() - 45 * 60 * 1000) },
      });
      if (throttle) continue;

      await enqueueCommand({
        stationId: station.stationId,
        type: "aim_absolute",
        payload: {
          azimuthDeg: meta.bearing,
          elevationDeg: Math.min(55, Math.max(8, meta.elevation)),
        },
        trace_id,
        watch_target,
        selection_reason: `score=${meta.score.toFixed(3)} dist_km=${meta.distance.toFixed(1)} precip=${precip.toFixed(2)}`,
      });
      enqueued += 1;
    }
  }

  return { enqueued };
}
