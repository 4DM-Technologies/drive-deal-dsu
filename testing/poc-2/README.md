# poc-2 - New Architecture POC (dual search, instrumented pipeline)

A second, more instrumented proof-of-concept, built on top of the lessons from
`car-scraper-poc/` and the production patterns in
`backend/src/agents/tools/web_search.py`. It implements the "new architecture" discussed
alongside it: a deterministic Python pipeline around the LLM, instead of letting the LLM
drive search/crawl itself.

```
query -> SEARCH (DuckDuckGo + SearXNG, concurrent)
      -> URL PROCESSOR (canonicalize, dedupe, robots.txt, domain/locale filter)
      -> RANKER (deterministic keyword score - no LLM)
      -> CRAWL4AI layer (static httpx fetch first, Crawl4AI/Chromium fallback)
      -> LLM EXTRACTION (schema-constrained, CarSpecs)
      -> QueryReport JSON (every stage's method + timing + tokens, plus final results)
```

Not in scope for this POC (see parent doc sections 17-27): persistent storage, BM25/vector
retrieval, ranking of *results* (vs. ranking of *candidate URLs*, which this POC does do),
cross-source verification, and the iterative "search again" loop. This POC measures the
live-crawl path end-to-end, which is the expensive part worth instrumenting first.

## Files

| File | Responsibility |
|---|---|
| `config.py` | Env vars, provider toggles, limits |
| `models.py` | Pydantic schemas - `QueryReport` is the detailed JSON output shape |
| `search_providers.py` | DuckDuckGo (`ddgs`) + SearXNG (HTTP `/search?format=json`), run concurrently |
| `url_filter.py` | Canonicalization, dedup, robots.txt, excluded/non-US domain filtering |
| `ranking.py` | Deterministic keyword scoring - picks which candidates get crawled |
| `crawler.py` | Static `httpx` fetch first, Crawl4AI/Chromium fallback - tags method + timing per URL |
| `llm_client.py` | OAuth-based LLM call, returns `(json, token_usage, duration_ms)` |
| `extractor.py` | LLM extraction into `CarSpecs`, tagged with tokens + timing |
| `pipeline.py` | Orchestrates all of the above into one `QueryReport` |
| `test_queries.py` | **The test file** - run one or more queries, get JSON reports + console summary |

## Setup

```bash
cd testing/poc-2
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
playwright install chromium   # crawl4ai uses Playwright under the hood
copy .env.example .env
```

LLM auth is reused from the backend's "Sign in with ChatGPT" OAuth cache - no
`OPENAI_API_KEY` needed unless you want to override it (see `.env.example`).

### SearXNG setup (self-hosted, free)

```bash
docker run -d --name searxng -p 8080:8080 searxng/searxng
```

SearXNG ships with JSON output disabled by default. After the container starts once
(so it generates its config volume), enable it:

```bash
docker exec searxng sh -c "echo '  - json' >> /etc/searxng/settings.yml"
# edit the 'search: formats:' list under /etc/searxng/settings.yml if the line above
# doesn't land under the right key - then:
docker restart searxng
```

Verify: `curl "http://localhost:8080/search?q=test&format=json"` should return JSON, not
a 403. If SearXNG isn't running, `search_searxng()` just logs a warning and contributes
zero results for that query - DuckDuckGo still runs independently, so the query doesn't fail.

## Run

```bash
python test_queries.py "BMW M6 for sale USA under 50000"
python test_queries.py "BMW M6 under 50000" "Tesla Model 3 under 35000"
python test_queries.py --file queries.txt
python test_queries.py   # built-in sample queries
```

Each run writes to `results/<UTC timestamp>/`:

- `<n>_<query-slug>.json` - the full `QueryReport` for that query: every search result
  (tagged by provider), every candidate after dedup, every crawl attempt (method +
  success + duration), every LLM extraction call (tokens + duration), and the final
  structured vehicle results.
- `_batch_summary.json` - just the `summary` block from every query in the run, side by
  side, for quick cross-query comparison (tokens, duration, method breakdown, results).

Console output mirrors the summary per query as it runs, e.g.:

```
[1] 'BMW M6 for sale USA under 50000'
    duration=8421ms  search_results=14 {'duckduckgo': 8, 'searxng': 6}  candidates=9  crawled=8 {'static': 5, 'crawl4ai': 2, 'failed': 1}  extracted=7  tokens=4213
      -> 2017 BMW M6 $41926  (https://www.cars.com/...)
      ...
```

## What this is for

Comparing DuckDuckGo vs. SearXNG result overlap/quality, measuring how often the cheap
static fetch succeeds vs. needing Crawl4AI, and totaling LLM token cost per query - the
numbers that decide whether the fuller architecture (caching, CSS-first extraction,
retrieval/ranking/verification) is worth building out past this POC.
