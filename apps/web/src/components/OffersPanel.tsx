import { useState } from "react";
import { useState as useLocalState } from "react";
import { PRICING_INFO, ROSTER, ROUTES, hubPrice, isoDate, perBbl, type Action, type Game, type HubId, type Offer, type Tender } from "@laycan/engine";
import { kbbl, shortDate, signed } from "../format";

function Negotiate({ o, act }: { o: Offer; act: (a: Action) => void }) {
  const step = o.playerSide === "buy" ? -0.25 : 0.25;
  const [diff, setDiff] = useLocalState(Math.round((o.pricing.diff + step) * 100) / 100);
  if (o.agreed) return <span className="badge data">price agreed: take it</span>;
  return (
    <span className="form-row" style={{ display: "inline-flex", gap: 6 }}>
      <input type="number" step={0.05} value={diff} onChange={(e) => setDiff(Number(e.target.value))} style={{ width: 80 }} aria-label={`Counter for ${o.id}`} />
      <button className="btn small" onClick={() => act({ type: "counter", offerId: o.id, diff })} data-testid={`counter-${o.id}`}>
        Counter{o.rounds ? ` (round ${o.rounds + 1})` : ""}
      </button>
    </span>
  );
}

function OfferCard({ game, o, act }: { game: Game; o: Offer; act: (a: Action) => void }) {
  const m = game.market;
  const cp = ROSTER.find((c) => c.id === o.cpty);
  const rel = game.state.relations[o.cpty]?.score ?? 0;
  const routes = o.playerSide === "buy" && o.incoterm === "FOB" ? ROUTES.filter((r) => r.from === o.hub) : [];
  const openVoyages = o.playerSide === "sell" && o.incoterm !== "FOB" && o.incoterm !== "ITT" ? game.book.voyages.filter((v) => v.to === o.hub && !v.saleId && v.status !== "done" && v.status !== "cancelled" && (!v.product || v.product === o.product)) : [];
  const pr = o.pricing.kind === "fixed" ? `fixed ${o.pricing.fixedPrice!.toFixed(2)}` : o.pricing.kind === "month" ? `month avg` : o.pricing.kind === "bl5" ? "5 quotes around B/L" : "5 quotes after B/L";
  return (
    <div className={`offer ${o.playerSide}`} data-testid="offer">
      <div className="offer-head">
        <span className="side" style={{ color: o.playerSide === "buy" ? "var(--phys)" : "var(--paper)" }}>
          YOU {o.playerSide.toUpperCase()}
        </span>
        <b>
          {kbbl(o.qtyBbl)} {o.product}
        </b>
        <span>
          {o.incoterm} {o.hub}
        </span>
        <span className="muted">
          laycan {shortDate(isoDate(o.laycan[0]))}–{shortDate(isoDate(o.laycan[1]))}
        </span>
      </div>
      <div className="meta" title={PRICING_INFO[o.pricing.kind]}>
        {pr} <b>{signed(o.pricing.diff)}</b> $/bbl · {o.payment.kind === "LC" ? "letter of credit" : "open account"} · ±{o.tolPct}% ({o.tolHolder === "player" ? "your option" : "their option"}) · {o.cptyName}{" "}
        {cp && (
          <span className={`badge ${cp.rating === "A" ? "data" : cp.rating === "BBB" ? "derived" : "estimate"}`} title={`${cp.blurb} Relationship ${rel >= 0 ? "+" : ""}${rel.toFixed(2)}.`}>
            {cp.rating}
          </span>
        )}
        <div className="muted">
          Index today {hubPrice(m, o.hub, o.product).toFixed(2)} → indicative {o.indicative.toFixed(2)} $/bbl. {o.note}.
        </div>
      </div>
      <div style={{ marginTop: 6 }}>
        <Negotiate key={`${o.id}-${o.rounds}-${o.pricing.diff}`} o={o} act={act} />
      </div>
      {routes.length > 0 && (
        <div className="routes">
          {routes.map((r) => {
            const qs = game.quotes(r.id).filter((q) => q.feasible);
            const q = qs.sort((a, b) => a.allInPerTonne - b.allInPerTonne)[0];
            if (!q) {
              return (
                <div className="route-row" key={r.id}>
                  <b>{r.id}</b>
                  <span className="muted">to {r.to}: route closed</span>
                  <span />
                </div>
              );
            }
            const arb = hubPrice(m, r.to, o.product) - hubPrice(m, o.hub, o.product) - o.pricing.diff - perBbl(q, o.product);
            return (
              <div className="route-row" key={r.id}>
                <b>
                  {r.id} → {r.to}
                </b>
                <span>
                  freight {perBbl(q, o.product).toFixed(2)} $/bbl ({q.ladenDays.toFixed(0)}d via {q.via}) · arb today{" "}
                  <span className={`arb ${arb >= 0 ? "pos" : "neg"}`}>{signed(arb)}</span>
                </span>
                <button className="btn small primary" onClick={() => act({ type: "accept", offerId: o.id, charter: { routeId: r.id, via: q.via } })}>
                  Buy + ship
                </button>
              </div>
            );
          })}
        </div>
      )}
      {o.playerSide === "sell" && (
        <div className="form-row" style={{ marginTop: 8 }}>
          {openVoyages.map((v) => (
            <button key={v.id} className="btn small primary" onClick={() => act({ type: "accept", offerId: o.id, voyageId: v.id })}>
              Sell, deliver with {v.id}
            </button>
          ))}
          <button className="btn small" onClick={() => act({ type: "accept", offerId: o.id })}>
            {o.incoterm === "FOB" || o.incoterm === "ITT" ? "Sell from your tank" : openVoyages.length ? "Sell (deliver later)" : "Sell short (find a cargo)"}
          </button>
        </div>
      )}
      {o.playerSide === "buy" && o.incoterm !== "FOB" && (
        <div className="form-row" style={{ marginTop: 8 }}>
          <button className="btn small primary" onClick={() => act({ type: "accept", offerId: o.id })}>
            {o.incoterm === "ITT" ? "Buy in tank" : "Buy (delivered to your tank)"}
          </button>
        </div>
      )}
    </div>
  );
}

