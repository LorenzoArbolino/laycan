interface Series {
  name: string;
  color: string;
  values: number[];
}

/** Minimal responsive SVG line chart (no dependencies). */
export function LineChart({ series, height = 120, labels }: { series: Series[]; height?: number; labels?: string[] }) {
  const all = series.flatMap((s) => s.values).filter((v) => Number.isFinite(v));
  if (all.length < 2) return <div className="empty">Chart fills in as the days pass.</div>;
  const w = 600;
  const h = height;
  const pad = { l: 40, r: 8, t: 8, b: 18 };
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
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" role="img" aria-label={series.map((s) => s.name).join(", ")}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} />
            <text x={pad.l - 4} y={y(t) + 4} fontSize={10} textAnchor="end" fill="var(--ink-3)">
              {t.toFixed(Math.abs(t) < 10 ? 1 : 0)}
            </text>
          </g>
        ))}
        {labels && labels.length > 1 && (
          <>
            <text x={pad.l} y={h - 4} fontSize={10} fill="var(--ink-3)">
              {labels[0]}
            </text>
            <text x={w - pad.r} y={h - 4} fontSize={10} fill="var(--ink-3)" textAnchor="end">
              {labels[labels.length - 1]}
            </text>
          </>
        )}
        {series.map((s) => (
          <polyline key={s.name} fill="none" stroke={s.color} strokeWidth={1.8} points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")} />
        ))}
      </svg>
      <div className="legend">
        {series.map((s) => (
          <span key={s.name}>
            <span className="dot" style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
      </div>
    </div>
  );
}
