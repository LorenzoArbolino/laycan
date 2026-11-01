"""Download public-domain source data into data/raw/ (gitignored).

Sources:
  - FRED mirror of EIA daily spot prices (no key needed)
  - EIA API v2 weekly stocks (needs EIA_API_KEY in the environment)
  - NOAA HURDAT2 Atlantic hurricane database

A manifest (url, retrieved date, sha256, rows) is written to params/sources.json so
that every calibrated parameter can cite exactly what it was fitted on.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import sys
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
MANIFEST = ROOT / "params" / "sources.json"

FRED_SERIES = {
    "DCOILBRENTEU": "Brent spot FOB, $/bbl",
    "DCOILWTICO": "WTI Cushing spot, $/bbl",
    "DGASNYH": "NY Harbor conventional gasoline spot, $/gal",
    "DGASUSGULF": "US Gulf Coast conventional gasoline spot, $/gal",
    "DDFUELNYH": "NY Harbor ULSD spot, $/gal",
    "DDFUELUSGULF": "US Gulf Coast ULSD spot, $/gal",
    "DJFUELUSGULF": "US Gulf Coast kerosene-type jet fuel spot, $/gal",
    "DHOILNYH": "NY Harbor No.2 heating oil spot, $/gal",
}

EIA_WEEKLY = {
    "WDISTUS1": "US distillate ending stocks, kbbl",
    "WGTSTUS1": "US total motor gasoline ending stocks, kbbl",
    "WKJSTUS1": "US kerosene-type jet ending stocks, kbbl",
    "WPULEUS3": "US refinery utilisation, %",
}

HURDAT_INDEX = "https://www.nhc.noaa.gov/data/hurdat/"


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def fetch_fred(manifest: dict) -> None:
    out = RAW / "fred"
    out.mkdir(parents=True, exist_ok=True)
    for sid, desc in FRED_SERIES.items():
        url = f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={sid}"
        r = requests.get(url, timeout=60)
        r.raise_for_status()
        p = out / f"{sid}.csv"
        p.write_bytes(r.content)
        manifest[f"fred:{sid}"] = {
            "description": desc,
            "url": url,
            "publisher": "U.S. EIA via FRED (St. Louis Fed)",
            "retrieved": dt.date.today().isoformat(),
            "sha256": _sha(p),
            "rows": r.text.count("\n") - 1,
        }
        print("fred", sid, manifest[f"fred:{sid}"]["rows"])


def fetch_eia_weekly(manifest: dict) -> None:
    key = os.environ.get("EIA_API_KEY")
    if not key:
        print("EIA_API_KEY not set; skipping EIA weekly series", file=sys.stderr)
        return
    out = RAW / "eia"
    out.mkdir(parents=True, exist_ok=True)
    for sid, desc in EIA_WEEKLY.items():
        route = "pnp/wiup" if sid.startswith("WPULE") else "stoc/wstk"
        url = f"https://api.eia.gov/v2/petroleum/{route}/data/"
        params = {
            "api_key": key,
            "frequency": "weekly",
            "data[0]": "value",
            "facets[series][]": sid,
            "sort[0][column]": "period",
            "sort[0][direction]": "asc",
            "length": 5000,
        }
        r = requests.get(url, params=params, timeout=60)
        r.raise_for_status()
        rows = r.json()["response"]["data"]
        p = out / f"{sid}.csv"
        p.write_text("date,value\n" + "".join(f"{x['period']},{x['value']}\n" for x in rows))
        manifest[f"eia:{sid}"] = {
            "description": desc,
            "url": url + f"?facets[series][]={sid}",
            "publisher": "U.S. EIA Open Data API v2",
            "retrieved": dt.date.today().isoformat(),
            "sha256": _sha(p),
            "rows": len(rows),
        }
        print("eia", sid, len(rows))


def fetch_hurdat(manifest: dict) -> None:
    import re

    idx = requests.get(HURDAT_INDEX, timeout=60).text
    files = sorted(set(re.findall(r'href="(hurdat2-1851-\d{4}-\d+\.txt)"', idx)))
    if not files:
        print("HURDAT2 file not found in index", file=sys.stderr)
        return
    name = files[-1]
    url = HURDAT_INDEX + name
    r = requests.get(url, timeout=120)
    r.raise_for_status()
    out = RAW / "noaa"
    out.mkdir(parents=True, exist_ok=True)
    p = out / "hurdat2.txt"
    p.write_bytes(r.content)
    manifest["noaa:hurdat2"] = {
        "description": "Atlantic hurricane best-track database (HURDAT2)",
        "url": url,
        "publisher": "NOAA National Hurricane Center",
        "retrieved": dt.date.today().isoformat(),
        "sha256": _sha(p),
        "rows": r.text.count("\n"),
    }
    print("hurdat", name)


def main() -> None:
    manifest: dict = {}
    if MANIFEST.exists():
        manifest = json.loads(MANIFEST.read_text())
    fetch_fred(manifest)
    fetch_eia_weekly(manifest)
    fetch_hurdat(manifest)
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")


if __name__ == "__main__":
    main()
