"""Stage 2: URL PROCESSOR (see parent doc, section 8-9) - canonicalize, deduplicate,
drop excluded/non-US-market domains, check robots.txt. No LLM involved anywhere here.
"""

import asyncio
import re
import time
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse
from urllib.robotparser import RobotFileParser

import httpx

from config import EXCLUDED_REFERENCE_DOMAINS, settings
from models import CandidateUrl, SearchResult, StageTiming
from utils import logger

USER_AGENT = "poc-2/0.1 (research project)"

_NON_US_LOCALE_PATH = re.compile(r"/(?!en[-_]us\b)[a-z]{2}[-_][a-z]{2}(?:/|$)", re.IGNORECASE)

_TRACKING_PARAMS = {
    "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
    "fbclid", "gclid", "msclkid", "ref", "src",
}


def canonicalize_url(url: str) -> str:
    """Strips tracking params, lowercases the host, drops a trailing slash and fragment -
    the minimum needed so 'cars.com/x/123?utm_source=google' and 'cars.com/x/123/' collapse
    to the same key for deduplication (parent doc, section 8)."""
    parsed = urlparse(url)
    kept_query = [(k, v) for k, v in parse_qsl(parsed.query, keep_blank_values=True) if k.lower() not in _TRACKING_PARAMS]
    path = parsed.path.rstrip("/") or "/"
    return urlunparse((parsed.scheme.lower(), parsed.netloc.lower(), path, "", urlencode(kept_query), ""))


def _domain_of(url: str) -> str | None:
    netloc = urlparse(url).netloc.lower()
    if netloc.startswith("www."):
        netloc = netloc[4:]
    return netloc or None


def _is_excluded_domain(domain: str) -> bool:
    return any(domain == excluded or domain.endswith(f".{excluded}") for excluded in EXCLUDED_REFERENCE_DOMAINS)


def _is_us_market_url(url: str) -> bool:
    return not _NON_US_LOCALE_PATH.search(urlparse(url).path)


async def _fetch_robots_parser(client: httpx.AsyncClient, origin: str) -> RobotFileParser | None:
    """Fetches/parses robots.txt once per origin (scheme://host). Returns None to mean
    "couldn't verify -> conservative skip everything on this origin", matching the old
    per-URL behavior's except-branch."""
    parser = RobotFileParser()
    try:
        response = await client.get(f"{origin}/robots.txt", headers={"User-Agent": USER_AGENT})
        if response.status_code >= 400:
            parser.parse([])  # no robots.txt -> allow everything by default
            return parser
        parser.parse(response.text.splitlines())
        return parser
    except httpx.HTTPError:
        return None


async def dedupe_and_filter(results: list[SearchResult]) -> tuple[list[CandidateUrl], StageTiming]:
    start = time.perf_counter()
    by_canonical: dict[str, CandidateUrl] = {}
    dropped: list[dict] = []
    pending: list[SearchResult] = []  # survived the cheap, non-IO filters - still need robots.txt

    for result in results:
        domain = _domain_of(result.url)
        if not domain:
            dropped.append({"url": result.url, "reason": "unparsable"})
            continue
        if _is_excluded_domain(domain):
            dropped.append({"url": result.url, "reason": "excluded_domain"})
            continue
        if not _is_us_market_url(result.url):
            dropped.append({"url": result.url, "reason": "non_us_locale"})
            continue

        canonical = canonicalize_url(result.url)
        if canonical in by_canonical:
            # Same listing seen from another provider/query - merge provenance instead
            # of crawling (or robots-checking) it twice.
            existing = by_canonical[canonical]
            if result.provider not in existing.providers:
                existing.providers.append(result.provider)
            if result.snippet and not existing.snippet:
                existing.snippet = result.snippet
            continue

        by_canonical[canonical] = None  # placeholder - reserves the slot/order
        pending.append(result)

    # robots.txt checks are the only network I/O in this stage - run every one concurrently
    # instead of one at a time, and fetch each distinct origin's robots.txt only once (shared
    # via one asyncio.Task per origin) even when several pending URLs share a domain.
    async with httpx.AsyncClient(timeout=settings.request_timeout_seconds) as client:
        origin_tasks: dict[str, asyncio.Task] = {}

        def _origin_parser(url: str) -> asyncio.Task:
            parsed = urlparse(url)
            origin = f"{parsed.scheme}://{parsed.netloc}"
            if origin not in origin_tasks:
                origin_tasks[origin] = asyncio.create_task(_fetch_robots_parser(client, origin))
            return origin_tasks[origin]

        parser_tasks = [_origin_parser(result.url) for result in pending]
        parsers = await asyncio.gather(*parser_tasks)

    for result, parser in zip(pending, parsers, strict=True):
        canonical = canonicalize_url(result.url)
        domain = _domain_of(result.url)
        if parser is None or not parser.can_fetch(USER_AGENT, result.url):
            del by_canonical[canonical]
            dropped.append({"url": result.url, "reason": "robots_disallowed"})
            continue
        by_canonical[canonical] = CandidateUrl(
            url=result.url,
            canonical_url=canonical,
            title=result.title,
            snippet=result.snippet,
            source_domain=domain,
            providers=[result.provider],
        )

    candidates = [c for c in by_canonical.values() if c is not None]
    duration_ms = (time.perf_counter() - start) * 1000
    logger.info(f"[url_filter] {len(results)} raw -> {len(candidates)} unique candidates ({len(dropped)} dropped)")
    timing = StageTiming(
        stage="url_filter",
        method="canonicalize+dedupe+parallel_robots",
        duration_ms=duration_ms,
        detail={"raw_count": len(results), "kept": len(candidates), "dropped": dropped},
    )
    return candidates, timing
