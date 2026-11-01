/**
 * A small dense two-phase simplex solver (Bland's rule, so it cannot cycle).
 *
 *   minimise    c·x
 *   subject to  A_ub x ≤ b_ub,  A_eq x = b_eq,  x ≥ 0
 *
 * Built from plain arithmetic, so results are identical on every platform. Problem sizes in
 * the game are tiny (≈ 8 variables, ≈ 15 constraints).
 */

export interface LP {
  c: number[];
  aUb?: number[][];
  bUb?: number[];
  aEq?: number[][];
  bEq?: number[];
}

export type LPResult = { status: "optimal"; x: number[]; value: number } | { status: "infeasible" } | { status: "unbounded" };

const EPS = 1e-9;

export function solveLP(lp: LP): LPResult {
  const n = lp.c.length;
  const rows: { a: number[]; b: number; kind: "le" | "ge" | "eq" }[] = [];
  (lp.aUb ?? []).forEach((a, i) => {
    const b = lp.bUb![i]!;
    rows.push(b >= 0 ? { a: [...a], b, kind: "le" } : { a: a.map((v) => -v), b: -b, kind: "ge" });
  });
  (lp.aEq ?? []).forEach((a, i) => {
    const b = lp.bEq![i]!;
    rows.push(b >= 0 ? { a: [...a], b, kind: "eq" } : { a: a.map((v) => -v), b: -b, kind: "eq" });
  });
  const m = rows.length;
  // Column layout: x (n) | slack/surplus (one per inequality) | artificial (one per ge/eq row)
  const nSlack = rows.filter((r) => r.kind !== "eq").length;
  const nArt = rows.filter((r) => r.kind !== "le").length;
  const width = n + nSlack + nArt + 1; // + rhs
  const T: number[][] = [];
  const basis: number[] = [];
  let s = 0;
  let art = 0;
  const artCols: number[] = [];
  for (const r of rows) {
    const row = new Array<number>(width).fill(0);
    for (let j = 0; j < n; j++) row[j] = r.a[j] ?? 0;
    row[width - 1] = r.b;
    if (r.kind === "le") {
      row[n + s] = 1;
      basis.push(n + s);
      s++;
    } else {
      if (r.kind === "ge") {
        row[n + s] = -1;
        s++;
      }
      const col = n + nSlack + art;
      row[col] = 1;
      basis.push(col);
      artCols.push(col);
      art++;
    }
    T.push(row);
  }

  const pivot = (pr: number, pc: number) => {
    const p = T[pr]![pc]!;
    const row = T[pr]!;
    for (let j = 0; j < width; j++) row[j] = row[j]! / p;
    for (let i = 0; i < m; i++) {
      if (i === pr) continue;
      const f = T[i]![pc]!;
      if (Math.abs(f) < EPS) continue;
      const ri = T[i]!;
      for (let j = 0; j < width; j++) ri[j] = ri[j]! - f * row[j]!;
    }
    basis[pr] = pc;
  };

  const run = (cost: number[], allowed: (j: number) => boolean): "optimal" | "unbounded" => {
    for (let iter = 0; iter < 500; iter++) {
      // reduced costs: c_j − c_B · column_j
      let enter = -1;
      for (let j = 0; j < width - 1; j++) {
        if (!allowed(j) || basis.includes(j)) continue;
        let rc = cost[j] ?? 0;
        for (let i = 0; i < m; i++) rc -= (cost[basis[i]!] ?? 0) * T[i]![j]!;
        if (rc < -EPS) {
          enter = j;
          break; // Bland: lowest index
        }
      }
      if (enter < 0) return "optimal";
      let leave = -1;
      let best = Infinity;
      for (let i = 0; i < m; i++) {
        const a = T[i]![enter]!;
        if (a > EPS) {
          const ratio = T[i]![width - 1]! / a;
          if (ratio < best - EPS || (Math.abs(ratio - best) <= EPS && basis[i]! < basis[leave]!)) {
            best = ratio;
            leave = i;
          }
        }
      }
      if (leave < 0) return "unbounded";
      pivot(leave, enter);
    }
    return "optimal";
  };

  // Phase 1: minimise the sum of artificials
  if (nArt > 0) {
    const c1 = new Array<number>(width - 1).fill(0);
    for (const col of artCols) c1[col] = 1;
    run(c1, () => true);
    const infeas = basis.reduce((acc, b, i) => acc + (artCols.includes(b) ? T[i]![width - 1]! : 0), 0);
    if (infeas > 1e-7) return { status: "infeasible" };
    // drive any zero-level artificials out of the basis
    for (let i = 0; i < m; i++) {
      if (!artCols.includes(basis[i]!)) continue;
      const j = T[i]!.findIndex((v, k) => k < n + nSlack && Math.abs(v) > EPS);
      if (j >= 0) pivot(i, j);
    }
  }
  // Phase 2: original objective, artificials barred
  const c2 = new Array<number>(width - 1).fill(0);
  for (let j = 0; j < n; j++) c2[j] = lp.c[j]!;
  const st = run(c2, (j) => !artCols.includes(j));
  if (st === "unbounded") return { status: "unbounded" };
  const x = new Array<number>(n).fill(0);
  basis.forEach((b, i) => {
    if (b < n) x[b] = T[i]![width - 1]!;
  });
  return { status: "optimal", x, value: x.reduce((acc, v, j) => acc + v * lp.c[j]!, 0) };
}
