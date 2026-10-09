"""Vehicle catalog test: brands -> models -> specs from free US government APIs, written to a txt file.

  python fetch_catalog.py [year] [brand_limit]      (defaults: 2025, 20)

Sources: fueleconomy.gov (EPA) for models/specs, NHTSA vPIC for the Car/SUV/Truck category.
"""

import re
import sys
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import quote

import requests

EPA = "https://www.fueleconomy.gov/ws/rest/vehicle"
NHTSA = "https://vpic.nhtsa.dot.gov/api/vehicles"
NHTSA_TYPES = {"Passenger Car": "passenger car", "SUV / MPV": "multipurpose passenger vehicle (mpv)", "Truck": "truck"}
DRIVE_SUFFIX_RE = re.compile(r"\b(2WD|4WD|AWD|FWD|RWD|HEV|PHEV|FFV|CNG|Pickup)\b", re.IGNORECASE)

session = requests.Session()
session.headers["Accept"] = "application/json"


def get_json(url, retries=3):
    for attempt in range(retries):
        try:
            resp = session.get(url, timeout=30)
            resp.raise_for_status()
            return resp.json() if resp.content else None
        except (requests.RequestException, ValueError):
            if attempt == retries - 1:
                raise
            time.sleep(2 ** attempt)


def menu(path):
    data = get_json(f"{EPA}/menu/{path}")
    items = (data or {}).get("menuItem") or []
    return items if isinstance(items, list) else [items]


def body_type(vclass):
    v = vclass.lower()
    if "sport utility" in v:
        return "SUV"
    if "pickup" in v:
        return "Pickup Truck"
    if "special purpose" in v:
        return "Special Purpose (Van/Truck)"
    if "minivan" in v:
        return "Minivan"
    if "van" in v:
        return "Van"
    if "station wagon" in v:
        return "Wagon"
    if "two seater" in v:
        return "Sports / Two-Seater"
    if "car" in v or "compact" in v:
        return "Car (Sedan/Coupe/Hatchback)"
    return vclass or "Unknown"


def normalize(name):
    return re.sub(r"\s+", " ", DRIVE_SUFFIX_RE.sub("", name)).strip().lower()


def nhtsa_categories(make, year):
    cats = {}
    for label, vtype in NHTSA_TYPES.items():
        url = f"{NHTSA}/GetModelsForMakeYear/make/{quote(make)}/modelyear/{year}/vehicletype/{quote(vtype)}?format=json"
        for m in (get_json(url) or {}).get("Results", []):
            cats.setdefault(m["Model_Name"].lower(), label)
    return cats


def match_category(epa_model, cats):
    base = normalize(epa_model)
    best = max((n for n in cats if base == n or base.startswith(n + " ")), key=len, default=None)
    return cats[best] if best else None


def fetch_config(year, make, model, option):
    d = get_json(f"{EPA}/{option['value']}") or {}
    return {
        "model": model,
        "option": option["text"],
        "class": d.get("VClass", ""),
        "engine": f"{d.get('cylinders') or '-'} cyl, {d.get('displ') or '-'} L {d.get('eng_dscr') or ''}".strip(),
        "transmission": d.get("trany", ""),
        "drive": d.get("drive", ""),
        "fuel": d.get("fuelType", ""),
        "mpg": f"{d.get('city08')} city / {d.get('highway08')} hwy / {d.get('comb08')} combined",
        "ev_range": d.get("range") if d.get("range") not in (None, "0", 0) else None,
        "epa_id": option["value"],
    }


def fetch_make(year, make):
    models = [m["value"] for m in menu(f"model?year={year}&make={quote(make)}")]
    jobs = [(model, opt) for model in models for opt in menu(f"options?year={year}&make={quote(make)}&model={quote(model)}")]
    with ThreadPoolExecutor(max_workers=4) as pool:
        configs = list(pool.map(lambda j: fetch_config(year, make, *j), jobs))
    try:
        cats = nhtsa_categories(make, year)
    except requests.RequestException:
        cats = {}
    for c in configs:
        c["body_type"] = body_type(c["class"])
        c["nhtsa_category"] = match_category(c["model"], cats)
    return models, configs


def write_report(path, year, results, elapsed):
    total_models = sum(len(m) for m, _ in results.values())
    total_cfg = sum(len(c) for _, c in results.values())
    matched = sum(1 for _, cfgs in results.values() for c in cfgs if c["nhtsa_category"])
    lines = [
        f"VEHICLE CATALOG TEST - model year {year}",
        f"Brands: {len(results)} | Models: {total_models} | Configurations: {total_cfg} | "
        f"NHTSA category matched: {matched}/{total_cfg} | Time: {elapsed:.0f}s",
        "Sources: fueleconomy.gov (EPA) specs, NHTSA vPIC categories",
        "=" * 100,
    ]
    for make, (models, configs) in results.items():
        lines.append(f"\n### {make}  ({len(models)} models, {len(configs)} configurations)")
        by_body = defaultdict(list)
        for c in configs:
            by_body[c["body_type"]].append(c)
        for body in sorted(by_body):
            lines.append(f"\n  [{body}]")
            for c in sorted(by_body[body], key=lambda x: (x["model"], x["option"])):
                lines.append(f"    - {c['model']}  |  {c['option']}")
                lines.append(
                    f"        class: {c['class']} | NHTSA: {c['nhtsa_category'] or 'no match'} | "
                    f"engine: {c['engine']} | trans: {c['transmission']} | drive: {c['drive']}"
                )
                ev = f" | EV range: {c['ev_range']} mi" if c["ev_range"] else ""
                lines.append(f"        fuel: {c['fuel']} | MPG: {c['mpg']}{ev} | epa_id: {c['epa_id']}")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main(year, limit):
    start = time.time()
    makes = [m["value"] for m in menu(f"make?year={year}")][:limit]
    print(f"Year {year}: fetching {len(makes)} brands: {', '.join(makes)}")
    results = {}
    for make in makes:
        try:
            results[make] = fetch_make(year, make)
            print(f"  {make}: {len(results[make][0])} models, {len(results[make][1])} configs")
        except requests.RequestException as e:
            print(f"  {make}: FAILED ({e})")
    out = Path(__file__).parent / f"catalog_{year}.txt"
    write_report(out, year, results, time.time() - start)
    print(f"Wrote {out} in {time.time() - start:.0f}s")


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 2025, int(sys.argv[2]) if len(sys.argv) > 2 else 20)
