# web_search_agent crawling: what changed, why, and what was deliberately skipped

This documents the investigation and fix applied to `backend/src/agents/tools/web_search.py` (the two tools
behind the `web_search_agent` graph node: `get_urls` and `process_url`), plus a debug tool
(`backend/scripts/trace_web_search.py`) built alongside it.

## The problem

Asking the agent something like *"what is the BMW X3's specialty"* returned data pulled from Wikipedia
instead of BMW's own US site (`bmwusa.com`), even though the manufacturer's official domain was already known
to the code (`MAKE_DOMAIN_MAP` in `backend/src/settings.py`).

## Root cause

1. `get_urls()` sent the user's raw question to DuckDuckGo (after Google Custom Search failed - see
   `backend/google_403.txt`, an `API_KEY_SERVICE_BLOCKED` error, meaning the configured Google CSE key isn't
   enabled for the Custom Search API on its GCP project) as plain free text, with no bias toward the
   manufacturer's own domain.
2. DuckDuckGo's organic ranking (same ranking shown in a browser - confirmed by comparing a live DuckDuckGo
   search screenshot against the `ddgs` library's scraped results) ranks Wikipedia above `bmwusa.com` for
   generic "what is X's specialty"-style phrasing.
3. `MAKE_DOMAIN_MAP` was only used as a *last-resort fallback when search returned zero results* - the moment
   DuckDuckGo returned any URL (even Wikipedia), that fallback never triggered.
