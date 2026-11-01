import { useCallback, useEffect, useRef, useState } from "react";
import { Game, SCENARIOS, assumptionRows, isoDate, type Action, type NewsItem } from "@laycan/engine";
import { MarketPanel } from "./components/MarketPanel";
import { OffersPanel } from "./components/OffersPanel";
import { BookPanel } from "./components/BookPanel";
import { PnlPanel } from "./components/PnlPanel";
import { cls, money, shortDate } from "./format";

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

function StartScreen({ onStart, resume }: { onStart: (scenario: string, seed: string) => void; resume: Game | null }) {
  const [scenario, setScenario] = useState("now_2026_11");
  const [seed, setSeed] = useState(seedFromUrl() ?? String(Math.floor(Math.random() * 1e6)));
  return (
    <div className="start">
      <h1>Laycan</h1>
      <p className="lede">
        Run a physical refined-products book. Buy and sell cargoes of gasoline, diesel and jet, charter tankers, hedge with futures, and find out where the money really comes from: freight, timing, pricing windows, optionality and
        things going wrong.
      </p>
      <div className="cards">
        {Object.values(SCENARIOS).map((s) => (
          <button key={s.id} className={`card ${scenario === s.id ? "selected" : ""}`} onClick={() => setScenario(s.id)} data-testid={`scenario-${s.id}`}>
            <h3>{s.name}</h3>
            <p>{s.description}</p>
          </button>
        ))}
      </div>
      <div className="form-row" style={{ marginTop: 16 }}>
        <label className="field">
          Seed (share it: the same seed gives the same market)
          <input value={seed} onChange={(e) => setSeed(e.target.value)} aria-label="Seed" />
        </label>
        <button className="btn primary" onClick={() => onStart(scenario, seed)} data-testid="start">
          Start 12-week game
        </button>
        {resume && !resume.over && (
          <button className="btn" onClick={() => onStart("", "")}>
            Resume saved game ({resume.scenario.name.split(" —")[0]}, {shortDate(isoDate(resume.day))})
          </button>
        )}
      </div>
      <div className="howto">
        <div>
          <b>1. Read the market.</b> Hub prices are Brent + the US Gulf crack + a regional differential. Differentials sit near freight parity: importers above, exporters below.
        </div>
        <div>
          <b>2. Find an arb.</b> Buy FOB where product is cheap, charter a ship, sell delivered where it is dear. It only pays if the spread beats freight, and it prices later, around the bill-of-lading date.
        </div>
        <div>
          <b>3. Hedge what is priced.</b> A floating purchase has no price risk until its window fixes. Hedge too early and you are short. Futures cost margin, and in backwardation shorts bleed.
        </div>
        <div>
          <b>4. Survive.</b> Ships are delayed, cargoes arrive off-spec, chokepoints close, buyers default. Stay inside your VaR limit and credit line. Every dollar of P&amp;L is explained at the end.
        </div>
      </div>
    </div>
  );
}

function News({ items }: { items: NewsItem[] }) {
  return (
    <section className="panel col-3" aria-label="News">
      <div className="panel-head">
        <h2>News &amp; alerts</h2>
      </div>
      <div className="news">
        {[...items].reverse().slice(0, 60).map((n, i) => (
          <div key={i} className={`news-item ${n.severity}`}>
            <span className="muted">{shortDate(isoDate(n.day))}</span> <span className="t">{n.title}</span>
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
  const [tab, setTab] = useState<"offers" | "book">("offers");
  const [toast, setToast] = useState<{ text: string; err: boolean } | null>(null);
  const [showAssumptions, setShowAssumptions] = useState(false);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  const g = gameRef.current;

  const start = (scenario: string, seed: string) => {
    gameRef.current = scenario ? Game.create({ scenario, seed }) : saved;
    save(gameRef.current);
    refresh();
  };

  const act = (a: Action) => {
    if (!gameRef.current) return;
    const r = gameRef.current.act(a);
    setToast({ text: r.message, err: !r.ok });
    if (r.ok && a.type === "accept") setTab("book");
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

  if (!g) return <StartScreen onStart={start} resume={saved} />;

  const s = g.score();
  const week = Math.min(12, Math.floor((g.day - g.state.startDay) / 7) + 1);
  const b = g.breakdown();
  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">LAYCAN</span>
        <div className="kpi">
          <span className="label">Date</span>
          <span className="value" data-testid="date">
            {isoDate(g.day)}
          </span>
        </div>
        <div className="kpi">
          <span className="label">Week</span>
          <span className="value">{g.over ? "done" : `${week}/12`}</span>
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
          <span className="label">Regime</span>
          <span className={`badge ${g.market.regime}`}>{g.market.regime}</span>
        </div>
        <div className="spacer" />
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
        <button className="btn primary" onClick={next} disabled={g.over || busy} data-testid="next">
          {g.over ? "Scenario complete" : busy ? "Running…" : "Next week ▶"}
        </button>
      </header>

      {g.over && (
        <section className="panel" style={{ marginTop: 12 }}>
          <h2>Scenario complete</h2>
          <p>
            Return <b className={cls(s.returnPct)}>{s.returnPct.toFixed(1)}%</b> · max drawdown {money(s.maxDrawdown)} · risk-adjusted score <b>{s.riskAdjusted.toFixed(2)}</b> · {s.varBreachDays} days over VaR limit ·{" "}
            {s.liquidityBreachDays} credit breaches. Seed <code>{g.state.seed}</code>: replay it, or try the other scenario with the same strategy.
          </p>
        </section>
      )}

      <main className="grid">
        <div className="col">
          <MarketPanel game={g} />
        </div>
        <div className="col">
          <section className="panel">
            <div className="tabs" role="tablist">
              <button role="tab" aria-selected={tab === "offers"} className={`tab ${tab === "offers" ? "active" : ""}`} onClick={() => setTab("offers")}>
                Offers &amp; bids <span className="count">{g.state.offers.length}</span>
              </button>
              <button role="tab" aria-selected={tab === "book"} className={`tab ${tab === "book" ? "active" : ""}`} onClick={() => setTab("book")} data-testid="tab-book">
                Book &amp; hedges <span className="count">{g.openPositions().deals.length + g.openPositions().voyages.length + g.book.futures.length}</span>
              </button>
            </div>
            {tab === "offers" ? <OffersPanel game={g} act={act} /> : <BookPanel game={g} act={act} />}
          </section>
        </div>
        <div className="col col-3">
          <PnlPanel game={g} />
          <News items={g.state.news} />
        </div>
      </main>
      {toast && <div className={`toast ${toast.err ? "err" : ""}`}>{toast.text}</div>}
      {showAssumptions && <Assumptions onClose={() => setShowAssumptions(false)} />}
    </div>
  );
}
