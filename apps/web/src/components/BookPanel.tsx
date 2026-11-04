import { Fragment, useState, type ReactNode } from "react";
import {
  FUTURES,
  FUTURES_IDS,
  HUBS,
  ROSTER,
  ROUTES,
  cargoValue,
  contractPrice,
  dealValue,
  isoDate,
  listedMonths,
  pricingDays,
  type Action,
  type Cargo,
  type Deal,
  type FuturesId,
  type Game,
  type HubId,
  type Voyage,
} from "@laycan/engine";
import { kbbl, money, range, shortDate, signed } from "../format";
import { DivertOptions } from "./Operations";
import { Tips } from "./Tips";

const cptyName = (id: string) => ROSTER.find((c) => c.id === id)?.name ?? id;
const day = (d: number) => shortDate(isoDate(d));

/* ------------------------------------------------------------------ deal stage */

function stage(d: Deal): { word: string; tone: string } {
  if (d.status === "open") return { word: d.side === "buy" ? "to receive" : "to deliver", tone: "accent" };
  if (d.status === "delivered") return { word: d.side === "buy" ? "received, unpaid" : "delivered, unpaid", tone: "warn" };
  if (d.status === "settled") return { word: "closed", tone: "ok" };
  return { word: "cancelled", tone: "" };
}

/** Where title passes and what happens next, in plain words. */
function dealStory(d: Deal, game: Game): string {
  const lay = range(day(d.laycan[0]), day(d.laycan[1]));
  const v = d.voyageId ? game.book.voyages.find((x) => x.id === d.voyageId) : undefined;
  const ship = v ? `, on ${v.id} ${v.from} → ${v.to}` : "";
  const value = money(d.qty * contractPrice(d, game.market));
  if (d.status === "open") {
    if (d.side === "buy")
      return d.incoterm === "FOB"
        ? `Title passes at ${d.hub}, the seller's port, when the cargo loads (${lay})${v ? ship : ". No ship yet: charter one"}.`
        : d.incoterm === "ITT"
          ? `Title passes inside a tank at ${d.hub} (${lay}).`
          : `The seller delivers to you at ${d.hub} (${lay}); title passes on arrival.`;
    return d.incoterm === "FOB"
      ? `The buyer lifts from your tank at ${d.hub} (${lay}).`
      : d.incoterm === "ITT"
        ? `Transfer from your tank at ${d.hub} (${lay}).`
        : `You deliver at ${d.hub}, the buyer's port (${lay})${v ? ship : ". Needs a cargo arriving there"}.`;
  }
  const when = d.deliveryDay !== undefined ? day(d.deliveryDay) : "";
  const due = d.dueDay !== undefined ? `, due ${day(d.dueDay)}` : "";
  if (d.status === "delivered") return d.side === "buy" ? `Title passed to you at ${d.hub} on ${when}. You owe ${value}${due}.` : `Delivered to ${cptyName(d.cpty)} at ${d.hub} on ${when}. They owe ${value}${due}.`;
  if (d.status === "settled") return `${d.side === "buy" ? "Received" : "Delivered"} at ${d.hub} on ${when}; paid ${value} (${contractPrice(d, game.market).toFixed(2)} $/bbl).`;
  return d.note ?? "Cancelled.";
}

