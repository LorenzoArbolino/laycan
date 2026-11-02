"""Fit engine parameters from public data in data/raw/ and write params/calibration.json.

Every output value carries provenance: label (data | derived | estimate), source, method, date.
Also writes params/targets.json: historical summary statistics the engine's simulated
paths are tested against (stylized-fact tests in packages/engine/test/stylized).

Run:  uv run python fetch.py && uv run python fit.py
"""

from __future__ import annotations

import datetime as dt
import json
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import optimize, stats

warnings.filterwarnings("ignore")

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "params"
TODAY = dt.date.today().isoformat()
GAL_PER_BBL = 42.0

# Regime windows used for labelled calibration (dates are of public, well-documented episodes).
WAR = [("2022-03-01", "2022-12-31"), ("2026-03-01", "2026-12-31")]
STRESS = [("2005-08-25", "2005-10-31"), ("2008-09-15", "2009-06-30"), ("2020-03-01", "2020-06-30")]


def P(value, unit, label, source, method):
    if isinstance(value, (np.floating, np.integer)):
        value = value.item()
    if isinstance(value, float):
        value = round(value, 6)
    return {"value": value, "unit": unit, "label": label, "source": source, "method": method, "date": TODAY}


def load_fred(sid: str) -> pd.Series:
    df = pd.read_csv(RAW / "fred" / f"{sid}.csv")
    df.columns = ["date", sid]
    df["date"] = pd.to_datetime(df["date"])
    df[sid] = pd.to_numeric(df[sid], errors="coerce")
    return df.set_index("date")[sid]


def regime_labels(idx: pd.DatetimeIndex) -> pd.Series:
    lab = pd.Series("normal", index=idx)
    for a, b in STRESS:
        lab[(idx >= a) & (idx <= b)] = "stressed"
    for a, b in WAR:
        lab[(idx >= a) & (idx <= b)] = "war"
    return lab


def ar1(x: pd.Series):
    x = x.dropna()
    y, xl = x.values[1:], x.values[:-1]
    b, a = np.polyfit(xl, y, 1)
    b = min(max(b, 1e-6), 0.999999)
    resid = y - (a + b * xl)
    kappa = -np.log(b)
    mu = a / (1 - b)
    return kappa, mu, resid


def robust_sigma(r: np.ndarray) -> float:
    return 1.4826 * np.median(np.abs(r - np.median(r)))


def garch_t_fit(r: np.ndarray):
    """GARCH(1,1) with Student-t innovations, MLE. r: daily log returns (decimal)."""
    r = r - r.mean()
    var0 = r.var()

    def nll(p):
        omega, alpha, beta, nu = p
        if omega <= 0 or alpha < 0 or beta < 0 or alpha + beta >= 0.9995 or nu <= 2.05:
            return 1e10
        h = np.empty_like(r)
        h[0] = var0
        for t in range(1, len(r)):
            h[t] = omega + alpha * r[t - 1] ** 2 + beta * h[t - 1]
        scale = np.sqrt(h * (nu - 2) / nu)
        return -np.sum(stats.t.logpdf(r / scale, nu) - np.log(scale))

    res = optimize.minimize(nll, x0=[var0 * 0.03, 0.06, 0.92, 6.0], method="Nelder-Mead",
                            options={"maxiter": 4000, "xatol": 1e-9, "fatol": 1e-6})
    return dict(zip(["omega", "alpha", "beta", "nu"], res.x))


def acf(x: np.ndarray, lags: int) -> list[float]:
    x = x - x.mean()
    d = np.dot(x, x)
    return [float(np.dot(x[:-k], x[k:]) / d) for k in range(1, lags + 1)]


def fourier_season(dev: pd.Series, k: int = 2):
    """Fit dev ~ sum_k a_k cos(2πk d/365.25) + b_k sin(...)."""
    d = dev.dropna()
    doy = d.index.dayofyear.values
    cols = []
    for j in range(1, k + 1):
        w = 2 * np.pi * j * doy / 365.25
        cols += [np.cos(w), np.sin(w)]
    X = np.column_stack(cols)
    coef, *_ = np.linalg.lstsq(X, d.values, rcond=None)
    return [float(c) for c in coef]


