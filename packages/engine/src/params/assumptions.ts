/**
 * The assumptions sheet: every parameter the engine uses, with its value, unit, label,
 * source and method. Generated from the code and calibration file, so it cannot drift.
 */
import calibration from "../../../../params/calibration.json";
import { CHOKEPOINT_INFO, VESSELS } from "../world/world";
import { MODEL, SCENARIOS } from "./model";
import { collectParams, type Param } from "./param";

export interface AssumptionRow {
  section: string;
  path: string;
  value: string;
  unit: string;
  label: Param["label"];
  source: string;
  method: string;
  date: string;
}

function fmtValue(v: unknown): string {
  if (typeof v === "number") {
    const a = Math.abs(v);
    if (a !== 0 && (a < 1e-3 || a >= 1e7)) return v.toExponential(3);
    return String(Math.round(v * 1e4) / 1e4);
  }
  if (Array.isArray(v)) return `[${v.map((x) => (Array.isArray(x) ? `[${x.map(fmtValue).join(", ")}]` : fmtValue(x))).join(", ")}]`;
  if (typeof v === "object" && v !== null) return JSON.stringify(v, (_k, x) => (typeof x === "number" ? Math.round(x * 1e4) / 1e4 : x));
  return String(v);
}

export function assumptionRows(): AssumptionRow[] {
  const sections: [string, unknown][] = [
    ["Calibration (public data)", calibration],
    ["Model", MODEL],
    ["Vessels", VESSELS],
    ["Chokepoints", CHOKEPOINT_INFO],
    ...Object.values(SCENARIOS).map((s) => [`Scenario: ${s.name}`, s] as [string, unknown]),
  ];
  const rows: AssumptionRow[] = [];
  const seen = new Set<string>();
  for (const [section, obj] of sections) {
    for (const { path, param } of collectParams(obj)) {
      const key = `${section}|${path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ section, path, value: fmtValue(param.value), unit: param.unit, label: param.label, source: param.source, method: param.method, date: param.date });
    }
  }
  return rows;
}

export function assumptionsMarkdown(): string {
  const rows = assumptionRows();
  const counts = rows.reduce<Record<string, number>>((a, r) => ((a[r.label] = (a[r.label] ?? 0) + 1), a), {});
  const out = [
    "# Laycan assumptions sheet",
    "",
    "Generated from the engine's parameters. Labels: **data** = observed public value; **derived** = fitted from data; **estimate** = informed assumption for review.",
    "",
    `Totals: ${Object.entries(counts)
      .map(([k, v]) => `${v} ${k}`)
      .join(", ")}.`,
    "",
  ];
  let section = "";
  for (const r of rows) {
    if (r.section !== section) {
      section = r.section;
      out.push("", `## ${section}`, "", "| Parameter | Value | Unit | Label | Source | Method |", "|---|---|---|---|---|---|");
    }
    const esc = (s: string) => s.replace(/\|/g, "\\|");
    out.push(`| ${esc(r.path)} | ${esc(r.value)} | ${esc(r.unit)} | ${r.label} | ${esc(r.source)} | ${esc(r.method)} |`);
  }
  return out.join("\n") + "\n";
}
