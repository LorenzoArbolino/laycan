import { useCallback, useEffect, useRef, useState } from "react";
import { EPISODES, Game, assumptionRows, type Action, type HubId, type NewsItem } from "@laycan/engine";
import { MarketPanel } from "./components/MarketPanel";
import { OffersPanel } from "./components/OffersPanel";
import { BookPanel } from "./components/BookPanel";
import { PnlPanel } from "./components/PnlPanel";
import { WorldMap } from "./components/WorldMap";
import { CounterpartiesPanel } from "./components/Counterparties";
import { Manual } from "./components/Manual";
import { cls, money } from "./format";

const SAVE_KEY = "laycan-save-v1";

function load(): Game | null {
  try {
    const s = localStorage.getItem(SAVE_KEY);
    return s ? Game.fromJSON(s) : null;
  } catch {
    return null;
  }
}
function save(g: Game | null) {
  try {
    if (g) localStorage.setItem(SAVE_KEY, g.toJSON());
    else localStorage.removeItem(SAVE_KEY);
  } catch {
    /* storage unavailable: play without saving */
  }
}

function seedFromUrl(): string | null {
  try {
    return new URLSearchParams(location.search).get("seed");
  } catch {
    return null;
  }
}

function StartScreen({ onStart, resume, onManual }: { onStart: (scenario: string, seed: string, weeks?: number) => void; resume: Game | null; onManual: () => void }) {
  // weeks = 0: open-ended (generated markets only)
  const [scenario, setScenario] = useState("generated");
  const [weeks, setWeeks] = useState(0);
  const episode = EPISODES.find((e) => e.id === scenario);
  const episodeWeeks = episode ? Game.scenarioFor(episode.id, "x").weeks : weeks;
  const [seed, setSeed] = useState(seedFromUrl() ?? String(Math.floor(Math.random() * 1e6)));
  const card = (id: string, title: string, body: string, extra = "") => (
    <button key={id} className={`card ${extra} ${scenario === id ? "selected" : ""}`} onClick={() => setScenario(id)} data-testid={`scenario-${id}`}>
      <h3>{title}</h3>
      <p>{body}</p>
    </button>
  );
  return (
    <div className="start">
      <h1>Laycan</h1>
      <p className="lede">
        Run a physical refined-products book. Buy and sell cargoes of gasoline, diesel and jet, charter tankers, store product, hedge with futures, and find out where the money really comes from: freight, timing, pricing
        windows, optionality and things going wrong.
      </p>
      <div className="modes">
        <div>
          <div className="mode-title">
            <h2>Generated market</h2>
            <small>a realistic world with no real date or prices: every seed is a new market</small>
          </div>
          <div className="cards">{card("generated", "Generated market", "Regime, prices, freight, inventories and chokepoints drawn from the model calibrated on 20 years of data, then run forward. Share the seed to play the same world.", "hero")}</div>
        </div>
        <div>
          <div className="mode-title">
            <h2>Historical replay</h2>
            <small>real US benchmark prices and stocks day by day; the rest of the world is modelled around them</small>
          </div>
          <div className="cards">{EPISODES.map((e) => card(e.id, e.name, `${e.teaser} (${Game.scenarioFor(e.id, "x").weeks} weeks)`))}</div>
        </div>
      </div>
      <div className="form-row" style={{ marginTop: 16 }}>
        <label className="field">
          Seed (same seed, same market)
          <input value={seed} onChange={(e) => setSeed(e.target.value)} aria-label="Seed" />
        </label>
        {scenario === "generated" && (
          <label className="field">
            Duration
            <select value={weeks} onChange={(e) => setWeeks(Number(e.target.value))} aria-label="Duration">
              <option value={0}>Unlimited</option>
              {[8, 12, 26, 52].map((w) => (
                <option key={w} value={w}>
                  {w} weeks{w === 52 ? " (a year)" : ""}
                </option>
              ))}
            </select>
          </label>
        )}
        <button className="btn" onClick={onManual} data-testid="start-manual">
          Read the manual
        </button>
        <button className="btn primary" onClick={() => onStart(scenario, seed, scenario === "generated" ? weeks : undefined)} data-testid="start">
          {scenario === "generated" && weeks === 0 ? "Start unlimited game" : `Start ${episodeWeeks}-week game`}
        </button>
        {resume && !resume.over && (
          <button className="btn" onClick={() => onStart("", "")}>
            Resume saved game ({resume.scenario.name.split(" —")[0]}, {resume.displayDate()})
          </button>
        )}
      </div>
      <div className="howto">
        <div>
          <b>1. Read the map.</b> Hub prices are Brent + the US Gulf crack + a regional differential. Green routes are where the spread beats freight today; diamonds are chokepoints.
        </div>
        <div>
          <b>2. Trade the arb.</b> Buy FOB where product is cheap, charter a ship, sell delivered where it is dear. It prices later, around the bill-of-lading date, so the arb you see is not the arb you get.
        </div>
        <div>
          <b>3. Store when the curve pays.</b> Lease tanks, buy prompt in-tank parcels and sell the curve forward when contango beats rent plus interest.
        </div>
        <div>
          <b>4. Hedge what is priced, and survive.</b> Floating purchases carry no price risk until they fix. Ships are delayed, cargoes go off-spec, chokepoints close, buyers default.
        </div>
      </div>
    </div>
  );
}