function Steps({ d, n }: { d: Deal; n: number }) {
  const priced = d.pricing.kind === "fixed" || d.fixings.length > 0;
  const done = [true, priced && (d.pricing.kind === "fixed" || d.fixings.length >= n || d.status !== "open"), d.status === "delivered" || d.status === "settled", d.status === "settled"];
  const names = ["Agreed", "Priced", d.side === "buy" ? "Title to you" : "Title to buyer", "Paid"];
  return (
    <div className="steps" style={{ gridTemplateColumns: "repeat(4, 1fr)" }} aria-label="Deal stages">
      {names.map((s, i) => (
        <span key={s} className={done[i] ? "d" : ""}>
          {s}
        </span>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ timeline */

interface Bar {
  id: string;
  from: number;
  to: number;
  label: string;
  cls: string;
  price?: [number, number];
}

/** Stack bars that overlap into rows. */
function pack(bars: Bar[]): Bar[][] {
  const rows: Bar[][] = [];
  for (const b of [...bars].sort((a, c) => a.from - c.from)) {
    const row = rows.find((r) => r[r.length - 1]!.to <= b.from);
    if (row) row.push(b);
    else rows.push([b]);
  }
  return rows;
}

function Timeline({ game, sel, onSel }: { game: Game; sel: string | null; onSel: (id: string) => void }) {
  const today = game.day;
  const start = today - 7;
  const end = today + 77;
  const pct = (d: number) => `${(Math.max(0, Math.min(1, (d - start) / (end - start))) * 100).toFixed(2)}%`;
  const width = (a: number, b: number) => `${(Math.max(0.6, ((Math.min(b, end) - Math.max(a, start)) / (end - start)) * 100)).toFixed(2)}%`;
  const live = game.book.deals.filter((d) => d.status === "open" || d.status === "delivered");
  const dealBar = (d: Deal): Bar => {
    const days = pricingDays(d, game.market);
    return {
      id: d.id,
      from: d.laycan[0],
      to: d.laycan[1] + 1,
      label: `${d.id} ${d.side === "buy" ? "buy" : "sell"} ${(d.qty / 1000).toFixed(0)} ${d.product} ${d.incoterm} ${d.hub}`,
      cls: `${d.side}${d.status !== "open" ? " done" : ""}`,
      price: d.pricing.kind === "fixed" || !days.length ? undefined : [Math.min(...days), Math.max(...days) + 1],
    };
  };
  const voyages = game.openPositions().voyages;
  const lanes: { name: string; bars: Bar[]; ticks?: { day: number; label: string; id: string }[] }[] = [
    { name: "Purchases", bars: live.filter((d) => d.side === "buy").map(dealBar) },
    { name: "Sales", bars: live.filter((d) => d.side === "sell").map(dealBar) },
    {
      name: "Voyages",
      bars: voyages.map((v) => ({ id: v.id, from: v.arriveLoad, to: (v.arriveDisch ?? v.arriveLoad + v.sailDays + 2) + 1, label: `${v.id} ${v.from} → ${v.to}`, cls: `voyage${v.status === "held" ? " held" : ""}` })),
    },
    { name: "Futures", bars: [], ticks: game.book.futures.map((f) => ({ day: f.expiry, label: `${f.contract}${String(f.m).padStart(2, "0")} ${f.lots > 0 ? "+" : ""}${f.lots}`, id: f.id })) },
    {
      name: "Tanks",
      bars: game.book.leases.filter((l) => l.endDay > start).map((l) => ({ id: l.id, from: l.startDay, to: l.endDay, label: `${l.hub} ${(l.capacityBbl / 1000).toFixed(0)} kbbl`, cls: "lease" })),
    },
  ];
  const weeks = Array.from({ length: 12 }, (_, i) => today + 7 * i).filter((d) => d < end);
  const empty = lanes.every((l) => !l.bars.length && !(l.ticks ?? []).length);
  return (
    <div className="table-wrap">
      <div className="tl" aria-label="Book timeline">
        <div className="tl-axis">
          <span />
          <div className="tl-ticks">
            {weeks
              .filter((_, i) => i % 2 === 0)
              .map((w) => (
                <span key={w} style={{ left: pct(w) }}>
                  {day(w)}
                </span>
              ))}
          </div>
        </div>
        {lanes.map((lane) => {
          const rows = pack(lane.bars);
          const h = Math.max(1, rows.length) * 22 + 4;
          return (
            <div className="tl-lane" key={lane.name}>
              <span className="name">{lane.name}</span>
              <div className="tl-track" style={{ height: h }}>
                {weeks.map((w) => (
                  <span key={w} className="tl-grid" style={{ left: pct(w) }} />
                ))}
                <span className="tl-today" style={{ left: pct(today) }} title="Today" />
                {rows.map((row, ri) =>
                  row.map((b) => (
                    <Fragment key={b.id}>
                      <button className={`tl-bar ${b.cls} ${sel === b.id ? "sel" : ""}`} style={{ left: pct(b.from), width: width(b.from, b.to), top: 3 + ri * 22 }} onClick={() => b.cls !== "lease" && onSel(b.id)} title={b.label}>
                        {b.label}
                      </button>
                      {b.price && <span className="tl-price" style={{ left: pct(b.price[0]), width: width(b.price[0], b.price[1]), top: 20 + ri * 22 }} title={`${b.id} pricing window`} />}
                    </Fragment>
                  )),
                )}
                {(lane.ticks ?? []).map((t) => (
                  <span key={t.id} className="tl-tick" style={{ left: pct(t.day) }} title={`expires ${day(t.day)}`}>
                    {t.label}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
        <div className="tl-key">
          <span>Bars: laycans and voyages</span>
          <span>Dotted line: pricing window</span>
          <span>Ticks: futures expiry</span>
          <span className="bad">Red line: today</span>
        </div>
        {empty && <div className="empty">Nothing scheduled yet. Buy a cargo in Offers &amp; bids.</div>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ positions blotter */

/** One position row; `narrow` repeats the date and pricing columns under the position on phones. */
function Row({ id, sel, onSel, cells, detail, testId, narrow }: { id: string; sel: boolean; onSel: (id: string) => void; cells: ReactNode[]; detail?: ReactNode; testId?: string; narrow?: string }) {
  return (
    <Fragment>
      <tr className={`click ${sel ? "sel" : ""}`} onClick={() => onSel(sel ? "" : id)} data-testid={testId} id={`pos-${id}`}>
        {cells.map((c, i) => (
          <td key={i} className={i === 1 ? "l wrap" : i === 2 ? "l wrap wide-only" : i === 3 ? "wide-only" : undefined}>
            {c}
            {i === 1 && narrow && <span className="sub narrow-only">{narrow}</span>}
          </td>
        ))}
      </tr>
      {sel && detail && (
        <tr className="detail">
          <td colSpan={cells.length}>{detail}</td>
        </tr>
      )}
    </Fragment>
  );
}

function voyageCargo(game: Game, v: Voyage): string {
  const cargo = v.cargoId ? game.book.cargoes.find((c) => c.id === v.cargoId) : undefined;
  const buy = v.purchaseId ? game.book.deals.find((d) => d.id === v.purchaseId) : undefined;
  if (cargo) return `Carrying ${kbbl(cargo.qty)} ${cargo.product}${cargo.qualityDiscount > 0 ? " (off-spec)" : ""}`;
  if (buy) return `To load ${kbbl(buy.qtyNominal)} ${buy.product} at ${v.from}`;
  return `To load ${v.product ?? "product"} from your tank at ${v.from}`;
}

export function BookPanel({ game, act }: { game: Game; act: (a: Action) => void }) {
  const [sel, setSel] = useState<string | null>(null);
  const select = (id: string) => {
    setSel(id || null);
    if (id) requestAnimationFrame(() => document.getElementById(`pos-${id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  };
  const m = game.market;
  const live = game.book.deals.filter((d) => d.status === "open" || d.status === "delivered");
  const closed = game.book.deals.filter((d) => d.status === "settled" || d.status === "cancelled").reverse();
  const voyages = game.openPositions().voyages;
  const tanks = game.book.cargoes.filter((c) => c.where === "tank");
  const dealRow = (d: Deal) => {
    const st = stage(d);
    const n = pricingDays(d, m).length || 1;
    const k = d.pricing.kind === "fixed" ? 1 : d.fixings.length;
    const v = dealValue(d, m);
    return (
      <Row
        key={d.id}
        id={d.id}
        sel={sel === d.id}
        onSel={select}
        testId="deal"
        narrow={`${range(day(d.laycan[0]), day(d.laycan[1]))} · priced ${d.pricing.kind === "fixed" ? "fixed" : `${Math.min(k, n)}/${n}`}`}
        cells={[
          <span className="code">{d.id}</span>,
          <>
            {d.side === "buy" ? "Bought" : "Sold"} {(d.qty / 1000).toFixed(0)} kbbl {d.product} {d.incoterm} {d.hub}
            <span className="sub">
              {d.side === "buy" ? "from" : "to"} {cptyName(d.cpty)}
              {d.voyageId ? ` · ${d.voyageId}` : ""}
            </span>
          </>,
          range(day(d.laycan[0]), day(d.laycan[1])),
          d.pricing.kind === "fixed" ? "fixed" : `${Math.min(k, n)}/${n}`,
          <span className={`st ${st.tone}`}>{st.word}</span>,
          d.status === "open" ? <span className={v >= 0 ? "ok" : "bad"}>{money(v)}</span> : <span className="dim">{money(Math.abs(v))}</span>,
        ]}
        detail={
          <div className="detail-grid">
            <div>
              <Steps d={d} n={n} />
              <p style={{ marginTop: 8 }}>{dealStory(d, game)}</p>
            </div>
            <dl className="terms">
              <dt>Invoice price now</dt>
              <dd>{contractPrice(d, m).toFixed(2)} $/bbl</dd>
              <dt>Pricing</dt>
              <dd>
                {d.pricing.kind === "fixed" ? "fixed" : `${k} of ${n} quotes fixed`}, premium {signed(d.pricing.diff)}
              </dd>
              <dt>Payment</dt>
              <dd>
                {d.payment.kind === "LC" ? "letter of credit" : "open account"}, {d.payment.days} days
              </dd>
            </dl>
          </div>
        }
      />
    );
  };
  const voyageRow = (v: Voyage) => {
    const buy = v.purchaseId ? game.book.deals.find((d) => d.id === v.purchaseId) : undefined;
    const sale = v.saleId ? game.book.deals.find((d) => d.id === v.saleId) : undefined;
    return (
      <Row
        key={v.id}
        id={v.id}
        sel={sel === v.id}
        onSel={select}
        testId="voyage"
        narrow={`load ${day(v.arriveLoad)}${v.arriveDisch ? ` · discharge ${day(v.arriveDisch)}` : ""}`}
        cells={[
          <span className="code">{v.id}</span>,
          <>
            {v.cls} <span className="code">{v.routeId}</span> {v.from} → {v.to}
            {v.via !== "direct" ? ` via ${v.via}` : ""}
            <span className="sub" data-testid="voyage-cargo">
              {voyageCargo(game, v)} · {buy ? `bought ${buy.id}` : "from tank"} · {sale ? `delivers ${sale.id} (${sale.incoterm} ${sale.hub})` : "no sale: discharges into tank"}
              {v.divertedFrom ? ` · diverted from ${v.divertedFrom}` : ""}
            </span>
          </>,
          <>
            load {day(v.arriveLoad)}
            <span className="sub">{v.arriveDisch ? `discharge ${day(v.arriveDisch)}` : `~${v.sailDays} d at sea`}</span>
          </>,
          "",
          <span className={`st ${v.status === "held" ? "bad" : "accent"}`}>{v.status}</span>,
          v.status === "sailing" ? (
            <button
              className="btn small"
              onClick={(e) => {
                e.stopPropagation();
                select(v.id);
              }}
              data-testid={`divert-${v.id}`}
            >
              Divert…
            </button>
          ) : (
            <span className="dim">{money(v.freightUsd + v.warRiskUsd)}</span>
          ),
        ]}
        detail={
          <div className="detail-grid">
          {v.status === "sailing" ? <DivertOptions game={game} v={v} act={act} /> : <span className="dim">Diversion is possible once the ship has loaded and sailed.</span>}
          <dl className="terms">
            <dt>Laytime</dt>
            <dd>
              {v.portHours.toFixed(0)} of {v.laytimeHours} hours used; demurrage {money(v.demurrageRate)}/day
            </dd>
            <dt>Freight</dt>
            <dd>
              {money(v.freightUsd)}
              {v.warRiskUsd > 0 ? ` + war risk ${money(v.warRiskUsd)}` : ""}
            </dd>
            {v.heldDays > 0 && (
              <>
                <dt>Held</dt>
                <dd className="bad">{v.heldDays} days</dd>
              </>
            )}
          </dl>
          </div>
        }
      />
    );
  };
  const tankRow = (c: Cargo) => (
    <Row
      key={c.id}
      id={c.id}
      sel={sel === c.id}
      onSel={select}
      cells={[
        <span className="code">{c.id}</span>,
        <>
          {kbbl(c.qty)} {c.product} in tank at {c.hub}
          {c.qualityDiscount > 0 && <span className="sub warn">off-spec, −{c.qualityDiscount.toFixed(2)} $/bbl</span>}
        </>,
        `since ${day(c.sinceDay)}`,
        "",
        <span className="st">in tank</span>,
        money(cargoValue(c, m)),
      ]}
      detail={
        <div className="form-row">
          <button className="btn small" onClick={() => act({ type: "sellSpot", cargoId: c.id })}>
            Sell spot now
          </button>
          {ROUTES.filter((r) => r.from === c.hub).map((r) => (
            <button key={r.id} className="btn small" onClick={() => act({ type: "charter", routeId: r.id, laycanStart: game.day + 5, product: c.product })}>
              Ship on <span className="code">{r.id}</span> → {r.to}
            </button>
          ))}
        </div>
      }
    />
  );
  const count = live.length + voyages.length + tanks.length;
  return (
    <div>
      <Tips
        id="book"
        tips={[
          <>Click a bar or a row for detail and actions. A deal goes from to receive / to deliver, to unpaid (title has passed at the hub shown), to closed (paid).</>,
          <>A ship with no sale discharges into tank at its destination: sell spot, ship it on, or match a later bid.</>,
          <>Cargoes at sea are valued on the curve for their arrival date: hedge in the futures month in which your barrels price or arrive.</>,
        ]}
      />
      <div className="section-title">
        <h3>Next ten weeks</h3>
      </div>
      <Timeline game={game} sel={sel} onSel={select} />
      <div className="section-title" style={{ marginTop: 18 }}>
        <h3>Positions</h3>
        <span className="note">marks on the forward curve</span>
      </div>
      {count === 0 ? (
        <div className="empty">No positions. Buy or sell a cargo in Offers &amp; bids.</div>
      ) : (
        <div className="table-wrap">
          <table aria-label="Positions">
            <thead>
              <tr>
                <th>ID</th>
                <th className="l">Position</th>
                <th className="l wide-only">Dates</th>
                <th className="wide-only">Priced</th>
                <th className="l">Stage</th>
                <th>Mark</th>
              </tr>
            </thead>
            <tbody>
              {live.map(dealRow)}
              {voyages.map(voyageRow)}
              {tanks.map(tankRow)}
            </tbody>
          </table>
        </div>
      )}
      {closed.length > 0 && (
        <details style={{ marginTop: 12 }}>
          <summary data-testid="closed-deals">Closed deals ({closed.length})</summary>
          <div className="table-wrap">
            <table aria-label="Closed deals">
              <tbody>
                {closed.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <span className="code">{d.id}</span>
                    </td>
                    <td className="l wrap">
                      {d.side === "buy" ? "Bought" : "Sold"} {(d.qty / 1000).toFixed(0)} kbbl {d.product} {d.incoterm} {d.hub}
                      <span className="sub">{dealStory(d, game)}</span>
                    </td>
                    <td className="l">
                      <span className={`st ${stage(d).tone}`}>{stage(d).word}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ hedging */

export function HedgePanel({ game, act }: { game: Game; act: (a: Action) => void }) {
  const [fut, setFut] = useState<{ id: FuturesId; month: number; lots: number }>({ id: "GO", month: 1, lots: 100 });
  const months = listedMonths(fut.id, game.day);
  const lm = months[Math.min(fut.month, months.length - 1)]!;
  const spec = FUTURES[fut.id];
  const fq = game.futuresQuote(fut.id, lm.y, lm.m);
  const lots = Math.max(1, Math.round(Math.abs(fut.lots)));
  const trade = (sign: 1 | -1) => act({ type: "futures", contract: fut.id, y: lm.y, m: lm.m, lots: sign * lots });
  const exps = game.exposures();
  const varNow = game.var99();
  const limit = game.scenario.finance.varLimit.value;
  return (
    <div>
      <div className="section-title">
        <h3>Exposure</h3>
        <span className="note">
          VaR 99% <span className={varNow > limit ? "bad strong" : "strong"}>{money(varNow)}</span> of {money(limit, 0)} limit
        </span>
      </div>
      {exps.length === 0 ? (
        <div className="empty">No price exposure. An unpriced floating purchase has none until its pricing window starts.</div>
      ) : (
        <table aria-label="Exposure">
          <thead>
            <tr>
              <th>Price component</th>
              <th>kbbl</th>
            </tr>
          </thead>
          <tbody>
            {exps.map((e) => (
              <tr key={e.key}>
                <td>{e.label}</td>
                <td className={e.bbl >= 0 ? "ok" : "bad"}>{signed(e.bbl / 1000, 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="section-title" style={{ marginTop: 18 }}>
        <h3>Futures</h3>
        <span className="note">sell to hedge barrels you own or have priced; buy to hedge a fixed-price sale</span>
      </div>
      {game.book.futures.length > 0 && (
        <table aria-label="Futures positions" style={{ marginBottom: 10 }}>
          <thead>
            <tr>
              <th>Contract</th>
              <th className="l">Position</th>
              <th>Expiry</th>
              <th>Margin</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {game.book.futures.map((f) => (
              <tr key={f.id}>
                <td>
                  <span className="code">
                    {f.contract} {f.y}-{String(f.m).padStart(2, "0")}
                  </span>
                </td>
                <td className="l">
                  {f.lots > 0 ? "Long" : "Short"} {Math.abs(f.lots)} lots <span className="dim">{FUTURES[f.contract].name}</span>
                </td>
                <td>{day(f.expiry)}</td>
                <td>{money(f.margin)}</td>
                <td>
                  <button className="btn small" onClick={() => act({ type: "futures", contract: f.contract, y: f.y, m: f.m, lots: -f.lots })}>
                    Close
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="form-row">
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
          <input type="number" min={1} step={10} value={lots} onChange={(e) => setFut({ ...fut, lots: Number(e.target.value) })} aria-label="Lots" />
        </label>
        <button className="btn" onClick={() => trade(1)} data-testid="fut-buy">
          Buy
        </button>
        <button className="btn" onClick={() => trade(-1)} data-testid="fut-sell">
          Sell
        </button>
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
        <span className="code">{lm.code}</span> {(fq * spec.quotePerBbl).toFixed(spec.quoteUnit === "$/gal" ? 4 : 2)} {spec.quoteUnit} · {lots} lots = {((lots * spec.bblPerLot) / 1000).toFixed(0)} kbbl · expires {day(lm.expiry)} · fee $3/lot
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ storage */

export function StoragePanel({ game, act }: { game: Game; act: (a: Action) => void }) {
  const [lease, setLease] = useState<{ hub: HubId; kbbl: number; months: number }>({ hub: "ARA", kbbl: 300, months: 3 });
  const leases = game.book.leases.filter((l) => l.endDay > game.day);
  return (
    <div>
      <div className="section-title">
        <h3>Carry</h3>
        <span className="note">$/bbl per month: storage pays when contango beats rent and interest</span>
      </div>
      <div className="table-wrap">
        <table className="carry" aria-label="Carry economics">
          <thead>
            <tr>
              <th>Hub, product</th>
              <th>Contango</th>
              <th>Rent</th>
              <th>Interest</th>
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
                    <td>{signed(c.contango)}</td>
                    <td>{signed(-c.storage)}</td>
                    <td>{signed(-c.finance)}</td>
                    <td className={`strong ${c.net > 0 ? "ok" : "bad"}`}>{signed(c.net)}</td>
                  </tr>
                );
              }),
            )}
          </tbody>
        </table>
      </div>
      <div className="section-title" style={{ marginTop: 18 }}>
        <h3>Tank leases</h3>
        <span className="note">take-or-pay; product above leased capacity pays spot tankage</span>
      </div>
      {leases.length > 0 && (
        <table aria-label="Leases" style={{ marginBottom: 10 }}>
          <thead>
            <tr>
              <th>Lease</th>
              <th className="l">Tank</th>
              <th>Rent $/bbl/mo</th>
              <th>Until</th>
              <th>Used kbbl</th>
            </tr>
          </thead>
          <tbody>
            {leases.map((l) => (
              <tr key={l.id}>
                <td>
                  <span className="code">{l.id}</span>
                </td>
                <td className="l">
                  {kbbl(l.capacityBbl)} at {l.hub}
                </td>
                <td>{l.feePerBblMonth.toFixed(2)}</td>
                <td>{day(l.endDay)}</td>
                <td>{(Math.min(game.tankStock(l.hub), game.leasedCapacity(l.hub)) / 1000).toFixed(0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="form-row">
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
          <input type="number" min={50} step={50} value={lease.kbbl} onChange={(e) => setLease({ ...lease, kbbl: Number(e.target.value) })} />
        </label>
        <label className="field">
          Months
          <input type="number" min={1} max={12} value={lease.months} onChange={(e) => setLease({ ...lease, months: Number(e.target.value) })} style={{ width: 64 }} />
        </label>
        <button className="btn" onClick={() => act({ type: "lease", hub: lease.hub, capacityBbl: lease.kbbl * 1000, months: lease.months })}>
          Lease tank at {game.leaseQuote(lease.hub).toFixed(2)} $/bbl/mo
        </button>
      </div>
    </div>
  );
}
