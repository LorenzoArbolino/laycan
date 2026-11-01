import { useState } from "react";
import { FUTURES, FUTURES_IDS, ROUTES, contractPrice, isoDate, listedMonths, type Action, type FuturesId, type Game } from "@laycan/engine";
import { kbbl, money, shortDate } from "../format";

const STAGES = ["fixed", "loading", "sailing", "discharging", "done"] as const;

export function BookPanel({ game, act }: { game: Game; act: (a: Action) => void }) {
  const pos = game.openPositions();
  const m = game.market;
  const [fut, setFut] = useState<{ id: FuturesId; month: number; lots: number }>({ id: "GO", month: 1, lots: -100 });
  const months = listedMonths(fut.id, game.day);
  const lm = months[Math.min(fut.month, months.length - 1)]!;
  const spec = FUTURES[fut.id];
  const fq = game.futuresQuote(fut.id, lm.y, lm.m);
  const tanks = game.book.cargoes.filter((c) => c.where === "tank");
  const exps = game.exposures();
  return (
    <div>
      <h2>Physical deals</h2>
      {pos.deals.length === 0 && <div className="empty">No open deals.</div>}
      {pos.deals.map((d) => {
        const n = d.window?.length ?? (d.pricing.kind === "fixed" ? 1 : 5);
        const k = d.pricing.kind === "fixed" ? 1 : d.fixings.length;
        return (
          <div className="item" key={d.id} data-testid="deal">
            <b>{d.id}</b> {d.side === "buy" ? "Bought" : "Sold"} {kbbl(d.qty)} {d.product} {d.incoterm} {d.hub}{" "}
            <span className="badge derived">{d.status}</span>
            <div className="sub">
              laycan {shortDate(isoDate(d.laycan[0]))}–{shortDate(isoDate(d.laycan[1]))} · priced {k}/{n} quotes · invoice price now {contractPrice(d, m).toFixed(2)} $/bbl
              {d.voyageId ? ` · ${d.voyageId}` : d.side === "sell" && d.incoterm !== "FOB" && d.status === "open" ? " · needs a cargo shipped here" : ""}
            </div>
          </div>
        );
      })}
      <h2 style={{ marginTop: 12 }}>Voyages</h2>
      {pos.voyages.length === 0 && <div className="empty">No ships at sea.</div>}
      {pos.voyages.map((v) => (
        <div className="item" key={v.id} data-testid="voyage">
          <b>{v.id}</b> {v.cls} {v.routeId} {v.from}→{v.to} via {v.via} <span className="badge derived">{v.status}</span>
          <div className="timeline">
            {STAGES.map((s, i) => (
              <span key={s} className={STAGES.indexOf(v.status as (typeof STAGES)[number]) >= i ? "done" : ""} />
            ))}
          </div>
          <div className="sub">
            load {shortDate(isoDate(v.arriveLoad))}
            {v.arriveDisch ? ` · discharge ${shortDate(isoDate(v.arriveDisch))}` : ` · ~${v.sailDays}d at sea`} · port hours {v.portHours.toFixed(0)}/{v.laytimeHours} laytime · demurrage ${(v.demurrageRate / 1e3).toFixed(0)}k/day
            {v.saleId ? ` · delivers ${v.saleId}` : " · no sale yet"}
          </div>
        </div>
      ))}
      <h2 style={{ marginTop: 12 }}>Cargo in tank</h2>
      {tanks.length === 0 && <div className="empty">Nothing in storage.</div>}
      {tanks.map((c) => (
        <div className="item" key={c.id}>
          <b>{c.id}</b> {kbbl(c.qty)} {c.product} at {c.hub}
          <div className="form-row" style={{ marginTop: 4 }}>
            {ROUTES.filter((r) => r.from === c.hub).map((r) => (
              <button key={r.id} className="btn small" onClick={() => act({ type: "charter", routeId: r.id, laycanStart: game.day + 5, product: c.product })}>
                Ship on {r.id} → {r.to}
              </button>
            ))}
          </div>
        </div>
      ))}
      <h2 style={{ marginTop: 12 }}>Futures</h2>
      {pos.futures.map((f) => (
        <div className="item" key={f.id}>
          <b>{f.lots > 0 ? "+" : ""}
            {f.lots}</b> {FUTURES[f.contract].name} {f.y}-{String(f.m).padStart(2, "0")} · margin {money(f.margin)}{" "}
          <button className="btn small" onClick={() => act({ type: "futures", contract: f.contract, y: f.y, m: f.m, lots: -f.lots })}>
            Close
          </button>
        </div>
      ))}
      <div className="form-row" style={{ marginTop: 6 }}>
        <label className="field">
          Contract
          <select value={fut.id} onChange={(e) => setFut({ ...fut, id: e.target.value as FuturesId })}>
            {FUTURES_IDS.map((id) => (
              <option key={id} value={id}>
                {FUTURES[id].name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Month
          <select value={fut.month} onChange={(e) => setFut({ ...fut, month: Number(e.target.value) })}>
            {months.map((x, i) => (
              <option key={x.code} value={i}>
                {x.code}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Lots (− = sell)
          <input type="number" step={10} value={fut.lots} onChange={(e) => setFut({ ...fut, lots: Number(e.target.value) })} style={{ width: 90 }} />
        </label>
        <button className="btn primary" onClick={() => act({ type: "futures", contract: fut.id, y: lm.y, m: lm.m, lots: fut.lots })}>
          Trade
        </button>
      </div>
      <small>
        {lm.code} at {(fq * spec.quotePerBbl).toFixed(spec.quoteUnit === "$/gal" ? 4 : 2)} {spec.quoteUnit}; 1 lot = {spec.bblPerLot.toLocaleString()} bbl; expires {isoDate(lm.expiry)}.
      </small>
      <h2 style={{ marginTop: 12 }}>Exposure by price component</h2>
      {exps.length === 0 && <div className="empty">No price exposure. Note: an unpriced floating purchase has none until its pricing window starts.</div>}
      <table>
        <tbody>
          {exps.map((e) => (
            <tr key={e.key}>
              <td>{e.label}</td>
              <td className={`num ${e.bbl >= 0 ? "pos" : "neg"}`}>{(e.bbl / 1000).toFixed(0)} kbbl</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
