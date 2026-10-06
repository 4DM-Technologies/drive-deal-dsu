"""Drives web_search_agent's crawling tools (get_urls + process_url) for one question and prints every
pipeline stage's input/output: make inference, the site-scoped and open search queries, raw search results,
domain filtering, LLM relevance scoring, which fetch method won each crawl, and the final extracted specs.

Only exercises src/agents/tools/web_search.py directly - no orchestrator, no kb_agent, no compose. Uses the
real DuckDuckGo/Google providers and a real LlmClient (same credential resolution as the app), so results
reflect production behavior, not mocks.

Writes the full trace plus final results as JSON (default: trace_output.json) and also prints it, same
pattern as testing/car-scraper-poc/trace_run.py.

Mirrors production's own fallback behavior (src/agents/serra/graph.py's `_resolve_one`): candidates are tried
in ranked order and it keeps going past a blocked/empty one until `--wanted` URLs have yielded real specs, or
the ranked list runs out - a single site blocking the crawler (bot protection, 403, etc.) does not by itself
mean "no data found".

Usage (run from the backend/ directory so the src package resolves):
    python scripts/trace_web_search.py --query "what is the bmw x3 car's specialty"
    python scripts/trace_web_search.py --query "best electric cars" --wanted 2
    python scripts/trace_web_search.py --query "tesla model 3" --no-score   (compare: scoring off)
    python scripts/trace_web_search.py --query "..." --out results/bmw_x3.json
"""

import argparse
import asyncio
import json
import sys
from pathlib import Path

# Windows consoles default to cp1252, which can't print characters that routinely show up in scraped page
# titles/snippets (curly quotes, em dashes, non-Latin text) - without this, printing one crashes the whole
# run partway through. UTF-8 with "replace" never raises, worst case an odd character prints as U+FFFD.
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.agents.llm import LlmClient  # noqa: E402
from src.agents.tools.web_search import get_urls, process_url  # noqa: E402
from src.database import SessionFactory, dispose_engine  # noqa: E402


def _print_stage(stage: dict) -> None:
    name = stage.get("stage", "?")
    print(f"\n{'=' * 70}\nSTAGE: {name}\n{'-' * 70}")
    for key, value in stage.items():
        if key == "stage":
            continue
        text = json.dumps(value, indent=2, ensure_ascii=False) if not isinstance(value, str) else value
        if len(text) > 2000:
            text = text[:2000] + f"\n... [truncated, {len(text)} chars total]"
        print(f"{key}:\n{text}")


async def main(query: str, wanted: int, use_scoring: bool, out_path: str) -> dict:
    async with SessionFactory() as session:
        llm = LlmClient(session) if use_scoring else None

        search_trace: list[dict] = []
        candidates = await get_urls(query, llm=llm, trace=search_trace)
        for stage in search_trace:
            _print_stage(stage)

        print(f"\n{'#' * 70}\nFINAL SEARCH CANDIDATES ({len(candidates)}):")
        for i, candidate in enumerate(candidates):
            print(f"  {i + 1}. [{candidate['source_domain']}] {candidate['url']}")

        crawl_llm = llm or LlmClient(session)
        crawl_traces: list[dict] = []
        results = []
        successes = 0
        for candidate in candidates:
            if successes >= wanted:
                break
            crawl_trace: list[dict] = []
            specs = await process_url(crawl_llm, candidate["url"], trace=crawl_trace)
            for stage in crawl_trace:
                _print_stage(stage)
            crawl_traces.append({"url": candidate["url"], "trace": crawl_trace})
            results.append({"url": candidate["url"], "specs": specs.model_dump() if specs else None})
            if specs:
                successes += 1
            else:
                print(f"\n>>> {candidate['url']} yielded nothing (blocked/empty) - trying the next candidate...")

        print(f"\n{'#' * 70}\nFINAL EXTRACTED RESULTS ({successes}/{wanted} wanted, {len(results)} URLs attempted):")
        print(json.dumps(results, indent=2, ensure_ascii=False))

        await session.rollback()  # debug run only - don't persist LlmAudit rows for throwaway trace calls
    await dispose_engine()

    output = {
        "query": query,
        "search_trace": search_trace,
        "search_candidates": candidates,
        "crawl_traces": crawl_traces,
        "final_results": results,
    }
    Path(out_path).write_text(json.dumps(output, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nFull trace + results written to {out_path}")
    return output


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Trace web_search_agent's crawling tools stage by stage.")
    parser.add_argument("--query", required=True, help="User question to feed into get_urls()")
    parser.add_argument(
        "--wanted", type=int, default=1, help="How many successful extractions to collect before stopping"
    )
    parser.add_argument("--no-score", action="store_true", help="Disable LLM scoring, to compare against it")
    parser.add_argument("--out", default="trace_output.json", help="Where to write the JSON trace + results")
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    asyncio.run(main(args.query, args.wanted, use_scoring=not args.no_score, out_path=args.out))
