import { useMemo, useState } from "react";
import { geoGraticule10, geoNaturalEarth1, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import land110 from "world-atlas/land-110m.json";
import {
  CHOKEPOINT_COORDS,
  CHOKEPOINT_INFO,
  HUB_INFO,
  HUBS,
  HUB_REGION,
  ROUTES,
  hubPrice,
  perBbl,
  routeGeometry,
  HUB_PAIRS,
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
  { type: "MultiPoint", coordinates: [[-104, 63], [150, 63], [-104, -38], [150, -38]] },
);
const path = geoPath(projection);
const graticule = path(geoGraticule10()) ?? "";
const pt = (c: [number, number]) => projection(c) ?? [0, 0];

const LABEL_OFFSET: Record<HubId, [number, number, "start" | "end"]> = {
  USGC: [10, 16, "start"],
  NYH: [8, -8, "start"],
  ARA: [8, -8, "start"],
  WAF: [8, 14, "start"],
  MEG: [-8, -10, "end"],
  FUJ: [8, 16, "start"],
  SIN: [-8, 16, "end"],
  JPN: [-10, 18, "end"],
};

/**
 * The world map. `compact` draws only the chart (no header, product switch or key): used as the
 * live picture on the start screen.
 */
export function WorldMap({ game, onHub, selectedHub = null, compact = false }: { game: Game; onHub?: (h: HubId | null) => void; selectedHub?: HubId | null; compact?: boolean }) {
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

  const chart = (
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" className="map" role="img" aria-label={compact ? "Today's market: hubs, prices and routes" : "Map of hubs, routes, chokepoints and your ships"}>
        <rect x={0} y={0} width={W} height={H} fill="var(--sea)" />
        <path d={graticule} fill="none" stroke="#d3dde3" strokeWidth={0.5} />
        <path d={landPath} fill="var(--land)" stroke="var(--coast)" strokeWidth={0.7} />

        {routes.map(({ r, qs, best, arb }) =>
          qs.map((q) => {
            const coords = routeGeometry(r.id, q.via);
            const d = path({ type: "LineString", coordinates: coords }) ?? "";
            const isBest = best && q.via === best.via;
            const blocked = !q.feasible;
            const color = blocked ? "var(--bad)" : arb !== null && arb > 0 ? "var(--ok)" : "#8f9aa3";
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

        {ships
          .filter(({ v }) => v.pathKey)
          .map(({ v }) => (
            <path key={`d-${v.id}`} d={path({ type: "LineString", coordinates: v.path ?? HUB_PAIRS[v.pathKey!]?.path ?? [] }) ?? ""} fill="none" stroke="var(--accent)" strokeWidth={2} strokeDasharray="6 3">
              <title>{`${v.id} diverted from ${v.divertedFrom} to ${v.to}`}</title>
            </path>
          ))}

        {Object.entries(CHOKEPOINT_COORDS).map(([c, coord]) => {
          const [x, y] = pt(coord);
          const st = m.choke[c as keyof typeof m.choke];
          const col = st === "open" ? "var(--ok)" : st === "restricted" ? "var(--warn)" : "var(--bad)";
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
            <g key={i} transform={`translate(${x - 20},${y - 20})`} aria-label="port disruption">
              {/* cyclone: two arcs around an eye */}
              <circle r={3} fill="var(--warn)" />
              <path d="M0,-9 A9,9 0 0 1 9,0 M0,9 A9,9 0 0 1 -9,0" fill="none" stroke="var(--warn)" strokeWidth={2.2} strokeLinecap="round" />
              <title>{`Port disruption at ${s.hub}: +${s.extraDays} days`}</title>
            </g>
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
            <g key={h} className="hub" onClick={() => onHub?.(sel ? null : h)} style={{ cursor: onHub ? "pointer" : "default" }} data-testid={compact ? undefined : `hub-${h}`}>
              {t && <circle cx={x} cy={y} r={11} fill="none" stroke="var(--accent)" strokeWidth={1.5} strokeDasharray="3 2" />}
              {!compact && Math.abs(m.stocks[HUB_REGION[h]][product]) >= 3 && (
                <circle cx={x} cy={y} r={15} fill="none" stroke={m.stocks[HUB_REGION[h]][product] < 0 ? "var(--bad)" : "var(--ok)"} strokeOpacity={0.45} strokeWidth={Math.min(6, 1 + Math.abs(m.stocks[HUB_REGION[h]][product]) / 4)}>
                  <title>{`${HUB_REGION[h]} ${product} stocks ${m.stocks[HUB_REGION[h]][product] >= 0 ? "+" : ""}${m.stocks[HUB_REGION[h]][product].toFixed(1)}% vs normal`}</title>
                </circle>
              )}
              {/* invisible hit area spanning marker and label, so the whole hub is clickable */}
              {(() => {
                const w = 8.6 * `${h} ${price.toFixed(1)}${h !== "USGC" ? ` (${diff >= 0 ? "+" : ""}${diff.toFixed(1)})` : ""}`.length;
                const lx0 = anchor === "start" ? x + dx - 2 : x + dx - w - 2;
                const lx1 = anchor === "start" ? x + dx + w + 2 : x + dx + 2;
                const x0 = Math.min(x - 16, lx0);
                const x1 = Math.max(x + 16, lx1);
                const y0 = Math.min(y - 16, y + dy - 15);
                const y1 = Math.max(y + 16, y + dy + (t ? 18 : 6));
                return <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} fill="transparent" />;
              })()}
              <circle cx={x} cy={y} r={sel ? 7 : 5} fill={sel ? "var(--accent)" : "var(--surface)"} stroke={sel ? "var(--accent)" : "var(--ink)"} strokeWidth={1.8} />
              <text x={x + dx} y={y + dy} textAnchor={anchor} className="hub-label">
                {h} <tspan className="hub-price">{price.toFixed(1)}</tspan>
                {h !== "USGC" && !compact && <tspan className="hub-diff"> {diff >= 0 ? "+" : "−"}{Math.abs(diff).toFixed(1)}</tspan>}
              </text>
              {t && (
                <text x={x + dx} y={y + dy + 13} textAnchor={anchor} className="hub-sub">
                  tank {(t / 1000).toFixed(0)} kbbl
                </text>
              )}
              {n && !compact && (
                <g transform={`translate(${anchor === "start" ? x - 11 : x + 11},${y - 11})`}>
                  <circle r={7} fill="var(--ink)" />
                  <text textAnchor="middle" y={3.5} fontSize={9} fill="#fff" fontWeight={600}>
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
          const col = pos.phase === "held" ? "var(--bad)" : pos.phase === "laden" ? "var(--accent)" : "var(--muted)";
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
  );
  if (compact) return chart;
  return (
    <section className="panel map-panel" aria-label="World map">
      <div className="panel-head" style={{ paddingBottom: 8 }}>
        <h2>World</h2>
        <div className="seg" role="radiogroup" aria-label="Product">
          {(["gasoline", "diesel", "jet"] as const).map((p) => (
            <button key={p} role="radio" aria-checked={product === p} className={product === p ? "on" : ""} onClick={() => setProduct(p)}>
              {p}
            </button>
          ))}
        </div>
      </div>
      {chart}
      <div className="map-key">
        <span className="key"><i style={{ borderColor: "var(--ok)" }} />arb open today</span>
        <span className="key"><i style={{ borderColor: "#8f9aa3" }} />arb closed</span>
        <span className="key"><i className="dash" style={{ borderColor: "var(--bad)" }} />blocked</span>
        <span className="key"><i className="dmd" style={{ background: "var(--warn)" }} />chokepoint</span>
        <span className="key"><i className="ring" style={{ borderColor: "var(--bad)" }} />region short of {product}</span>
        <span className="key"><i className="ring" style={{ borderColor: "var(--ok)" }} />long</span>
        <span className="key"><i style={{ borderColor: "var(--accent)", width: 10, borderTopWidth: 6 }} />your ships</span>
        <span className="key">numbers: offers at hub · click a hub to filter</span>
      </div>
    </section>
  );
}
