"""Runs the pipeline stage by stage and records each stage's input/output as JSON,
so you can see exactly what goes in and comes out of query parsing, URL resolution,
crawling, and extraction. Writes trace.json and also prints it.

Two modes:
  - Pass --url to skip search and crawl/extract that one URL directly (fast, for
    testing the crawler/extractor against a specific page).
  - Omit --url to run the full chain: query -> search_resolver (Google, falling back
    to DuckDuckGo) -> crawl -> extract, for every candidate URL found.

Usage:
    python trace_run.py --query "I want a BMW X3 under 55000"
    python trace_run.py --url "https://www.bmwusa.com/vehicles/x-series/x3/bmw-x3.html"
"""

import argparse
import asyncio
import json

from crawler import crawl_one
from llm_extractor import extract_specs_async
from models import CandidateUrl
from query_parser import parse_query_async
from search_resolver import resolve_urls

DEFAULT_QUERY = "I want a BMW X3"


async def _crawl_and_extract(candidate: CandidateUrl, trace: list[dict]) -> dict | None:
    markdown = await crawl_one(candidate)
    trace.append({
        "stage": "3_crawler",
        "input": {"url": candidate.url},
        "output": {
            "success": markdown is not None,
            "markdown_length": len(markdown) if markdown else 0,
            "markdown_preview": (markdown or "")[:800],
        },
    })

    if not markdown:
        return None

    specs = await extract_specs_async(candidate.url, markdown)
    trace.append({
        "stage": "4_llm_extractor",
        "input": {
            "source_url": candidate.url,
            "markdown_length": len(markdown),
            "markdown_sent_preview": markdown[:800],
        },
        "output": specs.model_dump(),
    })
    return specs.model_dump()


async def main(user_query: str, candidate_url: str | None) -> dict:
    trace: list[dict] = []

    # Stage 1: query -> intent
    intent = await parse_query_async(user_query)
    trace.append({
        "stage": "1_query_parser",
        "input": {"user_query": user_query},
        "output": intent.model_dump(),
    })

    if candidate_url:
        # Manual mode: skip search_resolver, crawl/extract the given URL directly.
        candidate = CandidateUrl(url=candidate_url, source_domain=candidate_url.split("/")[2])
        trace.append({
            "stage": "2_search_resolver (SKIPPED - --url passed explicitly)",
            "input": {"intent": intent.model_dump()},
            "output": {"candidate": candidate.model_dump()},
        })
        result = await _crawl_and_extract(candidate, trace)
        return {"trace": trace, "final_results": [result] if result else []}

    # Full chain: intent -> candidate URLs via search_resolver
    candidates = resolve_urls(intent)
    trace.append({
        "stage": "2_search_resolver",
        "input": {"intent": intent.model_dump()},
        "output": {"candidates": [c.model_dump() for c in candidates]},
    })

    final_results = []
    for candidate in candidates:
        result = await _crawl_and_extract(candidate, trace)
        if result:
            final_results.append(result)

    return {"trace": trace, "final_results": final_results}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Trace the car-scraper pipeline stage by stage.")
    parser.add_argument("--url", default=None, help="Skip search and crawl/extract this URL directly")
    parser.add_argument("--query", default=DEFAULT_QUERY, help="User query to feed into stage 1 (query_parser)")
    parser.add_argument("--out", default="trace.json", help="Where to write the JSON trace")
    parser.add_argument("--upload-s3", action="store_true", help="Also upload the trace JSON to the backend's S3 bucket")
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()

    result = asyncio.run(main(args.query, args.url))

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)

    print(json.dumps(result, indent=2))

    if args.upload_s3:
        from s3_uploader import upload_json_file

        key = upload_json_file(args.out)
        print(f"\n[trace_run] uploaded to S3: {key}")
