# Vehicle catalog: data findings and load rules

This document is the specification for the catalog sync, implemented in `backend/src/services/catalog/` and run
with `backend/scripts/sync_vehicle_catalog.py` (add `--dry-run` to validate without writing). It explains what the proof-of-concept output in
`catalog_2025.txt` contains, what is wrong with it, which source to use instead, and the exact rules for turning
source records into rows of the three catalog tables.

- Tables: `catalog_makes`, `catalog_models`, `catalog_variants` in `backend/src/repositories/schema/tables.py`
- Migration: `backend/alembic/versions/20261009_0008_vehicle_catalog.py`
- Diagram: `define/catalog-schema.puml`

Every number below was measured on 2026-10-09 against live data, not estimated.

## 1. Summary

1. **The POC data is accurate.** 20 randomly chosen rows were re-fetched from the live EPA API and all 20 matched
   on make, model, drive, transmission and MPG. The 2025 BMW M3 rows match BMW's published US lineup exactly.
2. **The POC output is incomplete and not yet structured.** It stopped after 20 of 48 brands, lists variants as
   "models", hides hybrids, and repeats names.
3. **Use the EPA bulk CSV, not the per-vehicle API.** One 2.2 MB download replaces about 2,400 API calls for one year, takes
   seconds instead of minutes, and includes two fields the POC never used: `baseModel` and `atvType`.
4. **NHTSA vPIC is not needed for the tables.** Body style can be derived from EPA data alone, and NHTSA's model
   names are not usable as model families.
5. **The rules in section 6 were prototyped on the full 2025 and 2026 EPA data.** Every row mapped to an allowed
   value, and the resulting families and variants match real lineups.

## 2. What `catalog_2025.txt` contains

The file was produced by `fetch_catalog.py` for model year 2025 with a 20-brand limit.

| Measure | Value |
|---|---|
| Brands | 20 (Acura to Hyundai, alphabetical) |
| Rows ("configurations") | 578 |
| Run time | 241 seconds |
| Sources | EPA REST API for specs, NHTSA vPIC for category |

Each row looks like this:

```text
    - M3 Competition M xDrive Sedan  |  Auto (S8), 6 cyl, 3.0 L, Turbo
        class: Compact Cars | NHTSA: Passenger Car | engine: 6 cyl, 3.0 L SIDI | trans: Automatic (S8) | drive: All-Wheel Drive
        fuel: Premium | MPG: 16 city / 23 hwy / 18 combined | epa_id: 47978
```

Rows are grouped under a body heading that the script derived from the EPA size class, such as `[SUV]` or
`[Car (Sedan/Coupe/Hatchback)]`.

## 3. Problems found in the POC output

| # | Problem | Evidence | Fix (section) |
|---|---|---|---|
| 1 | Only 20 of 48 brands for 2025 | EPA's 2025 make list has 48 brands. Kia, Toyota, Tesla, Nissan, Jeep, Ram, Mercedes-Benz, Subaru and others are missing | Load every make from the bulk file (5) |
| 2 | "Models" are really variants | The file reports "BMW 112 models". BMW actually has 24 model families in 2025 | Use `baseModel` as the family (6.3) |
| 3 | Hybrids are hidden | 77 mild-hybrid, hybrid and plug-in rows show only a gasoline grade such as "Regular" or "Premium". The hybrid flag is only in `atvType`, which the POC did not read | Map fuel from `atvType` (6.5) |
| 4 | Mild hybrids look like full hybrids | EPA marks 145 of the 2025 mild hybrids as `atvType=Hybrid`, for example the BMW M340i | Check `eng_dscr` for "Mild" (6.5) |
| 5 | Wheel sizes create fake variants | 67 rows carry a wheel size such as "i5 eDrive40 Sedan (19 inch Wheels)". They collapse to 31 real variants | Strip wheel text and merge (6.2, 6.8) |
| 6 | Repeated names within a brand | 70 names appear more than once, for example "Acura Integra" twice. Most differ by transmission or engine. The rest are EPA test setups a buyer cannot tell apart (stop-start, sport mode, police "Municipal") | Unique key plus merge (6.8) |
| 7 | 130 EVs have no engine data | Engine shows as "- cyl, - L" | Use "Electric motor" (6.6) |
| 8 | Body style is too coarse | "Car (Sedan/Coupe/Hatchback)" is one bucket of 187 rows | Derive from size class plus name (6.4) |
| 9 | Drive is repeated in the name | 103 names contain AWD, 90 contain 4WD, for example "Giulia AWD" | Strip drive words from the name (6.2) |
| 10 | NHTSA category missing for 25 rows | Ford F150, GMC Hummer EV Pickup, Genesis Electrified G80 and others did not match NHTSA names | Do not depend on NHTSA (4) |
| 11 | Non-retail vehicles included | "Hyundai Ioniq 5 Robo taxi", "Silverado Cab Chassis", "Sierra Cab Chassis" | Exclusion list (6.1) |
| 12 | EPA internal code names | "Ferrari F167 ABA" | Keep, but flag for review (8) |

