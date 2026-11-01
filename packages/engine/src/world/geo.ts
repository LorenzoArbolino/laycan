/**
 * Geography for maps: sea-route polylines (searoute on the Eurostat MARNET network) and the
 * position of each voyage along its route on a given day.
 */
import geo from "../../../../params/geo.json" with { type: "json" };
import { cos, sqrt } from "../core/dmath";
import type { Voyage } from "../book/types";
import { HUB_INFO, type ChokepointId, type HubId } from "./world";

export type LonLat = [number, number];

export const ROUTE_GEOMETRY = geo.routes as unknown as Record<string, LonLat[]>;

export const CHOKEPOINT_COORDS: Record<ChokepointId, LonLat> = {
  hormuz: [56.4, 26.5],
  babelmandeb: [43.4, 12.6],
  suez: [32.35, 30.6],
};

export const CAPE_OF_GOOD_HOPE: LonLat = [18.5, -34.6];

export function routeGeometry(routeId: string, via: string): LonLat[] {
  return ROUTE_GEOMETRY[`${routeId}:${via}`] ?? ROUTE_GEOMETRY[`${routeId}:direct`] ?? [];
}

function segLen(a: LonLat, b: LonLat): number {
  const lat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  let dx = b[0] - a[0];
  if (dx > 180) dx -= 360;
  if (dx < -180) dx += 360;
  const x = dx * cos(lat);
  const y = b[1] - a[1];
  return sqrt(x * x + y * y);
}

/** Point at a fraction (0..1) of the way along a polyline, by distance. */
export function pointAlong(coords: LonLat[], frac: number): LonLat {
  if (coords.length === 0) return [0, 0];
  if (coords.length === 1 || frac <= 0) return coords[0]!;
  const lens = coords.slice(1).map((c, i) => segLen(coords[i]!, c));
  const total = lens.reduce((s, x) => s + x, 0);
  let target = Math.min(1, frac) * total;
  for (let i = 0; i < lens.length; i++) {
    const l = lens[i]!;
    if (target <= l) {
      const a = coords[i]!;
      const b = coords[i + 1]!;
      const t = l === 0 ? 0 : target / l;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    target -= l;
  }
  return coords[coords.length - 1]!;
}

export interface ShipPosition {
  voyageId: string;
  at: LonLat;
  phase: "inbound to load" | "loading" | "laden" | "held" | "discharging" | "done";
  progress: number;
  from: HubId;
  to: HubId;
}

export function voyagePosition(v: Voyage, day: number): ShipPosition {
  const path = routeGeometry(v.routeId, v.via);
  const from = HUB_INFO[v.from].coords;
  const to = HUB_INFO[v.to].coords;
  const base = { voyageId: v.id, from: v.from, to: v.to };
  switch (v.status) {
    case "fixed":
      return { ...base, at: from, phase: v.heldDays > 0 ? "held" : "inbound to load", progress: 0 };
    case "loading":
      return { ...base, at: from, phase: "loading", progress: 0 };
    case "sailing": {
      const start = v.blDay ?? day;
      const end = v.arriveDisch ?? start + v.sailDays;
      const p = Math.max(0, Math.min(1, (day - start) / Math.max(1, end - start)));
      return { ...base, at: pointAlong(path, p), phase: "laden", progress: p };
    }
    case "held":
      return { ...base, at: from, phase: "held", progress: 0 };
    case "discharging":
      return { ...base, at: to, phase: "discharging", progress: 1 };
    default:
      return { ...base, at: to, phase: "done", progress: 1 };
  }
}