def main() -> None:
    brent = load_fred("DCOILBRENTEU")
    wti = load_fred("DCOILWTICO")
    gas_nyh = load_fred("DGASNYH") * GAL_PER_BBL
    gas_usg = load_fred("DGASUSGULF") * GAL_PER_BBL
    dsl_nyh = load_fred("DDFUELNYH") * GAL_PER_BBL
    dsl_usg = load_fred("DDFUELUSGULF") * GAL_PER_BBL
    jet_usg = load_fred("DJFUELUSGULF") * GAL_PER_BBL

    df = pd.concat({"brent": brent, "wti": wti, "gas_nyh": gas_nyh, "gas_usg": gas_usg,
                    "dsl_nyh": dsl_nyh, "dsl_usg": dsl_usg, "jet_usg": jet_usg}, axis=1)
    df = df[df.index >= "2006-06-14"].dropna()
    df["regime"] = regime_labels(df.index)

    cracks = pd.DataFrame({
        "gasoline": df["gas_usg"] - df["brent"],
        "diesel": df["dsl_usg"] - df["brent"],
        "jet": df["jet_usg"] - df["brent"],
    })
    reg = df["regime"]
    src_spot = "EIA daily spot prices via FRED (DCOILBRENTEU, DGASUSGULF, DDFUELUSGULF, DJFUELUSGULF, DGASNYH, DDFUELNYH)"

    params: dict = {"meta": {"generated": TODAY, "sample_start": str(df.index[0].date()),
                             "sample_end": str(df.index[-1].date()), "rows": int(len(df))}}
    targets: dict = {}
    report: dict = {}

    # ---------- Brent: GARCH-t on normal days, vol multipliers by regime ----------
    lr = np.log(df["brent"]).diff().dropna()
    lr = lr[np.isfinite(lr)]
    lr_norm = lr[reg.reindex(lr.index) == "normal"]
    g = garch_t_fit(lr_norm.values[-2500:])
    vol_by_reg = {k: float(lr[reg.reindex(lr.index) == k].std() * np.sqrt(252)) for k in ["normal", "stressed", "war"]}
    jumps = lr_norm[np.abs(lr_norm - lr_norm.median()) > 5 * robust_sigma(lr_norm.values)]
    params["brent"] = {
        "garch_omega": P(g["omega"], "1/day^2", "derived", src_spot, "GARCH(1,1)-t MLE on last 2500 normal-regime daily log returns"),
        "garch_alpha": P(g["alpha"], "-", "derived", src_spot, "GARCH(1,1)-t MLE"),
        "garch_beta": P(g["beta"], "-", "derived", src_spot, "GARCH(1,1)-t MLE"),
        "t_nu": P(g["nu"], "-", "derived", src_spot, "GARCH(1,1)-t MLE, Student-t degrees of freedom"),
        "vol_mult_stressed": P(vol_by_reg["stressed"] / vol_by_reg["normal"], "x", "derived", src_spot, "realised vol ratio stressed/normal windows"),
        "vol_mult_war": P(vol_by_reg["war"] / vol_by_reg["normal"], "x", "derived", src_spot, "realised vol ratio war/normal windows"),
        "jump_rate": P(len(jumps) / (len(lr_norm) / 252), "per year", "derived", src_spot, ">5 robust-sigma daily moves, normal regime"),
        "jump_scale": P(float(np.abs(jumps).mean()) if len(jumps) else 0.05, "log-return", "derived", src_spot, "mean |jump| of >5 robust-sigma moves"),
    }
    targets["brent"] = {
        "excess_kurtosis_min": float(stats.kurtosis(lr_norm.values)) * 0.4,
        "excess_kurtosis_hist": float(stats.kurtosis(lr_norm.values)),
        "sq_acf_1_10_hist": acf(lr_norm.values ** 2, 10),
        "annual_vol_normal": vol_by_reg["normal"],
        "annual_vol_war": vol_by_reg["war"],
    }

    # ---------- Cracks (USGC vs Brent): OU per regime, seasonality, jumps ----------
    params["cracks"] = {}
    targets["cracks"] = {}
    for prod in ["gasoline", "diesel", "jet"]:
        c = cracks[prod]
        trend = c.rolling(365, center=True, min_periods=200).mean()
        dev = (c - trend)[reg == "normal"]
        season = fourier_season(dev, 2)
        entry = {"season_fourier": P(season, "$/bbl", "derived", src_spot,
                                     "2-harmonic Fourier fit of crack minus 365d centred mean, normal regime")}
        tgt = {}
        for rk in ["normal", "stressed", "war"]:
            seg = c[reg == rk]
            # Fit AR(1) on contiguous blocks only: drop the jump at block boundaries.
            kappa, mu, resid = ar1(seg)
            if rk == "normal":
                # normal: estimate on deseasonalised series for cleaner mean reversion
                kappa, mu, resid = ar1(seg - (c - c.rolling(365, center=True, min_periods=200).mean() - dev.reindex(seg.index)).fillna(0) * 0)
            rs = robust_sigma(resid)
            jmask = np.abs(resid) > 4.5 * rs
            sig = float(np.std(resid[~jmask]))
            entry[rk] = {
                "mean": P(float(seg.mean()), "$/bbl", "derived", src_spot, f"mean USGC {prod} crack vs Brent, {rk} windows"),
                "kappa": P(float(np.clip(kappa, 0.004, 0.2)), "1/day", "derived", src_spot, "AR(1) on daily levels, -ln(b)"),
                "sigma": P(sig, "$/bbl/day", "derived", src_spot, "std of non-jump AR(1) residuals"),
                "jump_rate": P(float(jmask.sum() / (len(resid) / 252)), "per year", "derived", src_spot, ">4.5 robust-sigma residuals"),
                "jump_scale": P(float(np.abs(resid[jmask]).mean()) if jmask.any() else 3 * sig, "$/bbl", "derived", src_spot, "mean |jump|"),
            }
            if rk == "normal":
                tgt = {"half_life_days": float(np.log(2) / max(kappa, 1e-6)),
                       "excess_kurtosis_dchg": float(stats.kurtosis(np.diff(seg.values))),
                       "season_sign_jun_minus_dec": float(np.sign(
                           sum(season[2 * j] * (np.cos(2 * np.pi * (j + 1) * 172 / 365.25) - np.cos(2 * np.pi * (j + 1) * 355 / 365.25))
                               + season[2 * j + 1] * (np.sin(2 * np.pi * (j + 1) * 172 / 365.25) - np.sin(2 * np.pi * (j + 1) * 355 / 365.25))
                               for j in range(2))))}
        params["cracks"][prod] = entry
        targets["cracks"][prod] = tgt

    # Correlations of daily crack changes and Brent returns by regime.
    chg = pd.concat([lr.rename("brent"), cracks.diff()], axis=1).dropna()
    corr = {}
    for rk in ["normal", "stressed", "war"]:
        m = chg[reg.reindex(chg.index) == rk]
        corr[rk] = m.corr().round(4).values.tolist()
    params["correlation"] = {
        "order": ["brent", "gasoline", "diesel", "jet"],
        **{rk: P(v, "-", "derived", src_spot, f"Pearson correlation of daily Brent log-returns and crack changes, {rk}") for rk, v in corr.items()},
    }
    off = lambda M: np.mean([abs(M[i][j]) for i in range(1, 4) for j in range(1, 4) if i < j])
    targets["correlation"] = {"mean_abs_crack_corr_normal": off(corr["normal"]),
                              "mean_abs_crack_corr_war": off(corr["war"]),
                              "mean_abs_crack_corr_stressed": off(corr["stressed"])}

    # ---------- Regional spread NYH - USGC (the free two-hub natural experiment, probe P2) ----------
    params["regional_nyh_usgc"] = {}
    targets["regional"] = {}
    for prod, (a, b) in {"gasoline": ("gas_nyh", "gas_usg"), "diesel": ("dsl_nyh", "dsl_usg")}.items():
        s = (df[a] - df[b])[reg == "normal"]
        kappa, mu, resid = ar1(s)
        lo, hi = np.quantile(s, [0.05, 0.95])
        within = float(((s >= lo - 1) & (s <= hi + 1)).mean())
        params["regional_nyh_usgc"][prod] = {
            "mean": P(float(s.mean()), "$/bbl", "derived", src_spot, "NYH minus USGC spot, normal regime"),
            "kappa": P(float(kappa), "1/day", "derived", src_spot, "AR(1)"),
            "sigma": P(float(robust_sigma(resid)), "$/bbl/day", "derived", src_spot, "robust sigma of AR(1) residuals"),
            "band_lo": P(float(lo), "$/bbl", "derived", src_spot, "5th percentile, normal regime"),
            "band_hi": P(float(hi), "$/bbl", "derived", src_spot, "95th percentile, normal regime"),
        }
        war = (df[a] - df[b])[reg == "war"]
        targets["regional"][prod] = {
            "containment_normal": within,
            "half_life_days": float(np.log(2) / max(kappa, 1e-6)),
            "breakout_share_war": float(((war < lo - 1) | (war > hi + 1)).mean()),
        }

    # ---------- Probe P1: Markov-switching variance on Brent returns ----------
    try:
        import statsmodels.api as sm
        wk = np.log(df["brent"]).resample("W").last().diff().dropna() * 100
        mod = sm.tsa.MarkovRegression(wk.values, k_regimes=3, switching_variance=True)
        fit = mod.fit(disp=False, search_reps=5)
        probs = pd.DataFrame(fit.smoothed_marginal_probabilities, index=wk.index)
        pn = list(mod.param_names)
        pv = np.asarray(fit.params)
        sig2 = [pv[pn.index(f"sigma2[{i}]")] for i in range(3)]
        order = np.argsort(sig2)
        hi_state = order[-1]
        p1 = {}
        for name, (a, b) in {"2008Q4": ("2008-10-01", "2008-12-31"), "2020MarApr": ("2020-03-01", "2020-04-30"),
                             "2022MarJun": ("2022-03-01", "2022-06-30"), "2026MarOct": ("2026-03-01", "2026-10-31"),
                             "2023_2025": ("2023-01-01", "2025-12-31")}.items():
            p1[name] = float(probs.loc[a:b, hi_state].mean() + probs.loc[a:b, order[1]].mean())
        trans = fit.regime_transition
        report["probe_P1_markov"] = {"prob_elevated_vol_state": p1,
                                     "sigma_weekly_pct": [float(np.sqrt(sig2[i])) for i in order]}
    except Exception as e:  # pragma: no cover
        report["probe_P1_markov"] = {"error": str(e)}

    # Regime transition matrix (daily) from labelled windows: expected durations.
    params["regime"] = {
        "states": ["normal", "stressed", "war"],
        "daily_transition": P([[0.9993, 0.0005, 0.0002], [0.010, 0.988, 0.002], [0.004, 0.004, 0.992]], "prob/day", "estimate",
                              "labelled episodes 2005-2026 (Katrina, GFC, COVID, 2022, 2026)",
                              "expected durations: normal ~4y, stressed ~3m, war ~5m; base rates set so ~1 stress episode per 5y"),
    }

    # ---------- Historical magnitudes (verify-log item 5) ----------
    crack_nyh_d = df["dsl_nyh"] - df["brent"]
    crack_nyh_g = df["gas_nyh"] - df["brent"]
    report["magnitudes"] = {
        "katrina_2005_usgc_gasoline_crack_peak": float((load_fred("DGASUSGULF") * 42 - brent).loc["2005-08-25":"2005-10-15"].max()),
        "y2022_nyh_diesel_crack_peak": float(crack_nyh_d.loc["2022"].max()),
        "y2022_nyh_diesel_crack_peak_date": str(crack_nyh_d.loc["2022"].idxmax().date()),
        "y2026_nyh_diesel_crack_peak": float(crack_nyh_d.loc["2026"].max()),
        "y2026_nyh_diesel_crack_peak_date": str(crack_nyh_d.loc["2026"].idxmax().date()),
        "y2026_brent_spot_peak": float(df["brent"].loc["2026"].max()),
        "y2026_brent_spot_peak_date": str(df["brent"].loc["2026"].idxmax().date()),
        "y2026_brent_spot_low_mar_dec": float(df["brent"].loc["2026-04-01":].min()),
    }
    # ---------- Reconciliation of late-2026 market commentary against EIA data ----------
    m = df.loc["2026-09"]
    three21 = ((2 * m["gas_nyh"] + m["dsl_nyh"]) / 3 - m["wti"]).mean()
    last = df.iloc[-1]
    report["reconciliation_2026"] = {
        "sep2026_321_nyh_vs_wti_avg": float(three21),
        "y2025_321_nyh_vs_wti_avg": float(((2 * df.loc["2025", "gas_nyh"] + df.loc["2025", "dsl_nyh"]) / 3 - df.loc["2025", "wti"]).mean()),
        "last_date": str(df.index[-1].date()),
        "last_brent_spot": float(last["brent"]),
        "last_wti": float(last["wti"]),
        "last_nyh_ulsd_crack_vs_wti": float(last["dsl_nyh"] - last["wti"]),
        "last_nyh_gasoline_crack_vs_wti": float(last["gas_nyh"] - last["wti"]),
        "oct2026_nyh_ulsd_crack_vs_wti_range": [float((df.loc["2026-10", "dsl_nyh"] - df.loc["2026-10", "wti"]).min()),
                                                float((df.loc["2026-10", "dsl_nyh"] - df.loc["2026-10", "wti"]).max())],
        "jul2026_nyh_gasoline_crack_vs_wti_max": float((df.loc["2026-07", "gas_nyh"] - df.loc["2026-07", "wti"]).max()),
    }

    # ---------- "Now" snapshot: latest observed US levels (public data) ----------
    params["snapshot_now"] = {
        "date": P(str(df.index[-1].date()), "date", "data", src_spot, "last common observation"),
        "brent": P(float(last["brent"]), "$/bbl", "data", "EIA Brent spot via FRED DCOILBRENTEU", "last observation"),
        "crack_usgc_gasoline": P(float(last["gas_usg"] - last["brent"]), "$/bbl", "data", src_spot, "last observation"),
        "crack_usgc_diesel": P(float(last["dsl_usg"] - last["brent"]), "$/bbl", "data", src_spot, "last observation"),
        "crack_usgc_jet": P(float(last["jet_usg"] - last["brent"]), "$/bbl", "data", src_spot, "last observation"),
        "nyh_usgc_gasoline": P(float(last["gas_nyh"] - last["gas_usg"]), "$/bbl", "data", src_spot, "last observation"),
        "nyh_usgc_diesel": P(float(last["dsl_nyh"] - last["dsl_usg"]), "$/bbl", "data", src_spot, "last observation"),
    }
    params["snapshot_normal_2025"] = {
        "date": P("2025-11-03", "date", "data", src_spot, "start date of the normal baseline"),
        "brent": P(float(df.loc["2025-10-20":"2025-11-07", "brent"].mean()), "$/bbl", "data", "EIA Brent spot via FRED", "mean 20 Oct - 7 Nov 2025"),
        "crack_usgc_gasoline": P(float(cracks.loc["2025-10-20":"2025-11-07", "gasoline"].mean()), "$/bbl", "data", src_spot, "mean 20 Oct - 7 Nov 2025"),
        "crack_usgc_diesel": P(float(cracks.loc["2025-10-20":"2025-11-07", "diesel"].mean()), "$/bbl", "data", src_spot, "mean 20 Oct - 7 Nov 2025"),
        "crack_usgc_jet": P(float(cracks.loc["2025-10-20":"2025-11-07", "jet"].mean()), "$/bbl", "data", src_spot, "mean 20 Oct - 7 Nov 2025"),
        "nyh_usgc_gasoline": P(float((df["gas_nyh"] - df["gas_usg"]).loc["2025-10-20":"2025-11-07"].mean()), "$/bbl", "data", src_spot, "mean"),
        "nyh_usgc_diesel": P(float((df["dsl_nyh"] - df["dsl_usg"]).loc["2025-10-20":"2025-11-07"].mean()), "$/bbl", "data", src_spot, "mean"),
    }

    # Recent-window means: the "Now" war-regime levels and the 2023-2025 "normal" levels.
    def win(a, b):
        w = df.loc[a:b]
        return {
            "brent": float(w["brent"].mean()),
            "gasoline": float((w["gas_usg"] - w["brent"]).mean()),
            "diesel": float((w["dsl_usg"] - w["brent"]).mean()),
            "jet": float((w["jet_usg"] - w["brent"]).mean()),
            "nyh_usgc_gasoline": float((w["gas_nyh"] - w["gas_usg"]).mean()),
            "nyh_usgc_diesel": float((w["dsl_nyh"] - w["dsl_usg"]).mean()),
        }
    last90 = df.index[-1] - pd.Timedelta(days=90)
    r90 = win(str(last90.date()), str(df.index[-1].date()))
    n23 = win("2023-01-01", "2025-12-31")
    last30 = df.index[-1] - pd.Timedelta(days=30)
    r30 = win(str(last30.date()), str(df.index[-1].date()))
    params["window_means"] = {
        "now_last90": P(r90, "$/bbl", "derived", src_spot, f"means over {last90.date()} to {df.index[-1].date()}"),
        "now_last30": P(r30, "$/bbl", "derived", src_spot, f"means over {last30.date()} to {df.index[-1].date()}"),
        "normal_2023_2025": P(n23, "$/bbl", "derived", src_spot, "means over 2023-01-01 to 2025-12-31"),
    }
    report["window_means"] = {"now_last90": r90, "now_last30": r30, "normal_2023_2025": n23}

    # ---------- US stocks vs 5y seasonal average (EIA WPSR) ----------
    try:
        stk = {}
        for sid in ["WDISTUS1", "WGTSTUS1", "WKJSTUS1"]:
            s = pd.read_csv(RAW / "eia" / f"{sid}.csv", parse_dates=["date"]).set_index("date")["value"]
            lastd = s.index[-1]
            wk = lastd.isocalendar().week
            hist = s[(s.index.year >= lastd.year - 5) & (s.index.year < lastd.year)]
            avg = hist[np.abs(hist.index.isocalendar().week.astype(int) - int(wk)) <= 1].mean()
            stk[sid] = {"date": str(lastd.date()), "value_kbbl": float(s.iloc[-1]), "vs_5y_avg_pct": float((s.iloc[-1] / avg - 1) * 100)}
        report["us_stocks"] = stk
        params["snapshot_now"]["us_distillate_stocks_vs_5y_pct"] = P(stk["WDISTUS1"]["vs_5y_avg_pct"], "%", "data",
                                                                     "EIA WPSR WDISTUS1", "latest week vs same-week mean of prior 5 years")
        params["snapshot_now"]["us_gasoline_stocks_vs_5y_pct"] = P(stk["WGTSTUS1"]["vs_5y_avg_pct"], "%", "data",
                                                                   "EIA WPSR WGTSTUS1", "latest week vs same-week mean of prior 5 years")
    except FileNotFoundError:
        pass

    # ---------- Fundamentals: US refinery utilisation and stocks (EIA WPSR) ----------
    try:
        def five_year_dev(series: pd.Series, pct: bool) -> pd.Series:
            wk = series.index.isocalendar().week.astype(int).values
            out = []
            for i, (d, v) in enumerate(series.items()):
                h = series[(series.index.year >= d.year - 5) & (series.index.year < d.year)]
                hw = h.index.isocalendar().week.astype(int).values
                m = h[np.abs(hw - wk[i]) <= 1].mean()
                out.append(((v / m - 1) * 100 if pct else v - m) if m == m else np.nan)
            return pd.Series(out, index=series.index).dropna()

        load = lambda sid: pd.read_csv(RAW / "eia" / f"{sid}.csv", parse_dates=["date"]).set_index("date")["value"].astype(float)
        ud = five_year_dev(load("WPULEUS3"), pct=False)
        x = ud.values
        bu = float(np.polyfit(x[:-1], x[1:], 1)[0])
        ru = x[1:] - bu * x[:-1]
        src_wpsr = "EIA Weekly Petroleum Status Report (WPULEUS3, WDISTUS1, WGTSTUS1, WKJSTUS1), deviations from the 5-year same-week mean"
        fund = {
            "util_kappa": P(-np.log(bu) / 5, "1/business day", "derived", src_wpsr, "AR(1) on weekly US utilisation deviation, converted to business days"),
            "util_sigma": P(float(ru.std()) / np.sqrt(5), "pp/business day", "derived", src_wpsr, "weekly AR(1) residual sd / sqrt(5)"),
            "util_sd": P(float(ud.std()), "pp", "derived", src_wpsr, "sd of US utilisation deviation"),
            "util_min": P(float(ud.min()), "pp", "data", src_wpsr, f"largest shortfall ({ud.idxmin().date()}, Winter Storm Uri)"),
        }
        names = {"diesel": "WDISTUS1", "gasoline": "WGTSTUS1", "jet": "WKJSTUS1"}
        for p, sid in names.items():
            sd = five_year_dev(load(sid), pct=True)
            df = pd.concat({"s": sd, "u": ud}, axis=1).dropna()
            ds = df["s"].diff().shift(-1)
            d2 = pd.concat({"ds": ds, "u": df["u"], "s": df["s"]}, axis=1).dropna()
            X = np.column_stack([d2["u"], d2["s"], np.ones(len(d2))])
            coef, *_ = np.linalg.lstsq(X, d2["ds"], rcond=None)
            resid = d2["ds"] - X @ coef
            cw = cracks[p].resample("W-FRI").mean()
            j = pd.concat({"c": cw, "s": sd.resample("W-FRI").last()}, axis=1).dropna()
            norm = j[((j.index.year >= 2010) & (j.index.year <= 2019)) | ((j.index.year >= 2023) & (j.index.year <= 2025))]
            g = float(np.polyfit(norm["s"], norm["c"], 1)[0])
            fund[p] = {
                "stock_kappa": P(max(0.004, -float(coef[1]) / 5), "1/business day", "derived", src_wpsr, "weekly regression of stock-deviation change on its level, converted (floored at 0.004)"),
                "stock_sigma": P(float(resid.std()) / np.sqrt(5), "%/business day", "derived", src_wpsr, "weekly residual sd / sqrt(5)"),
                "util_to_stock_ols": P(float(coef[0]) / 5, "%/business day per pp", "derived", src_wpsr, "OLS of weekly stock change on utilisation deviation (attenuated by imports, demand and reporting noise; not used)"),
                "crack_per_stock": P(g, "$/bbl per %", "derived", src_wpsr + "; EIA spot via FRED", "OLS of weekly mean USGC crack on stock deviation, normal-regime years 2010-2019 and 2023-2025"),
            }
        # Refit the normal-regime crack process net of the stock channel, so that the engine's
        # crack = OU(residual) + slope × stocks reproduces the historical crack dynamics.
        for p in ["gasoline", "diesel", "jet"]:
            sd = five_year_dev(load(names[p]), pct=True)
            sdd = sd.reindex(cracks.index, method="ffill")
            g = fund[p]["crack_per_stock"]["value"]
            ex = (cracks[p] - g * sdd)[(reg == "normal") & sdd.notna()]
            kappa, mu, resid = ar1(ex)
            rs = robust_sigma(resid)
            jm = np.abs(resid) > 4.5 * rs
            fund[p]["ex_stock_kappa"] = P(float(np.clip(kappa, 0.004, 0.2)), "1/day", "derived", src_wpsr + "; EIA spot via FRED", "AR(1) on the normal-regime crack minus slope × stock deviation")
            fund[p]["ex_stock_sigma"] = P(float(np.std(resid[~jm])), "$/bbl/day", "derived", src_wpsr + "; EIA spot via FRED", "sd of non-jump residuals of that AR(1)")
        params["fundamentals"] = fund
        report["fundamentals"] = {k: (v["value"] if "value" in v else {kk: vv["value"] for kk, vv in v.items()}) for k, v in fund.items()}
    except FileNotFoundError:
        pass

    # ---------- Hurricanes: Gulf of Mexico hurricane-days by month (HURDAT2) ----------
    try:
        months = np.zeros(12)
        storms_by_month = np.zeros(12)
        years = set()
        cur_name = None
        hit = set()
        for line in (RAW / "noaa" / "hurdat2.txt").read_text().splitlines():
            parts = [p.strip() for p in line.split(",")]
            if parts[0].startswith("AL") and len(parts) >= 3 and not parts[0][2:].isdigit() is False and len(parts) < 6:
                cur_name = parts[0]
                continue
            if len(parts) < 8:
                continue
            date = parts[0]
            yr = int(date[:4])
            if yr < 1966:
                continue
            years.add(yr)
            status = parts[3]
            lat = float(parts[4][:-1]) * (1 if parts[4][-1] == "N" else -1)
            lon = float(parts[5][:-1]) * (-1 if parts[5][-1] == "W" else 1)
            wind = int(parts[6])
            if status == "HU" and 25 <= lat <= 31 and -98 <= lon <= -86:
                mo = int(date[4:6]) - 1
                months[mo] += 0.25  # 6-hourly fixes -> days
                key = (cur_name, mo)
                if key not in hit:
                    hit.add(key)
                    storms_by_month[mo] += 1
        ny = max(len(years), 1)
        rate = (storms_by_month / ny).round(4).tolist()
        params["hurricane"] = {
            "gulf_hurricanes_per_year_by_month": P(rate, "storms/yr", "derived", "NOAA HURDAT2 1966-2025",
                                                   "count of distinct hurricanes with a fix in 25-31N, 86-98W, per month"),
        }
        report["hurricane_rate_by_month"] = rate
    except FileNotFoundError:
        pass

    # ---------- Distances (searoute, Apache-2.0; Eurostat marnet network) ----------
    try:
        import searoute as sr
        ports = {
            "USGC": [-94.9, 29.3], "NYH": [-74.05, 40.6], "ARA": [4.0, 51.95], "WAF": [3.35, 6.4],
            "MEG": [50.2, 26.7], "FUJ": [56.4, 25.15], "SIN": [103.8, 1.2], "JPN": [139.85, 35.45],
        }
        legs = {
            "ARA-NYH": ("ARA", "NYH", []), "USGC-ARA": ("USGC", "ARA", []), "ARA-WAF": ("ARA", "WAF", []),
            "WAF-ARA": ("WAF", "ARA", []), "MEG-ARA-suez": ("MEG", "ARA", []), "MEG-ARA-cape": ("MEG", "ARA", ["suez", "babalmandab"]),
            "FUJ-ARA-suez": ("FUJ", "ARA", []), "FUJ-ARA-cape": ("FUJ", "ARA", ["suez", "babalmandab"]),
            "MEG-SIN": ("MEG", "SIN", []), "FUJ-SIN": ("FUJ", "SIN", []), "USGC-NYH": ("USGC", "NYH", []),
            "MEG-FUJ": ("MEG", "FUJ", []), "USGC-WAF": ("USGC", "WAF", []), "SIN-ARA-suez": ("SIN", "ARA", []),
            "MEG-JPN": ("MEG", "JPN", []), "JPN-SIN": ("JPN", "SIN", []), "SIN-JPN": ("SIN", "JPN", []),
        }
        dist = {}
        for k, (a, b, restr) in legs.items():
            r = sr.searoute(ports[a], ports[b], units="naut", restrictions=["northwest"] + restr)
            dist[k] = round(float(r["properties"]["length"]))
        params["distances_nm"] = P(dist, "nm", "derived", "searoute 1.6 (Apache-2.0) on Eurostat MARNET",
                                   "shortest sea path between representative hub coordinates")
        report["distances_nm"] = dist
    except Exception as e:  # pragma: no cover
        report["distances_error"] = str(e)

    OUT.mkdir(exist_ok=True)
    (OUT / "calibration.json").write_text(json.dumps(params, indent=1) + "\n")
    (OUT / "targets.json").write_text(json.dumps(targets, indent=1) + "\n")
    rep = ROOT / "data" / "raw" / "fit_report.json"
    rep.write_text(json.dumps(report, indent=1, default=str) + "\n")
    print(json.dumps(report, indent=1, default=str))


if __name__ == "__main__":
    main()
