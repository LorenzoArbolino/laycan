import { useState } from "react";
import { FUTURES, FUTURES_IDS, HUBS, ROUTES, contractPrice, isoDate, listedMonths, type Action, type FuturesId, type Game, type HubId } from "@laycan/engine";
import { kbbl, money, shortDate, signed } from "../format";
import { BlendPanel, DivertControl } from "./Operations";

const STAGES = ["fixed", "loading", "sailing", "discharging", "done"] as const;

function Hedge({ game, act }: { game: Game; act: (a: Action) => void }) {
  const [fut, setFut] = useState<{ id: FuturesId; month: number; lots: number }>({ id: "GO", month: 1, lots: 100 });
  const months = listedMonths(fut.id, game.day);
  const lm = months[Math.min(fut.month, months.length - 1)]!;
  const spec = FUTURES[fut.id];
  const fq = game.futuresQuote(fut.id, lm.y, lm.m);
  const lots = Math.max(1, Math.round(Math.abs(fut.lots)));
  const trade = (sign: 1 | -1) => act({ type: "futures", contract: fut.id, y: lm.y, m: lm.m, lots: sign * lots });
  return (
    <>
      <h2 style={{ marginTop: 12 }}>Futures (hedges)</h2>
      {game.book.futures.map((f) => (
        <div className="item" key={f.id}>
          <b className={f.lots > 0 ? "pos" : "neg"}>{f.lots > 0 ? "Long" : "Short"} {Math.abs(f.lots)}</b> {FUTURES[f.contract].name} {f.y}-{String(f.m).padStart(2, "0")} · margin {money(f.margin)}{" "}
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
          Lots
          <input type="number" min={1} step={10} value={lots} onChange={(e) => setFut({ ...fut, lots: Number(e.target.value) })} style={{ width: 80 }} aria-label="Lots" />
        </label>
        <button className="btn buy" onClick={() => trade(1)} data-testid="fut-buy">
          Buy
        </button>
        <button className="btn sell" onClick={() => trade(-1)} data-testid="fut-sell">
          Sell
        </button>
      </div>
      <small>
        {lm.code} at {(fq * spec.quotePerBbl).toFixed(spec.quoteUnit === "$/gal" ? 4 : 2)} {spec.quoteUnit} · {lots} lots = {((lots * spec.bblPerLot) / 1000).toFixed(0)} kbbl · expires {isoDate(lm.expiry)}. Sell to hedge
        barrels you own (or have bought at a price already fixed); buy to hedge a fixed-price sale.
      </small>
    </>
  );
}

function Storage({ game, act }: { game: Game; act: (a: Action) => void }) {
  const [lease, setLease] = useState<{ hub: HubId; kbbl: number; months: number }>({ hub: "ARA", kbbl: 300, months: 3 });
  const leases = game.book.leases.filter((l) => l.endDay > game.day);
  return (
    <>
      <h2 style={{ marginTop: 12 }}>Storage</h2>
      <div className="table-wrap">
        <table className="carry" aria-label="Carry economics">
          <thead>
            <tr>
              <th>Carry, $/bbl/month</th>
              <th>Contango</th>
              <th>Storage</th>
              <th>Finance</th>
              <th>Net</th>
            </tr>
          </thead>
          <tbody>
            {(["ARA", "USGC", "SIN", "FUJ"] as const).flatMap((h) =>
              (["diesel", "gasoline"] as const).map((p) => {
                const c = game.carry(h, p);
                return (
                  <tr key={h + p}>
                    <td>
                      {h} {p}
                    </td>
                    <td className="num">{signed(c.contango)}</td>
                    <td className="num">−{c.storage.toFixed(2)}</td>
                    <td className="num">−{c.finance.toFixed(2)}</td>
                    <td className={`num ${c.net > 0 ? "pos" : "neg"}`}>{signed(c.net)}</td>
                  </tr>
                );
              }),
            )}
          </tbody>
        </table>
      </div>
      <small>Storage pays when the curve's contango beats the tank rent and the interest on the barrels. In backwardation, holding inventory costs you twice.</small>
      {leases.map((l) => (
        <div className="item" key={l.id}>
          <b>{l.id}</b> {kbbl(l.capacityBbl)} at {l.hub}, {l.feePerBblMonth.toFixed(2)} $/bbl/month until {shortDate(isoDate(l.endDay))} · used {kbbl(Math.min(game.tankStock(l.hub), game.leasedCapacity(l.hub)))}
        </div>
      ))}
      <div className="form-row" style={{ marginTop: 6 }}>
        <label className="field">
          Hub
          <select value={lease.hub} onChange={(e) => setLease({ ...lease, hub: e.target.value as HubId })}>
            {HUBS.map((h) => (
              <option key={h}>{h}</option>
            ))}
          </select>
        </label>
        <label className="field">
          kbbl
          <input type="number" min={50} step={50} value={lease.kbbl} onChange={(e) => setLease({ ...lease, kbbl: Number(e.target.value) })} style={{ width: 80 }} />
        </label>
        <label className="field">
          Months
          <input type="number" min={1} max={12} value={lease.months} onChange={(e) => setLease({ ...lease, months: Number(e.target.value) })} style={{ width: 60 }} />
        </label>
        <button className="btn" onClick={() => act({ type: "lease", hub: lease.hub, capacityBbl: lease.kbbl * 1000, months: lease.months })}>
          Lease tank at {game.leaseQuote(lease.hub).toFixed(2)} $/bbl/mo
        </button>
      </div>
    </>
  );
}

export function BookPanel({ game, act }: { game: Game; act: (a: Action) => void }) {
  const pos = game.openPositions();
  const m = game.market;
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
            <b>{d.id}</b> {d.side === "buy" ? "Bought" : "Sold"} {kbbl(d.qty)} {d.product} {d.incoterm} {d.hub} <span className="badge derived">{d.status}</span>
            <div className="sub">
              laycan {shortDate(isoDate(d.laycan[0]))}–{shortDate(isoDate(d.laycan[1]))} · priced {k}/{n} quotes · invoice price now {contractPrice(d, m).toFixed(2)} $/bbl
              {d.voyageId ? ` · ${d.voyageId}` : d.side === "sell" && d.incoterm !== "FOB" && d.status === "open" ? " · needs a cargo here" : ""}
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
            {v.divertedFrom ? ` · diverted from ${v.divertedFrom}` : ""}
          </div>
          {v.status === "sailing" && <DivertControl game={game} v={v} act={act} />}
        </div>
      ))}
      <h2 style={{ marginTop: 12 }}>Cargo in tank</h2>
      {tanks.length === 0 && <div className="empty">Nothing in storage.</div>}
      {tanks.map((c) => (
        <div className="item" key={c.id}>
          <b>{c.id}</b> {kbbl(c.qty)} {c.product} at {c.hub}
          {c.qualityDiscount > 0 && <span className="badge estimate"> off-spec −{c.qualityDiscount.toFixed(2)}</span>}
          <div className="form-row" style={{ marginTop: 4 }}>
            <button className="btn small" onClick={() => act({ type: "sellSpot", cargoId: c.id })}>
              Sell spot now
            </button>
            {ROUTES.filter((r) => r.from === c.hub).map((r) => (
              <button key={r.id} className="btn small" onClick={() => act({ type: "charter", routeId: r.id, laycanStart: game.day + 5, product: c.product })}>
                Ship on {r.id} → {r.to}
              </button>
            ))}
          </div>
        </div>
      ))}
      <Hedge game={game} act={act} />
      <Storage game={game} act={act} />
      <BlendPanel game={game} act={act} />
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
