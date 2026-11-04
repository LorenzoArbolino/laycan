import { Fragment, useState, type ReactNode } from "react";
import { PRICING_INFO, ROSTER, ROUTES, hubPrice, isoDate, perBbl, type Action, type Game, type HubId, type Offer, type Tender, type VoyageQuote } from "@laycan/engine";
import { kbbl, pricingLabel, px, range, shortDate, signed } from "../format";
import { Tips } from "./Tips";

const d = (x: number) => shortDate(isoDate(x));

interface RouteArb {
  routeId: string;
  to: HubId;
  q: VoyageQuote | null;
  freight: number;
  arb: number | null;
}

/** Every route out of an FOB purchase, with today's arb: destination − origin − premium − freight. */
function routeArbs(game: Game, o: Offer): RouteArb[] {
  if (o.playerSide !== "buy" || o.incoterm !== "FOB") return [];
  const m = game.market;
  return ROUTES.filter((r) => r.from === o.hub)
    .map((r) => {
      const q = game.quotes(r.id).filter((x) => x.feasible).sort((a, b) => a.allInPerTonne - b.allInPerTonne)[0] ?? null;
      if (!q) return { routeId: r.id, to: r.to, q: null, freight: 0, arb: null };
      const freight = perBbl(q, o.product);
      return { routeId: r.id, to: r.to, q, freight, arb: hubPrice(m, r.to, o.product) - hubPrice(m, o.hub, o.product) - o.pricing.diff - freight };
    })
    .sort((a, b) => (b.arb ?? -1e9) - (a.arb ?? -1e9));
}

function openVoyagesTo(game: Game, o: Offer) {
  if (o.playerSide !== "sell" || o.incoterm === "FOB" || o.incoterm === "ITT") return [];
  return game.book.voyages.filter((v) => v.to === o.hub && !v.saleId && v.status !== "done" && v.status !== "cancelled" && (!v.product || v.product === o.product));
}

function Negotiate({ o, act }: { o: Offer; act: (a: Action) => void }) {
  const step = o.playerSide === "buy" ? -0.25 : 0.25;
  const [diff, setDiff] = useState(Math.round((o.pricing.diff + step) * 100) / 100);
  if (o.agreed) return <span className="st ok">Price agreed: accept it</span>;
  return (
    <span className="form-row" style={{ alignItems: "center" }}>
      <input type="number" step={0.05} value={diff} onChange={(e) => setDiff(Number(e.target.value))} aria-label={`Counter for ${o.id}`} />
      <button className="btn small" onClick={() => act({ type: "counter", offerId: o.id, diff })} data-testid={`counter-${o.id}`}>
        Counter{o.rounds ? ` (round ${o.rounds + 1})` : ""}
      </button>
    </span>
  );
}

