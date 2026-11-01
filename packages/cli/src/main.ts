#!/usr/bin/env tsx
/**
 * Laycan command-line interface.
 *
 *   laycan play [--scenario now_2026_11] [--seed 42]     interactive game
 *   laycan simulate [--scenario ...] [--seed ...]          passive market run, prints a summary
 *   laycan assumptions                                      prints the assumptions sheet (markdown)
 */
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import {
  BUCKET_INFO,
  CHOKEPOINT_INFO,
  FUTURES,
  FUTURES_IDS,
  Game,
  HUBS,
  PRODUCTS,
  ROUTES,
  SCENARIOS,
  EPISODES,
  assumptionsMarkdown,
  hubPrice,
  isoDate,
  listedMonths,
  perBbl,
  productBblPerTonne,
  type FuturesId,
  type HubId,
  type ProductId,
} from "@laycan/engine";

const args = process.argv.slice(2);
const cmd = args[0] ?? "play";
const opt = (k: string, d: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : d;
};

const m$ = (x: number) => `${x < 0 ? "-" : ""}$${(Math.abs(x) / 1e6).toFixed(2)}m`;
const pad = (s: string | number, n: number) => String(s).padStart(n);

function printMarket(g: Game) {
  const m = g.market;
  console.log(`\n${g.displayDate()}  regime: ${m.regime.toUpperCase()}   Brent ${m.brent.toFixed(2)} $/bbl`);
  console.log(`Chokepoints: ${g.chokeSummary()}`);
  console.log(`\nHub prices $/bbl (diff vs US Gulf)`.padEnd(30) + PRODUCTS.map((p) => pad(p, 18)).join(""));
  for (const h of HUBS) {
    console.log(h.padEnd(30) + PRODUCTS.map((p) => pad(`${hubPrice(m, h, p).toFixed(2)} (${m.diffs[h][p] >= 0 ? "+" : ""}${m.diffs[h][p].toFixed(1)})`, 18)).join(""));
  }
  console.log(`Cracks vs Brent at USGC: ` + PRODUCTS.map((p) => `${p} ${m.cracks[p].toFixed(1)}`).join("  "));
}

function printFreight(g: Game) {
  console.log("\nRoute            via     $/t all-in  diesel $/bbl  days  war-risk  status");
  for (const r of ROUTES) {
    for (const q of g.quotes(r.id)) {
      console.log(
        `${r.id.padEnd(16)} ${q.via.padEnd(7)} ${pad(q.allInPerTonne.toFixed(1), 10)}  ${pad(perBbl(q, "diesel").toFixed(2), 12)}  ${pad(q.ladenDays.toFixed(0), 4)}  ${pad((q.warRiskUsd / 1e3).toFixed(0) + "k", 8)}  ${q.feasible ? "open" : "BLOCKED " + q.blockedBy.join(",")}`,
      );
    }
  }
}

function printOffers(g: Game) {
  console.log("\nOffers (expire at next decision point):");
  for (const o of g.state.offers) {
    const pr = o.pricing.kind === "fixed" ? `fixed ${o.pricing.fixedPrice!.toFixed(2)}` : o.pricing.kind;
    console.log(
      `  ${o.id.padEnd(5)} YOU ${o.playerSide.toUpperCase().padEnd(4)} ${(o.qtyBbl / 1000).toFixed(0).padStart(4)} kbbl ${o.product.padEnd(8)} ${o.incoterm} ${o.hub.padEnd(4)} laycan ${isoDate(o.laycan[0]).slice(5)}→${isoDate(o.laycan[1]).slice(5)}  ${pr} ${o.pricing.diff >= 0 ? "+" : ""}${o.pricing.diff.toFixed(2)}  ${o.payment.kind}  ${o.cptyName}`,
    );
    if (o.playerSide === "buy" && o.incoterm === "FOB") {
      for (const r of ROUTES.filter((x) => x.from === o.hub)) {
        const q = g.quotes(r.id).filter((x) => x.feasible).sort((a, b) => a.allInPerTonne - b.allInPerTonne)[0];
        if (!q) continue;
        const arb = hubPrice(g.market, r.to, o.product) - hubPrice(g.market, o.hub, o.product) - o.pricing.diff - perBbl(q, o.product);
        console.log(`         → ${r.id.padEnd(9)} to ${r.to}: freight ${perBbl(q, o.product).toFixed(2)} $/bbl, arb at today's prices ${arb >= 0 ? "+" : ""}${arb.toFixed(2)} $/bbl`);
      }
    }
  }
}

