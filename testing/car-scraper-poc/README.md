# Car Scraper POC (Learning Project)

A small, modular proof-of-concept pipeline:

```
user query -> intent parsing (LLM) -> candidate URLs (search API) ->
crawl4ai (page -> clean markdown) -> LLM extraction (structured specs) -> JSON output
```

This is a **learning project only** — not for production use or resale. It does NOT use
proxy rotation, stealth/fingerprint evasion, or CAPTCHA bypassing. It respects
`robots.txt` and only crawls pages that allow it.

## Files

| File | Responsibility |
|---|---|
| `config.py` | Env vars, allowed domains, settings |
| `models.py` | Pydantic schemas shared across stages |
| `query_parser.py` | Turns a free-text query into structured intent (make/model/budget/etc.) via LLM |
| `search_resolver.py` | Resolves intent -> real candidate URLs via a search API, filtered to allowed domains + robots.txt check |
| `crawler.py` | Wraps crawl4ai: fetches a URL and returns clean markdown/text |
| `llm_extractor.py` | Takes crawled markdown -> structured car data (price, colors, specs) via LLM with JSON schema |
| `pipeline.py` | Orchestrates the full flow end-to-end |
| `main.py` | CLI entry point: `python main.py "I want a Tesla"` |

## Setup

```bash
cd testing/car-scraper-poc
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
playwright install chromium   # crawl4ai uses Playwright under the hood
copy .env.example .env        # fill in OPENAI_API_KEY and SEARCH_API_KEY
```

## Run

```bash
python main.py "I want top 5 Tesla Model 3 under 35000"
```

## Notes / limits

- `ALLOWED_DOMAINS` in `config.py` whitelists which sites we'll actually crawl (manufacturer
  sites + a couple of aggregators). Add/remove domains there.
- `search_resolver.py` checks `robots.txt` before returning any URL as crawlable. If a site
  disallows crawling, we skip it rather than finding a workaround.
- No retries-with-rotating-IPs, no headless-browser stealth patches — if a site blocks us,
  that's a signal to not scrape it, not a bug to route around.
- US-only constraint lives in `query_parser.py`'s system prompt — adjust if you want to
  experiment with other markets.