## 4. Data sources compared

| Source | What it gives | Verdict |
|---|---|---|
| **EPA bulk CSV** `https://www.fueleconomy.gov/feg/epadata/vehicles.csv.zip` | Every EPA-rated vehicle from 1984 to 2027 in one file. 50,407 rows and 84 columns, including `baseModel` and `atvType`. Last modified 2026-09-29 | **Use as the only source** |
| EPA REST API `https://www.fueleconomy.gov/ws/rest/vehicle/...` | The same records, but one HTTP call per vehicle plus menu calls | Use only to spot-check single records |
| NHTSA vPIC `https://vpic.nhtsa.dot.gov/api/` | Make and model names by year and vehicle type | Not needed. Names are at variant level ("330i", "M340i"), not family level ("3 Series"). Without a vehicle-type filter it also returns motorcycles (BMW "R 1300 GS") |
| Paid data (Edmunds, DataOne and similar) | Trims, prices, colors, options | Out of scope. Consider later if MSRP or trim packages are needed |

The bulk file's coverage by model year:

| Model year | EPA rows | Makes |
|---|---|---|
| 2023 | 1,330 | 51 |
| 2024 | 1,277 | 49 |
| 2025 | 1,273 | 48 |
| 2026 | 1,172 | 46 |
| 2027 | 539 | 35 (still being published) |

## 5. Load process

1. Download the bulk zip into an empty temporary folder and read `vehicles.csv` with the standard `csv` module.
   Read it as UTF-8 with `errors="replace"`.
2. Keep only the configured model years. Start with the last four years plus the next year, currently 2023 to 2027.
3. Drop excluded rows (6.1).
4. Normalize every remaining row into a variant record (6.2 to 6.7).
5. Group records by the unique key and merge each group (6.8).
6. Upsert in order: makes, then models, then variants. Use the natural keys:
   - make: `slug`
   - model: `(make_id, slug)`
   - variant: `(model_id, model_year, name, engine, transmission, drive_type, fuel_type)`
7. Set `is_active = false` on any make, model or variant in the synced years that the new file no longer contains.
   Never delete rows, because other features may reference them later.
8. Run the validation checks (7) inside the same transaction. Roll back the whole load if any check fails.
9. Log one summary line: years, makes, models, variants, merged groups, excluded rows, and run time.

Set `created_by` and `updated_by` to `catalog-sync`. The script must be safe to run again: a second run with the
same file must change nothing.

## 6. Normalization rules

### 6.1 Exclusions

Drop a row when its `model` matches this pattern, case-insensitive:

```python
EXCLUDE = re.compile(r"\b(cab chassis|robo ?taxi|police|ppv)\b", re.I)
```

This removed 5 rows in 2025 and 5 in 2026. Rows marked "Municipal" in `eng_dscr` are not dropped. They merge into
the normal variant instead (6.8).

### 6.2 Variant name

Start from EPA `model` and apply, in order:

1. Remove wheel and tire text in brackets: `re.sub(r"\s*\((?:[^)]*\b(?:inch|in\.|wheels?|tires?)\b[^)]*)\)", "", name, flags=re.I)`
2. Remove drive words, because drive has its own column: `re.sub(r"\b(2WD|4WD|AWD|FWD|RWD|4x4|4x2)\b", "", name, flags=re.I)`
3. Collapse repeated spaces and trim.

Keep brand drive names such as "xDrive", "quattro" and "4MATIC", because buyers use them to tell variants apart.

| EPA `model` | `name` |
|---|---|
| `i5 eDrive40 Sedan (19 inch Wheels)` | `i5 eDrive40 Sedan` |
| `F150 Pickup 4WD HEV` | `F150 Pickup HEV` |
| `Giulia AWD` | `Giulia` |

### 6.3 Model family (`catalog_models.name`)

Use EPA `baseModel`. It was present on every 2025 row and groups variants correctly, with one exception. BMW
uses `baseModel = "M"` for the M2, M3, M4, M5 and M8 together. For that case, use the first word of `model`.

```python
def family(row):
    base = row["baseModel"].strip()
    if row["make"] == "BMW" and base == "M":
        return row["model"].split()[0]  # M2, M3, M4, M5, M8
    return base
```

A scan of all 2025 data found no other family that was too broad. Mercedes-Benz puts AMG versions inside their
class, for example "AMG E53" under "E-Class". That is correct for buyers.

