import { useState, type ReactNode } from "react";
import { FUTURES, FUTURES_IDS, HUBS, ROSTER, ROUTES, contractPrice, isoDate, listedMonths, type Action, type Deal, type FuturesId, type Game, type HubId } from "@laycan/engine";
import { kbbl, money, shortDate, signed } from "../format";
import { BlendPanel, DivertControl } from "./Operations";
import { Tips } from "./Tips";

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
      <h4>Futures positions</h4>
      {game.book.futures.length === 0 && <div className="empty">No futures.</div>}
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

const cptyName = (id: string) => ROSTER.find((c) => c.id === id)?.name ?? id;
const day = (d: number) => shortDate(isoDate(d));

/** Where title passes and what happens next, in plain words. */
function dealStory(d: Deal, game: Game): { badge: string; badgeClass: string; text: string } {
  const lay = `${day(d.laycan[0])}–${day(d.laycan[1])}`;
  const v = d.voyageId ? game.book.voyages.find((x) => x.id === d.voyageId) : undefined;
  const ship = v ? ` · ${v.id} ${v.from}→${v.to}` : "";
  const P = contractPrice(d, game.market);
  const value = money(d.qty * P);
  if (d.status === "open") {
    if (d.side === "buy") {
      const text =
        d.incoterm === "FOB"
          ? `Loads at ${d.hub} (the seller's port) ${lay}, onto your ship${v ? ship : " · no ship yet: charter one"}`
          : d.incoterm === "ITT"
            ? `In-tank transfer to you at ${d.hub} ${lay}`
            : `The seller delivers to you at ${d.hub} ${lay}`;
      return { badge: "to receive", badgeClass: "stage-open", text };
    }
    const text =
      d.incoterm === "FOB"
        ? `The buyer lifts from your tank at ${d.hub} ${lay}`
        : d.incoterm === "ITT"
          ? `In-tank transfer from your tank at ${d.hub} ${lay}`
          : `You deliver at ${d.hub} (the buyer's port) ${lay}${v ? ship : " · needs a cargo arriving there"}`;
    return { badge: "to deliver", badgeClass: "stage-open", text };
  }
  const when = d.deliveryDay !== undefined ? day(d.deliveryDay) : "";
  if (d.status === "delivered") {
    const due = d.dueDay !== undefined ? ` by ${day(d.dueDay)}` : "";
    const fixing = fixedShareText(d);
    return d.side === "buy"
      ? { badge: "received · unpaid", badgeClass: "stage-pending", text: `Title passed to you at ${d.hub} on ${when}. You pay ${value}${due}${fixing}` }
      : { badge: "delivered · unpaid", badgeClass: "stage-pending", text: `Delivered to ${cptyName(d.cpty)} at ${d.hub} on ${when}. They pay ${value}${due}${fixing}` };
  }
  if (d.status === "settled") return { badge: "closed", badgeClass: "stage-closed", text: `${d.side === "buy" ? "Received" : "Delivered"} at ${d.hub} on ${when}; ${d.side === "buy" ? "paid" : "paid to you"} ${value} (${P.toFixed(2)} $/bbl)` };
  return { badge: "cancelled", badgeClass: "stage-cancelled", text: d.note ?? "Cancelled" };
}

function fixedShareText(d: Deal): string {
  if (d.pricing.kind === "fixed") return "";
  const n = d.window?.length ?? 5;
  return d.fixings.length < n ? ` (price still fixing: ${d.fixings.length}/${n} quotes, final amount may change)` : "";
}

function DealRow({ d, game }: { d: Deal; game: Game }) {
  const st = dealStory(d, game);
  const n = d.window?.length ?? (d.pricing.kind === "fixed" ? 1 : 5);
  const k = d.pricing.kind === "fixed" ? 1 : d.fixings.length;
  return (
    <div className={`item deal ${d.side}`} data-testid="deal">
      <b>{d.id}</b> {d.side === "buy" ? "Bought from" : "Sold to"} {cptyName(d.cpty)}: {kbbl(d.qty)} {d.product} {d.incoterm} {d.hub} <span className={`badge ${st.badgeClass}`}>{st.badge}</span>
      <div className="sub story">{st.text}</div>
      {d.status === "open" && (
        <div className="sub">
          priced {k}/{n} quotes · invoice price now {contractPrice(d, game.market).toFixed(2)} $/bbl
        </div>
      )}
    </div>
  );
}

function Section({ title, count, children, testId }: { title: string; count?: number; children: ReactNode; testId?: string }) {
  return (
    <section className="book-section" data-testid={testId}>
      <h3>
        {title}
        {count !== undefined && <span className="count">{count}</span>}
      </h3>
      {children}
    </section>
  );
}

