"""web_search_agent's two tools (ported from testing/car-scraper-poc/search_resolver.py + crawler.py +
llm_extractor.py, adapted to this app's async LlmClient instead of the PoC's standalone llm_client.py)."""

import asyncio
import json
import re
import sys
from html.parser import HTMLParser
from urllib.parse import urlparse
from urllib.robotparser import RobotFileParser

import httpx

from src.agents.llm import LlmClient
from src.agents.prompts import load_fragment
from src.agents.schemas import CarSpecs
from src.settings import (
    MAKE_DOMAIN_MAP,
    WEB_SEARCH_MAX_MARKDOWN_CHARS,
    WEB_SEARCH_USER_AGENT,
    get_settings,
)
from src.utils.log_flow import log_flow
from src.utils.logger import logger

# US-only: manufacturer sites often serve other markets under locale path segments like /en_AU/ or /de_de/.
_NON_US_LOCALE_PATH = re.compile(r"/(?!en[-_]us\b)[a-z]{2}[-_][a-z]{2}(?:/|$)", re.IGNORECASE)

# Generalist reference sites routinely outrank a manufacturer's own page in DuckDuckGo/Google results for
# "<make> <model> specs"-style queries, but they never originate manufacturer data - always skip them so the
# manufacturer's own page (or the MAKE_DOMAIN_MAP official fallback) is preferred instead.
_EXCLUDED_REFERENCE_DOMAINS = ("wikipedia.org", "wikiwand.com")

EXTRACTION_SCHEMA = CarSpecs.model_json_schema()


def _is_excluded_domain(domain: str) -> bool:
    return any(domain == excluded or domain.endswith(f".{excluded}") for excluded in _EXCLUDED_REFERENCE_DOMAINS)


def _trace_step(trace: list[dict] | None, stage: str, **data: object) -> None:
    """Opt-in instrumentation for scripts/trace_web_search.py - a no-op in production (trace=None)."""
    if trace is not None:
        trace.append({"stage": stage, **data})