The resulting 2025 BMW families are 2 Series, 3 Series, 4 Series, 5 Series, 7 Series, 8 Series, M2, M3, M4, M5,
M8, X1, X2, X3, X4, X5, X6, X7, XM, Z4, i4, i5, i7 and iX.

`slug` is the lower-case name with every run of non-letters and non-digits replaced by one hyphen, for example
"3-series" or "m3". The same rule applies to make slugs, for example "mercedes-benz".

`trim_name` is the variant name with the family name removed from the front and body words removed, or `NULL` if
nothing is left. For example, "M3 Competition M xDrive Sedan" in family "M3" gives "Competition M xDrive".

### 6.4 Body style

Apply the first rule that matches. Use the EPA `VClass` and the cleaned name from 6.2.

| Order | Condition | `body_style` |
|---|---|---|
| 1 | `VClass` contains "Sport Utility" | SUV |
| 2 | `VClass` contains "Pickup" | Truck |
| 3 | `VClass` contains "Minivan" | Minivan |
| 4 | `VClass` contains "Special Purpose" and the name contains van, transit, promaster, sprinter or metris | Van |
| 5 | `VClass` contains "Special Purpose" | SUV |
| 6 | `VClass` contains "Wagon" | Wagon |
| 7 | Name contains convertible, cabriolet, cabrio, roadster, spider, spyder or volante | Convertible |
| 8 | Name contains hatchback, 5-door, 5dr, sportback or liftback, or the family is GTI or Golf | Hatchback |
| 9 | Name contains "coupe" but not "gran coupe" | Coupe |
| 10 | `VClass` is "Two Seaters" | Coupe |
| 11 | Anything else | Sedan |

"Gran Coupe" is a four-door model, so it falls through to Sedan. 2025 result: SUV 569, Sedan 307, Truck 123,
Coupe 70, Wagon 32, Convertible 28, Hatchback 14, Minivan 11. No merged group had rows that disagreed.

### 6.5 Fuel type

| EPA data | `fuel_type` |
|---|---|
| `atvType = "EV"` | Electric |
| `atvType = "Plug-in Hybrid"` | Plug-in hybrid |
| `atvType = "Hybrid"` and `eng_dscr` contains "mild" | Mild hybrid |
| `atvType = "Hybrid"` | Hybrid |
| `atvType` is "FCV" or "eFCV" | Hydrogen |
| `atvType = "Diesel"` or `fuelType = "Diesel"` | Diesel |
| `atvType = "FFV"` | Flex fuel |
| Anything else | Gasoline |

The live data uses "Plug-in Hybrid", not "PHEV", even though some documentation lists the code as PHEV. Match the
live value. 2025 result: Gasoline 571, Electric 271, Mild hybrid 143, Hybrid 74, Plug-in hybrid 67, Diesel 16,
Flex fuel 8, Hydrogen 4.

### 6.6 Engine, transmission and drive

| Column | Rule | Example |
|---|---|---|
| `engine` | EV: "Electric motor". Fuel cell: "Fuel cell". Otherwise `f"{cylinders} cyl {displ} L"`, adding " Turbo" when `tCharger` is set or " Supercharged" when `sCharger` is set | `6 cyl 3.0 L Turbo` |
| `transmission` | "Manual" if `trany` starts with "Manual", otherwise "Automatic" | `Automatic` |
| `drive_type` | "All-Wheel Drive" gives AWD. "4-Wheel Drive" and "Part-time 4-Wheel Drive" give 4WD. "Front-Wheel Drive" gives FWD. "Rear-Wheel Drive" and "2-Wheel Drive" give RWD | `AWD` |

The engine column is required because it is part of the unique key. In PostgreSQL a NULL would let duplicate rows
through the unique constraint.

### 6.7 Efficiency and source columns

| Column | Source |
|---|---|
| `mpg_city`, `mpg_highway`, `mpg_combined` | `city08`, `highway08`, `comb08`. For EVs these values are MPGe |
| `ev_range_miles` | Electric: `range`. Plug-in hybrid: `rangeA`, because `range` is the combined gas and electric range (Alfa Romeo Tonale: `range` 360, `rangeA` 33). Everything else: NULL. Store NULL instead of 0 |
| `epa_vehicle_ids` | Every EPA `id` merged into the variant, as strings, sorted |
| `source_payload` | `{"source": "epa_bulk", "record": {...}}` holding the non-empty CSV fields of the representative record (6.8). The file's Last-Modified date is logged, not stored, so an unchanged vehicle is not rewritten every month |

### 6.8 Merging duplicates

Group records by `(make, family, name, engine, transmission, drive_type, fuel_type, model_year)`. In 2025, 96
groups had more than one EPA record. For each group:

