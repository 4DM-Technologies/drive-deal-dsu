"""The test file: give it one or more queries, get back one detailed JSON report per query
(timing per stage, method used per stage, tokens used, end result) plus a console summary
table so you can compare queries/runs at a glance.

Usage:
    python test_queries.py "BMW M6 under 50000"
    python test_queries.py "BMW M6 under 50000" "Tesla Model 3 under 35000"
    python test_queries.py --file queries.txt          # one query per line
    python test_queries.py                             # runs the built-in sample queries

Output:
    results/<timestamp>/<n>_<slug>.json   - one full QueryReport per query
    results/<timestamp>/_batch_summary.json - every report's `summary` block side by side
"""

import argparse
import asyncio
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from models import QueryReport
from pipeline import run_pipeline

RESULTS_DIR = Path(__file__).parent / "results"

SAMPLE_QUERIES = [
    "BMW M6 for sale USA under 50000",
    "Tesla Model 3 under 35000",
]


def _slugify(query: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", query.lower()).strip("_")
    return slug[:50] or "query"


def _print_report_line(index: int, report: QueryReport) -> None:
    s = report.summary
    print(
        f"[{index}] {report.query!r}\n"
        f"    duration={s['total_duration_ms']}ms  "
        f"search_results={s['search_results_found']['total']} {s['search_results_found']['by_provider']}  "
        f"candidates={s['candidates_after_dedup']}  crawled={s['candidates_crawled']} {s['crawl_method_breakdown']}  "
        f"extracted={s['pages_extracted']}  tokens={s['total_tokens']['total_tokens']}"
    )
    for vehicle in s["vehicles_found"]:
        print(f"      -> {vehicle['year'] or '?'} {vehicle['make'] or '?'} {vehicle['model'] or '?'} "
              f"${vehicle['price_usd'] or '?'}  ({vehicle['source_url']})")
    if report.errors:
        print(f"    errors: {report.errors}")


async def run_batch(queries: list[str]) -> Path:
    run_dir = RESULTS_DIR / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    run_dir.mkdir(parents=True, exist_ok=True)

    batch_summary = []
    batch_start = time.perf_counter()

    for i, query in enumerate(queries, start=1):
        report = await run_pipeline(query)

        out_path = run_dir / f"{i}_{_slugify(query)}.json"
        out_path.write_text(json.dumps(report.model_dump(), indent=2), encoding="utf-8")

        _print_report_line(i, report)
        batch_summary.append({"index": i, "file": out_path.name, **report.summary, "query": report.query})

    batch_duration_ms = (time.perf_counter() - batch_start) * 1000
    total_tokens = sum(s["total_tokens"]["total_tokens"] for s in batch_summary)
    summary_path = run_dir / "_batch_summary.json"
    summary_path.write_text(
        json.dumps(
            {
                "queries_run": len(queries),
                "batch_duration_ms": round(batch_duration_ms, 1),
                "total_tokens_all_queries": total_tokens,
                "results": batch_summary,
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    print(f"\n=== Batch done: {len(queries)} quer{'y' if len(queries) == 1 else 'ies'} in "
          f"{batch_duration_ms:.0f}ms, {total_tokens} tokens total ===")
    print(f"Reports written to: {run_dir}")
    return run_dir


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run one or more queries through the poc-2 research pipeline.")
    parser.add_argument("queries", nargs="*", help="Query strings to run (each becomes one report)")
    parser.add_argument("--file", default=None, help="Path to a text file with one query per line")
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    queries = list(args.queries)
    if args.file:
        queries.extend(line.strip() for line in Path(args.file).read_text(encoding="utf-8").splitlines() if line.strip())
    if not queries:
        queries = SAMPLE_QUERIES
        print(f"No queries given - running {len(queries)} built-in sample quer{'y' if len(queries)==1 else 'ies'}.")

    asyncio.run(run_batch(queries))


if __name__ == "__main__":
    sys.exit(main() or 0)