4. Only the top 2 raw results were kept (`web_search_max_crawl_sites = 2`), and the per-car resolution path
   (`_resolve_one` in `backend/src/agents/serra/graph.py`) stops at the *first* URL that yields *any*
   successful extraction - a clean Wikipedia summary extracts easily, so it won from the #1 ranking slot and
   `bmwusa.com` (ranked #2) was never even fetched.

## The fix

All in `backend/src/agents/tools/web_search.py`:

1. **Site-scoped search first.** When a known manufacturer is detected in the query (`_infer_make`,
   unchanged), the search is run as `<query> site:<official-us-domain>` (e.g. `site:bmwusa.com`) before the
   open query - a hard filter honored by both Google Custom Search and DuckDuckGo, not a ranking hope. Falls
   back to the open query only if the scoped search comes back empty.
2. **Open-query US bias.** When no known manufacturer domain applies (or the scoped search found nothing),
   the open/fallback query is appended with `"USA official site"` to bias an unmapped brand's results toward
   its US site instead of international/generic content.
3. **Hardcoded exclusion of reference/encyclopedia domains** (`wikipedia.org`, `wikiwand.com`) as a backstop,
   regardless of make.
4. **LLM relevance scoring** (`_score_candidates`): fetches a wider raw candidate pool (default 8, see
   `web_search_candidate_pool_size`) and scores each by title/domain/snippet alone (no page fetch) - 0.0-1.0,
   explicitly instructed to score down encyclopedias, dealer/forum/aggregator sites, and *non-US* regional
   manufacturer sites (`bmw.de`, `hyundai.co.kr`, etc.), keeping only candidates scoring above
   `web_search_min_score` (default 0.5). This is what generalizes the fix beyond the ~6 brands hardcoded in
   `MAKE_DOMAIN_MAP` - verified live against Hyundai (unmapped) correctly preferring `hyundaiusa.com` over
   PRNewswire/Car and Driver/Carscoops purely from scoring.
   - Uses `reasoning_effort="minimal"` (same pattern as the `small_talk` node) - this is cheap classification,
     not analysis, and a higher effort burns its own reasoning tokens out of the same output budget, which
     was observed truncating the JSON response before fixing it.
5. **US-market instruction added to the extraction prompt** in `process_url` - extract USD pricing, US
   trim/model names and US-spec figures (EPA, not WLTP/NEDC) only, ignoring non-US sections of a mixed page.
6. **Opt-in `trace` parameter** on both `get_urls` and `process_url` (default `None`, zero behavior change) -
   appends one dict per pipeline stage (inferred make, each search attempt, filtering, scoring, fetch method,
   extraction) for `scripts/trace_web_search.py` to print/export, without duplicating the real logic in a
   separate script.

All existing production call sites (`backend/src/agents/serra/graph.py`) are untouched and keep working
exactly as before - `llm`, `thread_id`, and `trace` are optional, defaulted to `None`/off.

## What this explicitly does **not** do

The orchestrator/classifier-node rewiring, and kb_agent integration, discussed early in the investigation
were **deliberately left out of this pass** - this work only touches the crawling tools themselves
(`get_urls`/`process_url`), not how/when the graph decides to call them. That is still a separate follow-up.

**Stealth/evasion crawling was declined.** `tesla.com` is protected by Akamai Bot Manager across its entire
domain (confirmed live - both `tesla.com/modelx` and `tesla.com/` returned `Blocked by anti-bot protection:
Akamai block`, from Crawl4AI's own diagnostic, not inferred). Building fingerprint spoofing, stealth browser
plugins, or proxy rotation to defeat that detection was asked for and declined: it is building a tool whose
purpose is to circumvent a third-party site's deliberate access controls, which is a different category of
thing than searching/crawling respecting `robots.txt`, and it is not something this effort does. This mirrors
a decision already made by the original proof-of-concept this code was ported from
(`testing/car-scraper-poc/crawler.py`): *"No stealth/evasion, no proxy rotation. If a page fails or blocks
the crawler, we skip it."*

The practical consequence: a domain-wide-blocked manufacturer site (Tesla today, possibly others) will
reliably fail to crawl, full stop, with this tool. The mitigation path is architectural, not evasive: fall
back to the open/broader search when every official-domain candidate fails to *crawl* (not just when the
*search* comes back empty), so a legitimate non-blocked source (press kit, Car and Driver, Edmunds, etc.) gets
a chance - and lean on the KB/database (see below) for well-known vehicles so live crawling of a hostile
domain is needed as rarely as possible. This fallback is proposed but **not yet implemented**.

## Debug tool: `backend/scripts/trace_web_search.py`

Drives `get_urls` + `process_url` directly for one question - no orchestrator, no kb_agent, no compose - using
real DuckDuckGo/Google and a real `LlmClient` (same credential resolution as the app). Prints every pipeline
stage and writes it all to JSON.

```powershell
# from backend/, with the project's venv active
.\.venv\Scripts\python.exe scripts\trace_web_search.py --query "what is the bmw x3 car's specialty"
.\.venv\Scripts\python.exe scripts\trace_web_search.py --query "best electric cars" --wanted 2
.\.venv\Scripts\python.exe scripts\trace_web_search.py --query "tesla model 3" --no-score
.\.venv\Scripts\python.exe scripts\trace_web_search.py --query "..." --out results\bmw_x3.json
```

`--wanted N` keeps trying ranked candidates in order until N of them yield a successful extraction or the
list runs out (mirrors `_resolve_one`'s real fallback behavior) - a single blocked/empty candidate does not
end the run.

## Tests

`backend/tests/agents/test_web_search.py` - 4 new unit tests (mocked, fast) covering: site-scoped query is
tried first for a known make, Wikipedia is excluded even when ranked first, scoring reorders/drops low-score
candidates, and a malformed scoring response degrades gracefully to search-engine order instead of discarding
every candidate. Full existing suite (77 tests) still passes unchanged.

## Settings added (`backend/src/settings.py`)

| Setting | Default | Purpose |
|---|---|---|
| `web_search_candidate_pool_size` | `8` | Raw candidates fetched per search when scoring is enabled |
| `web_search_min_score` | `0.5` | Minimum LLM relevance score to keep a candidate after scoring |

## KB-miss escalation: a named vehicle not in inventory now triggers a live web lookup (IMPLEMENTED)

**The bug this fixes**: asking "I want BMW i7" (a vehicle not in Deal&Drive's inventory) got stuck in a loop
of clarifying questions instead of ever searching the web for it - even though the crawling pipeline above
was working correctly. Root cause, found from a real request log: `web_search_agent` never ran at all. The
orchestrator (`backend/src/prompt/orchestrator.md`) only has three modes - `kb_only`, `web_per_car` (a
*category*, e.g. "top 5 SUVs"), `web_direct` (an *explicit* web-search request naming no specific model).
Naming one specific model fits none of these cleanly, and the LLM fell back to `kb_only`, which never
escalates to the web on its own.

**The fix** (`backend/src/agents/serra/graph.py`): rather than trying to make the orchestrator's upfront LLM
classification predict this correctly every time, `after_kb()` now escalates structurally, after the fact:

```python
if (
    state.get("mode") == "kb_only"
    and state.get("route") == "requirements"   # classifier already said "describing a vehicle wanted"
    and state.get("kb_searched")               # a real kb_search ran (not an early-return path)
    and not state.get("kb_results")             # ...and it found nothing
):
    return configured_target("kb_agent", "kb_miss", "web_search_agent")
```

- `route == "requirements"` is the classifier's own existing signal (`backend/src/agents/serra/graph.py`'s
  `classify()`: *"describing a vehicle wanted"*) - already computed, zero extra LLM cost, and precisely the
  thing that distinguishes "I want BMW i7" from a general browsing question like "what SUVs do you have"
  (which classifies as `advice`, not `requirements`, and correctly does **not** escalate).
- `kb_searched` is a new `AgentState` field (`backend/src/agents/state.py`), set only on `knowledge()`'s real
  `kb_search()` call path - not on its early-return paths (preference-gathering, "no domain content" skip),
  which also leave `kb_results` empty but have nothing worth escalating.
- `search_web`'s existing direct-mode branch (used whenever `mode != "web_per_car"`) already builds its query
  from `state["message"]` + preferences, so no further state changes were needed to make it serve this case -
  it just needed a path TO it.
- The new `kb_miss` condition was also registered in `backend/src/agents/configuration.py`
  (`DEFAULT_WORKFLOW["edges"]` and `CONDITIONS_BY_SOURCE["kb_agent"]`), so the admin-configurable workflow
  definition and its validator stay consistent with actual runtime behavior.

**A regression caught while building this**: the first version escalated on *any* `kb_only` + empty
`kb_results`, with no `route` check. That broke two existing tests
(`test_vehicle_questions_still_run_the_full_pipeline`, `test_orchestrator_accepts_a_valid_plan`) by making
"what SUVs do you have" and "what cars do you have" *also* escalate and hit the real network/LLM inside a
unit test (neither test mocks `get_urls`/`process_url`, since neither expected web_search_agent to run). The
`route == "requirements"` gate fixes this precisely, by design, not by accident - the whole point of the gate
is "a specific vehicle was named," and a generic browsing question is exactly the case it must exclude.

### Second regression, caught live after deploy: `kb_results` non-empty ≠ the model was found

Testing against the real running app surfaced a second, deeper issue in the same feature: asking "i need bmw
m3 new 2026" still didn't escalate. Reason: `kb_search()` (`backend/src/agents/tools/kb.py`) `OR`s
`Car.model.ilike` together with `Brand.name.ilike` across every query term - so a message containing "bmw"
matches **any** BMW row in inventory (e.g. a 5 Series), regardless of whether the actual model asked about
(M3, i7) exists at all. `kb_results` came back non-empty (with the wrong car), so `not state.get("kb_results")`
never fired - this is the exact same "BMW 5 Series, but no i7" mismatch from the original bug report, just
one level deeper.

**Fix**: a new `_kb_results_are_relevant(message, kb_results)` helper (`graph.py`) checks whether any
result's own `model` field (or a cached `learned_web_knowledge` finding's `content.model`) actually appears
in the buyer's message - not just whether `kb_results` is non-empty. `knowledge()` now computes this as
`kb_results_relevant` (new `AgentState` field), and `after_kb()`'s escalation condition checks
`not state.get("kb_results_relevant")` instead of `not state.get("kb_results")`. A same-brand-wrong-model row
no longer masks a genuine KB miss; a real match (the model name actually appears in the kb_result) still does
not escalate.

### Tests added

- `backend/tests/agents/test_orchestrator.py`:
  - `test_kb_miss_on_a_named_vehicle_escalates_to_a_live_web_lookup` / `test_kb_miss_on_a_general_browsing_question_does_not_escalate` -
    the positive/negative case for the `route == "requirements"` gate.
  - `test_kb_miss_escalates_even_when_a_same_brand_wrong_model_row_matched` - the exact "BMW M3 vs. 5 Series"
    bug, fully mocked.
  - `test_kb_miss_does_not_escalate_when_the_named_model_is_actually_in_inventory` - the flip side: a genuine
    inventory match must not trigger a needless web search.

Full suite: 204 passed (same one pre-existing unrelated failure as before, `test_health_and_reference_data`).

### Still to verify live

This second fix has not yet been exercised against the real running app (only in the mocked test suite) -
**the backend server needs restarting** to pick up the change before retrying "i need bmw m3 new 2026" or
"i want bmw i7" against it.

## Non-blocking KB persistence after a crawl, crawl-level fallback, and production scoring wiring (IMPLEMENTED)

Everything below this heading (previously planned) is now implemented in `backend/src/agents/serra/graph.py`
and `backend/src/agents/tools/web_search.py`. Three things landed together:

1. **Scoring is now actually active in production**, not just the debug script - both `get_urls()` call
   sites in `graph.py` (`_resolve_one` for per-car resolution, `search_web`'s direct-mode branch) now pass
   `llm=llm` (and a `thread_id`), so the LLM relevance scoring described above runs for real traffic.
2. **Crawl-level fallback to the open web**: when every candidate from an official-domain-scoped search
   (e.g. all `tesla.com` URLs) fails to *crawl* - not just when the *search* comes back empty - both
   `_resolve_one` and `search_web` now retry once with `get_urls(..., force_open=True)`, which skips the
   domain scoping entirely and searches the open web instead. Gated by the new `has_official_domain(query,
   make=None)` helper in `web_search.py`, so an unmapped make (which was already searching the open web) never
   wastes a second, redundant attempt. This is the architectural (non-evasive) mitigation discussed for
   Tesla's domain-wide Akamai block.
3. **Non-blocking KB persistence**: `persist_cars` no longer awaits the DB write inline. It now calls
   `_fire_and_forget(_persist_cars_background(...))`, which schedules an `asyncio.create_task` holding a
   strong reference in a module-level `_background_tasks` set (removed via `add_done_callback` on
   completion - without this, a fire-and-forget task risks silent garbage collection mid-run, a known
   asyncio gotcha). `_persist_cars_background` does the same brand/state lookup + `write_car` upsert
   `persist_cars` always did, but on its own `SessionFactory()` session (mirroring `stream_chat`'s
   `requirement_task`/`requirement_session` pattern in `ai_service.py`), with its own `commit()`/
   `rollback()` - fully decoupled from the request's session and the streamed response's lifetime. A failed
   or slow write is only logged (`agent_persist_cars_failed`); it can never surface to or delay the buyer's
   answer. The graph edges (`web_search_agent -> persist_cars -> compose`) are unchanged - `persist_cars`
   simply stops blocking that edge.

### A real pre-existing bug fixed along the way

`_resolve_one` has always called `get_urls(name, make=make)` with `make` taken from a car name's first word
(e.g. `"Tesla"`, capitalized) - but `MAKE_DOMAIN_MAP` keys are lowercase, and `get_urls` used the passed
`make` as-is without normalizing case. So the explicit-`make` path (production's per-car resolution) has
*always* silently missed the official-domain scoping/fallback, regardless of today's other fixes - only the
`make=None` path (which falls through to `_infer_make`'s own internal lowercasing) ever worked correctly.
Fixed in `get_urls` by normalizing `(make or _infer_make(query) or "").lower()`, and covered by a new
regression test (`test_explicit_capitalized_make_still_resolves_the_official_domain`).

### Tests added

- `backend/tests/agents/test_web_search.py`: case-normalization regression test for explicit `make=`.
- `backend/tests/agents/test_orchestrator.py`: scoring is wired (`get_urls` receives `llm`), the crawl-level
  open-web retry fires exactly once and only when warranted, and `persist_cars` schedules (rather than
  awaits) the background write.

Full suite: 200 passed (the one pre-existing unrelated failure, `test_health_and_reference_data`, is a
branch-level `.env` `APP_NAME` mismatch predating this work).

### What was originally planned here (superseded by the above - kept for history)

Goal: once `web_search_agent` crawls a page and extracts `CarSpecs`, write it into the `cars` table so a
later question for the same vehicle can be answered by `kb_agent` from the database instead of crawling
again - and the buyer's streamed answer must **not** wait for that DB write to finish.

### What already exists today (nothing here needs to be built from scratch)

- **The upsert logic already exists**: `write_car()` in `backend/src/agents/tools/kb_db.py` (lines 67-125)
  upserts a `Car` row keyed on `(brand_id, model, model_year)` - updates `price/mileage/body_type/fuel/
  transmission/status` if a matching row exists, otherwise inserts. It only `flush()`es, never commits -
  the caller owns the transaction.
- **A node already calls it after every crawl**: `persist_cars` in `backend/src/agents/serra/graph.py`
  (lines 686-720) already runs after `web_search_agent`, looks up `Brand`/`State` rows, and calls
  `write_car()` for each extracted spec that has make/model/year/price. **The problem is only that this node
  is currently awaited sequentially in the graph** - edges are
  `web_search_agent -> persist_cars -> compose` (`graph.add_edge(...)` around line 780-781), so today the
  streamed response genuinely waits for every DB write to flush before composing. This is exactly the
  "should not wait for DB write" behavior to fix - the upsert logic itself does not need to change.
- **The read side already exists and needs no changes**: `kb_search()` in `backend/src/agents/tools/kb.py`
  (lines 13-30) already queries the same `cars` table (joined with `Brand`, filtered to
  `Car.status == "available"`) for `kb_agent` to use - so anything `write_car` persists is automatically
  visible to future `kb_agent` lookups with zero additional wiring.
- **The non-blocking pattern already exists elsewhere in this codebase** - `backend/src/services/
  ai_service.py`'s `stream_chat` (lines 77-125) already runs a second graph concurrently via
  `asyncio.create_task(...)`, using a **dedicated `SessionFactory()` session** (`requirement_session`)
  rather than the request's shared session, specifically because concurrent flushes on one `AsyncSession`
  are not safe (its own comment: `"Session is already flushing"`). That second session is committed/rolled
  back/closed independently in a `finally` block, decoupled from the main request session's lifetime. This
  is the pattern to copy, not invent.
- There is no generic background-task-queue/`FastAPI BackgroundTasks` anywhere in `src/` - `asyncio.
  create_task` paired with a dedicated session is the established mechanism for this.

### The plan

1. Add a standalone `_persist_cars_background(car_specs, user_id, buyer_state_name, thread_id)` function in
   `graph.py` that does exactly what `persist_cars` does today (state/brand lookup + `write_car` per spec),
   but opens its **own** `SessionFactory()` session, and explicitly `commit()`s on success / `rollback()`s on
   exception (today's shared-session version relies on the outer request flow to commit later - a detached
   background task must own its own transaction boundary completely).
2. Add a small fire-and-forget helper that wraps `asyncio.create_task(...)` and **keeps a strong reference**
   to the task in a module-level `set`, removing it via `task.add_done_callback(...)` on completion. This
   matters: per Python's own `asyncio.create_task` docs, a task with no strong reference held anywhere can be
   garbage-collected mid-run, silently dropping the DB write - a real, easy-to-miss failure mode.
3. Change `persist_cars`'s body to call the fire-and-forget helper and return immediately (`{"step": step}`)
   without awaiting the DB work. No graph edges need to change - `persist_cars` stays exactly where it is in
   `web_search_agent -> persist_cars -> compose`, it just stops blocking that edge.
4. Keep the existing skip conditions (`preview` mode, missing make/model/year/price, no matching
   `Brand`/`State` row) identical to today's `persist_cars` - only the execution model (blocking -> fire-
   and-forget) changes, not the persistence rules.
5. Failure handling: a failed background write only logs a warning (`agent_persist_cars_failed`) - it must
   never surface to or affect the buyer's already-streamed answer, since by the time it could fail the
   response may already be fully sent.

This plan was carried out exactly as written above, after pulling the branch this work now lives on
(`feature/premium-ui-2`) and re-applying the stashed crawling fix - see the "IMPLEMENTED" section earlier in
this document for what actually landed.
