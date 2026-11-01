"""Sea-route geometry for the world map: searoute (Apache-2.0, Eurostat MARNET network)
paths between hub coordinates, for every route variant. Output: params/geo.json"""

from __future__ import annotations

import json
from pathlib import Path

import searoute as sr

ROOT = Path(__file__).resolve().parent.parent
PORTS = {
    "USGC": [-94.9, 29.3], "NYH": [-74.05, 40.6], "ARA": [4.0, 51.95], "WAF": [3.35, 6.4],
    "MEG": [50.2, 26.7], "FUJ": [56.4, 25.15], "SIN": [103.8, 1.2],
}
VARIANTS = {
    "TC2:direct": ("ARA", "NYH", []), "TC14:direct": ("USGC", "ARA", []), "TC19:direct": ("ARA", "WAF", []),
    "WAF-ARA:direct": ("WAF", "ARA", []), "TC8:suez": ("MEG", "ARA", []), "TC8:cape": ("MEG", "ARA", ["suez", "babalmandab"]),
    "FUJ-ARA:suez": ("FUJ", "ARA", []), "FUJ-ARA:cape": ("FUJ", "ARA", ["suez", "babalmandab"]),
    "MEG-SIN:direct": ("MEG", "SIN", []), "FUJ-SIN:direct": ("FUJ", "SIN", []), "USGC-NYH:direct": ("USGC", "NYH", []),
    "USGC-WAF:direct": ("USGC", "WAF", []),
}


def simplify(coords: list[list[float]], tol: float = 0.25) -> list[list[float]]:
    out = [coords[0]]
    for c in coords[1:-1]:
        if abs(c[0] - out[-1][0]) + abs(c[1] - out[-1][1]) >= tol:
            out.append(c)
    out.append(coords[-1])
    return [[round(x, 2), round(y, 2)] for x, y in out]


CHOKEPOINTS = {"hormuz": (56.4, 26.5), "babelmandeb": (43.4, 12.6), "suez": (32.35, 30.6)}


def passes(coords, point, tol=1.2) -> bool:
    return any(abs(x - point[0]) < tol and abs(y - point[1]) < tol for x, y in coords)


def main() -> None:
    out = {"source": "searoute 1.6 (Apache-2.0) on the Eurostat MARNET network", "ports": PORTS, "routes": {}, "pairs": {}}
    # Hub-to-hub paths (used for diversions at sea): distance, chokepoints passed, geometry
    for a in PORTS:
        for b in PORTS:
            if a == b:
                continue
            r = sr.searoute(PORTS[a], PORTS[b], units="naut", restrictions=["northwest"])
            coords = r["geometry"]["coordinates"]
            chokes = [c for c, pt in CHOKEPOINTS.items() if c != "hormuz" and passes(coords, pt)]
            # Hormuz is crossed exactly when a path enters or leaves the Gulf (MEG); Fujairah is outside
            if (a == "MEG") != (b == "MEG"):
                chokes.append("hormuz")
            out["pairs"][f"{a}>{b}"] = {"nm": round(float(r["properties"]["length"])), "chokepoints": sorted(chokes), "path": simplify(coords)}
    for k, (a, b, restr) in VARIANTS.items():
        r = sr.searoute(PORTS[a], PORTS[b], units="naut", restrictions=["northwest"] + restr)
        coords = simplify(r["geometry"]["coordinates"])
        out["routes"][k] = coords
        print(k, len(coords))
    (ROOT / "params" / "geo.json").write_text(json.dumps(out, separators=(",", ":")) + "\n")


if __name__ == "__main__":
    main()
