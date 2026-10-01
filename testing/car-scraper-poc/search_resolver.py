"""Stage 2: resolve a CarQueryIntent into real, crawlable candidate URLs.

Primary: Google Custom Search JSON API.
Fallback: DuckDuckGo (no API key needed) if Google isn't configured or its call fails.

Either way: results are filtered to an explicit domain allowlist, and robots.txt is
checked before a URL is ever marked crawlable.
"""

import re
from urllib.parse import urlparse
from urllib.robotparser import RobotFileParser

import httpx

from config import ALLOWED_DOMAINS, MAKE_DOMAIN_MAP, settings
from models import CandidateUrl, CarQueryIntent

USER_AGENT = "car-scraper-poc/0.1 (learning project)"

# This app is US-only (see query_parser's country_market constraint) - manufacturer sites
# often serve other markets under locale path segments like /en_AU/ or /de_de/. Drop those
# rather than crawling and then explaining to the LLM that it picked the wrong country.
_NON_US_LOCALE_PATH = re.compile(r"/(?!en[-_]us\b)[a-z]{2}[-_][a-z]{2}(?:/|$)", re.IGNORECASE)


def _is_us_market_url(url: str) -> bool:
    path = urlparse(url).path
    return not _NON_US_LOCALE_PATH.search(path)


def _domain_allowed(url: str) -> str | None:
    netloc = urlparse(url).netloc.lower()
    for domain in ALLOWED_DOMAINS:
        if netloc == domain or netloc.endswith(f".{domain}"):
            return domain
    return None


def _robots_allows(url: str) -> bool:
    parsed = urlparse(url)
    robots_url = f"{parsed.scheme}://{parsed.netloc}/robots.txt"
    parser = RobotFileParser()
    try:
        resp = httpx.get(robots_url, timeout=settings.request_timeout_seconds, headers={"User-Agent": USER_AGENT})
        if resp.status_code >= 400:
            # No robots.txt found -> treat as allowed by default.
            return True
        parser.parse(resp.text.splitlines())
    except httpx.HTTPError:
        # Can't verify -> be conservative and skip it.
        return False
    return parser.can_fetch(USER_AGENT, url)


def _build_search_query(intent: CarQueryIntent) -> str:
    parts = [p for p in [intent.make, intent.model, intent.body_type] if p]
    query = " ".join(parts) or "car"
    if intent.max_price:
        query += f" under ${int(intent.max_price)}"
    return query


def _ordered_domains(intent: CarQueryIntent) -> list[str]:
    """Puts the manufacturer's own domain first (if we know it) so a brand-specific
    query doesn't get swamped by irrelevant hits from an unrelated allowed domain
    before ever reaching the one that actually matters."""
    preferred = MAKE_DOMAIN_MAP.get((intent.make or "").strip().lower())
    if not preferred or preferred not in ALLOWED_DOMAINS:
        return list(ALLOWED_DOMAINS)
    return [preferred] + [d for d in ALLOWED_DOMAINS if d != preferred]


def _site_restrict(query: str, domains: list[str]) -> str:
    return query + " site:" + " OR site:".join(domains)


def _search_google(query: str, domains: list[str], num_results: int) -> list[dict]:
    if not settings.google_api_key or not settings.google_cse_id:
        raise RuntimeError("Google Custom Search not configured (GOOGLE_API_KEY / GOOGLE_CSE_ID missing)")

    resp = httpx.get(
        "https://www.googleapis.com/customsearch/v1",
        params={
            "key": settings.google_api_key,
            "cx": settings.google_cse_id,
            "q": _site_restrict(query, domains),
            "num": min(num_results, 10),  # Google CSE caps at 10 per request
        },
        timeout=settings.request_timeout_seconds,
    )
    resp.raise_for_status()
    data = resp.json()
    return [
        {"url": item["link"], "title": item.get("title", "")}
        for item in data.get("items", [])
        if "link" in item
    ]


def _search_duckduckgo(query: str, domains: list[str], num_results: int) -> list[dict]:
    """DuckDuckGo's backend doesn't reliably handle a long `site:a OR site:b OR ...` query
    the way Google does, so we query one domain at a time (in the given priority order)
    and merge results until we have enough."""
    from ddgs import DDGS
    from ddgs.exceptions import DDGSException

    results: list[dict] = []
    with DDGS() as ddgs:
        for domain in domains:
            if len(results) >= num_results:
                break
            try:
                for r in ddgs.text(f"{query} site:{domain}", max_results=num_results):
                    url = r.get("href") or r.get("link")
                    if url:
                        results.append({"url": url, "title": r.get("title", "")})
            except DDGSException:
                continue  # no results for this domain, try the next one
    return results


def resolve_urls(intent: CarQueryIntent) -> list[CandidateUrl]:
    query = _build_search_query(intent)
    domains = _ordered_domains(intent)

    raw_results: list[dict] = []
    provider_used = "google"
    try:
        raw_results = _search_google(query, domains, settings.max_results)
    except Exception as exc:  # noqa: BLE001 - fall back to DuckDuckGo on any Google failure
        print(f"[search_resolver] Google search unavailable ({exc}); falling back to DuckDuckGo")
        provider_used = "duckduckgo"
        raw_results = _search_duckduckgo(query, domains, settings.max_results)

    print(f"[search_resolver] provider={provider_used} query={query!r} raw_results={len(raw_results)}")

    candidates: list[CandidateUrl] = []
    for result in raw_results:
        domain = _domain_allowed(result["url"])
        if not domain:
            continue
        if not _is_us_market_url(result["url"]):
            continue
        if not _robots_allows(result["url"]):
            continue
        candidates.append(CandidateUrl(url=result["url"], source_domain=domain, title=result["title"]))

    return candidates[: intent.top_n]


if __name__ == "__main__":
    from query_parser import parse_query

    test_intent = parse_query("I want a Tesla Model 3")
    for c in resolve_urls(test_intent):
        print(c)