function printBook(g: Game) {
  const b = g.breakdown();
  const s = g.score();
  console.log(`\nEquity ${m$(b.total)}  (P&L ${m$(s.pnl)}, max drawdown ${m$(s.maxDrawdown)})  cash ${m$(b.cash)}  credit line ${m$(g.creditLimit())}  VaR99 ${m$(g.var99())}`);
  const pos = g.openPositions();
  for (const d of pos.deals) console.log(`  ${d.id.padEnd(5)} ${d.side} ${(d.qty / 1000).toFixed(0)} kbbl ${d.product} ${d.incoterm} ${d.hub} [${d.status}] priced ${d.fixings.length}/${d.window?.length ?? (d.pricing.kind === "fixed" ? 1 : 5)}${d.voyageId ? ` via ${d.voyageId}` : ""}`);
  for (const v of pos.voyages) console.log(`  ${v.id.padEnd(5)} ${v.cls} ${v.routeId} via ${v.via} [${v.status}] ETA load ${isoDate(v.arriveLoad)}${v.arriveDisch ? ` disch ${isoDate(v.arriveDisch)}` : ""}`);
  for (const c of pos.cargoes) console.log(`  ${c.id.padEnd(5)} ${(c.qty / 1000).toFixed(0)} kbbl ${c.product} in ${c.where} at ${c.hub}`);
  for (const f of pos.futures) console.log(`  ${f.id.padEnd(5)} ${f.lots} lots ${FUTURES[f.contract].name} ${f.y}-${String(f.m).padStart(2, "0")}`);
}

function printPnl(g: Game) {
  console.log("\nP&L attribution        physical       paper       total");
  for (const a of g.attributionTotals()) console.log(`  ${BUCKET_INFO[a.bucket].label.padEnd(20)} ${pad(m$(a.physical), 10)} ${pad(m$(a.paper), 11)} ${pad(m$(a.total), 11)}`);
}

const HELP = `
Commands
  m | market                     hub prices, cracks, chokepoints
  f | freight                    route freight (bottom-up)
  o | offers                     counterparty offers and bids, with arb at today's prices
  b | book                       positions, voyages, cargoes, futures
  p | pnl                        P&L attribution
  x | exposure                   exposure by price component (bbl)
  accept <offerId> [route] [via] accept an offer; for FOB purchases name a route to charter
  assign <saleId> <voyageId>     deliver a sale with a voyage
  charter <route> <product> <days-ahead>   charter to lift product from your tank
  lease <hub> [kbbl] [months]    lease tank capacity (take-or-pay)
  spot <cargoId>                 sell a tank parcel to a merchant now (index − haircut)
  carry                          cash-and-carry economics by hub
  fut <RB|HO|GO|BRN> <month#> <lots>       trade futures (month# 0 = front; lots < 0 to sell)
  curve                          futures curves
  quote <buy|sell> <product> <hub> <FOB|DES|CIF>   ask the market for a quote
  n | next                       run to the next weekly decision point
  news                           recent news
  save <file>                    save the game
  q | quit
`;

async function play() {
  const scenario = opt("scenario", "generated");
  const seed = opt("seed", String(Date.now() % 100000));
  const load = opt("load", "");
  let g: Game;
  if (load) {
    const fs = await import("node:fs");
    g = Game.fromJSON(fs.readFileSync(load, "utf8"));
  } else g = Game.create({ scenario, seed });
  const sc = g.scenario;
  console.log(`\nLAYCAN — ${sc.name}\nSeed ${g.state.seed}. ${sc.description}\n`);
  for (const n of g.state.news) console.log(`  • ${n.title}`);
  console.log(HELP);
  printMarket(g);
  printOffers(g);
  const rl = createInterface({ input: stdin, output: stdout, terminal: stdin.isTTY ?? false });
  const promptText = () => `\n[${g.displayDate()} week ${Math.floor((g.day - g.state.startDay) / 7) + 1}] > `;
  const finish = () => {
    console.log("\n=== Scenario complete ===");
    printBook(g);
    printPnl(g);
    const s = g.score();
    console.log(`\nReturn ${s.returnPct.toFixed(1)}%  risk-adjusted score ${s.riskAdjusted.toFixed(2)}  VaR breach days ${s.varBreachDays}  liquidity breach days ${s.liquidityBreachDays}`);
  };
  stdout.write(promptText());
  for await (const raw of rl) {
    const line = raw.trim();
    if (!stdin.isTTY && line) console.log(line);
    const [c, ...a] = line.split(/\s+/);
    if (c === "q" || c === "quit") break;
    try {
      await handle(g, c ?? "", a);
    } catch (e) {
      console.log(`error: ${(e as Error).message}`);
    }
    if (g.over) {
      finish();
      break;
    }
    stdout.write(promptText());
  }
  rl.close();
}