function News({ items, game }: { items: NewsItem[]; game: Game }) {
  return (
    <section className="panel col-3" aria-label="News">
      <div className="panel-head">
        <h2>News &amp; alerts</h2>
      </div>
      <div className="news">
        {[...items].reverse().slice(0, 60).map((n, i) => (
          <div key={i} className={`news-item ${n.severity}`}>
            <span className="muted">{game.displayDate(n.day).replace(/,? (Year \d+|\d{4})$/, "")}</span> <span className="t">{n.title}</span>
            {n.body && <div>{n.body}</div>}
          </div>
        ))}
      </div>
    </section>
  );
}

function Assumptions({ onClose }: { onClose: () => void }) {
  const rows = assumptionRows();
  const [filter, setFilter] = useState("");
  const shown = rows.filter((r) => (r.section + r.path + r.source).toLowerCase().includes(filter.toLowerCase()));
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Assumptions">
        <div className="panel-head">
          <h2>Assumptions sheet ({rows.length} parameters)</h2>
          <button className="btn small" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="muted" style={{ fontSize: 13 }}>
          Every number the engine uses. <span className="badge data">data</span> observed public value · <span className="badge derived">derived</span> fitted from data · <span className="badge estimate">estimate</span> informed
          assumption for review.
        </p>
        <input placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: "100%", marginBottom: 8 }} />
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Parameter</th>
                <th>Value</th>
                <th>Label</th>
                <th style={{ textAlign: "left" }}>Source / method</th>
              </tr>
            </thead>
            <tbody>
              {shown.slice(0, 400).map((r) => (
                <tr key={r.section + r.path}>
                  <td style={{ whiteSpace: "normal" }}>
                    <small>{r.section}</small>
                    <div>{r.path}</div>
                  </td>
                  <td className="num" style={{ whiteSpace: "normal", maxWidth: 220, wordBreak: "break-word" }}>
                    {r.value} <small>{r.unit}</small>
                  </td>
                  <td>
                    <span className={`badge ${r.label}`}>{r.label}</span>
                  </td>
                  <td className="src">
                    {r.source}
                    <div className="muted">{r.method}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function App() {
  const gameRef = useRef<Game | null>(null);
  const [saved] = useState<Game | null>(() => load());
  const [, setVersion] = useState(0);
  const [tab, setTab] = useState<"offers" | "book" | "cpty">("offers");
  const [hub, setHub] = useState<HubId | null>(null);
  const [toast, setToast] = useState<{ text: string; err: boolean } | null>(null);
  const [showAssumptions, setShowAssumptions] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  const g = gameRef.current;

  const start = (scenario: string, seed: string, weeks?: number) => {
    gameRef.current = scenario ? Game.create({ scenario, seed, weeks: weeks || undefined, openEnded: weeks === 0 }) : saved;
    save(gameRef.current);
    refresh();
  };

  const act = (a: Action) => {
    if (!gameRef.current) return;
    const r = gameRef.current.act(a);
    setToast({ text: r.message, err: !r.ok });
    if (r.ok && a.type === "accept") setTab("book");
    if (a.type === "counter" || a.type === "tenderBid") setTab("offers");
    save(gameRef.current);
    refresh();
  };

  const next = () => {
    if (!gameRef.current) return;
    setBusy(true);
    setTimeout(() => {
      gameRef.current!.advance();
      save(gameRef.current);
      setBusy(false);
      setTab("offers");
      refresh();
    }, 0);
  };

  if (!g)
    return (
      <>
        <StartScreen onStart={start} resume={saved} onManual={() => setShowManual(true)} />
        {showManual && <Manual onClose={() => setShowManual(false)} />}
      </>
    );

  const s = g.score();
  const openEnded = !!g.state.openEnded;
  const totalWeeks = openEnded ? Infinity : Math.round((g.state.endDay - g.state.startDay) / 7);
  const week = Math.min(totalWeeks, Math.floor((g.day - g.state.startDay) / 7) + 1);
  const b = g.breakdown();
  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">LAYCAN</span>
        <div className="kpi">
          <span className="label">Date</span>
          <span className="value" data-testid="date">
            {g.displayDate()}
          </span>
        </div>
        <div className="kpi">
          <span className="label">Week</span>
          <span className="value" data-testid="week">{g.over ? "done" : openEnded ? `${week}` : `${week}/${totalWeeks}`}</span>
        </div>
        <div className="kpi">
          <span className="label">Equity</span>
          <span className="value">{money(b.total)}</span>
        </div>
        <div className="kpi">
          <span className="label">P&amp;L</span>
          <span className={`value ${cls(s.pnl)}`}>{money(s.pnl)}</span>
        </div>
        <div className="kpi">
          <span className="label">Cash / credit</span>
          <span className="value">
            {money(b.cash, 1)} / {money(g.creditLimit(), 0)}
          </span>
        </div>
        <div className="kpi">
          <span className="label">Mode</span>
          <span className="value" style={{ fontSize: 12, fontFamily: "var(--sans)" }}>
            {g.scenario.kind === "historical" ? "Replay" : "Generated"}
          </span>
        </div>
        <div className="kpi">
          <span className="label">Regime</span>
          <span className={`badge ${g.market.regime}`}>{g.market.regime}</span>
        </div>
        <div className="spacer" />
        <button className="btn small" onClick={() => setShowManual(true)} data-testid="manual">
          Manual
        </button>
        <button className="btn small" onClick={() => setShowAssumptions(true)}>
          Assumptions
        </button>
        <button
          className="btn small"
          onClick={() => {
            save(null);
            gameRef.current = null;
            refresh();
          }}
        >
          New game
        </button>
        {openEnded && !g.over && (
          <button
            className="btn small"
            data-testid="end-game"
            onClick={() => {
              if (!confirm("End the game now and see your score? Open positions stay valued at today's marks.")) return;
              gameRef.current!.end();
              save(gameRef.current);
              refresh();
            }}
          >
            End game
          </button>
        )}
        <button className="btn primary" onClick={next} disabled={g.over || busy} data-testid="next">
          {g.over ? (openEnded ? "Game over" : "Scenario complete") : busy ? "Running…" : "Next week ▶"}
        </button>
      </header>

      {g.over && (
        <section className="panel" style={{ marginTop: 12 }}>
          <h2>{openEnded ? "Game over" : "Scenario complete"}</h2>
          <p>
            Return <b className={cls(s.returnPct)}>{s.returnPct.toFixed(1)}%</b> · max drawdown {money(s.maxDrawdown)} · risk-adjusted score <b>{s.riskAdjusted.toFixed(2)}</b> · {s.varBreachDays} days over VaR limit ·{" "}
            {s.liquidityBreachDays} credit breaches{openEnded ? ` over ${week - 1} weeks` : ""}. Seed <code>{g.state.seed}</code>: replay it, or try another market with the same strategy.
          </p>
        </section>
      )}

      <main className="grid2">
        <div className="col">
          <MarketPanel game={g} />
        </div>
        <div className="col center">
          <WorldMap game={g} selectedHub={hub} onHub={(h) => { setHub(h); setTab("offers"); }} />
          <section className="panel">
            <div className="tabs" role="tablist">
              <button role="tab" aria-selected={tab === "offers"} className={`tab ${tab === "offers" ? "active" : ""}`} onClick={() => setTab("offers")}>
                Offers &amp; bids <span className="count">{g.state.offers.length}</span>
              </button>
              <button role="tab" aria-selected={tab === "book"} className={`tab ${tab === "book" ? "active" : ""}`} onClick={() => setTab("book")} data-testid="tab-book">
                Book, storage &amp; hedges <span className="count">{g.openPositions().deals.length + g.openPositions().voyages.length + g.book.futures.length}</span>
              </button>
              <button role="tab" aria-selected={tab === "cpty"} className={`tab ${tab === "cpty" ? "active" : ""}`} onClick={() => setTab("cpty")} data-testid="tab-cpty">
                Counterparties
              </button>
            </div>
            {tab === "offers" ? <OffersPanel game={g} act={act} hub={hub} clearHub={() => setHub(null)} /> : tab === "book" ? <BookPanel game={g} act={act} /> : <CounterpartiesPanel game={g} />}
          </section>
        </div>
        <div className="col">
          <PnlPanel game={g} />
          <News items={g.state.news} game={g} />
        </div>
      </main>
      {toast && <div className={`toast ${toast.err ? "err" : ""}`}>{toast.text}</div>}
      {showAssumptions && <Assumptions onClose={() => setShowAssumptions(false)} />}
      {showManual && <Manual onClose={() => setShowManual(false)} />}
    </div>
  );
}
