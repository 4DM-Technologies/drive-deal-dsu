"""Orchestrates the full new-architecture flow for one query and records everything:

    query -> search (DuckDuckGo + SearXNG, concurrent)
          -> dedupe/canonicalize/filter (robots.txt, domain/locale rules)
          -> rank (deterministic keyword score, no LLM)
          -> crawl (static fetch first, crawl4ai fallback)
          -> extract (LLM, schema-constrained)
          -> QueryReport (every stage's method/timing/tokens + final results)

This mirrors the parent doc's `agent.research()` controller (section 30), minus storage/
retrieval/verification, which are out of scope for this POC - the goal here is measuring
the live-crawl path (search -> crawl -> extract), not the cache/RAG path.
"""

import time
from datetime import datetime, timezone

from crawler import crawl_many
from extractor import extract_many
from models import QueryReport
from ranking import rank_candidates
from search_providers import search_all
from url_filter import dedupe_and_filter
from utils import logger


def _build_summary(report: QueryReport) -> dict:
    by_method: dict[str, int] = {}
    for c in report.crawl_results:
        by_method[c.method] = by_method.get(c.method, 0) + 1
    by_provider: dict[str, int] = {}
    for s in report.search_results:
        by_provider[s.provider] = by_provider.get(s.provider, 0) + 1

    return {
        "search_results_found": {"total": len(report.search_results), "by_provider": by_provider},
        "candidates_after_dedup": len(report.candidates),
        "candidates_crawled": len(report.crawl_results),
        "crawl_method_breakdown": by_method,
        "pages_extracted": len(report.final_results),
        "total_tokens": report.total_tokens.model_dump(),
        "total_duration_ms": round(report.total_duration_ms, 1),
        "vehicles_found": [
            {"source_url": r.source_url, "make": r.make, "model": r.model, "year": r.year, "price_usd": r.price_usd}
            for r in report.final_results
        ],
    }


async def run_pipeline(query: str) -> QueryReport:
    started = datetime.now(timezone.utc)
    report = QueryReport(query=query, started_at=started.isoformat())
    pipeline_start = time.perf_counter()

    logger.info(f"[pipeline] query={query!r}")

    # Stage 1: search
    search_results, search_timings = await search_all(query)
    report.search_results = search_results
    report.stages.extend(search_timings)

    # Stage 2: dedupe/canonicalize/filter
    candidates, filter_timing = await dedupe_and_filter(search_results)
    report.candidates = candidates
    report.stages.append(filter_timing)

    # Stage 3: rank (deterministic, picks who actually gets crawled)
    selected, rank_timing = rank_candidates(query, candidates)
    report.stages.append(rank_timing)

    if not selected:
        report.errors.append("no crawlable candidates survived search+filter+rank")

    # Stage 4: crawl
    pages, crawl_results = await crawl_many([c.url for c in selected])
    report.crawl_results = crawl_results

    # Stage 5: extract
    specs, extract_timings = await extract_many(pages)
    report.final_results = specs
    report.stages.extend(extract_timings)
    for t in extract_timings:
        if t.tokens:
            report.total_tokens = report.total_tokens + t.tokens

    finished = datetime.now(timezone.utc)
    report.finished_at = finished.isoformat()
    report.total_duration_ms = (time.perf_counter() - pipeline_start) * 1000
    report.summary = _build_summary(report)

    logger.info(
        f"[pipeline] done in {report.total_duration_ms:.0f}ms - "
        f"{len(report.final_results)} vehicle(s) extracted, {report.total_tokens.total_tokens} tokens used"
    )
    return report
