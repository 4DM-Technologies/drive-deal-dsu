"""Orchestrates the full flow: query -> intent -> urls -> crawl -> extract."""

import asyncio

from crawler import crawl_many
from llm_extractor import extract_specs_async
from models import CarSpecs
from query_parser import parse_query_async
from search_resolver import resolve_urls


async def run_pipeline(user_query: str) -> list[CarSpecs]:
    intent = await parse_query_async(user_query)
    print(f"[pipeline] intent: {intent.model_dump_json()}")

    candidates = resolve_urls(intent)
    print(f"[pipeline] resolved {len(candidates)} crawlable candidate(s)")

    pages = await crawl_many(candidates)
    print(f"[pipeline] crawled {len(pages)} page(s) successfully")

    results: list[CarSpecs] = []
    for url, markdown in pages.items():
        try:
            results.append(await extract_specs_async(url, markdown))
        except Exception as exc:  # noqa: BLE001 - learning project, just log and continue
            print(f"[pipeline] extraction failed for {url}: {exc}")

    return results


if __name__ == "__main__":
    import sys

    query = " ".join(sys.argv[1:]) or "I want to see the top 5 Tesla cars"
    output = asyncio.run(run_pipeline(query))
    for item in output:
        print(item.model_dump_json(indent=2))
