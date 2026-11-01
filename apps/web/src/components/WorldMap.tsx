import { useMemo, useState } from "react";
import { geoNaturalEarth1, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import land110 from "world-atlas/land-110m.json";
import {
  CHOKEPOINT_COORDS,
  CHOKEPOINT_INFO,
  HUB_INFO,
  HUBS,
  ROUTES,
  hubPrice,
  perBbl,
  routeGeometry,
  voyagePosition,
  type Game,
  type HubId,
  type ProductId,
} from "@laycan/engine";

const W = 1000;
const H = 430;

const topo = land110 as unknown as Topology<{ land: GeometryCollection }>;
const LAND = feature(topo, topo.objects.land);
const projection = geoNaturalEarth1().fitExtent(
  [
    [6, 6],
    [W - 6, H - 6],
  ],
  { type: "MultiPoint", coordinates: [[-100, 55], [118, 55], [-100, -36], [118, -36]] },
);
const path = geoPath(projection);
const pt = (c: [number, number]) => projection(c) ?? [0, 0];

const LABEL_OFFSET: Record<HubId, [number, number, "start" | "end"]> = {
  USGC: [-8, 16, "end"],
  NYH: [8, -8, "start"],
  ARA: [8, -8, "start"],
  WAF: [8, 14, "start"],
  MEG: [-8, -10, "end"],
  FUJ: [8, 16, "start"],
  SIN: [-8, 16, "end"],
};

export function WorldMap({ game, onHub, selectedHub }: { game: Game; onHub: (h: HubId | null) => void; selectedHub: HubId | null }) {
  const [product, setProduct] = useState<ProductId>("diesel");
  const m = game.market;
  const landPath = useMemo(() => path(LAND) ?? "", []);

  const routes = ROUTES.map((r) => {
    const qs = game.quotes(r.id);
    const feasible = qs.filter((q) => q.feasible).sort((a, b) => a.allInPerTonne - b.allInPerTonne);
    const best = feasible[0];
    const arb = best ? hubPrice(m, r.to, product) - hubPrice(m, r.from, product) - perBbl(best, product) : null;
    return { r, qs, best, arb };
  });

  const ships = game.openPositions().voyages.map((v) => ({ v, pos: voyagePosition(v, game.day) }));
  const tanks = new Map<HubId, number>();
  for (const c of game.book.cargoes) if (c.where === "tank") tanks.set(c.hub, (tanks.get(c.hub) ?? 0) + c.qty);
  const offersAt = new Map<HubId, number>();
  for (const o of game.state.offers) offersAt.set(o.hub, (offersAt.get(o.hub) ?? 0) + 1);
  const storms = game.state.ports;

  return (
    <section className="panel map-panel" aria-label="World map">
      <div className="panel-head">
        <h2>World</h2>
        <div className="seg" role="radiogroup" aria-label="Product">
          {(["gasoline", "diesel", "jet"] as const).map((p) => (
            <button key={p} role="radio" aria-checked={product === p} className={product === p ? "on" : ""} onClick={() => setProduct(p)}>
              {p}
            </button>
          ))}
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" className="map" role="img" aria-label="Map of hubs, routes, chokepoints and your ships">
        <rect x={0} y={0} width={W} height={H} fill="var(--sea)" rx={8} />
        <path d={landPath} fill="var(--land)" stroke="var(--land-edge)" strokeWidth={0.6} />

        {routes.map(({ r, qs, best, arb }) =>
          qs.map((q) => {
            const coords = routeGeometry(r.id, q.via);
            const d = path({ type: "LineString", coordinates: coords }) ?? "";
            const isBest = best && q.via === best.via;
            const blocked = !q.feasible;
            const color = blocked ? "var(--neg)" : arb !== null && arb > 0 ? "var(--pos)" : "var(--route)";
            return (
              <path
                key={r.id + q.via}
                d={d}
                fill="none"
                stroke={color}
                strokeWidth={isBest ? 2 : 1}
                strokeOpacity={isBest ? 0.9 : 0.35}
                strokeDasharray={blocked ? "4 4" : isBest ? undefined : "2 3"}
              >
                <title>
                  {`${r.id} ${r.from}→${r.to} via ${q.via}: ${blocked ? "BLOCKED" : `${perBbl(q, product).toFixed(2)} $/bbl ${product}, ${q.ladenDays.toFixed(0)} days`}${isBest && arb !== null ? ` · arb today ${arb >= 0 ? "+" : ""}${arb.toFixed(2)} $/bbl` : ""}`}
                </title>
              </path>
            );
          }),
        )}

        {Object.entries(CHOKEPOINT_COORDS).map(([c, coord]) => {
          const [x, y] = pt(coord);
          const st = m.choke[c as keyof typeof m.choke];
          const col = st === "open" ? "var(--pos)" : st === "restricted" ? "var(--warn)" : "var(--neg)";
          return (
            <g key={c} transform={`translate(${x},${y})`}>
              <rect x={-5} y={-5} width={10} height={10} transform="rotate(45)" fill={col} stroke="#fff" strokeWidth={1.2} />
              <title>{`${CHOKEPOINT_INFO[c as keyof typeof CHOKEPOINT_INFO].name}: ${st}`}</title>
            </g>
          );
        })}

        {storms.map((s, i) => {
          const [x, y] = pt(HUB_INFO[s.hub].coords);
          return (
            <text key={i} x={x - 22} y={y - 14} fontSize={18} aria-label="port disruption">
              🌀<title>{`Port disruption at ${s.hub}: +${s.extraDays} days`}</title>
            </text>
          );
        })}

        {HUBS.map((h) => {
          const [x, y] = pt(HUB_INFO[h].coords);
          const [dx, dy, anchor] = LABEL_OFFSET[h];
          const price = hubPrice(m, h, product);
          const diff = m.diffs[h][product];
          const t = tanks.get(h);
          const n = offersAt.get(h);
          const sel = selectedHub === h;
          return (
            <g key={h} className="hub" onClick={() => onHub(sel ? null : h)} style={{ cursor: "pointer" }} data-testid={`hub-${h}`}>
              {t && <circle cx={x} cy={y} r={11} fill="none" stroke="var(--accent)" strokeWidth={2} strokeDasharray="3 2" />}
              <circle cx={x} cy={y} r={sel ? 9 : 7} fill={sel ? "var(--accent)" : "#fff"} stroke="var(--accent)" strokeWidth={2.5} />
              <text x={x + dx} y={y + dy} textAnchor={anchor} className="hub-label">
                <tspan fontWeight={700}>{h}</tspan> <tspan className="num">{price.toFixed(1)}</tspan>
                {h !== "USGC" && <tspan className="hub-diff"> ({diff >= 0 ? "+" : ""}{diff.toFixed(1)})</tspan>}
              </text>
              {t && (
                <text x={x + dx} y={y + dy + 13} textAnchor={anchor} className="hub-sub">
                  tank {(t / 1000).toFixed(0)} kbbl
                </text>
              )}
              {n && (
                <g transform={`translate(${x + 8},${y - 12})`}>
                  <circle r={7} fill="var(--paper)" />
                  <text textAnchor="middle" y={3.5} fontSize={9} fill="#fff" fontWeight={700}>
                    {n}
                  </text>
                </g>
              )}
              <title>{`${HUB_INFO[h].name}: ${product} ${price.toFixed(2)} $/bbl. ${HUB_INFO[h].role}${n ? ` ${n} offers/bids.` : ""} Click to filter offers.`}</title>
            </g>
          );
        })}

        {ships.map(({ v, pos }, i) => {
          const [x, y] = pt(pos.at);
          const col = pos.phase === "held" ? "var(--neg)" : pos.phase === "laden" ? "var(--ship)" : "var(--ink-3)";
          const off = pos.phase === "laden" ? 0 : 10 + 6 * (i % 3);
          return (
            <g key={v.id} transform={`translate(${x + (pos.phase === "laden" ? 0 : off)},${y + (pos.phase === "laden" ? 0 : -off)})`} data-testid="ship">
              <path d="M-7,3 L7,3 L4,7 L-4,7 Z M-1,-7 L-1,3 L1,3 L1,-7 Z M1,-6 L6,1 L1,1 Z" fill={col} stroke="#fff" strokeWidth={0.6} transform="scale(1.4)" />
              <text x={11} y={-5} className="ship-label">
                {v.id}
              </text>
              <title>{`${v.id} ${v.cls} ${v.routeId} ${v.from}→${v.to} via ${v.via}: ${pos.phase}${pos.phase === "laden" ? ` (${Math.round(pos.progress * 100)}%)` : ""}${v.product ? `, ${v.product}` : ""}`}</title>
            </g>
          );
        })}
      </svg>
      <div className="legend map-legend">
        <span>
          <span className="dot" style={{ background: "var(--pos)" }} />
          arb open today (destination − origin − freight &gt; 0)
        </span>
        <span>
          <span className="dot" style={{ background: "var(--route)" }} />
          arb closed
        </span>
        <span>
          <span className="dot" style={{ background: "var(--neg)" }} />
          blocked
        </span>
        <span>◆ chokepoint state</span>
        <span>
          <span className="dot" style={{ background: "var(--ship)" }} />
          your ships
        </span>
        <span>
          <span className="dot" style={{ background: "var(--paper)", borderRadius: 9 }} />
          offers at hub
        </span>
      </div>
    </section>
  );
}
