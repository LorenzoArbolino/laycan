/**
 * Every number the engine uses carries provenance. The assumptions sheet and the UI read
 * the label, so an estimate is never presented as market data.
 *
 *  - data:     an observed value from a public source
 *  - derived:  fitted or computed from public data (or, for private calibration, from
 *              exchange data that is not redistributed; the method says so)
 *  - estimate: an informed assumption, to be reviewed
 */
export type ParamLabel = "data" | "derived" | "estimate";

export interface Param<T = number> {
  value: T;
  unit: string;
  label: ParamLabel;
  source: string;
  method: string;
  date: string;
}

export function est<T>(value: T, unit: string, source: string, method = "informed assumption"): Param<T> {
  return { value, unit, label: "estimate", source, method, date: "2026-11-01" };
}

export function derived<T>(value: T, unit: string, source: string, method: string): Param<T> {
  return { value, unit, label: "derived", source, method, date: "2026-11-01" };
}

export function isParam(x: unknown): x is Param<unknown> {
  if (typeof x !== "object" || x === null) return false;
  const o = x as Record<string, unknown>;
  return (
    "value" in o &&
    typeof o.unit === "string" &&
    (o.label === "data" || o.label === "derived" || o.label === "estimate") &&
    typeof o.source === "string" &&
    o.source.length > 0 &&
    typeof o.method === "string" &&
    typeof o.date === "string"
  );
}

/** Walk a nested params object and return every leaf param with its path. */
export function collectParams(obj: unknown, path: string[] = []): { path: string; param: Param<unknown> }[] {
  if (isParam(obj)) return [{ path: path.join("."), param: obj }];
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return [];
  const out: { path: string; param: Param<unknown> }[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) out.push(...collectParams(v, [...path, k]));
  return out;
}

/** Validate that a params tree has provenance on every numeric leaf. Returns offending paths. */
export function findUnlabelled(obj: unknown, path: string[] = [], skip: (p: string[]) => boolean = () => false): string[] {
  if (skip(path)) return [];
  if (isParam(obj)) return [];
  if (typeof obj === "number") return [path.join(".")];
  if (typeof obj !== "object" || obj === null) return [];
  if (Array.isArray(obj)) return obj.flatMap((v, i) => findUnlabelled(v, [...path, String(i)], skip));
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) => findUnlabelled(v, [...path, k], skip));
}
