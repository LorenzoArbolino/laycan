import { useEffect, useRef, useState } from "react";

interface Series {
  name: string;
  values: number[];
  /** the series that matters is drawn in the accent; the rest are grey context */
  emphasis?: boolean;
  color?: string;
}

const CONTEXT = ["#8a8d90", "#b4b6b8", "#cfd0d1"];

/** Minimal responsive SVG line chart: faint grid, direct labels at the line ends, no legend box. */
export function LineChart({ series, height = 120, labels, digits }: { series: Series[]; height?: number; labels?: string[]; digits?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(480);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => e && e.contentRect.width > 0 && setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const all = series.flatMap((s) => s.values).filter((v) => Number.isFinite(v));
  if (all.length < 2)
    return (
      <div ref={ref}>
        <div className="empty">The chart fills in as the days pass.</div>
      </div>
    );
  const h = height;
  const longest = Math.max(...series.map((s) => s.name.length + 5));
  const pad = { l: 34, r: Math.min(130, 10 + longest * 7), t: 6, b: 16 };
  let min = Math.min(...all);
  let max = Math.max(...all);
  if (max - min < 1e-6) {
    max += 1;
    min -= 1;
  }
  const n = Math.max(...series.map((s) => s.values.length));
  const x = (i: number) => pad.l + (i / Math.max(n - 1, 1)) * (w - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - min) / (max - min)) * (h - pad.t - pad.b);
  const ticks = [min, (min + max) / 2, max];
  const dg = digits ?? (max - min < 10 ? 1 : 0);
  let ci = 0;
  const styled = series.map((s) => ({ ...s, stroke: s.color ?? (s.emphasis ? "var(--accent)" : CONTEXT[ci++ % CONTEXT.length]!) }));
  // direct labels at the right end, nudged apart so they never overlap
  const ends = styled
    .map((s) => ({ s, yy: y(s.values[s.values.length - 1] ?? 0), v: s.values[s.values.length - 1] ?? 0 }))
    .sort((a, b) => a.yy - b.yy);
  for (let i = 1; i < ends.length; i++) if (ends[i]!.yy - ends[i - 1]!.yy < 12) ends[i]!.yy = ends[i - 1]!.yy + 12;
  return (
    <div ref={ref}>
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label={series.map((s) => s.name).join(", ")} style={{ display: "block", overflow: "visible" }}>
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} stroke="var(--line-2)" strokeWidth={1} />
          <text x={pad.l - 6} y={y(t) + 4} fontSize={11} textAnchor="end" fill="var(--muted)">
            {t.toFixed(dg)}
          </text>
        </g>
      ))}
      {labels && labels.length > 1 && (
        <>
          <text x={pad.l} y={h - 2} fontSize={11} fill="var(--muted)">
            {labels[0]}
          </text>
          <text x={w - pad.r} y={h - 2} fontSize={11} fill="var(--muted)" textAnchor="end">
            {labels[labels.length - 1]}
          </text>
        </>
      )}
      {[...styled].sort((a, b) => Number(!!a.emphasis) - Number(!!b.emphasis)).map((s) => (
        <polyline key={s.name} fill="none" stroke={s.stroke} strokeWidth={s.emphasis ? 2 : 1.4} strokeLinejoin="round" points={s.values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")} />
      ))}
      {ends.map(({ s, yy, v }) => (
        <text key={s.name} x={w - pad.r + 6} y={yy + 4} fontSize={12} fill={s.emphasis ? "var(--ink)" : "var(--muted)"} fontWeight={s.emphasis ? 600 : 400}>
          {s.name} {v.toFixed(dg)}
        </text>
      ))}
    </svg>
    </div>
  );
}
