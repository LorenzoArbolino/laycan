import { useCallback, useEffect, useRef, useState } from "react";
import { EPISODES, Game, assumptionRows, isoDate, type Action, type HubId, type NewsItem } from "@laycan/engine";
import { MarketPanel } from "./components/MarketPanel";
import { OffersPanel } from "./components/OffersPanel";
import { BookPanel, HedgePanel, StoragePanel } from "./components/BookPanel";
import { BlendPanel } from "./components/Operations";
import { PnlPanel } from "./components/PnlPanel";
import { WorldMap } from "./components/WorldMap";
import { CounterpartiesPanel } from "./components/Counterparties";
import { Manual } from "./components/Manual";
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

/* ------------------------------------------------------------------ start */

/** First sentence of a teaser: the list stays short; the full text shows on the selected row. */
const firstSentence = (t: string) => {
  const i = t.indexOf(". ");
  return i > 0 ? t.slice(0, i + 1) : t;
};

function StartScreen({ onStart, resume, onManual }: { onStart: (scenario: string, seed: string, weeks?: number) => void; resume: Game | null; onManual: () => void }) {
  const [scenario, setScenario] = useState("generated");
  // weeks = 0: unlimited (generated markets only)
  const [weeks, setWeeks] = useState(0);
  const [seed, setSeed] = useState(seedFromUrl() ?? String(Math.floor(Math.random() * 1e6)));
  const episodeWeeks = scenario === "generated" ? weeks : Game.scenarioFor(scenario, "x").weeks;
  const markets = [
    { id: "generated", name: "Generated market", starts: "Year 1", weeks: "any", what: "A new realistic world for every seed: regime, prices, freight, stocks and chokepoints drawn from the model calibrated on 20 years of data." },
    ...EPISODES.map((e) => {
      const sc = Game.scenarioFor(e.id, "x");
      return { id: e.id, name: e.name, starts: `${shortDate(sc.startDate)} ${sc.startDate.slice(0, 4)}`, weeks: String(sc.weeks), what: e.teaser };
    }),
  ];
  const link = `${location.origin}${location.pathname}?seed=${encodeURIComponent(seed)}`;
  return (
    <div className="start">
      <h1>Laycan</h1>
      <p className="lede">Run a physical refined-products book: buy and sell cargoes, charter tankers, store, blend and hedge. Every dollar of P&amp;L is explained.</p>
      <div className="go form-row">
        <label className="field">
          Seed
          <input value={seed} onChange={(e) => setSeed(e.target.value)} aria-label="Seed" className="seed-input" />
        </label>
        {scenario === "generated" && (
          <label className="field">
            Length
            <select value={weeks} onChange={(e) => setWeeks(Number(e.target.value))} aria-label="Duration">
              <option value={0}>Unlimited</option>
              {[8, 12, 26, 52].map((w) => (
                <option key={w} value={w}>
                  {w} weeks
                </option>
              ))}
            </select>
          </label>
        )}
        <button className="btn primary" onClick={() => onStart(scenario, seed, scenario === "generated" ? weeks : undefined)} data-testid="start">
          {scenario === "generated" && weeks === 0 ? "Start unlimited game" : `Start ${episodeWeeks}-week game`}
        </button>
        <button className="btn" onClick={onManual} data-testid="start-manual">
          Read the manual
        </button>
      </div>
      <p className="hint-line">
        Same seed, same market:{" "}
        <a href={link} data-testid="seed-link">
          share this seed
        </a>
        {resume && !resume.over && (
          <>
            {" · "}
            <button className="btn link" onClick={() => onStart("", "")}>
              Resume saved game ({resume.scenario.name.split(" —")[0]}, {resume.displayDate()})
            </button>
          </>
        )}
      </p>
      <div className="market-list">
        <table aria-label="Markets" role="radiogroup">
          <thead>
            <tr>
              <th />
              <th className="l">Market</th>
              <th className="l wide-only">Starts</th>
              <th className="wide-only">Weeks</th>
            </tr>
          </thead>
          <tbody>
            {markets.map((mk) => (
              <tr
                key={mk.id}
                className={`click ${scenario === mk.id ? "sel" : ""}`}
                onClick={() => setScenario(mk.id)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setScenario(mk.id)}
                tabIndex={0}
                role="radio"
                aria-checked={scenario === mk.id}
                data-testid={`scenario-${mk.id}`}
                title={mk.what}
              >
                <td className="pick">
                  <span className="radio" />
                </td>
                <td className="l">
                  <span className="strong">{mk.name}</span>
                  <span className="sub">
                    <span className="narrow-only">
                      {mk.starts} · {mk.weeks === "any" ? "any length" : `${mk.weeks} weeks`} ·{" "}
                    </span>
                    {scenario === mk.id ? mk.what : firstSentence(mk.what)}
                  </span>
                </td>
                <td className="l date wide-only">{mk.starts}</td>
                <td className="wide-only">{mk.weeks}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ side panels */

function News({ items, game }: { items: NewsItem[]; game: Game }) {
  return (
    <section className="panel" aria-label="News">
      <div className="panel-head">
        <h2>News</h2>
      </div>
      <div className="panel-body news">
        {[...items].reverse().slice(0, 60).map((n, i) => (
          <div key={i} className="news-item">
            <span className="when">{shortDate(isoDate(n.day))}</span>
            <span className={`t ${n.severity}`}>{n.title}</span>
            {n.body && <span className="body">{n.body}</span>}
          </div>
        ))}
        {items.length === 0 && <div className="empty">Quiet so far.</div>}
      </div>
      <span hidden>{game.day}</span>
    </section>
  );
}

function Assumptions({ onClose }: { onClose: () => void }) {
  const rows = assumptionRows();
  const [filter, setFilter] = useState("");
  const shown = rows.filter((r) => (r.section + r.path + r.source).toLowerCase().includes(filter.toLowerCase()));
  const tone = (l: string) => (l === "data" ? "ok" : l === "derived" ? "accent" : "warn");
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Assumptions">
        <div className="modal-head">
          <h2>Assumptions · {rows.length} parameters</h2>
          <button className="btn small" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="form-row" style={{ marginBottom: 10, gap: "4px 16px", fontSize: 13 }}>
          <span className="st ok">data: observed public value</span>
          <span className="st accent">derived: fitted from data</span>
          <span className="st warn">estimate: assumption for review</span>
        </div>
        <input placeholder="Filter by name or source" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: "100%", marginBottom: 8 }} aria-label="Filter assumptions" />
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Parameter</th>
                <th>Value</th>
                <th className="l">Label</th>
                <th className="l">Source and method</th>
              </tr>
            </thead>
            <tbody>
              {shown.slice(0, 400).map((r) => (
                <tr key={r.section + r.path}>
                  <td className="wrap">
                    <span className="muted" style={{ fontSize: 12 }}>
                      {r.section}
                    </span>
                    <div>{r.path}</div>
                  </td>
                  <td style={{ whiteSpace: "normal", maxWidth: 220, wordBreak: "break-word" }}>
                    {r.value} <span className="dim">{r.unit}</span>
                  </td>
                  <td className="l">
                    <span className={`st ${tone(r.label)}`}>{r.label}</span>
                  </td>
                  <td className="src">
                    {r.source}
                    <div className="faint">{r.method}</div>
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

/* ------------------------------------------------------------------ app */

type Tab = "offers" | "book" | "hedge" | "storage" | "blend" | "cpty";

export function App() {
  const gameRef = useRef<Game | null>(null);
  const [saved] = useState<Game | null>(() => load());
  const [, setVersion] = useState(0);
  const [tab, setTab] = useState<Tab>("offers");
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
  const pos = g.openPositions();
  const regimeTone = g.market.regime === "normal" ? "ok" : g.market.regime === "stressed" ? "warn" : "bad";
  const tabs: [Tab, string, number | null][] = [
    ["offers", "Offers & bids", g.state.offers.length],
    ["book", "Book", pos.deals.length + pos.voyages.length + g.book.cargoes.filter((c) => c.where === "tank").length],
    ["hedge", "Hedging", g.book.futures.length],
    ["storage", "Storage", null],
    ["blend", "Blending", null],
    ["cpty", "Counterparties", null],
  ];
  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">Laycan</span>
        <span className="kv">
          <span className="v" data-testid="date">
            {g.displayDate()}
          </span>
          <span className="k">
            week <span data-testid="week">{g.over ? "done" : openEnded ? `${week}` : `${week}/${totalWeeks}`}</span>
          </span>
        </span>
        <span className="kv">
          <span className="k">Equity</span>
          <span className="v">{money(b.total)}</span>
        </span>
        <span className="kv">
          <span className="k">P&amp;L</span>
          <span className={`v ${cls(s.pnl)}`}>{money(s.pnl)}</span>
        </span>
        <span className="kv">
          <span className="k">Cash</span>
          <span className="v">{money(b.cash, 1)}</span>
          <span className="k">credit {money(g.creditLimit(), 0)}</span>
        </span>
        <span className={`st ${regimeTone}`} title={`${g.scenario.kind === "historical" ? "Historical replay" : "Generated market"} · market regime`}>
          {g.market.regime}
        </span>
        <span className="spacer" />
        <span className="actions">
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
            {g.over ? (openEnded ? "Game over" : "Scenario complete") : busy ? "Running…" : "Next week →"}
          </button>
        </span>
      </header>

      {g.over && (
        <section className="panel" style={{ margin: "12px 16px 0" }}>
          <div className="panel-body">
            <h2>{openEnded ? "Game over" : "Scenario complete"}</h2>
            <p style={{ marginTop: 6 }}>
              Return <span className={`strong ${cls(s.returnPct)}`}>{s.returnPct.toFixed(1)}%</span> · max drawdown {money(s.maxDrawdown)} · risk-adjusted score <span className="strong">{s.riskAdjusted.toFixed(2)}</span> ·{" "}
              {s.varBreachDays} days over VaR · {s.liquidityBreachDays} credit breaches{openEnded ? ` · ${week - 1} weeks` : ""} · seed <code>{g.state.seed}</code>
            </p>
          </div>
        </section>
      )}

      <main className="app-main">
        <div className="col">
          <MarketPanel game={g} />
        </div>
        <div className="col center">
          <WorldMap
            game={g}
            selectedHub={hub}
            onHub={(h) => {
              setHub(h);
              setTab("offers");
            }}
          />
          <section className="panel">
            <div className="tabs" role="tablist">
              {tabs.map(([id, label, n]) => (
                <button key={id} role="tab" aria-selected={tab === id} className={`tab ${tab === id ? "active" : ""}`} onClick={() => setTab(id)} data-testid={`tab-${id}`}>
                  {label}
                  {n !== null && <span className="count">{n}</span>}
                </button>
              ))}
            </div>
            <div className="panel-body">
              {tab === "offers" && <OffersPanel game={g} act={act} hub={hub} clearHub={() => setHub(null)} />}
              {tab === "book" && <BookPanel game={g} act={act} />}
              {tab === "hedge" && <HedgePanel game={g} act={act} />}
              {tab === "storage" && <StoragePanel game={g} act={act} />}
              {tab === "blend" && <BlendPanel game={g} act={act} />}
              {tab === "cpty" && <CounterpartiesPanel game={g} />}
            </div>
          </section>
        </div>
        <div className="col">
          <PnlPanel game={g} />
          <News items={g.state.news} game={g} />
        </div>
      </main>
      {toast && (
        <div className={`toast ${toast.err ? "err" : ""}`} role="status">
          {toast.text}
        </div>
      )}
      {showAssumptions && <Assumptions onClose={() => setShowAssumptions(false)} />}
      {showManual && <Manual onClose={() => setShowManual(false)} />}
    </div>
  );
}
