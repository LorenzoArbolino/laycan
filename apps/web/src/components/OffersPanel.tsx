import { useState } from "react";
import { PRICING_INFO, ROUTES, hubPrice, isoDate, perBbl, type Action, type Game, type HubId, type Offer } from "@laycan/engine";
import { kbbl, shortDate, signed } from "../format";

function OfferCard({ game, o, act }: { game: Game; o: Offer; act: (a: Action) => void }) {
  const m = game.market;
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
        {pr} {signed(o.pricing.diff)} $/bbl · {o.payment.kind === "LC" ? "letter of credit" : "open account"} · ±{o.tolPct}% ({o.tolHolder === "player" ? "your option" : "their option"}) · {o.cptyName}
        <div className="muted">
          Index today {hubPrice(m, o.hub, o.product).toFixed(2)} → indicative {o.indicative.toFixed(2)} $/bbl. {o.note}.
        </div>
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
