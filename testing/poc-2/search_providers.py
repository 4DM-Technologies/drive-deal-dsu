"""Stage 1: SEARCH MANAGER (see parent doc, section 7/34/48).

Both providers run concurrently via asyncio.gather and are independent: either one can
be disabled, time out, or error without failing the query - that's the resilience pattern
already proven in backend/src/agents/tools/web_search.py's _search_providers, just fanned
out to "both at once" instead of "fallback in sequence", since the whole point of this POC
is comparing them side by side.

DuckDuckGo: via the `ddgs` library, no API key needed, synchronous under the hood (run via
asyncio.to_thread).

SearXNG: a self-hosted metasearch engine that itself aggregates multiple backends (Google,
Bing, Brave, etc. depending on its config) - see parent doc section 35. Queried over HTTP
with `&format=json`. Requires a running instance; see README.md for a one-line docker run.
"""

import time

import httpx

from config import settings
from models import SearchResult, StageTiming
from utils import logger


def _search_duckduckgo_sync(query: str, num_results: int) -> list[dict]:
    """Synchronous (ddgs has no native async API) - called via asyncio.to_thread."""
    from ddgs import DDGS
    from ddgs.exceptions import DDGSException

    results: list[dict] = []
    try:
        with DDGS() as ddgs:
            for item in ddgs.text(query, max_results=num_results):
                url = item.get("href") or item.get("link")
                if url:
                    results.append(
                        {
                            "url": url,
                            "title": item.get("title", ""),
                            "snippet": item.get("body") or item.get("description") or "",
                        }
                    )
    except DDGSException as exc:
        logger.warning(f"[duckduckgo] query failed: {exc}")
    return results


async def search_duckduckgo(query: str, num_results: int) -> tuple[list[SearchResult], StageTiming]:
    import asyncio

    start = time.perf_counter()
    error: str | None = None
    try:
        raw = await asyncio.to_thread(_search_duckduckgo_sync, query, num_results)
    except Exception as exc:  # noqa: BLE001 - provider outage must never kill the query
        logger.warning(f"[duckduckgo] unavailable: {exc}")
        raw, error = [], str(exc)[:300]
    duration_ms = (time.perf_counter() - start) * 1000
    results = [SearchResult(url=r["url"], title=r["title"], snippet=r["snippet"], provider="duckduckgo") for r in raw]
    timing = StageTiming(
        stage="search_duckduckgo",
        method="duckduckgo",
        duration_ms=duration_ms,
        detail={"query": query, "raw_count": len(raw), "error": error},
    )
    return results, timing


async def search_searxng(query: str, num_results: int) -> tuple[list[SearchResult], StageTiming]:
    start = time.perf_counter()
    raw: list[dict] = []
    error: str | None = None
    try:
        async with httpx.AsyncClient(timeout=settings.request_timeout_seconds) as client:
            response = await client.get(
                f"{settings.searxng_url.rstrip('/')}/search",
                params={"q": query, "format": "json", "language": "en-US"},
                headers={"User-Agent": "poc-2/0.1 (research project)"},
            )
            response.raise_for_status()
            data = response.json()
        raw = [
            {"url": item["url"], "title": item.get("title", ""), "snippet": item.get("content", "")}
            for item in data.get("results", [])[:num_results]
            if "url" in item
        ]
    except Exception as exc:  # noqa: BLE001 - e.g. instance not running, connection refused
        logger.warning(f"[searxng] unavailable ({settings.searxng_url}): {exc}")
        error = str(exc)[:300]
    duration_ms = (time.perf_counter() - start) * 1000
    results = [SearchResult(url=r["url"], title=r["title"], snippet=r["snippet"], provider="searxng") for r in raw]
    timing = StageTiming(
        stage="search_searxng",
        method="searxng",
        duration_ms=duration_ms,
        detail={"query": query, "raw_count": len(raw), "error": error, "instance": settings.searxng_url},
    )
    return results, timing


async def search_all(query: str) -> tuple[list[SearchResult], list[StageTiming]]:
    """Runs every enabled provider concurrently, returns the merged raw results (not yet
    deduped/ranked - that's url_filter.py + ranking.py) plus one StageTiming per provider."""
    import asyncio

    tasks = []
    if settings.enable_duckduckgo:
        tasks.append(search_duckduckgo(query, settings.max_results_per_provider))
    if settings.enable_searxng:
        tasks.append(search_searxng(query, settings.max_results_per_provider))

    if not tasks:
        return [], [StageTiming(stage="search_all", method="none", detail={"error": "no providers enabled"})]

    outcomes = await asyncio.gather(*tasks)
    all_results: list[SearchResult] = []
    timings: list[StageTiming] = []
    for results, timing in outcomes:
        all_results.extend(results)
        timings.append(timing)
    return all_results, timings