async function handle(g: Game, c: string, a: string[]): Promise<void> {
  switch (c) {
    case "m":
    case "market":
      return printMarket(g);
    case "f":
    case "freight":
      return printFreight(g);
    case "o":
    case "offers":
      return printOffers(g);
    case "b":
    case "book":
      return printBook(g);
    case "p":
    case "pnl":
      return printPnl(g);
    case "x":
    case "exposure":
      for (const e of g.exposures()) console.log(`  ${e.label.padEnd(28)} ${pad((e.bbl / 1000).toFixed(0), 8)} kbbl`);
      return;
    case "accept":
      console.log(g.act({ type: "accept", offerId: a[0]!, charter: a[1] ? { routeId: a[1], via: a[2] as "suez" | "cape" | undefined } : undefined }).message);
      return;
    case "lease":
      console.log(g.act({ type: "lease", hub: a[0] as HubId, capacityBbl: Number(a[1] ?? 300) * 1000, months: Number(a[2] ?? 3) }).message);
      return;
    case "spot":
      console.log(g.act({ type: "sellSpot", cargoId: a[0]! }).message);
      return;
    case "carry":
      for (const h of ["ARA", "USGC", "SIN", "FUJ"] as const)
        for (const p of ["diesel", "gasoline"] as const) {
          const c = g.carry(h, p);
          console.log(`  ${h.padEnd(5)} ${p.padEnd(9)} contango ${c.contango.toFixed(2).padStart(6)}  storage −${c.storage.toFixed(2)}  finance −${c.finance.toFixed(2)}  net ${c.net.toFixed(2).padStart(6)} $/bbl/month`);
        }
      return;
    case "assign":
      console.log(g.act({ type: "assign", saleId: a[0]!, voyageId: a[1]! }).message);
      return;
    case "charter":
      console.log(g.act({ type: "charter", routeId: a[0]!, product: a[1] as ProductId, laycanStart: g.day + Number(a[2] ?? 5) }).message);
      return;
    case "fut": {
      const id = a[0]!.toUpperCase() as FuturesId;
      const mm = listedMonths(id, g.day)[Number(a[1] ?? 0)];
      if (!mm) throw new Error("no such contract month");
      console.log(g.act({ type: "futures", contract: id, y: mm.y, m: mm.m, lots: Number(a[2]) }).message);
      return;
    }
    case "curve":
      for (const id of FUTURES_IDS) {
        const spec = FUTURES[id];
        console.log(`  ${spec.name.padEnd(26)} ` + listedMonths(id, g.day).map((mm) => `${mm.code} ${(g.futuresQuote(id, mm.y, mm.m) * spec.quotePerBbl).toFixed(spec.quoteUnit === "$/gal" ? 3 : 1)}`).join("  "));
      }
      return;
    case "quote":
      console.log(g.act({ type: "quote", side: a[0] as "buy" | "sell", product: a[1] as ProductId, hub: a[2] as HubId, incoterm: (a[3] ?? "FOB") as "FOB" }).message);
      return;
    case "n":
    case "next": {
      const news = g.advance();
      for (const n of news) console.log(`  ${isoDate(n.day)} ${n.severity === "critical" ? "!!" : n.severity === "warn" ? " !" : "  "} ${n.title}${n.body ? " — " + n.body : ""}`);
      printMarket(g);
      printBook(g);
      if (!g.over) printOffers(g);
      return;
    }
    case "news":
      for (const n of g.state.news.slice(-15)) console.log(`  ${isoDate(n.day)} ${n.title}`);
      return;
    case "save": {
      const fs = await import("node:fs");
      fs.writeFileSync(a[0] ?? "laycan-save.json", g.toJSON());
      console.log("saved");
      return;
    }
    case "":
      return;
    default:
      console.log(HELP);
  }
}

function simulate() {
  const g = Game.create({ scenario: opt("scenario", "generated"), seed: opt("seed", "1"), weeks: Number(opt("weeks", "12")) });
  while (!g.over) g.advance();
  const h = g.state.history;
  console.log(`${h.length} business days. Brent ${h[0]!.brent.toFixed(2)} → ${h.at(-1)!.brent.toFixed(2)}; diesel crack ${h[0]!.cracks.diesel.toFixed(1)} → ${h.at(-1)!.cracks.diesel.toFixed(1)}`);
  for (const n of g.state.news.filter((x) => x.kind === "event")) console.log(`  ${isoDate(n.day)} ${n.title}`);
  printMarket(g);
  printFreight(g);
  void CHOKEPOINT_INFO;
  void productBblPerTonne;
}

if (cmd === "list") {
  console.log("generated              Generated market (default): realistic world, no real date or prices");
  for (const e of EPISODES) console.log(`${e.id.padEnd(22)} Historical replay: ${e.name}`);
  for (const s of Object.values(SCENARIOS)) console.log(`${s.id.padEnd(22)} Real start: ${s.name}`);
} else if (cmd === "assumptions") stdout.write(assumptionsMarkdown());
else if (cmd === "simulate") simulate();
else await play();
