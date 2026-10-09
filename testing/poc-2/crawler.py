"""Stage 4: CRAWL4AI layer (parent doc, section 10-11/36), plus the cheap-fetch-first
optimization already proven in backend/src/agents/tools/web_search.py - try a plain httpx
GET + HTML text extraction before ever paying for a Chromium subprocess. Records which
method actually served each page and how long it took, since that split (static vs.
browser) is one of the two biggest cost levers this whole POC exists to measure.
"""

import asyncio
import re
import sys
import time
from html.parser import HTMLParser

import httpx

from config import settings
from models import CrawlResult
from utils import logger

MAX_MARKDOWN_CHARS = 45_000
USER_AGENT = "poc-2/0.1 (research project)"


class _ReadableHtmlParser(HTMLParser):
    _ignored = {"script", "style", "noscript", "svg", "template"}
    _blocks = {"article", "br", "div", "footer", "h1", "h2", "h3", "h4", "header", "li", "main", "p", "section"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._ignored_depth = 0
        self._parts: list[str] = []

    def handle_starttag(self, tag: str, attrs) -> None:
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


async def _fetch_static(url: str) -> str | None:
    async with httpx.AsyncClient(
        timeout=settings.crawl_timeout_seconds, follow_redirects=True, headers={"User-Agent": USER_AGENT}
    ) as client:
        response = await client.get(url)
        response.raise_for_status()
    content_type = response.headers.get("content-type", "").lower()
    if "html" not in content_type and "text" not in content_type:
        return None
    parser = _ReadableHtmlParser()
    parser.feed(response.text)
    content = parser.text()
    return content[:MAX_MARKDOWN_CHARS] if content else None


def _crawl4ai_supported() -> bool:
    loop_name = type(asyncio.get_running_loop()).__name__
    return not (sys.platform == "win32" and "Proactor" not in loop_name)


async def _fetch_crawl4ai(crawler, url: str) -> tuple[str | None, str | None]:
    """Runs one URL against an *already-open* AsyncWebCrawler. Measured: a fresh
    `AsyncWebCrawler()` per URL pays Chromium's cold-start cost every single time
    (~17-20s/URL regardless of order). One shared instance pays it once - the first URL on
    a shared browser still takes ~10s, every URL after it drops to ~4-10s, even when fired
    concurrently via asyncio.gather. See README "Crawl4AI browser reuse" for the measurement."""
    from crawl4ai import CrawlerRunConfig

    try:
        result = await crawler.arun(url=url, config=CrawlerRunConfig(word_count_threshold=40))
    except Exception as exc:  # noqa: BLE001
        logger.warning(f"[crawler] crawl4ai exception for {url}: {str(exc)[:200]}")
        return None, str(exc)[:300]
    if not result.success:
        error = getattr(result, "error_message", "") or "crawl4ai reported failure"
        logger.info(f"[crawler] crawl4ai failed for {url}: {error}")
        return None, error
    markdown = getattr(result, "markdown", "")
    content = str(markdown)[:MAX_MARKDOWN_CHARS] if markdown else None
    return content, (None if content else "no content extracted")


async def _try_static(url: str) -> str | None:
    try:
        return await _fetch_static(url)
    except Exception as exc:  # noqa: BLE001 - fall through to crawl4ai
        logger.info(f"[crawler] static fetch failed for {url}: {str(exc)[:200]}")
        return None


async def crawl_many(urls: list[str]) -> tuple[dict[str, str], list[CrawlResult]]:
    """Returns {url: content} for every URL that crawled successfully, plus the list of
    CrawlResult (method/timing/success) for every URL attempted.

    Two-phase, both phases concurrent: every URL tries the cheap static fetch at once first;
    whatever's left (static failed/blocked) shares ONE Crawl4AI browser instance for its
    fallback attempt instead of each spinning up its own Chromium process."""
    starts = {url: time.perf_counter() for url in urls}

    static_contents = await asyncio.gather(*[_try_static(url) for url in urls])

    pages: dict[str, str] = {}
    results: list[CrawlResult] = []
    fallback_urls: list[str] = []
    for url, content in zip(urls, static_contents, strict=True):
        if content:
            pages[url] = content
            duration_ms = (time.perf_counter() - starts[url]) * 1000
            results.append(CrawlResult(url=url, method="static", success=True, content_length=len(content), duration_ms=duration_ms))
        else:
            fallback_urls.append(url)

    if fallback_urls and _crawl4ai_supported():
        from crawl4ai import AsyncWebCrawler

        async with AsyncWebCrawler() as crawler:
            fallback_outcomes = await asyncio.gather(*[_fetch_crawl4ai(crawler, url) for url in fallback_urls])
        for url, (content, error) in zip(fallback_urls, fallback_outcomes, strict=True):
            duration_ms = (time.perf_counter() - starts[url]) * 1000
            if content:
                pages[url] = content
                results.append(CrawlResult(url=url, method="crawl4ai", success=True, content_length=len(content), duration_ms=duration_ms))
            else:
                results.append(CrawlResult(url=url, method="failed", success=False, duration_ms=duration_ms, error=error))
    elif fallback_urls:
        logger.info("[crawler] crawl4ai skipped for all fallback URLs: unsupported event loop")
        for url in fallback_urls:
            results.append(
                CrawlResult(url=url, method="failed", success=False, error="crawl4ai unsupported on this event loop")
            )

    return pages, results