function OfferDetail({ game, o, act, routes }: { game: Game; o: Offer; act: (a: Action) => void; routes: RouteArb[] }) {
  const cp = ROSTER.find((c) => c.id === o.cpty);
  const rel = game.state.relations[o.cpty]?.score ?? 0;
  const m = game.market;
  const best = routes.find((r) => r.arb !== null);
  const voyages = openVoyagesTo(game, o);
  return (
    <div className="detail-grid">
      <div>
        {routes.length > 0 && (
          <>
            <div className="table-wrap">
              <table aria-label={`Routes for ${o.id}`}>
                <thead>
                  <tr>
                    <th>Route</th>
                    <th>Days</th>
                    <th>Freight $/bbl</th>
                    <th>Arb $/bbl</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {routes.map((r) => (
                    <tr key={r.routeId} className={r.q ? "" : "blocked"}>
                      <td>
                        <span className="code">{r.routeId}</span> → {r.to}
                        {r.q && r.q.via !== "direct" && <span className="dim"> via {r.q.via}</span>}
                      </td>
                      <td>{r.q ? r.q.ladenDays.toFixed(0) : "—"}</td>
                      <td>{r.q ? r.freight.toFixed(2) : "closed"}</td>
                      <td className={r.arb === null ? "" : r.arb >= 0 ? "ok" : "bad"}>{r.arb === null ? "" : signed(r.arb)}</td>
                      <td>{r.q && <button className="btn small" onClick={() => act({ type: "accept", offerId: o.id, charter: { routeId: r.routeId, via: r.q!.via } })}>Buy + ship</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {best && best.q && (
              <div className="calc" style={{ marginTop: 10 }} aria-label="Arb arithmetic">
                <span>{best.to} {o.product} today</span>
                <span className="v">{hubPrice(m, best.to, o.product).toFixed(2)}</span>
                <span>− {o.hub} {o.product} today</span>
                <span className="v">{px(-hubPrice(m, o.hub, o.product))}</span>
                <span>− premium</span>
                <span className="v">{px(-o.pricing.diff)}</span>
                <span>− freight, {best.q.cls} {best.q.ladenDays.toFixed(0)} days</span>
                <span className="v">{px(-best.freight)}</span>
                <span className="t">Arb today</span>
                <span className={`v t ${best.arb! >= 0 ? "ok" : "bad"}`}>{signed(best.arb!)}</span>
              </div>
            )}
          </>
        )}
        {o.playerSide === "sell" && (
          <div className="form-row">
            {voyages.map((v) => (
              <button key={v.id} className="btn small primary" onClick={() => act({ type: "accept", offerId: o.id, voyageId: v.id })}>
                Sell, deliver with <span className="code">{v.id}</span>
              </button>
            ))}
            <button className="btn small" onClick={() => act({ type: "accept", offerId: o.id })}>
              {o.incoterm === "FOB" || o.incoterm === "ITT" ? "Sell from your tank" : voyages.length ? "Sell, deliver later" : "Sell short, find a cargo"}
            </button>
          </div>
        )}
        {o.playerSide === "buy" && o.incoterm !== "FOB" && (
          <button className="btn small primary" onClick={() => act({ type: "accept", offerId: o.id })}>
            {o.incoterm === "ITT" ? "Buy in tank" : "Buy, delivered to your tank"}
          </button>
        )}
      </div>
      <div>
        <dl className="terms">
          <dt>Pricing</dt>
          <dd>
            {PRICING_INFO[o.pricing.kind]}
            {o.pricing.kind === "fixed" ? `: ${o.pricing.fixedPrice!.toFixed(2)}` : ""}, {signed(o.pricing.diff)} $/bbl
          </dd>
          <dt>Index today</dt>
          <dd>
            {hubPrice(m, o.hub, o.product).toFixed(2)} → indicative {o.indicative.toFixed(2)} $/bbl
          </dd>
          <dt>Payment</dt>
          <dd>{o.payment.kind === "LC" ? "letter of credit" : "open account"}, {o.payment.days} days</dd>
          <dt>Tolerance</dt>
          <dd>
            ±{o.tolPct}%, {o.tolHolder === "player" ? "your option" : "their option"}
          </dd>
          <dt>Counterparty</dt>
          <dd title={cp?.blurb}>
            {o.cptyName} · {cp?.rating ?? ""} · relationship {signed(rel)}
          </dd>
          <dt>Cargo</dt>
          <dd>{o.note}</dd>
        </dl>
        <div style={{ marginTop: 10 }}>
          <Negotiate key={`${o.id}-${o.rounds}-${o.pricing.diff}`} o={o} act={act} />
        </div>
      </div>
    </div>
  );
}

function OfferRow({ game, o, act, open, toggle }: { game: Game; o: Offer; act: (a: Action) => void; open: boolean; toggle: () => void }) {
  const cp = ROSTER.find((c) => c.id === o.cpty);
  const routes = routeArbs(game, o);
  const best = routes.find((r) => r.arb !== null);
  const voyages = openVoyagesTo(game, o);
  let where: string;
  let action: ReactNode;
  if (o.playerSide === "buy" && o.incoterm === "FOB") {
    where = best ? `→ ${best.to}, ${best.q!.ladenDays.toFixed(0)} d` : "routes closed";
    action = best ? (
      <button className={`btn small ${best.arb! > 0 ? "primary" : ""}`} onClick={(e) => (e.stopPropagation(), act({ type: "accept", offerId: o.id, charter: { routeId: best.routeId, via: best.q!.via } }))}>
        Buy + ship
      </button>
    ) : (
      <span className="dim">—</span>
    );
  } else if (o.playerSide === "buy") {
    where = o.incoterm === "ITT" ? "in tank" : "to your tank";
    action = (
      <button className="btn small" onClick={(e) => (e.stopPropagation(), act({ type: "accept", offerId: o.id }))}>
        Buy
      </button>
    );
  } else {
    where = o.incoterm === "FOB" || o.incoterm === "ITT" ? "from your tank" : voyages.length ? `with ${voyages[0]!.id}` : "needs a cargo";
    action = (
      <button className="btn small" onClick={(e) => (e.stopPropagation(), act(voyages.length ? { type: "accept", offerId: o.id, voyageId: voyages[0]!.id } : { type: "accept", offerId: o.id }))}>
        Sell
      </button>
    );
  }
  return (
    <Fragment>
      <tr className={`click ${open ? "sel" : ""}`} onClick={toggle} data-testid="offer" aria-expanded={open}>
        <td className={o.playerSide === "buy" ? "strong" : ""}>{o.playerSide === "buy" ? "Buy" : "Sell"}</td>
        <td className="l">
          {(o.qtyBbl / 1000).toFixed(0)} {o.product} {o.incoterm} {o.hub}
          <span className="sub">{range(d(o.laycan[0]), d(o.laycan[1]))}</span>
        </td>
        <td className="l" title={PRICING_INFO[o.pricing.kind]}>
          {pricingLabel(o.pricing)} {signed(o.pricing.diff)}
          <span className="sub">
            {o.cptyName.replace(/ (Co\.|Ltd)$/, "")} · {cp?.rating}
          </span>
        </td>
        <td className="l dim">{where}</td>
        <td className={best ? (best.arb! >= 0 ? "ok strong" : "bad") : ""}>{best ? signed(best.arb!) : ""}</td>
        <td>{action}</td>
      </tr>
      {open && (
        <tr className="detail">
          <td colSpan={6}>
            <OfferDetail game={game} o={o} act={act} routes={routes} />
          </td>
        </tr>
      )}
    </Fragment>
  );
}

export function OffersPanel({ game, act, hub, clearHub }: { game: Game; act: (a: Action) => void; hub: HubId | null; clearHub: () => void }) {
  const [want, setWant] = useState({ side: "buy" as "buy" | "sell", product: "diesel" as "diesel" | "gasoline" | "jet", hub: "USGC" as HubId, incoterm: "FOB" as "FOB" | "DES" | "ITT" });
  const offers = game.state.offers.filter((o) => !hub || o.hub === hub);
  const [openId, setOpenId] = useState<string | null>(null);
  const current = openId && offers.some((o) => o.id === openId) ? openId : (offers[0]?.id ?? null);
  return (
    <div>
      <Tips
        id="offers"
        tips={[
          <>Click a row for its routes, the arb arithmetic, terms and a counter-offer. Arb = destination − origin − premium − freight at today's prices; the deal prices later, so the arb you see is not the arb you get.</>,
          <>
            <b>Where title passes.</b> FOB: at the load port, onto a ship you charter. DES: on arrival at the buyer's port, so you must land a cargo there inside the buyer's laycan. ITT: inside a tank at the hub.
          </>,
          <>
            <b>Line up the laycans.</b> Loading date + sailing days + a few days of slack must fall inside the sale's laycan. Late: $0.50/bbl. No delivery: $3/bbl.
          </>,
          <>
            <b>Match the quantities.</b> A sale must be filled within its tolerance (usually ±5%); a smaller cargo means a short-delivery penalty.
          </>,
          <>
            <b>Price risk starts when the price fixes.</b> Fixed price: from today. Floating: only during its pricing window. Hedge what is priced, in the month it prices.
          </>,
          <>
            <b>Negotiate.</b> Patient counterparties meet you halfway, impatient ones walk. Tenders are sealed bids: bid what the cargo is worth to you.
          </>,
          <>
            <b>Wait for the green.</b> Prices sit just inside freight parity, so most routes lose most weeks. Trade only when the arb covers freight, financing and a margin.
          </>,
        ]}
      />
      {hub && (
        <div className="filter">
          Showing {hub} only
          <button className="btn small link" onClick={clearHub}>
            Show all
          </button>
        </div>
      )}
      <Tenders game={game} act={act} />
      {offers.length === 0 ? (
        <div className="empty">No offers left this week. Request a quote, or go to next week.</div>
      ) : (
        <div className="table-wrap">
          <table aria-label="Offers and bids">
            <thead>
              <tr>
                <th>You</th>
                <th className="l">Cargo, kbbl · laycan</th>
                <th className="l">Pricing, $/bbl · counterparty</th>
                <th className="l">Route</th>
                <th>Arb $/bbl</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {offers.map((o) => (
                <OfferRow key={o.id} game={game} o={o} act={act} open={current === o.id} toggle={() => setOpenId(current === o.id ? "" : o.id)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <details style={{ marginTop: 12 }}>
        <summary>Request a quote (wider spread: you show your hand)</summary>
        <div className="form-row" style={{ marginTop: 8 }}>
          <label className="field">
            Side
            <select value={want.side} onChange={(e) => setWant({ ...want, side: e.target.value as "buy" | "sell" })}>
              <option value="buy">I buy</option>
              <option value="sell">I sell</option>
            </select>
          </label>
          <label className="field">
            Product
            <select value={want.product} onChange={(e) => setWant({ ...want, product: e.target.value as "diesel" })}>
              {["gasoline", "diesel", "jet"].map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <label className="field">
            Hub
            <select value={want.hub} onChange={(e) => setWant({ ...want, hub: e.target.value as HubId })}>
              {["USGC", "NYH", "ARA", "WAF", "MEG", "FUJ", "SIN", "JPN"].map((h) => (
                <option key={h}>{h}</option>
              ))}
            </select>
          </label>
          <label className="field">
            Terms
            <select value={want.incoterm} onChange={(e) => setWant({ ...want, incoterm: e.target.value as "FOB" | "DES" })}>
              <option>FOB</option>
              <option>DES</option>
              <option>ITT</option>
            </select>
          </label>
          <button className="btn" onClick={() => act({ type: "quote", ...want })}>
            Request quote
          </button>
        </div>
      </details>
    </div>
  );
}

function TenderRow({ t, game, act }: { t: Tender; game: Game; act: (a: Action) => void }) {
  const [bid, setBid] = useState(t.bid ?? (t.playerSide === "sell" ? 0.6 : -0.2));
  return (
    <tr data-testid="tender">
      <td className="l wrap">
        <span className="strong">{t.cptyName}</span> {t.playerSide === "sell" ? "buys" : "sells"} {kbbl(t.qtyBbl)} {t.product} {t.incoterm} {t.hub}
        <span className="sub">
          laycan from {d(t.laycan[0])} · closes {d(t.closeDay)} · {t.competitors} sealed bids · {t.playerSide === "sell" ? "lowest premium wins" : "highest premium wins"} · index {hubPrice(game.market, t.hub, t.product).toFixed(2)}
        </span>
      </td>
      <td>
        <input type="number" step={0.05} value={bid} onChange={(e) => setBid(Number(e.target.value))} aria-label={`Bid for ${t.id}`} />
      </td>
      <td>
        <button className="btn small" onClick={() => act({ type: "tenderBid", tenderId: t.id, diff: bid })}>
          {t.bid !== undefined ? `Update (now ${signed(t.bid)})` : "Submit bid"}
        </button>
      </td>
    </tr>
  );
}

function Tenders({ game, act }: { game: Game; act: (a: Action) => void }) {
  const open = game.state.tenders.filter((t) => t.status === "open");
  const done = game.state.tenders.filter((t) => t.status === "won" || t.status === "lost").slice(-3);
  if (!open.length && !done.length) return null;
  return (
    <div style={{ marginBottom: 14 }}>
      <div className="section-title">
        <h3>Tenders</h3>
        <span className="note">sealed bids, premium vs index $/bbl</span>
      </div>
      <div className="table-wrap">
        <table aria-label="Tenders">
          <tbody>
            {open.map((t) => (
              <TenderRow key={t.id} t={t} game={game} act={act} />
            ))}
            {done.map((t) => (
              <tr key={t.id}>
                <td className="l wrap dim" colSpan={3}>
                  <span className={`st ${t.status === "won" ? "ok" : ""}`}>
                    {t.status === "won" ? "Won" : "Lost"}: {t.cptyName} {t.product} {t.hub} at {signed(t.bid ?? 0)} (best other {signed(t.winning ?? 0)})
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