- `epa_vehicle_ids` is the union of all ids.
- The representative record is the one without "Municipal", "Sport Mode" or "Stop-Start" in `eng_dscr`. If none
  qualifies, use the lowest id.
- MPG and range come from the representative record.

Measured effect: 2025 goes from 1,273 EPA rows to 1,154 variants across 48 makes and 313 model families. 2026 goes
from 1,172 rows to 1,095 variants across 46 makes and 288 families.

### 6.9 Link to marketplace brands

After upserting makes, set `brand_id` where a row in the existing `brands` table has the same name, ignoring case.
Leave it NULL otherwise. The catalog must never insert into or change `brands`. Names differ in a few places, so
keep a small mapping such as `{"INEOS Automotive": "INEOS"}` if one is needed.

## 7. Validation checks after each load

Fail the load if any check is false.

| Check | Expected |
|---|---|
| Makes in the latest complete model year | at least 40 |
| Variants in each complete model year (every synced year except the newest) | at least 900 |
| Variants per family | at least 1 |
| Required columns empty | 0 rows |
| BMW 2025 M3 variants | exactly 3: M3 Sedan (manual, RWD), M3 Competition Sedan (RWD), M3 Competition M xDrive Sedan (AWD) |
| Toyota 2025 RAV4 variants | include fuel types Gasoline, Hybrid and Plug-in hybrid |
| Second run with the same file | 0 inserts and 0 updates |

The M3 check uses a fact confirmed against BMW's published 2025 US lineup.

## 8. Known limitations and open decisions

- **No prices.** EPA has no MSRP. The budget question must use fixed ranges until a price source is chosen.
- **Heavy trucks and vans are missing.** EPA does not rate vehicles over 8,500 lb gross vehicle weight, so the Ford
  F-250 and F-350, the Ram 2500 and 3500, and full-size Transit and Sprinter vans are absent. 2025 has 0 Van rows
  for this reason. Questions about them must fall back to the LLM path.
- **Brands not sold in the US are missing**, for example Mahindra. That is correct for a US marketplace.
- **Some hatchbacks may appear as Sedan.** EPA size classes do not say hatchback. Rule 8 catches every 2025 case
  found (Civic 5Dr, Mazda 3 5-Door, Corolla Hatchback, GTI, Golf R, Audi Sportbacks), but a new model with an
  unusual name will default to Sedan. Review the Sedan list after each new model year.
- **Seats, colors and option packages are not available** from EPA.
- **New model years arrive gradually.** 2027 has only 35 makes so far. Re-run the sync monthly.
- **EPA internal names** such as "Ferrari F167 ABA" pass through unchanged. Review rare makes after the first load.

## 9. How this was verified

| Check | Method | Result |
|---|---|---|
| POC rows match the live source | Re-fetched 20 random `epa_id` values from the EPA REST API | 20 of 20 identical |
| Brand coverage | EPA make menu for 2025 | 48 makes; the POC has 20 |
| BMW M3 lineup | BMW press release and independent reviews | 3 variants for 2025, the same as EPA |
| Heavy-duty exclusion | fueleconomy.gov rating rules | Vehicles over 8,500 lb are not rated |
| Bulk file freshness | HTTP headers | 2.2 MB, Last-Modified 2026-09-29 |
| Normalization rules | Prototype run on all 2025 and 2026 bulk rows | 0 unmapped values; families and variants as in 6.3 and 6.8 |
| Turbo and supercharger flags | Bulk CSV values for 2025 | `tCharger` is "T" or empty; `sCharger` is "S" or empty |
| Plug-in hybrid range fields | Bulk CSV values for 2025 | All 67 plug-in rows have `rangeA` above 0 |

## 10. Sources

- [EPA vehicle data downloads, vehicles.csv.zip](https://www.fueleconomy.gov/feg/download.shtml)
- [FuelEconomy.gov web services](https://fueleconomy.gov/feg/ws)
- [FuelEconomy.gov vehicle field definitions](https://apis.io/schemas/fueleconomy/vehicle/)
- [Which vehicles fueleconomy.gov rates](https://fueleconomy.gov/feg/info.shtml)
- [Why heavy-duty pickups have no EPA rating](https://www.greencarreports.com/news/1105494_youll-never-know-the-epa-ratings-of-heavy-duty-pickup-trucks-heres-why)
- [BMW Group press release: the new 2025 BMW M3](https://press.bmwgroup.com/usa/article/detail/T0442408EN_US/the-new-2025-bmw-m3)
- [Kelley Blue Book: 2025 BMW M3](https://www.kbb.com/bmw/m3/2025/)
- [NHTSA vPIC API](https://vpic.nhtsa.dot.gov/api/)
