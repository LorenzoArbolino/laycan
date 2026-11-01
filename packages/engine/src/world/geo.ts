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

export interface HubPair {
  nm: number;
  chokepoints: ChokepointId[];
  path: LonLat[];
}
/** Sea paths between every pair of hubs (used for diversions). Key: "FROM>TO". */
export const HUB_PAIRS = geo.pairs as unknown as Record<string, HubPair>;

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

export function pathLength(coords: LonLat[]): number {
  let s = 0;
  for (let i = 1; i < coords.length; i++) s += segLen(coords[i - 1]!, coords[i]!);
  return s;
}

/**
 * Nearest point of a polyline to P: its distance along the path and the gap to P, both in
 * the same equirectangular degree units as pathLength (1° ≈ 60 nm).
 */
export function nearestOnPath(coords: LonLat[], p: LonLat): { index: number; point: LonLat; along: number; gap: number } {
  let best = { index: 0, point: coords[0] ?? p, along: 0, gap: Infinity };
  let acc = 0;
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1]!;
    const b = coords[i]!;
    const lat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
    const k = cos(lat);
    const ax = a[0] * k,
      ay = a[1],
      bx = b[0] * k,
      by = b[1],
      px = p[0] * k,
      py = p[1];
    const dx = bx - ax,
      dy = by - ay;
    const L2 = dx * dx + dy * dy;
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2)) : 0;
    const qx = ax + t * dx,
      qy = ay + t * dy;
    const gap = sqrt((px - qx) * (px - qx) + (py - qy) * (py - qy));
    const seg = segLen(a, b);
    if (gap < best.gap) best = { index: i, point: [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])], along: acc + t * seg, gap };
    acc += seg;
  }
  return best;
}

/** Chokepoints a polyline passes close to. */
export function chokepointsOn(coords: LonLat[], tol = 1.2): ChokepointId[] {
  return (Object.keys(CHOKEPOINT_COORDS) as ChokepointId[]).filter((c) => {
    const [x, y] = CHOKEPOINT_COORDS[c];
    return coords.some((q) => Math.abs(q[0] - x) < tol && Math.abs(q[1] - y) < tol);
  });
}

/** Inside the Persian Gulf (west of the Strait of Hormuz). */
export function insideGulf(p: LonLat): boolean {
  return p[0] > 47.5 && p[0] < 56.2 && p[1] > 23.5 && p[1] < 30.5;
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
  const path = v.path ?? (v.pathKey ? (HUB_PAIRS[v.pathKey]?.path ?? []) : routeGeometry(v.routeId, v.via));
  const from = HUB_INFO[v.from].coords;
  const to = HUB_INFO[v.to].coords;
  const base = { voyageId: v.id, from: v.from, to: v.to };
  switch (v.status) {
    case "fixed":
      return { ...base, at: from, phase: v.heldDays > 0 ? "held" : "inbound to load", progress: 0 };
    case "loading":
      return { ...base, at: from, phase: "loading", progress: 0 };
    case "sailing": {
      const start = v.legStartDay ?? v.blDay ?? day;
      const f0 = v.legStartFrac ?? 0;
      const end = v.arriveDisch ?? start + v.sailDays;
      const p = Math.max(0, Math.min(1, f0 + (1 - f0) * ((day - start) / Math.max(1, end - start))));
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
