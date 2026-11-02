// Fails if any tracked file looks like raw downloads or licensed market data.
// Committed data lives in params/*.json: fitted parameters with provenance, public-domain EIA
// replay series (cited) and computed sea-route geometry. Exchange and PRA data never go in.
import { execSync } from "node:child_process";

const tracked = execSync("git ls-files", { encoding: "utf8" }).split("\n").filter(Boolean);
const banned = [/^data\//, /(^|\/)licensed\//i, /\.(csv|xls|xlsx|parquet)$/i, /hurdat/i];
const bad = tracked.filter((f) => banned.some((re) => re.test(f)));
if (bad.length) {
  console.error("Raw or licensed data must not be committed:\n" + bad.join("\n"));
  process.exit(1);
}
console.log(`ok: ${tracked.length} tracked files, no raw or licensed data`);