export function OffersPanel({ game, act, hub, clearHub }: { game: Game; act: (a: Action) => void; hub: HubId | null; clearHub: () => void }) {
  const [want, setWant] = useState({ side: "buy" as "buy" | "sell", product: "diesel" as const as "diesel" | "gasoline" | "jet", hub: "USGC" as "USGC", incoterm: "FOB" as "FOB" | "DES" | "ITT" });
  const offers = game.state.offers.filter((o) => !hub || o.hub === hub);
  return (
    <div>
      <p className="hint">
        Counterparties offer cargoes (you buy) and bid for them (you sell). Prices float on the hub index plus a premium or discount. For each FOB purchase the arb shows destination − origin − premium − freight at today's prices; pricing
        happens later, so the real outcome will differ. ITT = in-tank transfer: a prompt parcel inside a terminal, the raw material of storage plays.
      </p>
      {hub && (
        <span className="filter-chip">
          Showing {hub} only{" "}
          <button className="btn small" onClick={clearHub}>
            show all
          </button>
        </span>
      )}
      <Tenders game={game} act={act} />
      {offers.length === 0 && <div className="empty">No offers left this week. Ask for a quote or advance to next week.</div>}
      {offers.map((o) => (
        <OfferCard key={o.id} game={game} o={o} act={act} />
      ))}
      <details>
        <summary>Ask the market for a quote (wider spread: you show your hand)</summary>
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
            <select value={want.hub} onChange={(e) => setWant({ ...want, hub: e.target.value as "USGC" })}>
              {["USGC", "NYH", "ARA", "WAF", "MEG", "FUJ", "SIN"].map((h) => (
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
  const [bid, setBid] = useLocalState(t.bid ?? (t.playerSide === "sell" ? 0.6 : -0.2));
  return (
    <div className="offer sell" data-testid="tender">
      <div className="offer-head">
        <span className="side" style={{ color: "var(--warn)" }}>TENDER</span>
        <b>
          {t.cptyName} {t.playerSide === "sell" ? "buys" : "sells"} {(t.qtyBbl / 1000).toFixed(0)} kbbl {t.product}
        </b>
        <span>
          {t.incoterm} {t.hub}
        </span>
        <span className="muted">closes {isoDate(t.closeDay)} · laycan {isoDate(t.laycan[0]).slice(5)}</span>
      </div>
      <div className="meta">
        Sealed bids, {t.competitors} competitors. {t.playerSide === "sell" ? "The lowest premium over the index wins." : "The highest premium over the index wins."} Index today {hubPrice(game.market, t.hub, t.product).toFixed(2)} $/bbl.
      </div>
      <div className="form-row" style={{ marginTop: 6 }}>
        <input type="number" step={0.05} value={bid} onChange={(e) => setBid(Number(e.target.value))} style={{ width: 80 }} aria-label={`Bid for ${t.id}`} />
        <button className="btn small primary" onClick={() => act({ type: "tenderBid", tenderId: t.id, diff: bid })}>
          {t.bid !== undefined ? `Update bid (now ${signed(t.bid)})` : "Submit bid"}
        </button>
      </div>
    </div>
  );
}

function Tenders({ game, act }: { game: Game; act: (a: Action) => void }) {
  const open = game.state.tenders.filter((t) => t.status === "open");
  const done = game.state.tenders.filter((t) => t.status === "won" || t.status === "lost").slice(-3);
  if (!open.length && !done.length) return null;
  return (
    <div style={{ marginBottom: 8 }}>
      {open.map((t) => (
        <TenderRow key={t.id} t={t} game={game} act={act} />
      ))}
      {done.map((t) => (
        <div key={t.id} className="muted" style={{ fontSize: 12 }}>
          Tender {t.cptyName} {t.product} {t.hub}: {t.status === "won" ? "won" : "lost"} at {signed(t.bid ?? 0)} (best competitor {signed(t.winning ?? 0)})
        </div>
      ))}
    </div>
  );
}