export function BookPanel({ game, act }: { game: Game; act: (a: Action) => void }) {
  const pos = game.openPositions();
  const tanks = game.book.cargoes.filter((c) => c.where === "tank");
  const exps = game.exposures();
  const open = game.book.deals.filter((d) => d.status === "open");
  const unpaid = game.book.deals.filter((d) => d.status === "delivered");
  const closed = game.book.deals.filter((d) => d.status === "settled" || d.status === "cancelled").reverse();
  const dealById = (id?: string) => (id ? game.book.deals.find((d) => d.id === id) : undefined);
  return (
    <div>
      <Tips
        id="book"
        tips={[
          <>
            A deal moves from <b>to receive / to deliver</b> (title has not passed) to <b>unpaid</b> (title has passed at the hub shown; the invoice is due) to <b>closed</b> (paid). FOB passes title at the load port, DES on
            arrival at the buyer's port, ITT inside a tank.
          </>,
          <>Voyages show what they carry and which purchase and sale they link. A ship with no sale discharges into tank at its destination, where you can sell spot, ship on, or match a later bid.</>,
          <>Hedge with the futures month in which your barrels price or arrive: cargoes at sea are valued on the curve for their arrival date, so a matched hedge leaves little time-spread risk.</>,
        ]}
      />
      <Section title="Physical deals" count={open.length + unpaid.length}>
        <h4>Open: title not yet passed</h4>
        {open.length === 0 && <div className="empty">None.</div>}
        {open.map((d) => (
          <DealRow key={d.id} d={d} game={game} />
        ))}
        <h4>Delivered, awaiting payment</h4>
        {unpaid.length === 0 && <div className="empty">None.</div>}
        {unpaid.map((d) => (
          <DealRow key={d.id} d={d} game={game} />
        ))}
        {closed.length > 0 && (
          <details>
            <summary data-testid="closed-deals">Closed deals ({closed.length})</summary>
            {closed.map((d) => (
              <DealRow key={d.id} d={d} game={game} />
            ))}
          </details>
        )}
      </Section>
      <Section title="Voyages" count={pos.voyages.length}>
        {pos.voyages.length === 0 && <div className="empty">No ships chartered.</div>}
        {pos.voyages.map((v) => {
          const cargo = v.cargoId ? game.book.cargoes.find((c) => c.id === v.cargoId) : undefined;
          const buy = dealById(v.purchaseId);
          const sale = dealById(v.saleId);
          const carrying = cargo
            ? `Carrying ${kbbl(cargo.qty)} ${cargo.product} (${cargo.id})${cargo.qualityDiscount > 0 ? ", off-spec" : ""}`
            : buy
              ? `To load ${kbbl(buy.qtyNominal)} ${buy.product} at ${v.from}`
              : `To load ${v.product ?? "product"} from your tank at ${v.from}`;
          return (
            <div className="item" key={v.id} data-testid="voyage">
              <b>{v.id}</b> {v.cls} {v.routeId} {v.from}→{v.to} via {v.via} <span className="badge derived">{v.status}</span>
              <div className="timeline">
                {STAGES.map((s, i) => (
                  <span key={s} className={STAGES.indexOf(v.status as (typeof STAGES)[number]) >= i ? "done" : ""} />
                ))}
              </div>
              <div className="sub" data-testid="voyage-cargo">
                <b>{carrying}</b> · bought {buy ? `${buy.id} from ${cptyName(buy.cpty)}` : "from your tank"} · {sale ? `sells ${sale.id} to ${cptyName(sale.cpty)} (${sale.incoterm} ${sale.hub})` : "no sale yet: discharges into tank"}
              </div>
              <div className="sub">
                load {day(v.arriveLoad)}
                {v.arriveDisch ? ` · discharge ${day(v.arriveDisch)}` : ` · ~${v.sailDays}d at sea`} · port hours {v.portHours.toFixed(0)}/{v.laytimeHours} laytime · demurrage ${(v.demurrageRate / 1e3).toFixed(0)}k/day
                {v.divertedFrom ? ` · diverted from ${v.divertedFrom}` : ""}
              </div>
              {v.status === "sailing" && <DivertControl game={game} v={v} act={act} />}
            </div>
          );
        })}
      </Section>
      <Section title="Cargo in tank" count={tanks.length}>
        {tanks.length === 0 && <div className="empty">Nothing in storage.</div>}
        {tanks.map((c) => (
          <div className="item" key={c.id}>
            <b>{c.id}</b> {kbbl(c.qty)} {c.product} at {c.hub}, since {day(c.sinceDay)}
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
      </Section>
      <Section title="Hedges and exposure" count={game.book.futures.length}>
        <Hedge game={game} act={act} />
        <h4>Exposure by price component</h4>
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
      </Section>
      <Section title="Storage">
        <Storage game={game} act={act} />
      </Section>
      <Section title="Blending">
        <BlendPanel game={game} act={act} />
      </Section>
    </div>
  );
}
