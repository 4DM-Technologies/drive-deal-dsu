"""Stage 3: crawl a URL with crawl4ai and return clean markdown for the LLM stage.

No stealth/evasion, no proxy rotation. If a page fails or blocks the crawler,
we skip it rather than working around the block.
"""

import asyncio

from crawl4ai import AsyncWebCrawler

from models import CandidateUrl


async def crawl_one(candidate: CandidateUrl) -> str | None:
    async with AsyncWebCrawler() as crawler:
        result = await crawler.arun(url=candidate.url)
        if not result.success:
            print(f"[crawler] failed to crawl {candidate.url}: {result.error_message}")
            return None
        return result.markdown


async def crawl_many(candidates: list[CandidateUrl]) -> dict[str, str]:
    """Returns {url: markdown} for every URL that crawled successfully."""
    pages: dict[str, str] = {}
    async with AsyncWebCrawler() as crawler:
        for candidate in candidates:
            result = await crawler.arun(url=candidate.url)
            if result.success:
                pages[candidate.url] = result.markdown
            else:
                print(f"[crawler] failed to crawl {candidate.url}: {result.error_message}")
    return pages


if __name__ == "__main__":
    sample = CandidateUrl(url="https://www.tesla.com/model3", source_domain="tesla.com")
    markdown = asyncio.run(crawl_one(sample))
    print((markdown or "")[:1000])