class _ReadableHtmlParser(HTMLParser):
    """Small dependency-free fallback for pages that do not require JavaScript to expose their content."""

    _ignored = {"script", "style", "noscript", "svg", "template"}
    _blocks = {"article", "br", "div", "footer", "h1", "h2", "h3", "h4", "header", "li", "main", "p", "section"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._ignored_depth = 0
        self._parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in self._ignored:
            self._ignored_depth += 1
        elif not self._ignored_depth and tag in self._blocks:
            self._parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in self._ignored and self._ignored_depth:
            self._ignored_depth -= 1
        elif not self._ignored_depth and tag in self._blocks:
            self._parts.append("\n")

    def handle_data(self, data: str) -> None:
        if not self._ignored_depth and (text := " ".join(data.split())):
            self._parts.append(text)

    def text(self) -> str:
        return re.sub(r"\n{3,}", "\n\n", " ".join(self._parts)).strip()


@log_flow(layer="agent")
def _is_us_market_url(url: str) -> bool:
    return not _NON_US_LOCALE_PATH.search(urlparse(url).path)


@log_flow(layer="agent")
def _domain_of(url: str) -> str | None:
    """No allow-list: any public domain is crawlable (still subject to robots.txt and the US-market filter).
    Returns the root domain (leading "www." stripped) so candidates/sources keep a clean `source_domain`
    label, or None for an unparsable URL."""
    netloc = urlparse(url).netloc.lower()
    if netloc.startswith("www."):
        netloc = netloc[4:]
    return netloc or None


@log_flow(layer="agent")
async def _robots_allows(client: httpx.AsyncClient, url: str) -> bool:
    parsed = urlparse(url)
    robots_url = f"{parsed.scheme}://{parsed.netloc}/robots.txt"
    parser = RobotFileParser()
    try:
        response = await client.get(robots_url, headers={"User-Agent": WEB_SEARCH_USER_AGENT})
        if response.status_code >= 400:
            return True  # no robots.txt -> allowed by default
        parser.parse(response.text.splitlines())
    except httpx.HTTPError:
        return False  # can't verify -> conservative skip
    return parser.can_fetch(WEB_SEARCH_USER_AGENT, url)


@log_flow(layer="agent")
def _infer_make(query: str) -> str | None:
    """Find a supported manufacturer in a natural-language search query."""
    lowered = query.lower()
    return next((make for make in MAKE_DOMAIN_MAP if re.search(rf"\b{re.escape(make)}\b", lowered)), None)


def has_official_domain(query: str, make: str | None = None) -> bool:
    """True if `get_urls(query, make=make)` would scope its first search to a known official domain - i.e.
    a `force_open=True` retry is a genuinely different attempt, not a repeat of the same open search, worth
    doing only when every candidate from that scoped attempt failed to crawl (see graph.py's `_resolve_one`
    and `search_web`)."""
    return bool(MAKE_DOMAIN_MAP.get((make or _infer_make(query) or "").lower() or None))


@log_flow(layer="agent")
async def _search_google(client: httpx.AsyncClient, query: str, num_results: int) -> list[dict]:
    settings = get_settings()
    if not settings.google_api_key or not settings.google_cse_id:
        raise RuntimeError("Google Custom Search not configured (google_api_key / google_cse_id missing)")
    response = await client.get(
        "https://www.googleapis.com/customsearch/v1",
        params={
            "key": settings.google_api_key,
            "cx": settings.google_cse_id,
            "q": query,
            "num": min(num_results, 10),
        },
    )
    response.raise_for_status()
    data = response.json()
    return [
        {"url": item["link"], "title": item.get("title", ""), "snippet": item.get("snippet", "")}
        for item in data.get("items", [])
        if "link" in item
    ]


@log_flow(layer="agent")
def _search_duckduckgo(query: str, num_results: int) -> list[dict]:
    """Synchronous (ddgs has no native async API) - called via asyncio.to_thread."""
    from ddgs import DDGS

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
    except Exception as exc:
        # DDGS and its browser-impersonation transport evolve independently. A provider compatibility issue
        # must never terminate the user's streaming chat request.
        logger.warning("web_search_duckduckgo_failed", query=query, error=str(exc)[:200])
    return results


@log_flow(layer="agent")
async def _search_providers(client: httpx.AsyncClient, query: str, num_results: int) -> tuple[list[dict], str]:
    """Tries Google Custom Search first, falls back to DuckDuckGo when unset or failing. Never raises - a
    provider outage degrades to an empty result list, caller decides what to do next."""
    try:
        return await _search_google(client, query, num_results), "google"
    except Exception as exc:
        logger.info("web_search_provider_fallback", query=query, error=str(exc)[:200])
    try:
        return await asyncio.to_thread(_search_duckduckgo, query, num_results), "duckduckgo"
    except Exception as fallback_exc:
        logger.warning("web_search_all_providers_failed", query=query, error=str(fallback_exc)[:200])
        return [], "unavailable"


@log_flow(layer="agent")
async def _score_candidates(
    llm: LlmClient,
    query: str,
    candidates: list[dict[str, str]],
    thread_id: str | None = None,
    prompt_overrides: dict[str, str] | None = None,
) -> list[float]:
    """Cheap relevance scoring from title/domain/snippet alone - no page fetch happens here. Falls back to a
    neutral score for every candidate if the LLM response is missing or malformed, so a scoring hiccup
    degrades to "crawl in search-engine order" instead of discarding every candidate."""
    if not candidates:
        return []
    payload = [
        {"index": i, "title": c.get("title", ""), "domain": c.get("source_domain", ""), "snippet": c.get("snippet", "")}
        for i, c in enumerate(candidates)
    ]
    prompt = (
        f"{load_fragment('web_search_scoring.md', prompt_overrides)}\n\n"
        f"Query: {query}\n\n"
        f"Candidates (JSON array, 0-indexed):\n{json.dumps(payload)}"
    )
    try:
        # "minimal" effort - this is a cheap classification from title/snippet alone, not analysis, and a
        # higher effort burns its own reasoning tokens out of the same max_output_tokens budget, which can
        # truncate the actual JSON answer before it's written (see profile_kwargs("small_talk", "minimal")).
        completion = await llm.generate(
            prompt, "web_search_url_scoring", thread_id, reasoning_effort="minimal", max_output_tokens=500
        )
        data = _parse_json_object(completion.text)
        scores = [float(score) for score in data["scores"]]
        if len(scores) != len(candidates):
            raise ValueError(f"expected {len(candidates)} scores, got {len(scores)}")
        return scores
    except Exception as exc:
        logger.info("web_search_scoring_failed", query=query, error=str(exc)[:200])
        return [0.5] * len(candidates)


@log_flow(layer="agent")
async def get_urls(
    query: str,
    domains: list[str] | None = None,
    make: str | None = None,
    limit: int | None = None,
    llm: LlmClient | None = None,
    thread_id: str | None = None,
    trace: list[dict] | None = None,
    force_open: bool = False,
    prompt_overrides: dict[str, str] | None = None,
) -> list[dict[str, str]]:
    """Resolve a search query to robots.txt-permitting, US-market candidate URLs - no domain allow-list, any
    public site is eligible, but a manufacturer's own official domain (MAKE_DOMAIN_MAP) and a wider raw
    candidate pool are preferred when `llm` is supplied, see `_score_candidates`. `domains` is accepted for
    backward compatibility but no longer restricts results. `trace`, when passed a list, is appended with one
    dict per pipeline stage (scripts/trace_web_search.py uses this to show every intermediate input/output).
    `force_open=True` skips the official-domain-scoped search entirely - for a second attempt after every
    candidate from a scoped search failed to *crawl* (e.g. a domain-wide bot wall), so the caller can retry
    against the open web instead of only the one domain it already knows is unreachable."""
    settings = get_settings()
    num_results = limit or settings.web_search_max_crawl_sites
    pool_size = max(num_results, settings.web_search_candidate_pool_size) if llm else num_results
    # MAKE_DOMAIN_MAP keys are lowercase - an explicit `make` (e.g. "Tesla", straight from a car name's first
    # word) must be normalized the same way _infer_make's own regex match already is, or the lookup below
    # silently misses every explicitly-passed make.
    inferred_make = (make or _infer_make(query) or "").lower() or None
    preferred_domain = None if force_open else (MAKE_DOMAIN_MAP.get(inferred_make) if inferred_make else None)
    _trace_step(trace, "infer_make", query=query, inferred_make=inferred_make, preferred_domain=preferred_domain)

    async with httpx.AsyncClient(timeout=settings.web_search_request_timeout_seconds) as client:
        raw_results: list[dict] = []
        provider = "unavailable"
        if preferred_domain:
            scoped_query = f"{query} site:{preferred_domain}"
            raw_results, provider = await _search_providers(client, scoped_query, pool_size)
            if raw_results:
                provider = f"{provider}_official_site"
            _trace_step(trace, "search_scoped", query=scoped_query, provider=provider, raw_results=raw_results)
        if not raw_results:
            # No known official domain to scope to (or that search came up empty) - bias the open query toward
            # US-market results instead of leaving it to the search engine's default (often international/wiki).
            open_query = f"{query} USA official site"
            raw_results, provider = await _search_providers(client, open_query, pool_size)
            _trace_step(trace, "search_open", query=open_query, provider=provider, raw_results=raw_results)

        # A brand-specific research request can still use the official manufacturer page when search APIs are
        # unavailable. This never invents an arbitrary URL - just the one known official domain for that make.
        if not raw_results and preferred_domain:
            raw_results = [{"url": f"https://www.{preferred_domain}/", "title": f"{inferred_make.title()} official site"}]
            provider = "official_fallback"
            _trace_step(trace, "official_fallback", raw_results=raw_results)

        candidates: list[dict[str, str]] = []
        dropped: list[dict[str, str]] = []
        for result in raw_results:
            domain = _domain_of(result["url"])
            if not domain or _is_excluded_domain(domain) or not _is_us_market_url(result["url"]):
                dropped.append({"url": result["url"], "reason": "excluded_domain_or_non_us"})
                continue
            if not await _robots_allows(client, result["url"]):
                dropped.append({"url": result["url"], "reason": "robots_disallowed"})
                continue
            candidate = {"url": result["url"], "title": result["title"], "source_domain": domain}
            if snippet := str(result.get("snippet") or "").strip():
                candidate["snippet"] = snippet[:1200]
            candidates.append(candidate)
        _trace_step(trace, "filter", kept=candidates, dropped=dropped)

        if llm and len(candidates) > 1:
            scores = await _score_candidates(llm, query, candidates, thread_id, prompt_overrides)
            ranked = sorted(zip(candidates, scores, strict=True), key=lambda pair: pair[1], reverse=True)
            _trace_step(
                trace,
                "score",
                scores=scores,
                ranked=[{"url": c["url"], "score": score} for c, score in ranked],
            )
            candidates = [c for c, score in ranked if score >= settings.web_search_min_score] or [ranked[0][0]]
            _trace_step(trace, "score_filtered", min_score=settings.web_search_min_score, kept=candidates)

        logger.info("web_search_get_urls", query=query, provider=provider, candidates=len(candidates))
        final = candidates[:num_results]
        _trace_step(trace, "final_candidates", candidates=final)
        return final


async def _retry(label: str, url: str, attempt_fn) -> str | None:
    """Runs `attempt_fn` up to `settings.web_search_max_retries` times, retrying only on transient failures
    (network/timeout/5xx) with a short linear backoff. A clean "nothing here" result (None, no exception) is
    not retried - that's not a transient failure, it's a page genuinely missing the data."""
    settings = get_settings()
    last_exc: Exception | None = None
    for attempt in range(1, settings.web_search_max_retries + 1):
        try:
            return await attempt_fn()
        except (httpx.TimeoutException, httpx.ConnectError, httpx.RemoteProtocolError) as exc:
            last_exc = exc
            logger.info(f"web_search_{label}_retry", url=url, attempt=attempt, error=str(exc)[:200])
            if attempt < settings.web_search_max_retries:
                await asyncio.sleep(0.5 * attempt)
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code < 500:
                raise
            last_exc = exc
            logger.info(f"web_search_{label}_retry", url=url, attempt=attempt, error=str(exc)[:200])
            if attempt < settings.web_search_max_retries:
                await asyncio.sleep(0.5 * attempt)
    if last_exc:
        raise last_exc
    return None


@log_flow(layer="agent")
async def _fetch_static_page(url: str) -> str | None:
    """Fetch and clean visible HTML text without launching a browser subprocess."""
    if not _is_us_market_url(url):
        return None
    settings = get_settings()

    async def _attempt() -> str | None:
        async with httpx.AsyncClient(
            timeout=settings.web_search_request_timeout_seconds,
            follow_redirects=True,
            headers={"User-Agent": WEB_SEARCH_USER_AGENT},
        ) as client:
            response = await client.get(url)
            response.raise_for_status()
        final_url = str(response.url)
        if not _is_us_market_url(final_url):
            return None
        content_type = response.headers.get("content-type", "").lower()
        if "html" not in content_type and "text" not in content_type:
            return None
        parser = _ReadableHtmlParser()
        parser.feed(response.text)
        content = parser.text()
        return content[:WEB_SEARCH_MAX_MARKDOWN_CHARS] if content else None

    try:
        return await _retry("static_fetch", url, _attempt)
    except Exception as exc:
        logger.info("web_search_static_fetch_failed", url=url, error=str(exc)[:200])
        return None


@log_flow(layer="agent")
async def _crawl_browser_page(url: str) -> str | None:
    """Use Crawl4AI only when the running event loop supports Playwright subprocesses."""
    loop_name = type(asyncio.get_running_loop()).__name__
    if sys.platform == "win32" and "Proactor" not in loop_name:
        logger.info("web_search_browser_skipped", url=url, reason=f"unsupported Windows event loop: {loop_name}")
        return None

    async def _attempt() -> str | None:
        from crawl4ai import AsyncWebCrawler, CrawlerRunConfig

        async with AsyncWebCrawler() as crawler:
            result = await crawler.arun(url=url, config=CrawlerRunConfig(word_count_threshold=40))
        if not result.success:
            logger.info("web_search_crawl_failed", url=url, error=getattr(result, "error_message", ""))
            return None
        markdown = getattr(result, "markdown", "")
        return str(markdown)[:WEB_SEARCH_MAX_MARKDOWN_CHARS] if markdown else None

    try:
        return await _retry("crawl", url, _attempt)
    except Exception as exc:
        logger.warning("web_search_crawl_exception", url=url, error=str(exc)[:200])
        return None


@log_flow(layer="agent")
def _parse_json_object(text: str) -> dict:
    match = re.search(r"\{.*\}", text, re.DOTALL)
    return json.loads(match.group(0) if match else text)


@log_flow(layer="agent")
async def process_url(
    llm: LlmClient,
    url: str,
    thread_id: str | None = None,
    *,
    state_trace_id: str | None = None,
    profile: dict | None = None,
    trace: list[dict] | None = None,
    prompt_overrides: dict[str, str] | None = None,
) -> CarSpecs | None:
    """Crawl one URL (clean markdown via crawl4ai) and extract structured CarSpecs from it in one unit, so
    Mode A can run this as a single awaitable per URL under asyncio.gather. `trace` behaves as in `get_urls`."""
    page_content = await _fetch_static_page(url)
    fetch_method = "static" if page_content else None
    if not page_content:
        page_content = await _crawl_browser_page(url)
        fetch_method = "crawl4ai" if page_content else None
    _trace_step(
        trace,
        "fetch",
        url=url,
        method=fetch_method,
        content_length=len(page_content) if page_content else 0,
        content_preview=(page_content or "")[:500],
    )
    if not page_content:
        return None

    prompt = (
        f"{load_fragment('web_search_agent.md', prompt_overrides)}\n\n"
        f"JSON schema to follow:\n{EXTRACTION_SCHEMA}\n\n"
        f"Source URL: {url}\n\n"
        f'<page_content trust="untrusted">\n{page_content}\n</page_content>'
    )
    try:
        profile = profile or {}
        completion = await llm.generate(
            prompt,
            "car_spec_extraction",
            state_trace_id or thread_id,
            model=profile.get("model"),
            reasoning_effort=profile.get("reasoning_effort"),
            max_output_tokens=profile.get("max_output_tokens"),
        )
        data = _parse_json_object(completion.text)
        data["source_url"] = url
        specs = CarSpecs.model_validate(data)
        _trace_step(trace, "extract", url=url, specs=specs.model_dump())
        return specs
    except Exception as exc:
        logger.info("web_search_extraction_unparsable", url=url, error=str(exc)[:200])
        _trace_step(trace, "extract", url=url, error=str(exc)[:200])
        return None
