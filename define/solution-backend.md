# DriveDeal — Backend Solution Document

> **This file is an instruction prompt.** Hand it to an AI development agent
> together with [`solution-business.md`](./solution-business.md) and
> [`solution-frontend.md`](./solution-frontend.md). It contains no application
> code — it is the contract the implementation must satisfy.
>
> **Authority order.** Column names, types, constraints and indexes come from
> [`schema-visualizer.md`](./schema-visualizer.md). Relationships come from
> [`schema-erd.mmd`](./schema-erd.mmd). Product rules come from
> [`solution-business.md`](./solution-business.md). **The response contract
> comes from the frontend's mock types — §0.2 is binding and is settled, not
> negotiable.** Where this document deliberately departs from the schema, the
> departure is in §2 and is binding. Where they disagree silently, stop and
> raise it.

---

## 0.0 Build order — the frontend ships first

**The frontend will already be complete and demonstrable before this document is
implemented.** It was built against local mock data in
`frontend/src/services/mocks/`, and every screen, state, transition and
animation already works.

**Consequences for how you build the backend:**

1. **The mock types are your response contract.** `frontend/src/services/generated/types.ts`
   and `frontend/src/services/generated/client.ts` already declare every entity
   type and every operation the app calls, transcribed from
   `schema-visualizer.md`. **Read them before writing a single Pydantic model.**
   They are the settled agreement; this document must produce them exactly, not
   restate them.
2. **You are not designing an API. You are implementing one.** Every endpoint in
   §9 already has a caller, a screen, an error state and a test harness behind
   it. Field names, nullability, the controlled vocabularies, `money as string`
   and the `role` union are fixed. **A response that the mock client could not
   consume is a defect, even if it is well-designed REST.**
3. **The integration is a swap, not a migration.** The frontend talks to a
   `DriveDealClient` interface with two implementations. You write the `HttpClient`
   and it is wired in behind `VITE_USE_MOCKS=false`. **No screen changes, and if
   a screen needs changing, your response shape is wrong.**
4. **The mock layer stays in the repo.** It is the executable specification and
   the test harness for every screen — the harness for testing the frontend
   against *your* responses without a server.
5. **The frontend's arithmetic must be reproduced, not reinvented.** Its
   `helpers/match.ts` encodes the out-of-door total, the leaderboard sort
   (`final_price ASC, created_at ASC`) and the leader/revision flags. The
   generated column and the leaderboard index must agree with it exactly, or
   the two will disagree in front of a user.
6. **The real-time event union is the wire format** and already has a client
   implementation — message id, dedupe, reconnect and gap replay. §8
   implements the server for a client that is already written.

**Do not** "improve" the contract, add fields the UI does not read, change the
error envelope, or rename a status value. If you believe the contract is wrong,
raise it as a change request before writing code.

---

## 0.1 Stack — pinned, no substitutions

| Layer | Choice | Version target | Why this and not the alternative |
|---|---|---|---|
| Language | Python | **3.11** | Pinned in `backend/Dockerfile` (`python:3.11-slim`) and in CI |
| Web framework | **FastAPI** | 0.115+ | Native async, auto OpenAPI, WebSocket support in-process. Its generated OpenAPI is a **verification artefact** — the contract is already fixed by the frontend (§0.2) |
| ORM | **SQLAlchemy 2.0 async** | 2.0.x | `Mapped[...]` / `mapped_column` typing, `async_sessionmaker`. The `src/repositories/schema` layer is the declarative base |
| Migrations | **Alembic** | latest | Autogenerate against the declarative metadata |
| Validation / settings | **Pydantic v2** + `pydantic-settings` | 2.x | `BaseModel` for the API surface, `Settings` for `src/settings.py` |
| Database | **PostgreSQL on RDS** | 15+ | With `postgis`, `pg_trgm`, `unaccent`. **No `pgvector`** — retrieval is SQL, not vectors (§2 Delta 9) |
| DB driver | `psycopg[binary]` | 3.x | `psycopg[binary]` + `geoalchemy2`. No `pgvector` wheel needed |
| Auth | **JWT (HS256)**, Argon2id passwords | `pyjwt[crypto]`, `argon2-cffi` | Self-contained. **No Supabase Auth** — see §2 Deltas 4–6 |
| AI orchestration | **LangGraph** | latest | Checkpointing maps 1:1 onto `conversation_history` (one row per graph step) |
| LLM | **Anthropic Claude** via `langchain-anthropic` | latest | Per product decision. `provider` in `llm_audits` is `anthropic` |
| Retrieval | **The relational schema itself** | — | The agent emits SQLAlchemy ORM queries; PostgreSQL *is* the knowledge base. No vector store, no embedding model (§2 Delta 9) |
| Web search / crawl | **Crawl4AI** | latest (0.9.x) | The single web tool. Async, headless-browser, returns LLM-ready markdown. **No hand-rolled fetching, no `selectolax`, no `bs4`** — see §10.4 |
| Logging | `structlog` | latest | JSON logs that carry the same `uuid`/`request_id` as `error_logs` |
| Tests | `pytest`, `pytest-asyncio`, `pytest-cov` | latest | CI floor is 75% |
| Lint/format | **ruff** | latest | `ruff check` + `ruff format --check`, zero warnings |
| HTTP client (outbound) | `src/client/` | — | The enforced folder structure requires this directory; it wraps the Crawl4AI crawler |

**The installable package names behind that table.** The rows above name
libraries; `backend/requirements.txt` needs the exact pip identifiers, and three
of them are not guessable from the display name:

| Layer | pip package | Note |
|---|---|---|
| Web framework | `fastapi`, `uvicorn[standard]` | `websockets` comes via the uvicorn extra |
| ORM / driver | `sqlalchemy[asyncio]`, `asyncpg`, `psycopg[binary]`, `alembic`, `geoalchemy2` | **`psycopg[binary]` is required in addition to `asyncpg`** — Alembic and the generated-column checks need the sync driver, and `asyncpg` alone cannot run them |
| Validation | `pydantic`, `pydantic-settings` | |
| Auth | `pyjwt[crypto]`, `argon2-cffi` | the `[crypto]` extra is what pulls in the HS256 backend |
| AI | `anthropic`, `langchain`, `langchain-anthropic`, `langgraph` | `langchain-anthropic` is the LLM binding; `anthropic` is its transport |
| **Web crawl** | **`crawl4ai`** | The single web tool (§10.4). Spelled with digits, not `crawl4-ai`. **This is the one that is easy to miss** and it is required — `web_search` is a load-bearing tool for the compare agent, and its absence is not a clean import error but a broken tool at runtime |
| Storage | `boto3` | S3 presign for `deal_documents` |
| Logging | `structlog` | |
| Test / lint | `pytest`, `pytest-asyncio`, `pytest-cov`, `ruff`, `bandit` | needed by the CI lint and coverage stages, so they belong in the same file |

`crawl4ai` additionally requires **system** libraries in the runtime image
(`libnss3`, `libatk-bridge2.0-0`, `libgbm1`, `libasound2`, `libpango`, and the
rest of the Chromium dependency set). A `pip install` that succeeds on a
developer laptop will still fail at `BrowserConfig` launch time in a bare
`python:3.11-slim` container, which is why `backend/Dockerfile` must install
them and why the image is not built from the slim base unmodified.

### 0.2 The response contract (settled — read before writing a model)

The frontend is built and running against mocks. **Its types are the
contract.** This is the single most important instruction in the document.

**Source of truth, in this order:**

1. `frontend/src/services/generated/types.ts` — every entity type, transcribed
   from `schema-visualizer.md`
2. `frontend/src/services/generated/client.ts` — the `DriveDealClient` interface,
   one method per operation the UI calls
3. `frontend/src/services/mocks/` — the exact response shapes, including the
   worked examples below
4. The error envelope, `§6.2` here and `§2.5` of the frontend doc
5. The realtime event union, `§8` here and `§2.6` of the frontend doc

**Five things that are fixed and will not be changed by you:**

| Contract point | Rule |
|---|---|
| **Money** | Serialised as a **JSON string decimal** — `"70229.00"`. Never a JSON number. The frontend parses once through `helpers/currency` and deliberately avoids float arithmetic |
| **Controlled vocabularies** | Exactly the values in `schema-visualizer.md` §11, with that exact spelling. `seller` is `dealer` (§2 Delta 1). `Mercedes` and `Mercedes-Benz` are one brand |
| **Nullability** | Nullable DB columns serialise as `null`, never omitted and never a sentinel. A `null` spec renders as **"not reported"** in the UI — that is a rendered state, so returning `""` or `0` instead of `null` is a contract violation |
| **Status unions** | `role`, `buyerRequestStatus`, `quoteStatus`, `dealStatus`, `timeline`, `ticketStatus`, `verificationStatus` are closed unions. An unknown value must be a `422`, never a silent default |
| **Error envelope** | `{ "error": { "code", "message", "details", "request_id" } }`. The UI branches on `code` and **never parses `message`** |

**The worked examples in the mock data are acceptance tests.** The frontend
already asserts these, and your responses must reproduce them exactly:

| Fact | Value |
|---|---|
| Quote `118bd33a-…` breakdown | `65345 + 800 + 4084 + 0 − 0 = 70229.00` |
| Quote `2fa7ac94-…` breakdown | `32600 + 150 + 2038 + 203 − 0 = 34991.00`, `status: accepted` |
| Ticket ids | `TIC-316519` (customer), `DS9940692696` (dealer) — unique **per category** |
| Verification ids | `DV1788793917` pending, `DV1788882726` approved, `DV1788278835` denied, `SA97379` agent approved |
| Request statuses on seeded data | `open` × 4, `fulfilled` × 1 |
| Leaderboard | Navee Motors leads the Bronco request at `70229.00`; two dealers carry `revision_needed` |

**How to verify you are conformant, not merely similar:**

1. Serve your OpenAPI at `/api/v1/openapi.json` and run it through the
   frontend's generator. **The diff against the committed
   `src/services/generated/` must be empty.** A non-empty diff is a contract
   violation, and it is the check that catches it before anyone opens the app.
2. Run the frontend against your live API with `VITE_USE_MOCKS=false` and walk
   **every** screen in the frontend's §3 route table. Loading, empty, error and
   loaded states each.
3. Drive the mock's `?chaos` flag against your server — every screen's error
   state must render a real server error correctly, not just a mock one.
4. Exercise the realtime path (§8) for leaderboard re-ranking, chat delivery, and
   a dropped connection. Reconnect must recover the missed state by re-fetching
   over REST — there is no server-side replay (§8 rule 1).
5. Walk both chat doors (§9.5): accept-then-chat, and
   request-then-dealer-accept-then-chat. Confirm the contact is unreachable
   before the gate opens — try `/quotes/{id}/dealer-contact` and
   `GET /chats/{quote_id}` on a pending quote and expect
   `DEALER_CONTACT_WITHHELD` and `CHAT_NOT_OPEN`, not empty data.
6. Confirm `/api/v1/openapi.json` and `/api/v1/docs` are reachable **without**
   an `Authorization` header, and that `/api/v1/docs` renders the same document.

If a response makes a frontend screen change, the response is wrong. Not the
screen.

### 0.3 Explicit non-dependencies

- **No Supabase.** No `supabase` client, no `auth.uid()`, no GoTrue, no Supabase
  Realtime. The deployment target is a self-contained Docker container on EC2
  (`drive-deal-dsu-api`) talking to RDS.
- **No Alembic-autogenerate in CI.** Migrations are hand-reviewed; autogenerate
  is a developer convenience only.
- **No ORM-level cascade deletes** for `deal_quotes`, `deal_documents`,
  `deal_chats` — the FK `ON DELETE` rules in the schema are authoritative and
  must be expressed in the migrations, not left to SQLAlchemy defaults.
- **No background task framework.** Scheduled work (§9.5) uses an explicit
  scheduler, not per-request `BackgroundTasks` for anything that must be
  retried.

---

## 1. Directory structure — the layout CI enforces

The CI pipeline's Stage 2 fails the build if any of these is missing. This is
not advisory; it is a hard gate on every PR.

```
backend/
├── main.py                          # ASGI entry point — REQUIRED FILE
├── Dockerfile                       # exists
├── .dockerignore                    # exists
├── requirements.txt                 # REQUIRED for the Docker build
├── alembic.ini
├── pyproject.toml                   # ruff config
├── pytest.ini  (or [tool.pytest] in pyproject)
├── migrations/                      # Alembic revisions
├── tests/                           # REQUIRED DIR — mirrored test tree
│   └── ...
└── src/                             # REQUIRED DIR
    ├── __init__.py                  # REQUIRED FILE
    ├── settings.py                  # REQUIRED FILE
    ├── models/                      # REQUIRED DIR — SQLAlchemy ORM entities
    ├── schemas/                     # REQUIRED DIR — Pydantic request/response
    ├── routes/                      # REQUIRED DIR — FastAPI routers
    ├── middleware/                  # REQUIRED DIR — request context, auth, audit
    ├── services/                    # REQUIRED DIR — business logic
    ├── repositories/                # REQUIRED DIR — data access, NO business logic
    │   └── schema/                  # REQUIRED DIR — declarative base, mixins
    ├── client/                      # REQUIRED DIR — outbound HTTP, scrape tool
    ├── utils/                       # REQUIRED DIR
    │   └── exceptions/              # REQUIRED DIR — custom exception hierarchy
    └── agents/                      # LangGraph graphs, tools, nodes
```

### 1.1 Layer contract — the one rule that matters

```
routes/  →  services/  →  repositories/  →  models/  →  PostgreSQL
             ↑
       client/ (agents call outbound HTTP)
```

- **`routes/`** — HTTP and WebSocket only. Parse input via Pydantic, call exactly
  one service method, shape the response. **No SQL. No business logic. No
  `await session.execute()`.** No route may import from `repositories/`.
- **`services/`** — all business logic and all transaction boundaries. This is
  the only layer that opens a session and commits. A service method is one
  transaction.
- **`repositories/`** — data access and **nothing else**. No business decisions,
  no status transitions, no permission reasoning. A repository method is one
  query (or one explicitly-named multi-query read).
- **`models/`** — declarative ORM entities only, no methods that do I/O.
- **`schemas/`** — Pydantic in/out types. Separate from `models/` so a DB column
  change never silently alters the API contract.
- **`client/`** — outbound HTTP: the **Crawl4AI crawler wrapper**, the Anthropic
  client wrapper, the email sender. Nothing here may import from `services/`.
- **`utils/exceptions/`** — the custom hierarchy (§6.1) that maps to HTTP status
  codes. Routes never raise bare `HTTPException`.
- **`agents/`** — LangGraph graphs and tools. Tools are thin adapters that call
  `repositories/` (KB reads/writes) and `client/` (scrape). They must not
  contain their own SQL or their own HTTP calls.

**A test in `tests/` mirrors this tree**: `tests/services/`,
`tests/repositories/`, `tests/routes/`, `tests/agents/`, `tests/utils/`.

### 1.2 Import rules (enforce with ruff)

```toml
# pyproject.toml
[tool.ruff.lint]
select = ["E", "F", "I", "N", "UP", "B", "A", "C4", "SIM", "T20", "ASYNC", "S", "ARG", "PTH"]

[tool.ruff.lint.flake8-tidy-imports]
ban-relative-imports = "parents"   # absolute imports only

[tool.ruff.lint.isort]
known-first-party = ["src"]
```

Add `TID` to `select` and ban the forbidden parents in
`flake8-tidy-imports.banned-api` so a layering violation fails lint, not a code
review. Note `S` (bandits) is on because CI runs Bandit at high severity —
keep `# nosec` comments meaningful and few.

---

## 2. Schema deltas from `schema-visualizer.md`

The schema was designed for Supabase Auth. This build uses FastAPI + SQLAlchemy
+ RDS + JWT. The data dictionary stays as written; the *auth plumbing* is
re-expressed. These deltas are binding and are what Alembic migrations must
produce.

### Delta 1 — `profiles.role`: `seller` → `dealer`

```sql
ALTER TABLE profiles DROP CONSTRAINT profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('buyer','dealer','support','admin'));
UPDATE profiles SET role = 'dealer' WHERE role = 'seller';
```

Applied **after** dropping and re-adding the constraint, or the `UPDATE` fails
under the old one. "Dealer" is the single term everywhere: DB enum, API field,
route segment, JWT claim, UI copy. `seller` survives only in historical column
names.

### Delta 2 — restore `deal_quotes.deal_status`

`schema-visualizer.md` §11.2 documents dropping this as deleting 39/39 live
values with no replacement. It comes back, **as slugs** (the legacy values
contained spaces and capitals and cannot be a clean `ENUM`):

| Slug | Legacy display string |
|---|---|
| `paperwork_going_on` | Paperwork going on |
| `funds_arrived` | Funds arrived *(legacy typo `Funds Arranged`, 2 rows — remap)* |
| `dispatch` | Dispatch |
| `delivery` | Delivery |
| `completed` | Completed |
| `cancelled` | Cancelled |

```sql
ALTER TABLE deal_quotes ADD COLUMN deal_status text
  CHECK (deal_status IS NULL OR deal_status IN
    ('paperwork_going_on','funds_arrived','dispatch','delivery','completed','cancelled'));

CREATE TYPE deal_status_transition AS ENUM (...);  -- for the transition guard
```

**The transition guard.** Status must only move forward through the defined
order, with `cancelled` reachable from any non-terminal state. Enforce with a
PL/pgSQL trigger that raises on an illegal pair, not with application code —
application code is bypassable and the deal lifecycle is a financial record.
Legitimate order:

```
NULL → paperwork_going_on → funds_arrived → dispatch → delivery → completed
        ↘ cancelled (from any state except completed/cancelled)
```

`completed` is buyer-confirmed. `cancelled` may be set by a dealer or by
support. Advance via a dedicated service method; every transition appends to
`deal_history` (§Delta 3) with `actor_id` and `actor_role`.

### Delta 3 — restore `deal_quotes.deal_history`

```sql
ALTER TABLE deal_quotes ADD COLUMN deal_history jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(deal_history) = 'array');
```

Append-only. Every entry carries `ts`, `actor_id`, `actor_role`, `event`, and
event-specific fields. Price revisions append
`{previous_final_price, new_final_price, was_leading, now_leading,
competitors_extended}`. **Never rewrite or reorder existing entries** — a
service that rewrites history is a bug, and a test must assert it.

### Delta 4 — `set_audit_actor()` without `auth.uid()`

```sql
CREATE OR REPLACE FUNCTION set_audit_actor() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor text := COALESCE(
  NULLIF(current_setting('app.current_user_id', true), ''), 'system');
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := COALESCE(NEW.created_at, now());
    NEW.created_by := v_actor;
  END IF;
  NEW.updated_at := now();
  NEW.updated_by := v_actor;
  RETURN NEW;
END; $$;
```

All 15 tables keep the trigger. The `text` column holding either a uuid or the
literal `'system'` remains, with the same `CHECK` — the reasoning in
`schema-visualizer.md` §2.1 is unchanged.

**`app.current_user_id` is set by the session, never by the client.** See §5.3.

### Delta 5 — RLS: same intent, two enforcement layers

`schema-visualizer.md` §14 lists 28 policies keyed on `auth.uid()`. Under
FastAPI + RDS the intent is preserved but expressed twice, and **both layers
must pass** — application-layer-only is defence-in-depth, DB-layer-only is
unreachable from an ORM that does not set the GUC.

**Layer A — Postgres RLS on the GUC.** `ALTER TABLE … ENABLE ROW LEVEL SECURITY`
and rewrite `auth.uid()` → `NULLIF(current_setting('app.current_user_id', true),
'')::uuid`, and the role checks → `app.current_role` (a second GUC). The
service-role connection uses a dedicated role with `BYPASSRLS`.

**Layer B — the application.** A `RoleGuard` dependency (§5.2) and an
ownership check in every repository read. The repository layer is where the
`EXISTS (SELECT 1 FROM deal_quotes q WHERE q.id = :quote_id AND q.buyer_id =
me)` patterns from §14 live.

> **Three legacy policies must not be reproduced** (`schema-visualizer.md` §14
> "Hardening the live policies"): the `USING (true)` read on quotes, and the
> two fully open `USING (true) WITH CHECK (true)` policies. Every policy you
> write is a named allow-list. A blanket `ALLOW ALL` is a security incident and
> must be rejected in review.

### Delta 6 — `profiles.id` is no longer an auth uid

`profiles.id` becomes `DEFAULT gen_random_uuid()`. The `profiles` table loses
its `REFERENCES auth.users(id)` dependency entirely — there is no
`auth.users`. The 1:1 credential link is `users.profile_id` (already `UNIQUE`),
which is now the only relationship between a person and their login.

**Migration order for any profile that previously had a Supabase auth user:**
create the new `profiles` row, create the `users` row pointing at it, then
rewrite every FK from the old auth uid to the new `profiles.id` in a single
transaction. Never leave a `profiles` row without its `users` row —
`profile_id` is `NOT NULL`.

### Delta 7 — Realtime via FastAPI WebSocket, not Supabase Realtime

`schema-visualizer.md` §15 lists two Supabase channels. Their **coverage** is
preserved and delivered over a self-hosted WebSocket, but the channel/subscribe
mechanism is not: the server pushes to each socket based on who owns it, so the
client cannot widen its own access by subscribing. The two channels map onto the
frame types as follows — the left column is what the legacy channel covered, the
right is what the client receives:

| Legacy channel | Former filter | Frames that replace it |
|---|---|---|
| `quote:{quote_id}` | `quote_id=eq.<id>` | `chat_message`, `chat_read`, plus `chat_request` for a dealer's triage on that quote |
| `request:{buyer_request_id}` | `buyer_request_id=eq.<id>` | `leaderboard_updated` and `quote_update` (the latter covers what were four separate `quote.created` / `revised` / `accepted` / `declined` events) |
| — | — | `deal_status`, `request_update`, `heartbeat` had no legacy channel; they are additions |

See §8 for the wire protocol. The point of the request-scoped frames is that
the buyer's leaderboard re-ranks **without a refresh** when a dealer revises a
price — that is a hard requirement from `solution-business.md` §4.5.

### Delta 8 — `quote_history` stays dropped, replaced by `deal_history`

`schema-visualizer.md` §11.1's anti-sniping ranking gap is closed by Delta 3's
`deal_history`, not by reinstating the `quote_history` blob. Do not add
`quote_history` back — one revision ledger per quote, typed, append-only.

### Delta 9 — no vector embeddings. The database *is* the knowledge base

**There is no `cars.embedding` column, no `pgvector` extension, no embedding
model, and no vector index in this build.** Retrieval is **structured SQL**: the
agent translates a user question into an ORM query, runs it against PostgreSQL,
and answers from the rows.

**What this deletes:**

| Removed | Consequence |
|---|---|
| `cars.embedding vector(1536)` | Column dropped |
| `ivfflat (embedding vector_cosine_ops)` and `GIN (embedding vector_ip_ops)` indexes | Dropped — and with them the `CREATE INDEX CONCURRENTLY` migration concern in §7.2 |
| `pgvector` extension and the `pgvector` Python package | Neither is required. `postgis`, `pg_trgm` and `unaccent` remain |
| `EMBEDDING_MODEL` setting | Deleted from §3 |
| `task_type = 'embedding'` writes in `llm_audits` | No embedding task is ever logged. `'rag_retrieval'` stays in the `CHECK` constraint and is renamed in meaning to SQL retrieval (§10.3) — **keep the enum value** so the constraint is not rewritten |

`schema-visualizer.md` has been **aligned with this delta**: the `embedding`
column, the two vector indexes, and the `pgvector` extension line are removed,
and the engine header now reads PostgreSQL + `postgis` + `pg_trgm` +
`unaccent`. §11.1's "dropped tables" row that mapped the old RAG tables onto
`cars.embedding` has been corrected to map onto `cars` + `cars.reviews`.

The remaining `embedding` strings in `schema-visualizer.md` are deliberate and
must stay: the `'embedding'` value inside the `llm_audits.task_type` `CHECK`
constraint (line ~983) and its sample row (line ~1013) are historical audit
data, not a live code path. The `CREATE EXTENSION vector` line in the §12
migration order is removed, since an extension that is never queried only
slows down every write.

**What replaces semantic search:** `pg_trgm` similarity + `unaccent` for fuzzy
text, plain indexed equality and range predicates for everything structured,
and `postgis` for distance. Every question the advisor is asked in this product
is answerable from typed columns — brand, model, body type, price range, year,
mileage, rating, state, radius, features, quote history. There is no unstructured
corpus here that only an embedding index could reach.

**The trade-off, stated honestly:** text search is exact-lexical where vector
search was fuzzy-semantic. *"something reliable for snow"* will not match
`AWD` via trigram similarity. Two mitigations are mandatory:

1. **`cars.features` and `cars.title` are queryable, and the agent is instructed
   to widen** — try the literal term, then the brand, then drop the constraint
   and rank, rather than returning nothing.
2. **`web_search` covers what the columns cannot.** This is precisely the gap it
   exists for, and it is why `kb_insert` (§10.4) is not optional.

Do not reintroduce embeddings to solve a recall complaint without raising it
first. It is an architectural decision, not a tuning knob.

### Delta 10 — terms acceptance is stored, not just asserted at signup

`solution-frontend.md` §3.5 makes a Terms checkbox mandatory on all three
signup forms. The frontend doc specifies the *interaction* but is silent on
persistence, which is a real gap: a consent record that lives only in a POST
body is not evidence of consent, and the product has a `/terms` page with a
last-updated date, so the accepted version must be identifiable.

**Storage: two columns on `profiles`.** No separate `terms_acceptances` table
in this build — one account has one signup, and an account re-created after
deletion is a new `profiles` row, so a per-account column is sufficient and
avoids a 16th table.

```sql
ALTER TABLE profiles
  ADD COLUMN terms_accepted     boolean     NOT NULL DEFAULT false,
  ADD COLUMN terms_version      text        NOT NULL DEFAULT '2026-09-01',
  ADD COLUMN terms_accepted_at  timestamptz;
```

**The three columns and who owns them:**

| Column | Owner | Rule |
|---|---|---|
| `terms_version` | server | The version string the user was shown. Server-assigned from the current `TERMS_VERSION` constant, **never taken from the request** — a client that posts an arbitrary version is a bug, not a feature |
| `terms_accepted` | client | `true` on signup. Server rejects signup when it is false or absent with `VALIDATION_ERROR` |
| `terms_accepted_at` | server | `now()` at signup. The client may send it, and the value is **ignored**; it exists so a shared-client field list does not leak a false "client supplied a timestamp" impression |

**Sign-up requests carry `terms_accepted: boolean` and `terms_version: string`
(the latter validated as advisory, then overwritten).** All three of
`BuyerSignupRequest`, `DealerSignupRequest`, and `SupportSignupRequest` in
`design/openapi.yaml` have `terms_accepted` in `required`; the response objects
expose `terms_accepted_at` read-only.

**Rules:**

1. `terms_accepted != true` → `422 VALIDATION_ERROR` on all three signup routes.
   Never create a `users` row and never return tokens first.
2. A token is issued **only after** the `profiles` and `users` rows exist, so
   there is no window where an account exists without its consent record.
3. The dealer and support signups are already inactive pending approval, so the
   consent record is written at the same moment — approval later does not touch it.
4. `/auth/me` returns `terms_accepted_at`. If it is ever `NULL` on an existing
   account (a row backfilled from the legacy schema), the account is treated as
   **not** consented and must re-accept at next login; do not backfill the column
   with the migration timestamp, which would fabricate consent.
5. The `TERMS_VERSION` constant is a single source of truth shared with the
   frontend `/terms` page's last-updated date. If they ever disagree, the
   frontend is wrong — a page whose date differs from what users agreed to is
   the actual legal exposure.

**Privacy Policy is deliberately not versioned here.** One `terms_version`
covers the signup checkbox, which references both documents. If the two ever
need independent version history, that is the trigger to promote this to a
`terms_acceptances` table — not a reason to add two nullable columns now.

### Delta 11 — chat access request state on `deal_quotes`

§9.5 adds a buyer-initiated "ask to chat" before acceptance. That request is
durable, auditable, and per-party, but it is **one per quote at a time** — which
is exactly the shape `deal_quotes` already has for everything else chat-related.
So it lives on the quote, not in a sixteenth table:

```sql
ALTER TABLE deal_quotes
  ADD COLUMN chat_request_status   text
    CHECK (chat_request_status IS NULL
           OR chat_request_status IN ('pending','accepted','declined')),
  ADD COLUMN chat_request_message  text CHECK (length(chat_request_message) <= 1000),
  ADD COLUMN chat_requested_at     timestamptz,
  ADD COLUMN chat_responded_at     timestamptz,
  ADD COLUMN chat_decline_reason   text CHECK (length(chat_decline_reason) <= 500);

CREATE INDEX deal_quotes_chat_inbox_idx
  ON deal_quotes (dealer_id, chat_requested_at DESC)
  WHERE chat_request_status = 'pending';
```

**Why columns and not a `chat_access_requests` table.** The dealer inbox
(`GET /chats/requests`) is then a single index scan on the partial index above,
returning the quote's own denormalised `buyer_id` / `dealer_id` and joining to
`buyer_requests` for the vehicle summary — no new joins, no second source of
truth for "who is this quote about", and nothing to keep consistent when a quote
is withdrawn. A table earns its keep when there are *many* requests per quote
(a negotiation history); here the product explicitly allows one live request,
and a re-request after a decline overwrites the previous outcome by design.

**Two invariants the CHECK constraints cannot express, so enforce them in the
service and state them here:**

1. `chat_requested_at IS NOT NULL` **iff** `chat_request_status IS NOT NULL`, and
   `chat_responded_at IS NOT NULL` **iff** the status is terminal. A pending
   request has no response timestamp.
2. `chat_request_status` can only leave `pending` once. Re-accepting an accepted
   request is a 200 no-op, and re-declining a declined one is a 200 no-op.

Acceptance is one transaction across four writes: the status flip, the quote's
`status → 'negotiating'`, the `deal_chats` row, and the `deal_history` entry.
Any of them failing alone leaves a dealer who believes they answered and a buyer
who is still locked out.

---

## 3. Configuration — `src/settings.py`

Pydantic `BaseSettings`, env-driven, **no secrets in code or defaults**. Every
field must have a safe non-secret default except those that must fail fast at
boot.

| Field | Env | Default | Notes |
|---|---|---|---|
| `APP_ENV` | `APP_ENV` | `development` | `development` / `staging` / `production`; drives `error_logs.environment` |
| `DATABASE_URL` | `DATABASE_URL` | — | **required**, no default. `postgresql+asyncpg://…` |
| `JWT_SECRET` | `JWT_SECRET` | — | **required.** HS256. No committed default, ever |
| `JWT_ALGORITHM` | — | `HS256` | |
| `JWT_ACCESS_TTL_MIN` | — | `30` | |
| `JWT_REFRESH_TTL_DAYS` | — | `14` | |
| `CORS_ORIGINS` | `CORS_ORIGINS` | `http://localhost:5173` | Comma-separated allow-list. `*` is a production startup error |
| `ANTHROPIC_API_KEY` | `ANTHROPIC_API_KEY` | — | required for agents to start |
| `LLM_MODEL` | `LLM_MODEL` | `claude-sonnet-5` | |
| `LLM_MAX_TOKENS` | — | `4096` | |
| `LLM_TIMEOUT_S` | — | `30` | A real logged `LLM_TIMEOUT` exceeded 30 s (`error_logs` 500003) |
| `SCRAPE_USER_AGENT` | — | `DriveDealBot/1.0 (+https://drivedeal.example/bot)` | Sets Crawl4AI's `BrowserConfig.user_agent`. Honest identification, required by `robots.txt` etiquette |
| `SCRAPE_RATE_LIMIT_RPS` | — | `1.0` | Per-domain politeness |
| `SCRAPE_TIMEOUT_S` | — | `15` | Crawl4AI `CrawlerRunConfig.page_timeout` + the `arun` call deadline |
| `SCRAPE_MAX_BYTES` | — | `2_000_000` | Hard cap on a response body |
| `CRAWL4AI_BROWSER` | — | `chromium` | `BrowserConfig.browser_type`. Firefox also supported; Chromium is the default and the tested one |
| `CRAWL4AI_HEADLESS` | — | `true` | Never `false` in any deployed environment |
| `CRAWL4AI_MAX_PAGES` | — | `5` | Ceiling on pages fetched per `web_search` call |
| `CRAWL4AI_CACHE_MODE` | — | `enabled` | `Crawl4AI CacheMode.ENABLED` so repeat questions skip the network |
| `S3_BUCKET` | `S3_BUCKET` | — | `deal_documents` stores keys only |
| `S3_REGION` | — | `us-east-1` | |
| `SALES_TAX_RATES` | — | `{"TX": 0.0625}` | See §9.8 — this is a known simplification |
| `STATES_TTL_S` | — | `86400` | `states` / `brands` master cache |
| `EXPIRY_SWEEP_CRON` | — | `0 3 * * *` | Matches the legacy schedule |
| `LOG_LEVEL` | — | `INFO` | |

**`JWT_SECRET` is the single most dangerous value in the system.** A committed
default, a test key in production, or a key that appears in an error log is an
incident. Add an explicit startup assertion that it is present, ≥ 32 bytes, and
not the value used in `tests/`.

> `scripts/generate_env.py` (already in the repo, called by the CI at Stage 8
> and Stage 9) renders `frontend/.env.production` and `backend.env` from GitHub
> Secrets. Every field above must have a matching entry in that script's
> mapping, or the deployed container will boot with a missing variable.

---

## 4. `main.py` — application assembly

Responsibilities, in order:

1. Create the `FastAPI` instance. Metadata: title `DriveDeal API`, version from
   the build, `openapi_url = /api/v1/openapi.json`, `docs_url = /api/v1/docs`.
   Both are **unauthenticated and read-only**. They are documentation routes, not
   business APIs (§9.9) — gate them on `APP_ENV` if the deployment must not
   expose the schema publicly, but never put them behind a user token: a token
   makes them unlinkable, and `/openapi.json` is the stable URL that Postman,
   codegen, and the frontend's generator all pin to.
2. Install middleware **in this order** — order is load-bearing:
   `RequestContextMiddleware` (§5.1) → `CORSMiddleware` → `GzipMiddleware`
   (minimum size 1000) → `TrustedHostMiddleware`.
3. `lifespan` handler: create the `async_sessionmaker`, warm the states/brands
   cache, run light migrations check, start the scheduler (§9.6), and on
   shutdown close pools and stop the scheduler cleanly.
4. `include_router` for each domain under `/api/v1` (§6.3).
5. Mount the WebSocket router (§8).
6. `GET /health` (liveness — no DB call) and `GET /api/v1/health/ready`
   (readiness — pings the DB, returns 503 if it fails). Container healthcheck
   uses `/health`.
7. A root handler that returns 404 with the API's error envelope shape, so a
   mistyped route does not return FastAPI's default HTML.

---

## 5. Middleware and authentication

### 5.1 `RequestContextMiddleware`

The spine of the whole system. For every request:

1. Generate or accept `X-Request-Id`.
2. Generate the correlation `uuid` (also used by `llm_audits.uuid` and
   `error_logs.uuid`).
3. Bind a `structlog` contextvars logger carrying `request_id`, `uuid`,
   `path`, `method`, `user_id`, `role`.
4. On completion, write an `error_logs` row for any unhandled exception or
   status ≥ 500, with `error_code`, truncated `stack_trace` (8 KB cap), `source`
   = `backend`, `endpoint`, `request_id`, `user_id`, `environment`, and a
   **PII-scrubbed** `error_context`. Scrub `password`, `token`, `authorization`,
   `api_key`, and any `users.password_hash`.
5. Response headers: `X-Request-Id`.

**Never log** a password, a JWT, or an `ANTHROPIC_API_KEY`. Add a structlog
processor that redacts by key name as a defence-in-depth layer, plus a test that
asserts redaction.

### 5.2 Auth dependencies — `src/middleware/auth.py`

JWT claims, HS256, verified with the constant from `src/settings.py`:

```json
{
  "sub": "<profiles.id uuid>",
  "role": "buyer | dealer | support | admin",
  "email": "rahul01@gmail.com",
  "jti": "<unique token id, for revocation>",
  "iat": 1758000000, "exp": 1758001800, "type": "access"
}
```

| Dependency | Behaviour |
|---|---|
| `get_current_user` | Validates signature + `exp` + `type == 'access'`, loads the profile, rejects if `users.is_active = false`. **A pending dealer's token is rejected here**, which is what makes §1.3's login block work |
| `get_current_profile` | The `profiles` row, cached per-request |
| `require_roles("dealer", "support", "admin")` | Factory. 403 `FORBIDDEN_ROLE` on mismatch |
| `require_approved_dealer` | `require_roles("dealer")` **and** a `support_verifications` row with `status = 'approved'`. Use on every dealer-only route so a mis-issued JWT still cannot act |
| `get_optional_user` | For public routes that personalise (e.g. open request feed) |

**Error codes are specific, never generic.** `DEALER_PENDING_REVIEW` for a
blocked dealer is a product requirement (`solution-business.md` §1.3) — the
dealer must be able to distinguish "not approved yet" from "wrong password".
Full list in §6.2.

**Token handling.** Access token 30 min, refresh 14 days. Refresh rotation:
every refresh issues a new `jti` and stores it, so a replayed refresh token is
detectable and revokes the family. Logout adds `jti` to a revocation set
(Redis, or a `users`-adjacent store if Redis is not adopted — see §11.2).
Password change revokes all outstanding refresh tokens for the profile.

### 5.3 Session actor binding

Every `AsyncSession` in a request opens with the GUC set, so the database audit
trigger resolves the actor without trusting the client:

```python
await session.execute(
    text("SELECT set_config('app.current_user_id', :uid, true), "
         "set_config('app.current_role', :role, true)"),
    {"uid": str(current_user.id), "role": current_user.role},
)
```

- `set_config(..., true)` is **transaction-local** — the setting cannot leak
  across pooled connections. This is a correctness requirement, not a style one.
- A service running with no user (the expiry sweep, an agent background task)
  leaves the GUC unset, and the trigger records `'system'`. That is the correct
  value, not a fallback.
- The ORM must never map `created_by`/`updated_by` as writable client fields.

---

## 6. Errors, exceptions and the response envelope

### 6.1 Custom hierarchy — `src/utils/exceptions/`

```
DriveDealError (base)
├── ValidationError            422   input failed Pydantic/business rules
├── AuthenticationError        401   no/invalid/expired credentials
├── PermissionDeniedError      403   authenticated, not allowed
│   └── DealerPendingError     403   DEALER_PENDING_REVIEW
├── NotFoundError              404
├── ConflictError              409   duplicate license, unique violation
├── StateTransitionError       409   illegal deal_status / quote status move
├── RateLimitError             429
├── UpstreamError              502   scrape or LLM provider failed
│   └── LLMTimeoutError        504
└── LLMRefusalError            422   provider refused; content filtered
```

Rules: routes **never** raise bare `HTTPException`; services raise these;
a single exception handler in `main.py` maps each to its status and error code.
Every LLM-path exception must also write an `llm_audits` row with the matching
`status` (`timeout`, `rate_limited`, `refused`, `content_filtered`, `error`).

### 6.2 Error envelope

```json
{
  "error": {
    "code": "DEALER_PENDING_REVIEW",
    "message": "Your dealer account is awaiting support approval.",
    "details": { "verification_id": "4cac1879-…" },
    "request_id": "a1b2c3d4-0001-4e5f-8a9b-0c1d2e3f4a5b"
  }
}
```

`code` is a **stable machine-readable string** the frontend branches on;
`message` is for humans and may be reworded. The frontend must never parse
`message`. Codes: `VALIDATION_ERROR`, `UNAUTHENTICATED`, `INVALID_CREDENTIALS`,
`TOKEN_EXPIRED`, `FORBIDDEN_ROLE`, `DEALER_PENDING_REVIEW`, `NOT_FOUND`,
`CONFLICT`, `ILLEGAL_TRANSITION`, `RATE_LIMITED`, `UPSTREAM_ERROR`,
`LLM_TIMEOUT`, `LLM_REFUSED`.

### 6.3 `src/routes/` — the router map

One module per domain, each an `APIRouter` with a tag, mounted at a prefix.
All under `/api/v1`.

| Module | Prefix | Endpoints (§9) |
|---|---|---|
| `auth.py` | `/api/v1/auth` | signup, login, refresh, logout, verify-email, resend |
| `profiles.py` | `/api/v1/profiles` | me, update, avatar, preferences |
| `reference.py` | `/api/v1/reference` | states, brands |
| `requests.py` | `/api/v1/requests` | buyer CRUD + dealer feed |
| `quotes.py` | `/api/v1/quotes` | submit, list, detail, revise, accept, decline, withdraw |
| `deals.py` | `/api/v1/deals` | list, detail, status advance, document checklist |
| `chat.py` | `/api/v1/chats` | history, send, clear, negotiation request |
| `documents.py` | `/api/v1/documents` | presign upload, confirm, list, delete |
| `support.py` | `/api/v1/support` | tickets CRUD, queue, notes, rca |
| `verifications.py` | `/api/v1/verifications` | queue, approve, deny, reject |
| `members.py` | `/api/v1/members` | support/admin list, approve support agents |
| `ai.py` | `/api/v1/ai` | chat, threads, thread switch, compare, request-preview |
| `health.py` | `/api/v1/health` | liveness, readiness |

---

## 7. `src/repositories/` and `src/models/`

### 7.1 Declarative base — `src/repositories/schema/`

- `Base(DeclarativeBase)` with `MetaData(naming_convention=…)` producing
  deterministic constraint names — essential for Alembic autogenerate to diff
  cleanly.
- `UUIDPrimaryKeyMixin` — `id: Mapped[uuid.UUID]` with
  `server_default=text("gen_random_uuid()")`.
- `TimestampMixin` — `created_at`/`updated_at` with `server_default`/`onupdate`.
- `AuditActorMixin` — `created_by`/`updated_by` as `Mapped[str]`, declared
  `**not** client-writable. The DB trigger owns them; the ORM only reads.
  Enforce by listing them in a `__allow_unmapped__`-style exclusion or by
  making the service layer never assign them.
- `SoftDeleteMixin` where the schema calls for it.
- `Enum` types as `sa.Enum(..., native_enum=True, create_constraint=True)` —
  `text` + `CHECK` as the schema specifies, so the vocabulary stays in one
  place. **Controlled vocabularies are non-negotiable** (`schema-visualizer.md`
  §11). A new `fuel` value requires a migration, not a code change.
- All enums importable from **one** module, so the frontend's codegen and the
  backend cannot drift.

### 7.2 `src/models/` — one module per table

Fifteen modules mirroring the fifteen tables, plus nothing else. Each model
documents the relationship intent from `schema-visualizer.md` §10.3.

Critical modelling points, all straight from the schema:

- **`profiles`** — 1:1 with `users` via `users.profile_id` (`UNIQUE`). The
  relationship that must **not** be added: a second FK to `profiles` labelled
  "auth user".
- **`buyer_requests`** — 20 typed columns. **There is no `requirements` jsonb.**
  `year_min`/`year_max` and `budget_min`/`budget_max` are ranges with
  `CHECK (max >= min)`. `search_radius_miles > 0`.
  `status` in `('draft','open','closed','expired','fulfilled')`.
- **`deal_quotes`** — `final_price` is a **generated stored column**:
  ```python
  final_price: Mapped[Decimal] = mapped_column(
      Computed(
          "vehicle_price + COALESCE(doc_fee,0) + COALESCE(sales_tax,0)"
          " + COALESCE(title_reg,0) - COALESCE(trade_in_credit,0)",
          persisted=True,
      )
  )
  ```
  SQLAlchemy must never write it. It is also the leaderboard sort key, backed by
  `btree (buyer_request_id, final_price ASC, created_at ASC)`.
  `deal_status` and `deal_history` per Deltas 2 and 3.
  `UNIQUE (buyer_request_id, dealer_id)` — one quote per dealer per request.
- **`deal_documents`** — 1:N off `quote_id`, **no `UNIQUE` on `quote_id`**
  (live data has one quote with two document rows). The
  `deal_quotes.deal_documents_id` pointer is `ON DELETE SET NULL`, nullable, and
  safe to leave `NULL` on insert then `UPDATE`.
- **`conversation_history`** — composite PK `(thread_id, checkpoint_id)`.
  `thread_id` alone **cannot** be the PK: a thread accumulates one checkpoint
  per graph node. `thread_id` formats already exist in the wild —
  `dce16b4b-…` (chat), `neg_2fa7ac94-…` (negotiation), `1df42731-…` (advisor)
  — and the new advisor threads must follow a distinguishable pattern so the
  sidebar can list them without a type sniff.
- **`buyer_preference`** — `profile_id` is both PK and FK. No `id`. Absence of
  a row = no preferences stated, and every `NULL` column is a wildcard in the
  match query.
- **`support_tickets`** / **`support_verifications`** — `UNIQUE (category,
  ticket_id)`, **not** `UNIQUE (ticket_id)`. Including `category` is what lets
  `TIC-316519` and `DS9940692696` coexist.
- **`llm_audits`, `error_logs`** — `bigserial` PK, `uuid` `UNIQUE` correlation
  column, soft-delete flags. `llm_audits` is append-only; its `UPDATE` branch is
  never reached.
- **`cars`** — no `embedding` column and no vector indexes exist in this build
  (§2 Delta 9). The `cars` indexes that remain are ordinary btree/GiST ones and
  are created in the initial migration, so `CREATE INDEX CONCURRENTLY` is not
  required here.

### 7.3 Connection and extensions

```python
# requirements.txt
sqlalchemy[asyncio]>=2.0
alembic
psycopg[binary]
geoalchemy2
structlog
```

> **Binary wheels and extensions.** `postgis`, `pg_trgm` and `unaccent` are
> Postgres *server* extensions; the Python packages only speak the wire
> protocol. RDS supports them, but they must be enabled on the instance
> (`ALTER EXTENSION postgis;` etc.) before Alembic runs, or the first migration
> fails. Put extension creation in migration `0001`, not in application startup.
> **`pgvector` is not required and must not be added** — see §2 Delta 9.

Session lifecycle: one `AsyncSession` per request, created by a FastAPI
dependency, committed or rolled back by the service layer, closed on exit. A
service that commits means the request boundary is wrong.

### 7.4 Repository conventions

- Every method takes the current actor explicitly where ownership matters, e.g.
  `find_quote_for_actor(session, quote_id, actor)` — never infer the actor from
  a global.
- **Every** read that touches user data is ownership-scoped in SQL, not by
  post-filtering in Python. Fetch-then-check leaks through counts and
  pagination.
- No repository method returns a `dict` of raw columns for anything the API
  exposes; return ORM entities or explicit row models.
- The leaderboard query lives in one repository method, `list_quotes_leaderboard`,
  with a test asserting the tie-break is `created_at ASC`.

---

## 8. WebSocket protocol

One connection carries all realtime traffic for a profile. Path: `/api/v1/ws`.

**Auth is a single-use ticket, and only a ticket.** The client POSTs its bearer
token to `POST /api/v1/chats/ws-ticket` and receives a `ticket` valid for 60 s and
one use, then upgrades `GET /api/v1/ws?ticket=…`. Browsers cannot set an
`Authorization` header on a handshake, and
`Sec-WebSocket-Protocol: bearer, <token>` leaks the long-lived token into proxy
logs and `Sec-WebSocket-Protocol` negotiation failures. Invalidate the ticket on
first use so a captured URL cannot be replayed.

There is no per-conversation socket. A second tab is a second connection, and one
connection already carries every quote, deal, and request the profile can see.

**Client → server**

```json
{"type": "chat.send", "quote_id": "2fa7ac94-…", "id": "<client uuid>", "message": "Is this in stock?"}
{"type": "chat.read", "quote_id": "2fa7ac94-…", "last_read_message_id": "<uuid>"}
{"type": "ping"}
```

`chat.send` is a thin shim over the same service call as
`POST /chats/{quote_id}`. It must not be a second code path.

**Server → client**

Every frame carries `seq` (monotonic per socket) and `at` (ISO-8601) so the
client can detect a gap.

```json
{"type": "chat_message", "seq": 418, "at": "2026-09-28T11:14:03Z", "data": {
  "id": "05fd4db1-…", "quote_id": "2fa7ac94-…", "sender_id": "…",
  "sender_role": "dealer", "message": "Yes, one owner.", "created_at": "2026-09-28T11:14:02Z"}}
{"type": "chat_request", "seq": 419, "at": "2026-09-28T11:15:44Z", "data": {
  "id": "9c1f0a52-…", "quote_id": "2fa7ac94-…", "status": "accepted",
  "chat_opened": true, "requested_at": "…", "responded_at": "…", "…": "…"}}
{"type": "chat_read",   "seq": 420, "at": "2026-09-28T11:16:00Z",
 "quote_id": "2fa7ac94-…", "last_read_message_id": "05fd4db1-…"}
{"type": "leaderboard_updated", "seq": 421, "at": "2026-09-28T11:20:09Z", "data": {
  "request_id": "15cd4afa-…", "quotes": [{"id": "…", "dealer": "Ridgeway Motors",
  "final_price": "34991.00", "is_leading": true, "revision_needed": false}]}}
{"type": "deal_status", "seq": 422, "at": "2026-09-28T11:20:10Z", "data": { "…": "…" }}
{"type": "quote_update", "seq": 423, "at": "2026-09-28T11:20:11Z", "data": { "…": "…" }}
{"type": "request_update", "seq": 424, "at": "2026-09-28T11:20:12Z", "data": { "…": "…" }}
{"type": "heartbeat",   "seq": 425, "at": "2026-09-28T11:20:30Z"}
{"type": "error",       "seq": 426, "at": "2026-09-28T11:20:31Z", "code": "CHAT_NOT_OPEN", "message": "…"}
```

Frame types are snake_case and the payload sits under `data`; the client upserts
chat messages by `id`, which makes retries and out-of-order delivery harmless.

**Rules, all mandatory:**

1. **The socket is a notification channel, not a source of truth.** Every frame
   says *something changed*; the authoritative state is the REST resource. A
   frame lost during a reconnect window is recovered by re-listing the affected
   chat or collection — the server stores no event log to replay from, which is
   deliberate: gap replay would require persisting every event and would
   reintroduce the "we pushed it but it is not committed" class of bug.
2. **Client-generated message ids.** The server persists the client's `id` as
   `deal_chats.id` for optimistic-UI reconciliation and dedupe. A duplicate id
   is a no-op, not an error, and still returns 201 over HTTP.
3. **Persist first, then broadcast.** Never push a message that was not
   committed. This is exactly the class of failure already in production:
   `error_logs` 500001, `BID_QUERY_INVALID`, endpoint `/api/quotes/bid` — the
   bidding service queried incorrectly and the operation did not return.
4. **Reconnect with exponential backoff**, then re-fetch. On a `seq` gap the
   client may also re-list immediately rather than wait for the next frame.
5. **Heartbeat** every 30 s; drop a connection silent for 90 s.
6. **Connection limit per profile** (e.g. 5) and a per-quote message rate limit.
   Exceeding either closes with a code and a reason.
7. The WebSocket layer may **not** bypass the service layer — it calls the same
   `services/chat.py` method the HTTP send endpoint calls, so authorization and
   `deal_history` behaviour cannot diverge between the two paths.
8. A frame is only pushed to a socket whose owner is authorized to see the
   underlying row. Authorization is re-checked at send time, not at
   connection time, because a quote can be withdrawn mid-session.


---

## 9. Endpoint contract

Every row below already has a live caller: a method on the frontend's
`DriveDealClient` interface and a screen that renders its result. **This table
documents the API you must build to match — it is not a proposal.** If a row
conflicts with `frontend/src/services/generated/client.ts`, the conflict goes
to a change request (§0.0), not into the code.

`{role}` guards use the dependencies from §5.2. All bodies and responses use
the envelope-free Pydantic models in `src/schemas/`.

### 9.1 Auth

| Method | Path | Guard | Notes |
|---|---|---|---|
| `POST` | `/auth/signup/buyer` | public | Creates `profiles` + `users` in one transaction. Returns access + refresh. Never logs the password |
| `POST` | `/auth/signup/dealer` | public | Creates profile + `users(is_active=false)` + `support_verifications(category='dealer', status='pending', ticket_id='DV<epoch>')`. Returns 201 with a **pending** payload — **no tokens** |
| `POST` | `/auth/signup/support` | public | Same, `category='agent'`, 403-free because the account is inert. Not linked from public navigation |
| `POST` | `/auth/login` | public | Argon2id verify. If `users.is_active = false` and a pending verification exists → 403 `DEALER_PENDING_REVIEW`. Wrong password → 401 `INVALID_CREDENTIALS`. **Never reveal which of the two** beyond that deliberate distinction |
| `POST` | `/auth/refresh` | refresh token | Rotates `jti`; replay revokes the family |
| `POST` | `/auth/logout` | `get_current_user` | Revokes the `jti` |
| `POST` | `/auth/forgot-password` | public | Always 202, whether or not the email exists — no user enumeration |
| `POST` | `/auth/reset-password` | public | Argon2id hash, revoke all sessions |
| `GET` | `/auth/me` | `get_current_user` | Profile + role + verification status |

Use a dummy Argon2id verify on unknown emails so login timing does not
enumerate accounts.

### 9.2 Profiles and reference data

| Method | Path | Guard |
|---|---|---|
| `GET` | `/profiles/me` | any |
| `PATCH` | `/profiles/me` | any — **cannot** change `role`, `email` uniqueness rules, or any audit column |
| `POST` | `/profiles/me/preferences` | any | Upsert `buyer_preference` (1:1) |
| `GET` | `/profiles/{id}` | self, or support/admin |
| `GET` | `/reference/states` | public — 50 + DC, cached 24 h |
| `GET` | `/reference/brands` | public — cached 24 h |
| `GET` | `/reference/states/{code}/tax-rate` | public — see §9.8 caveat |

### 9.3 Buyer requests

| Method | Path | Guard | Notes |
|---|---|---|---|
| `POST` | `/requests` | buyer | Full §3.1 field set. Geocode `buyer_area` → `buyer_area_state_id` + `coordinates`. `status = 'draft'` unless `publish=true` |
| `GET` | `/requests` | buyer | Own list, paginated, with live quote counts |
| `GET` | `/requests/{id}` | buyer (owner) | Spec + status + quote count + lead quote |
| `PATCH` | `/requests/{id}` | buyer (owner) | **Blocked once `status != 'draft'`** except `additional_information` |
| `POST` | `/requests/{id}/publish` | buyer (owner) | `draft → open` |
| `POST` | `/requests/{id}/close` | buyer (owner) | → `closed` |
| `GET` | `/requests/{id}/quotes` | buyer (owner) | **The leaderboard.** One indexed query, `ORDER BY final_price ASC, created_at ASC`, each row carrying `is_leading` and `revision_needed` |
| `GET` | `/requests/{id}/compare-ids` | buyer (owner) | Quote ids for the compare agent |
| `GET` | `/feed/requests` | dealer | **The dealer request feed.** `status = 'open'`, geo-filtered by `search_radius_miles` via PostGIS `ST_DWithin`, with brand/budget/distance/timeframe filters. `GET /feed/requests/{id}` for detail — returns only what a dealer may see, and never the buyer's identity or contact |
| `POST` | `/requests/{id}/ai-draft` | buyer | Persist an AI-assembled draft for confirmation. **The AI may not call this itself** — see §10.6 |

### 9.4 Quotes, deals, chat, documents

| Method | Path | Guard | Notes |
|---|---|---|---|
| `POST` | `/quotes` | `require_approved_dealer` | Body: `buyer_request_id` + the five price lines + `message` + `expires_at`. `final_price` is **not** accepted from the client — the generated column computes it. Returns 201 |
| `GET` | `/quotes` | dealer | Own quotes, with `is_leading` / `revision_needed` / `Deal Accepted!` computed per the §4.4 rules |
| `GET` | `/quotes/{id}` | buyer or dealer on the quote | Full breakdown + documents + chat summary |
| `PATCH` | `/quotes/{id}/revise` | dealer (own) | **Appends `deal_history`**, extends competing `expires_at` if now leading (§4.5), publishes `leaderboard_updated`. Idempotency key required |
| `POST` | `/quotes/{id}/accept` | **buyer on the quote** | Transaction: `status = 'accepted'`, `accepted_at = now()`, request → `fulfilled`, siblings → `declined`, `leaderboard_updated` + `quote_update` broadcast. **A dealer calling this is 403** |
| `POST` | `/quotes/{id}/decline` | buyer | → `declined` |
| `POST` | `/quotes/{id}/withdraw` | dealer | → `withdrawn` |
| `GET` | `/quotes/{id}/dealer-contact` | buyer on the quote | Unlocks phone, email, and business name. Gated on **`status = 'accepted'`** *or* a **dealer-accepted chat request**. Otherwise 403 `DEALER_CONTACT_WITHHELD` with the quote and request status in `details` so the client can explain the gate. Returns `contact_available`, which is the single source of truth for showing the chat icon |
| `GET` | `/deals` | buyer **or** dealer | Same rows, filtered by side: `buyer_id = me` for Orders, `dealer_id = me` for Deals |
| `GET` | `/deals/{id}` | party to the quote | Breakdown + stepper + documents + chat. Dealer contact is **omitted** (not blanked) unless the same gate as `/quotes/{id}/dealer-contact` is open — one predicate, one place |
| `POST` | `/deals/{id}/status` | party (completed = buyer; cancelled = dealer or support) | Validated against the transition guard; appends `deal_history` |
| `GET` | `/deals/{id}/documents/checklist` | party | Which documents exist vs. required for the current stage |
| `POST` | `/chats/ws-ticket` | any authed | 60 s single-use ticket for the WebSocket handshake (§8) |
| `POST` | `/chats/{quote_id}/request-access` | buyer | **Negotiation branch.** Body: `message` (1–1000 chars, the buyer's own words). Creates a `pending` chat access request, notifies the dealer. Quote status untouched. Re-requesting while `pending` returns the existing row with **200**, not 409. 409 only if the quote is `accepted`/`withdrawn` |
| `GET` | `/chats/requests` | dealer (inbox) / buyer (sent) | Dealer defaults to `pending`; buyer sees all own requests. `status` query overrides. Include `unread_count` for the nav badge |
| `GET` | `/chats/requests/{id}` | requester or addressee | Single request |
| `POST` | `/chats/requests/{id}/accept` | **dealer addressed** | One transaction: request → `accepted`, quote → `negotiating`, `deal_chats` created, contact unlocked, `chat_request` + `chat_message` (the request text as message 1) pushed. **Idempotent** — re-accept returns 200, not 409 |
| `POST` | `/chats/requests/{id}/decline` | **dealer addressed** | → `declined`, optional `reason` (≤500) shown verbatim to the buyer. Quote unchanged, nothing unlocked. Buyer may submit a new request later |
| `GET` | `/chats/{quote_id}` | party, **chat open** | Ascending, honouring the caller's `*_chat_cleared_at`. 403 `CHAT_NOT_OPEN` until the quote is `accepted` or a chat request was accepted |
| `POST` | `/chats/{quote_id}` | party, **chat open** | HTTP fallback; same service as the WS `chat.send` frame. Duplicate `id` is a 201 no-op |
| `POST` | `/chats/{quote_id}/read` | party, chat open | Advances `buyer_last_read_at` / `dealer_last_read_at`. **Monotonic** — a stale re-report is ignored, never rewinds. Pushes `chat_read` to the other side |
| `POST` | `/chats/{quote_id}/request-negotiation` | buyer | Body: description. Sets `status = 'negotiating'`, notifies the dealer, appends `deal_history` |
| `POST` | `/chats/{quote_id}/clear` | party | Sets that party's `*_chat_cleared_at`. **Never deletes rows** |
| `POST` | `/documents/presign` | `require_approved_dealer` | S3 presigned PUT, `quote_id`-prefixed key |
| `POST` | `/documents/{id}/confirm` | dealer (own) | Creates the `deal_documents` row, then `UPDATE`s the quote's `deal_documents_id` pointer |
| `GET` | `/documents/{quote_id}` | party | Presigned GETs |
| `DELETE` | `/documents/{id}` | dealer (own) | Only before acceptance |

### 9.5 The chat lifecycle

One chat per quote, keyed `deal_chats.quote_id`. There is no chat id, and no
conversation entity — a chat is a scope, not a row with an identity. It opens
through exactly one of two doors:

```
                    buyer accepts the quote
       (pending) ─────────────────────────────► ACCEPTED ──► chat open
          │                                        contact unlocked
          │
          │  buyer POSTs /chats/{quote_id}/request-access
          ▼
       PENDING ──── dealer declines ────► DECLINED   (quote untouched, nothing unlocked)
          │
          │  dealer POSTs /chats/requests/{id}/accept
          ▼
       ACCEPTED ──────────────────────────► quote → negotiating, chat open,
                                            contact unlocked
```

**Door 1 — the buyer accepts.** No extra call, no request, no approval. Accepting
is itself consent to talk, so `GET /quotes/{id}/dealer-contact` returns the
dealer and `GET /chats/{quote_id}` returns 200. The buyer's offer page renders
the chat icon directly beside the dealer name.

**Door 2 — the buyer wants to negotiate.** The buyer has declined to commit but
still has a question, so they send a description. Nothing opens on the buyer's
say-so: the request is `pending` and the dealer owns the decision. Accept is a
single transaction covering the status flip, quote transition, chat creation,
contact unlock, and both frames, because a dealer must never see "accepted"
while the buyer's chat is still closed.

**The gate is one predicate, used in three places.** Define it once in
`services/chat.py` — call it `chat_is_open(quote, caller)` — and have
`/quotes/{id}/dealer-contact`, `/deals/{id}`, and `GET /chats/{quote_id}` all
call it. Three hand-written copies of "is this unlocked" is how the contact
leaks: a route written later, or a quote that moves to `negotiating` by some
path the gate did not consider. When the quote status changes anywhere in the
codebase, the gate follows automatically.

**Withdrawal closes the chat, not the history.** If the dealer withdraws a quote
that has an open chat, the chat is soft-closed and the dealer side is cleared;
the rows remain so a later re-quote on the same request does not resurrect stale
messages.

**Why `chat_access_requests` is a table and not a message.** The request is a
durable, auditable, per-party state transition with its own `requested_at` /
`responded_at`, and it is the artifact the dealer triages from an inbox. Burying
it as the first row of a chat would mean creating a chat to represent the
absence of a chat.

### 9.6 Support, verifications, members

| Method | Path | Guard | Notes |
|---|---|---|---|
| `POST` | `/support/tickets` | any authed | `category` derived from role — a dealer cannot file a `customer` ticket. `ticket_id` generated per the category's format |
| `GET` | `/support/tickets` | caller | Own tickets |
| `GET` | `/support/tickets/{id}` | caller or support/admin | |
| `GET` | `/support/queue/tickets` | support/admin | Filter by `category`, `status`, `priority` |
| `PATCH` | `/support/queue/tickets/{id}` | support/admin | Status change, append to `notes` jsonb, set `rca` on resolve |
| `GET` | `/verifications` | support/admin | The approval queue, `status = 'pending'` first |
| `POST` | `/verifications/{id}/approve` | support/admin | Sets `users.is_active = true`, `email_sent`, appends to `notes`. **`category='agent'` requires role `admin`** — a support agent cannot approve a peer |
| `POST` | `/verifications/{id}/deny` | support/admin | Mandatory reason into `notes` |
| `GET` | `/members` | support/admin | Support/admin roster with verification history |
| `POST` | `/members/{id}/suspend` | admin | `users.is_active = false` |

### 9.7 AI — `src/routes/ai.py`

| Method | Path | Guard | Notes |
|---|---|---|---|
| `POST` | `/ai/chat` | buyer | `{agent, message, thread_id?}` → **SSE stream** of `status` and `token` events, then `done` (§10.8). **Must stream — a caller that blocks for a full reply is a defect** |
| `GET` | `/ai/threads` | buyer | Sidebar: `thread_id`, derived title, `last_active_at`, `agent`, message count |
| `GET` | `/ai/threads/{id}` | owner | Full history for session switching |
| `POST` | `/ai/threads` | buyer | New session |
| `POST` | `/ai/compare` | buyer | `{request_ids[], question?}` → structured comparison (§10.5) |
| `POST` | `/ai/request-preview` | buyer | Current `buyer_preference` + inferred request fields, for the confirm-and-edit UI |

### 9.8 Sales tax

`GET /reference/states/{code}/tax-rate` returns the rate from
`SALES_TAX_RATES`. **This is a known v1 simplification** — US sales tax is
state *and* county, and a state-level table is wrong for most of the country
(`solution-business.md` §12 Q1). The quote form must show the derived tax as
**editable** by the dealer, with the derived value as the default, and the UI
must not claim the figure is the buyer's exact liability. A seller location is
also a legitimate override basis — accept an explicit `tax_rate` on the quote
body, recorded in `deal_history`.

### 9.9 Documentation routes

Two routes, both under `/api/v1`, both unauthenticated, both read-only:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/openapi.json` | The contract itself, as `application/json`. This is the **pinned URL** — codegen, Postman, and the frontend generator all reference it, so it must not move, must not be versioned per-build, and must never require a token |
| `GET` | `/docs` | Swagger UI that loads `/openapi.json`, so the human-readable reference cannot drift from the machine-readable one |

They are infrastructure, not resources. Consequences worth stating so nobody
"fixes" them later:

- **`/openapi.json` is a `Docs` operation, not a `Health` one.** Health is a
  liveness signal a load balancer polls; documentation is not. Tagging it as
  `Health` puts a contract URL in a probe rotation.
- **No auth.** A token makes the URL unlinkable and unbookmarkable, and it is
  the one artifact an integrator needs before they have an account. If the
  schema must not be public, restrict the whole deployment at the edge — do not
  re-add `bearer_auth` and call it solved.
- **`304` on `/openapi.json`.** The document is large and changes rarely, so it
  carries an `ETag`. A client sending `If-None-Match` gets an empty 304 rather
  than a 200 with a full document.
- **The `GET /ws` operation in this file is a documentation artefact too.** It
  is not OpenAPI-conformant and is flagged `x-websocket: true`; a codegen that
  chokes on it must be told to skip that single operation, not to regenerate
  from an older spec.

---

## 10. AI layer — LangGraph

`src/agents/`. Claude via `langchain-anthropic`. Every invocation writes an
`llm_audits` row.

### 10.1 Serra AI — 3-agent architecture

Serra is the buyer-facing AI chatbot. It has **three agents** running in a
coordinated LangGraph workflow, plus a parallel **requirement agent**. There is
no separate intent-classifier LLM call — the **main agent handles intent
classification itself** as part of its reasoning, reducing latency and cost.

**The three agents:**

```
 User query
     │
     ▼
┌──────────────────────────────────────────────────────────┐
│  MAIN AGENT  (LangGraph node, LangChain create_react_agent) │
│  ─ Handles memory (conversation_history checkpoints)     │
│  ─ Handles skills / tool selection                       │
│  ─ Classifies intent inline (no separate LLM call)       │
│  ─ Decides: answer from KB, go to web, or hand off       │
└────────┬──────────────────────┬───────────────────────────┘
         │                      │
         ▼                      ▼
  ┌──────────────┐       ┌──────────────────┐
  │  KB AGENT    │       │  WEB SEARCH       │
  │  (sql query  │──────►│  AGENT            │
  │   over cars, │ miss  │  (Crawl4AI)       │
  │   quotes,    │       │  ─ fetches live   │
  │   prefs)     │       │  ─ writes to DB   │
  └──────────────┘       │    via kb_insert  │
                         └──────────────────┘

  Side by side, always running:
  ┌────────────────────────────────────┐
  │  REQUIREMENT AGENT                 │
  │  (fills the car request form)      │
  │  ─ accumulates fields across turns │
  │  ─ end goal: complete buyer_request│
  │  ─ previews before posting         │
  └────────────────────────────────────┘
```

**Agent descriptions:**

| Agent | LangChain pattern | Role |
|---|---|---|
| Main agent | `create_react_agent` (LangChain) | Entry point. Receives every user message. Handles memory, skill routing, and inline intent classification. Decides whether to answer from the KB or call the web search agent. |
| KB agent | Tool called by the main agent | Structured SQL retrieval over `cars`, `brands`, `deal_quotes`, `buyer_preference`, `states`, `conversation_history`. Returns typed rows with provenance. |
| Web search agent | Tool called by the main agent on KB miss | Crawl4AI-powered. Fetches and parses live web pages. Always writes findings back via `kb_insert`. |
| Requirement agent | Parallel LangGraph node, always active | Runs side-by-side with the main agent on every turn. Accumulates car-buying request fields from the conversation. Triggers the editable request preview when the form is complete. |

**The LangGraph workflow:**

```python
# src/agents/serra/graph.py
from langgraph.graph import StateGraph, END
from langchain.agents import create_react_agent

workflow = StateGraph(SerraState)

# Nodes
workflow.add_node("main_agent", main_agent_node)         # create_react_agent
workflow.add_node("kb_agent", kb_agent_node)             # tool: SQL retrieval
workflow.add_node("web_search_agent", web_search_node)  # tool: Crawl4AI
workflow.add_node("requirement_agent", requirement_node) # parallel: form filler

# Edges
workflow.set_entry_point("main_agent")
workflow.add_conditional_edges(
    "main_agent",
    route_after_main,   # → kb_agent | web_search_agent | END
)
workflow.add_conditional_edges(
    "kb_agent",
    route_after_kb,     # → web_search_agent (on miss) | END
)
workflow.add_edge("web_search_agent", END)

# Requirement agent runs in parallel via a separate subgraph
# invoked on every turn regardless of the main agent's path
```

**No intent-classifier LLM call.** The main agent resolves intent as part of
its ReAct reasoning loop — it reads the conversation history and the user
message and decides which tool to call. A separate classifier call would add
250–400 ms of latency on every turn and is unnecessary when the main agent is
already reasoning over the same input. The `needs_tools` flag from the old
classifier is replaced by the main agent's tool-use decision.

**Tag-based prompts.** Every agent's system prompt is structured with
capitalised XML-style tags so sections are addressable, diffable and
swappable without rewriting the whole prompt:

```xml
<ROLE>
You are Serra, DriveDeal's automotive advisor...
</ROLE>

<MEMORY>
Conversation history is provided as prior turns. Do not re-introduce yourself
if you have already done so in this thread.
</MEMORY>

<TOOLS>
You have three tools: kb_search, web_search, kb_insert.
Always try kb_search first. Only call web_search if kb_search returns no
usable result. Always call kb_insert after a successful web_search.
</TOOLS>

<INTENT_CLASSIFICATION>
Classify the user's intent inline as part of your reasoning:
- car_lookup: asking about a specific car
- comparison: comparing cars or quotes
- request_building: describing what they want to buy
- price_question: asking about pricing or taxes
- review_question: asking about reviews or ratings
- spec_question: asking about specs or features
- negotiation_help: asking about deal or negotiation
- chitchat: anything else — answer conversationally, no tools needed
</INTENT_CLASSIFICATION>

<GROUNDING>
Every factual claim about a car must cite its source — either a KB row id or
a scraped URL. Never invent a spec, price or review. If you do not have the
data, say so plainly.
</GROUNDING>

<OUTPUT_FORMAT>
Return structured cards (AICarCard, CompareTable) as JSON events — never
serialise them into prose. Plain questions get plain text answers.
</OUTPUT_FORMAT>
```

Each agent has its own prompt file in `src/agents/prompts/`. Tags make
diffing prompt changes trivial and enable per-section A/B testing without
touching surrounding copy.

**Model: GPT-sol medium via Codex OAuth.**

The LLM is `gpt-sol-medium` (GPT-o3 medium reasoning), accessed via **Codex
OAuth** — not a direct API key. The integration is:

```python
# src/agents/llm.py
from langchain_openai import ChatOpenAI
from src.auth.codex_oauth import get_codex_token

def get_llm() -> ChatOpenAI:
    """Returns the LangChain LLM bound to gpt-sol-medium via Codex OAuth."""
    token = get_codex_token()   # fetches/refreshes the OAuth bearer token
    return ChatOpenAI(
        model="gpt-sol-medium",
        openai_api_key=token,
        openai_api_base=settings.CODEX_API_BASE,
        streaming=True,
        temperature=0,
    )
```

```python
# src/auth/codex_oauth.py
import httpx, time
from src.settings import settings

_cache: dict = {}

def get_codex_token() -> str:
    """Returns a valid OAuth bearer token for Codex, refreshing when needed."""
    if _cache.get("expires_at", 0) > time.time() + 60:
        return _cache["token"]
    resp = httpx.post(
        settings.CODEX_TOKEN_URL,
        data={
            "grant_type": "client_credentials",
            "client_id": settings.CODEX_CLIENT_ID,
            "client_secret": settings.CODEX_CLIENT_SECRET,
            "scope": "model:invoke",
        },
        timeout=10,
    )
    resp.raise_for_status()
    payload = resp.json()
    _cache["token"] = payload["access_token"]
    _cache["expires_at"] = time.time() + payload.get("expires_in", 3600)
    return _cache["token"]
```

Settings additions required:

```python
CODEX_API_BASE: str         # e.g. "https://api.codex.example/v1"
CODEX_TOKEN_URL: str        # OAuth token endpoint
CODEX_CLIENT_ID: str        # required
CODEX_CLIENT_SECRET: str    # required — never committed
LLM_MODEL: str = "gpt-sol-medium"
```

**The compare agent** (`compare-agent`) has its own LangGraph subgraph with
the **same two tools** (KB agent + web search agent) but a different entry
node and a different prompt:

```
 POST /ai/compare {request_ids[], question?}
     │
     ▼
 ┌──────────────────────────────────────┐
 │  COMPARE MAIN AGENT                  │
 │  (create_react_agent)                │
 │  ─ fetches all selected requests     │
 │  ─ calls kb_agent per request        │
 │  ─ calls web_search_agent on miss    │
 └────────┬──────────────────────┬──────┘
          ▼                      ▼
   ┌──────────────┐       ┌──────────────────┐
   │  KB AGENT    │       │  WEB SEARCH AGENT │
   │  (same tool) │       │  (same tool)     │
   └──────────────┘       └──────────────────┘
          │
          ▼
   ┌──────────────────────────────────────┐
   │  COMPARISON BUILDER                  │
   │  assembles ComparisonResult schema   │
   │  null cells → "not reported"         │
   │  recommendation + caveats required   │
   └──────────────────────────────────────┘
```

The compare agent prompt is also tag-based:

```xml
<ROLE>
You are DriveDeal's comparison analyst. You compare car quotes objectively.
</ROLE>

<TOOLS>
For each selected request, call kb_search to get the quote data and car specs.
If specs are missing, call web_search. Always call kb_insert on new findings.
</TOOLS>

<OUTPUT_SCHEMA>
Return a structured ComparisonResult. Every selected request must appear in
the output even if all its data is missing. Missing values are null — never
invented. The recommendation field is required and must state reasoning.
</OUTPUT_SCHEMA>

<CAVEATS>
Explicitly list every "not reported" gap in the caveats array. A comparison
that hides missing data is worse than no comparison.
</CAVEATS>
```

`thread_type` namespaces: `advisor` for Serra, `compare` for the compare
agent, `negotiation` for deal negotiation, `dealer` for dealer-side threads.

### 10.2 The classifier

A small, cheap model call that emits structured output:

```python
class Intent(BaseModel):
    agent: Literal["sera-agent", "compare-agent"]
    intent: Literal["car_lookup", "comparison", "request_building", "price_question",
                    "review_question", "spec_question", "negotiation_help", "chitchat"]
    needs_tools: bool
    target_request_ids: list[uuid.UUID] | None
```

Routing consequences from `solution-business.md` §8.4:
- `agent` drives the graph. An **unknown value is a 422, never a silent
  fallback.**
- `intent = request_building` switches the agent into **intake mode** (§10.6).
- `needs_tools = False` short-circuits tool use — a "what is your name" turn must
  not hit the knowledge base.

### 10.3 Tool 1 — `kb_search`: the database is the knowledge base

**The agent turns a user question into a SQLAlchemy ORM query and runs it
against PostgreSQL.** There is no vector index, no embedding call and no
document store. This is the whole retrieval design, and it is deliberate: every
question this product gets is answerable from typed columns.

**The tool signature is one natural-language question, and it returns rows:**

```python
class KbSearch(BaseModel):
    """Read-only structured retrieval over the marketplace schema."""
    question: str                       # the user's question, as asked
    intent: Literal["car_lookup", "comparison", "request_building",
                    "price_question", "review_question", "spec_question"]
    tables: list[Literal["cars", "brands", "buyer_preference", "states",
                         "deal_quotes", "profiles", "conversation_history"]]
    limit: int = 20                     # hard ceiling 50, enforced in code

> **There is no `car_reviews` table.** Reviews live inline on
> `cars.reviews` (jsonb), so a review question reads `cars` and unnests that
> array — see §2 Delta 9. Listing `car_reviews` here would have the model emit a
> query against a table that does not exist.
```

**How the query is produced, in this order — this is a pipeline, not one shot:**

1. **Classify** (§10.2) to get `intent` and the plausible table set. This is a
   small, cheap structured-output call.
2. **Generate the query.** The model emits a `Select` built with SQLAlchemy 2.0
   Core/`select()` against the mapped classes in
   `src/repositories/schema/` — **not a raw SQL string.**
3. **Validate it before it runs.** Non-negotiable, and it is the reason this
   design is safe:

   | Check | Rule |
   |---|---|
   | Statement type | `SELECT` only. A generated `INSERT`/`UPDATE`/`DELETE`/`DDL` is rejected outright |
   | No raw SQL | The output is a parsed AST, not a string. There is no `text()` passthrough for the agent |
   | Allow-listed tables | Must be in the `tables` enum above. A model naming `users` or `llm_audits` is a validation failure, logged, and refused |
   | Row limit | `limit` clamped to 50, and `LIMIT` applied by the code, never by the model |
   | Timeout | `statement_timeout` set on the session for this query only |
   | Read-only | Executed on a connection with the write role's `default_transaction_read_only` set |
   | Tenant scoping | The caller's profile id is injected by the code as a predicate. The model can never author or widen a row-scope filter |

4. **Execute** in the request's read session and serialise the rows.
5. **Explain provenance.** Every returned row carries the table and the columns
   used, so the answer can cite *"from the cars table, this 2022 Big Bend"*.

**Query-quality rules that make this work:**

- **Resolve reference data first.** `brands` and `states` are small and must be
  resolved before the main query, using `pg_trgm` similarity + `unaccent`,
  because real input is misspelled — the corpus contains `Fisco texas`,
  `Tesax,34`, and both `Mercedes` and `Mercedes-Benz`. Resolve to the canonical
  id, then use equality.
- **Prefer `IN` over joins for spec matching.** `cars.features` is a text array;
  a feature query is `features && ARRAY['sunroof']` (gin), not a per-feature
  join.
- **Radius is PostGIS**, `ST_DWithin(coordinates::geography, origin::geography, radius)`.
  Not a bounding box.
- **Nullable columns are filters only when stated.** A buyer who never mentioned
  mileage must get cars with and without mileage, not `WHERE mileage IS NOT NULL`.
- **Widen, do not give up.** If the literal predicate returns nothing, relax in
  order: drop the softest constraint, then sort and return the closest matches,
  then say plainly that nothing matched. Returning an empty list silently is a
  bug; inventing a car is a worse one.
- **Gaps are returned as gaps.** A missing spec is `None`, never a plausible
  guess. This is the single most important tool contract.
- **The generated query is logged** to `llm_audits` with `task_type =
  'rag_retrieval'` — keep the existing enum value (§2 Delta 9) — plus the
  compiled SQL and its duration, so a bad retrieval is debuggable and auditable.
  A model-authored query that returns garbage is a data-quality bug with a
  permanent record attached.

> **Do not add embeddings back to make this simpler.** Vector search is the
> conventional answer, and it is the wrong one for a fully structured corpus:
> it adds a second datastore to keep in sync, an embedding cost per row, and a
> black box that cannot answer *"show me every AWD SUV under $65k within 25
> miles"*. The ORM query answers that exactly.

### 10.4 Tool 2 — `web_search`, powered by Crawl4AI

**Crawl4AI is the web tool. It is the only one.** There is no hand-rolled
`httpx` fetch, no `selectolax`, no `bs4`, and no second crawler behind a flag.
The tool is a thin adapter over Crawl4AI's `AsyncWebCrawler`, and it does not
contain its own HTTP logic.

Crawl4AI is an async, headless-browser crawler built for LLM consumption: it
renders JavaScript, then converts the page to **markdown**, which is the format
this agent actually wants. That is the whole reason for the choice — the
alternatives return raw HTML and then you write an extractor.

**The tool signature:**

```python
class WebSearch(BaseModel):
    """Fetch and read live web pages. Used only when kb_search has no answer."""
    query: str                        # what the agent needs to find out
    urls: list[HttpUrl] | None = None # explicit targets, when the agent has them
    max_pages: int = 3                # hard ceiling CRAWL4AI_MAX_PAGES (5)
```

**Implementation, in `src/client/crawl4ai.py`:**

```python
from crawl4ai import AsyncWebCrawler, CacheMode
from crawl4ai.async_configs import BrowserConfig, CrawlerRunConfig
from crawl4ai.content_filter_strategy import PruningContentFilter
from crawl4ai.markdown_generation_strategy import DefaultMarkdownGenerator

# One crawler for the process lifetime, not one per call — it owns a browser.
_browser = BrowserConfig(
    browser_type=settings.CRAWL4AI_BROWSER,   # chromium
    headless=settings.CRAWL4AI_HEADLESS,      # never false in deployment
    user_agent=settings.SCRAPE_USER_AGENT,
)

async def fetch(url: str, query: str) -> CrawlResult:
    run = CrawlerRunConfig(
        cache_mode=CacheMode.ENABLED,          # repeat questions skip the network
        page_timeout=settings.SCRAPE_TIMEOUT_S * 1000,
        word_count_threshold=20,               # drop boilerplate blocks
        excluded_tags=["nav", "footer", "header", "form", "script", "style"],
        exclude_external_links=True,
        remove_overlay_elements=True,          # cookie modals, newsletter overlays
        markdown_generator=DefaultMarkdownGenerator(
            content_filter=PruningContentFilter(threshold=0.4)
        ),
    )
    async with AsyncWebCrawler(config=_browser) as crawler:
        return await crawler.arun(url=url, config=run)
```

**Read `result.markdown.fit_markdown` when a content filter is configured, and
`result.markdown.raw_markdown` when it is not.** `fit_markdown` is the pruned,
relevant content; this is the field that goes into the model's context. Getting
this wrong is the most common Crawl4AI mistake — `result.markdown` is an object,
not a string, and printing it yields a repr.

**Rules, all mandatory.** Crawl4AI handles fetching and rendering; these are the
controls it does not give you for free:

1. **`robots.txt` is fetched and honoured** per host, cached, and re-checked on
   change. A disallowed path is never crawled. Crawl4AI does not enforce this
   for you.
2. **Rate limit** `SCRAPE_RATE_LIMIT_RPS` per domain, with jitter. Concurrency
   capped at 2 per host — `AsyncWebCrawler` is happy to open a browser context
   per URL, and an unbounded `arun_many` is a self-inflicted denial of service.
3. **The `AsyncWebCrawler` is a process-level singleton**, started on FastAPI
   lifespan startup and closed on shutdown. Constructing one per call pays a
   browser launch every time and will exhaust memory under load.
4. **No SSRF.** Resolve the hostname yourself **before** handing the URL to
   Crawl4AI and reject private, loopback, link-local and metadata ranges
   (`169.254.169.154` family, `169.254.169.254`) *before* connecting, and
   re-validate after redirects. **Crawl4AI driving a real browser means no
   egress control is bypassed by our own network rules** — the validation is
   the only control, so it is mandatory and it is a test case.
5. **Size capped** at `SCRAPE_MAX_BYTES` via a response hook; abort early.
   A headless browser will happily download 40 MB.
6. **Timeout** `SCRAPE_TIMEOUT_S` on both `page_timeout` and the awaited call.
   A timeout is an `UpstreamError` → 502, and **the agent degrades gracefully** —
   it answers from `kb_search` results plus an honest "I couldn't verify this
   online", rather than failing the whole turn.
7. **Result handling**: check `result.success` and `result.status_code` before
   reading content. On failure, the error is logged with the URL and the agent
   moves on. Never retry more than once.
8. **No LLM-based extraction strategy in v1.** `LLMExtractionStrategy` would mean
   a second LLM call per page and doubles the cost of every lookup. Return the
   markdown and let the agent read it. Revisit only if a real query class
   demonstrably needs structured extraction.
9. **Cache failures too**, so repeated identical failures do not re-launch a
   browser against a dead host.

**What the agent gets back** is a list of `SourceRef` entries —
`{url, title, markdown_excerpt, fetched_at}` — not raw text. The excerpt is
truncated before it reaches the model, and the full `kb_insert` payload is built
from it. This is what makes provenance mandatory rather than optional
(`solution-business.md` §8.5).

#### Tool 3 — `kb_insert`

**`kb_insert` is not optional and not a "nice to have".** The product rationale
(`solution-business.md` §8.2) is that every finding scraped once becomes a
database answer forever. After a successful crawl that yields a durable fact —
specs, reviews, price observations — the agent **must** call `kb_insert`, and
the next identical question must be answerable from `kb_search` with zero web
calls.

Insert rules:
- **Normalise into typed columns, always.** A scraped fact goes into the
  existing column it belongs to — `cars` specs, `cars.reviews`, or a
  `deal_quotes`-adjacent price observation. Do not invent a free-text findings
  blob: a fact the agent cannot query with an ORM predicate is a fact
  `kb_search` will never return, which defeats the point of the write-back
  (§10.3).
- **Deduplicate before inserting.** Re-crawling a known page must not create a
  near-duplicate. A content hash + `pg_trgm` similarity check is the minimum.
  Crawl4AI's `CacheMode.ENABLED` is the first line of defence, but cache is
  expiry-based, so the check is still required.
- **Store the source URL and fetch timestamp** with every inserted fact. An
  answer with no provenance is not allowed to be returned.
- **Never write a negative fact.** Absence of data in a scrape is absence, not
  evidence the spec does not exist.
- Both agents do this, not just the advisor.

A regression test must assert the round-trip: **crawl → insert → re-answer with
the crawler disabled.** That test is the executable form of the product
requirement.

### 10.5 The compare agent

`POST /ai/compare` returns structured, renderable output — the backend shapes it,
the frontend does not parse prose to build a table:

```python
class ComparisonResult(BaseModel):
    requests: list[RequestComparisonRow]   # one per selected request
    spec_table: dict[str, dict[uuid.UUID, str | None]]  # field → request → value
    price_analysis: PriceAnalysis          # vs target_otd and budget_max, plus spread
    review_summary: ReviewSummary          # sentiment + volume, or "no reviews in KB"
    recommendation: Recommendation        # pick + reasoning + confidence
    caveats: list[str]                    # includes every "not reported" gap
    sources: list[SourceRef]              # KB row ids and/or scraped URLs
```

Hard rules: missing data renders as `None` → the frontend shows
**"not reported"**; every selected request appears in the output even if all its
data is missing; a recommendation without visible reasoning is a validation
failure.

### 10.6 Request-building intake — human-in-the-loop is mandatory

Across roughly 4–5 turns the agent assembles the full §3.1 request into
`buyer_preference` (`source = 'ai_inferred'`, `confidence` set) and a request
draft.

**The agent must not create a published request by itself.** The flow is:

1. Agent believes the request is complete → emits a **preview**, not a post.
2. `POST /requests/{id}/ai-draft` persists a `draft` request.
3. The frontend renders it as a **fillable, editable confirmation form** —
   not a read-only summary. The buyer can change any field.
4. Only `POST /requests/{id}/publish` (`draft → open`) makes it live.

A test must assert that no LangGraph node can reach `buyer_requests` with
`status = 'open'`. The AI's write surface to `buyer_requests` is `draft` only.

### 10.7 Conversation session management

- New session → new `thread_id` with the `advisor`/`chat` prefix, persisted
  before the first reply so a refresh does not orphan the conversation.
- **Session switching** reads `conversation_history` by `thread_id` and replays
  the checkpoint chain. Titles are derived (first user message, truncated) —
  the schema has no `chat_sessions` table, and `schema-visualizer.md` §6.1
  documents that consequence explicitly.
- **Sidebar list** = the `GROUP BY` query in §6.1. Do not N+1 it; add
  `DISTINCT ON` and the `(user_id, thread_type, created_at DESC)` index if the
  thread count grows.
- **`expanded_ui`** is a server-advertised flag. The 3-message popover → 4th
  message full-interface rule (`solution-business.md` §8.1) is **owned by the
  backend** so the threshold is consistent across clients and changeable without
  a frontend release. The frontend still owns the *transition* and must explain
  it to the user.

### 10.8 Streaming the reply — `status` before `token`, always

**The buyer must never stare at a frozen input waiting for an LLM to finish
thinking.** A non-streaming `/ai/chat` is a defect, not a simpler
implementation: with tools involved, a turn routinely takes 8–20 s — classifier
call, `kb_search`, possibly a Crawl4AI fetch, then generation. Silence for that
long reads as a broken app.

`POST /ai/chat` is **Server-Sent Events**. One event stream, five event types,
in this order:

```
event: status   data: {"phase":"classifying","label":"Understanding your question"}
event: status   data: {"phase":"searching","label":"Checking available cars"}
event: status   data: {"phase":"crawling","label":"Looking this up online"}
event: token    data: {"text":"Two Ford dealers"}
event: token    data: {"text":" have AWD Broncos"}
event: card     data: {"kind":"car","car":{…}}
event: token    data: {"text":" in stock near you."}
event: sources  data: {"items":[{"url":"…","title":"…"}]}
event: done     data: {"thread_id":"…","messages_used":4,"expanded_ui":false}
```

| Event | When | Contract |
|---|---|---|
| `status` | Before any work begins, and on **every tool boundary** | `phase` is machine-readable; `label` is a **short human sentence** the frontend shows verbatim. Emit one **immediately on connect**, before the first tool runs, so time-to-first-feedback is ~100 ms |
| `token` | Per streamed chunk from Claude | Incremental `text` only. The client concatenates. No cumulative full-text payloads |
| `card` | When the agent has structured output | An `AICarCard`, `CompareTable` or `RequestPreview` payload. **Structured data must not be serialised into prose tokens** — the frontend renders it, it does not parse it |
| `sources` | Before `done` | Provenance URLs. A `sources`-less answer that cites a fact is a bug |
| `done` | Terminal | `thread_id`, `messages_used`, `expanded_ui`, token counts. The client persists the reply here |
| `error` | On failure | The standard envelope `code`. A failed turn must still close the stream cleanly |

**Rules, all mandatory:**

1. **`status` first, always.** The first byte on the wire is a `status` event.
   Never make the client guess why it is waiting.
2. **A `status` before every tool call.** `kb_search` and `web_search` both get
   one, so a slow crawl is visible as *"Looking this up online"* rather than as
   a stall. The phases are the UI's entire thinking indicator.
3. **A heartbeat comment every 15 s** while a tool runs, so proxies and
   `uvicorn --timeout-keep-alive` do not sever a legitimately slow turn.
4. **No buffering middleware.** A response-compressing or buffering proxy will
   batch the whole stream and reintroduce the exact problem this section
   exists to fix. The SSE response sets `Cache-Control: no-cache`,
   `X-Accel-Buffering: no`, and `Content-Type: text/event-stream`.
5. **`token` granularity is token-level**, not sentence-level. A 3-second gap
   between chunks reintroduces the wait.
6. **The client can abort.** Disconnecting closes the upstream Anthropic stream
   and stops tool execution — an abandoned turn must not keep crawling the web
   or keep billing tokens.
7. **A failed turn still terminates.** Emit `error`, then `done` with
   `messages_used` unchanged. A stream that dies open leaves the UI spinning
   forever.
8. **`expanded_ui` rides on `done`**, not on a header — the threshold decision
   happens after generation (§10.7).
9. **The whole exchange is still persisted** to `conversation_history` exactly
   as if it were non-streaming. Streaming is a transport concern and must not
   change what is stored, so a session switch replays an identical thread.
10. `POST /ai/chat` must remain reachable with `Accept: text/event-stream`. A
    plain `POST` for a client that cannot stream is acceptable **only** as an
    explicit opt-in, and it is not required in v1 — the frontend always streams.

### 10.9 Observability

Every LLM call → one `llm_audits` row with `task_type`, `provider`,
`model_name`, `thread_id`, tokens, `latency_ms`, `status`, `error_code` on
failure. Wrap the client in a decorator so **no** call site can skip the audit
— an unlogged call is a defect. `total_tokens` should be a generated column
(`input + output`) so it cannot drift. User-visible failures also write an
`error_logs` row sharing the same `uuid` and `thread_id`. Reference the real
failure shape: `negotiation_offer`, 3,120 + 340 tokens, 4,520 ms, `status =
error` because the 30 s budget was exceeded.

---

## 11. Background work, testing and operations

### 11.1 Scheduled jobs

| Job | Schedule | Action |
|---|---|---|
| `expire_stale_buyer_requests` | `0 3 * * *` | `open → expired` where `request_expire < now()`. This is the **rewrite** of the function `schema-visualizer.md` §12.1 says must be rewritten or dropped |
| `expire_stale_quotes` | hourly | `pending`/`negotiating` → `expired` where `expires_at < now()` |
| `reconcile_orphan_preferences` | weekly | The `other_brand_ids` array has **no FK** — Postgres cannot constrain array elements. Sweep orphans, per §6.2's warning |
| `sweep_orphan_llm_threads` | weekly | `llm_audits.thread_id` / `error_logs.thread_id` have **no FK by design** so logs survive conversation deletion. This is their cleanup |
| `partition_error_logs` | monthly | `error_logs` is partitioned by month on `created_at`; drop partitions older than 90 days |
| `refresh_states_brands_cache` | daily | Invalidate the 24 h reference cache |

Jobs run with the **service role** and no `app.current_user_id`, so every row
they touch records `created_by = 'system'` — which is correct, not a gap. Use
`SELECT … FOR UPDATE SKIP LOCKED` so overlapping runs cannot double-process.

### 11.2 Store decision

JWT revocation and WS fan-out need shared state. Redis is the right answer
(fan-out across uvicorn workers, revocation sets, rate limits). If Redis is
deferred, the fallback is an in-process structure — which is **correct only
with a single uvicorn worker**, and that constraint must be documented
explicitly in `main.py` rather than discovered in production. State the choice.

### 11.3 Tests — `backend/tests/`, 75% floor

The CI job `code-coverage` runs
`python -m pytest --cov=src --cov-report=term-missing tests/` and **fails the
build below 75%**. That is a hard gate, not a target.

Mandatory test coverage, each mapping to a numbered acceptance criterion in
`solution-business.md` §10:

| Area | Must assert |
|---|---|
| Auth | pending dealer gets 403 `DEALER_PENDING_REVIEW`; wrong password gets 401; support self-approval is impossible; a buyer token reaches no dealer route; refresh rotation detects replay |
| Audit | a client-supplied `created_by` is overwritten by the trigger; a system job records `'system'`; `app.current_user_id` does not leak across pooled connections |
| `final_price` | the §4.1 invariant for many inputs including trade-in credit; the generated column cannot be written; no drift is possible |
| Leaderboard | exactly one `is_leading`; ties break on `created_at ASC`; `revision_needed` correctness; a revision re-ranks |
| Revision | prior values land in `deal_history` with the actor; history is never rewritten; competitors' `expires_at` extend only when the revision takes the lead; the quote is immutable once terminal |
| Acceptance | only the buyer can accept; a dealer call is 403; siblings are declined; the request becomes `fulfilled` |
| Deal status | every legal transition succeeds; every illegal one raises; the guard is in the DB |
| Contact reveal | the buyer's deal detail **omits** the dealer contact block pre-acceptance and includes it post-acceptance |
| Chat | a non-participant is 403; a duplicate client message id is a no-op; per-side clear hides but does not delete |
| AI | classifier routing; unknown `agent` is 422; **KB miss → crawl → insert → re-answer with the crawler disabled**; no tool call for `needs_tools = False`; the agent cannot publish a request; **SSE emits `status` before `token`, and a stop request actually aborts the stream** |
| Crawl (Crawl4AI) | robots.txt is honoured; SSRF targets are rejected before `arun`; the size cap aborts; rate limits hold; `result.success` is checked; a failure degrades to a grounded answer rather than a 500 |
| Support | a dealer cannot file a `customer` ticket; ticket ids are unique **per category**; only `admin` approves an `agent` verification; `rca` is required on resolve |
| Logging | redaction of `password`, `authorization`, `api_key`; correlation `uuid` shared with `llm_audits` |

Use `pytest-asyncio`, an in-memory or containerised Postgres for integration
tests, and **real Postgres for anything touching `generated` columns, the audit
trigger, PostGIS, or the generated-query validator in §10.3** — SQLite cannot
execute the invariants that matter most here, and a test that passes on SQLite
proves nothing. In particular, `kb_search` needs a real-Postgres test that feeds
it an adversarial question and asserts the non-`SELECT` and off-allow-list
rejections actually fire.

### 11.4 Docker

The existing `backend/Dockerfile` is correct for this stack. Confirm:
`python:3.11-slim`, a build stage with a venv, a non-root `appuser`, the
`CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]` entry
point, and `/app/data` + `/app/uploads` volumes (the EC2 deploy script mounts
`drive-deal-dsu-data` and `drive-deal-dsu-uploads` there). CI runs Hadolint with
`--failure-threshold error`.

The container must boot with **only** environment variables. Anything else is a
packaging bug that will surface as a failed health check on EC2.

---

## 12. Definition of done — backend

1. All 9 CI-enforced directories and 3 enforced files exist; the Stage 2 job
   passes.
2. `ruff check src/` and `ruff format --check src/` are both clean with zero
   warnings.
3. `pytest --cov=src` passes and the total is **≥ 75%**.
4. Gitleaks finds nothing; Bandit reports no high-severity issue in `src/`;
   Trivy reports no fixable critical in Python dependencies.
5. Every endpoint in §9 is implemented with its documented guard, and a test
   exists for each guard.
6. All ten schema deltas are applied in named, reviewed Alembic migrations.
7. The three defective legacy RLS policies appear nowhere.
8. `conversation_history` round-trips a LangGraph thread across a process
   restart, and the sidebar list query is not N+1.
9. The crawl → insert → re-answer-without-crawling round trip is covered by a
   passing test.
10. The agent cannot publish a `buyer_requests` row without a buyer action.
11. No secret, password or JWT is logged, and redaction is tested.
12. Every LLM call produces an `llm_audits` row, enforced by a decorator rather
    than by convention.
13. `main.py` boots the app from environment variables alone.
14. Crawl4AI is the only web client in `requirements.txt`; there is no `httpx`
    fetch path, no `selectolax`, no `bs4`.
15. `/ai/chat` streams over SSE: a `status` event is emitted **before** the first
    `token`, and no reply is ever sent as one silent block.

---

## 13. Seed data — every table populated, realistic and consistent

The backend must ship with a `scripts/seed.py` that populates all 15 tables
with realistic, internally consistent dummy data. Run it once after migrations.
It is idempotent — running it twice produces no duplicates.

**The seeded data is the acceptance environment.** Every screen in the frontend
must have something real to display against this seed. Every edge case — empty
state, error state, the leading/revision flags, the pending-approval flow — must
be exercisable without creating additional data.

### 13.1 Personas — the fixed cast

All UUIDs are stable. Hard-code them in `scripts/seed.py` so the frontend and
backend refer to the same rows forever.

| Persona | UUID | Email | Password | Role | Status |
|---|---|---|---|---|---|
| Buyer — Rahul | `bdc31c9e-f6ed-40d0-a32f-706062f81d77` | `rahul01@gmail.com` | `rahul123` | buyer | active |
| Buyer — Adithyaa | `250d3f1c-3f4b-4cf6-8e7f-b1c972e2237f` | `adithyaa.ma@gmail.com` | `adithyaa123` | buyer | active |
| Dealer — Premium Auto Sales | `82d81b31-cf25-438c-a293-62c0ec219876` | `premium@autosales.com` | `premium123` | dealer | approved |
| Dealer — Navee Motors | `6c795ae0-edb8-4546-aef2-dab9edc2221f` | `hari@naveemotors.com` | `harishhey` | dealer | approved |
| Dealer — Test 2 Motors | `55a4688d-b55f-4c6b-8d9f-4ae617d614fd` | `test2@motors.com` | `test2123` | dealer | approved |
| Support Agent | `4772bb1a-ee75-4f45-b8e6-53d70f6e42b1` | `support03@gmail.com` | `support123` | support | approved |
| Admin | `a1b2c3d4-0000-4e5f-8a9b-000000000001` | `admin@drivedeal.com` | `admin123` | admin | active |
| Pending Dealer | `b866fe89-31a1-4b14-9247-118c83c8210c` | `pending@dealer.com` | `pending123` | dealer | pending |

### 13.2 `states` — all 50 + DC

Seed all 51 US states/territories from a static list. At minimum include TX
(`Texas`), WA (`Washington`), CA (`California`), NY (`New York`), FL
(`Florida`). Every state must have its `abbreviation`, `name`, and a
representative `coordinates` geography point.

### 13.3 `brands` — 12 manufacturers

| Name | Country | display_name |
|---|---|---|
| Ford | US | Ford |
| Honda | JP | Honda |
| BMW | DE | BMW |
| Tesla | US | Tesla |
| Mercedes-Benz | DE | Mercedes-Benz |
| McLaren | GB | McLaren |
| Toyota | JP | Toyota |
| Chevrolet | US | Chevrolet |
| Hyundai | KR | Hyundai |
| Audi | DE | Audi |
| Mahindra | IN | Mahindra |
| Porsche | DE | Porsche |

### 13.4 `cars` — 12 listings

One row per car. `seller_id` is one of the three approved dealers. At least one
row must have `mileage = NULL` and at least one must have `reviews = []` so
both "not reported" rendering paths are exercised.

| Brand | Model | Year | Body Type | Price | Mileage | Condition | Dealer |
|---|---|---|---|---|---|---|---|
| Ford | Bronco Big Bend | 2022 | SUV | 45900.00 | 28000 | used | Navee Motors |
| Ford | Mustang GT | 2023 | Sports Car | 52000.00 | 5000 | used | Premium Auto Sales |
| Honda | Jazz | 2024 | Hatchback | 22000.00 | NULL | new | Premium Auto Sales |
| BMW | 5 Series | 2024 | Sedan | 72000.00 | 3000 | new | Test 2 Motors |
| Tesla | Model 3 | 2023 | Sedan | 41000.00 | 15000 | used | Test 2 Motors |
| Mercedes-Benz | C-Class | 2025 | Sedan | 58000.00 | 0 | new | Premium Auto Sales |
| McLaren | 720S | 2022 | Sports Car | 260000.00 | 2000 | used | Test 2 Motors |
| Ford | F-150 | 2023 | SUV | 48000.00 | 22000 | used | Navee Motors |
| Honda | CR-V | 2024 | SUV | 35000.00 | 0 | new | Premium Auto Sales |
| Toyota | Camry | 2022 | Sedan | 28000.00 | 35000 | used | Navee Motors |
| BMW | X5 | 2025 | SUV | 82000.00 | 1000 | new | Test 2 Motors |
| Chevrolet | Silverado | 2021 | SUV | 38000.00 | 45000 | used | Navee Motors |

Each car gets 2–5 seeded `reviews` in the jsonb column, except the Honda Jazz
which gets `[]` to exercise the empty-reviews state.

### 13.5 `buyer_requests` — 5 rows for Rahul, 1 for Adithyaa

Use the exact UUIDs from `solution-frontend.md` §2.2:

| Buyer | Brand | Model | Status | Budget max | Timeline |
|---|---|---|---|---|---|
| Rahul | Ford | Bronco | open | 75000 | Within 2 weeks |
| Rahul | Ford | Mustang GT | open | 60000 | Just exploring |
| Rahul | Honda | Jazz | fulfilled | 35000 | Within 1 week |
| Rahul | BMW | 5 Series | open | 80000 | Within 2 weeks |
| Adithyaa | Toyota | Camry | open | 45000 | Within 1 week |

### 13.6 `deal_quotes` — 7 rows

The arithmetic invariants must hold exactly:

| id | Request | Dealer | vehicle_price | doc_fee | sales_tax | title_reg | trade_in | final_price | status |
|---|---|---|---|---|---|---|---|---|---|
| `118bd33a-9443-4951-a038-a3ab811284e4` | Bronco | Navee Motors | 65345 | 800 | 4084 | 0 | 0 | **70229.00** | pending |
| `a2b3c4d5-1111-4e5f-8a9b-111111111111` | Bronco | Premium Auto Sales | 67000 | 950 | 4188 | 200 | 0 | **72338.00** | pending |
| `c3d4e5f6-2222-4e5f-8a9b-222222222222` | Bronco | Test 2 Motors | 68000 | 750 | 4250 | 150 | 0 | **73150.00** | pending |
| `2fa7ac94-8871-4909-8175-438a4ca16c41` | Honda Jazz | Premium Auto Sales | 32600 | 150 | 2038 | 203 | 0 | **34991.00** | accepted |
| `d4e5f6a7-3333-4e5f-8a9b-333333333333` | Mustang GT | Navee Motors | 49000 | 600 | 3063 | 100 | 0 | **52763.00** | pending |
| `e5f6a7b8-4444-4e5f-8a9b-444444444444` | BMW 5 Series | Test 2 Motors | 71000 | 1200 | 4438 | 250 | 2000 | **74888.00** | pending |
| `f6a7b8c9-5555-4e5f-8a9b-555555555555` | BMW 5 Series | Premium Auto Sales | 72000 | 1100 | 4500 | 300 | 0 | **77900.00** | pending |

### 13.7 `deal_chats` — messages on the Honda Jazz accepted deal

Seed with the messages from §4.8 of `solution-business.md` plus 4 additional
conversation turns so the thread has texture:

1. Buyer: *"I have accepted your quote! Let's finalize the details."*
2. Dealer: *"2days"*
3. Buyer: *"Hi Premium Auto Sales, I'm ready with my funds arrangement. I'll be financing the remaining balance of $34,691 with a loan."*
4. Dealer: *"Great, we'll have the paperwork ready. Can you come in Thursday?"*
5. Buyer: *"Thursday works. What documents should I bring?"*
6. Dealer: *"Bring your driver's licence, proof of insurance, and financing pre-approval letter."*

### 13.8 `support_tickets` — 2 rows

| ticket_id | category | summary | status |
|---|---|---|---|
| `TIC-316519` | customer | "The web page was more slow" | new |
| `DS9940692696` | dealer | "Bidding is not working properly" | in-progress |

### 13.9 `support_verifications` — 4 rows

| ticket_id | category | profile | status |
|---|---|---|---|
| `DV1788793917` | dealer | Pending Dealer | pending |
| `DV1788882726` | dealer | Navee Motors | approved |
| `DV1788278835` | dealer | (a denied example) | denied |
| `SA97379` | agent | Support Agent | approved |

### 13.10 `buyer_preference` — 1 row for Rahul

Brand: Ford, body_type: SUV, seats: 7, transmission: Automatic, drivetrain: AWD,
condition: used, year_min: 2021, budget_max: 65000,
must_haves: `['sunroof','leather','apple_carplay']`, confidence: 0.92,
source: `ai_inferred`.

### 13.11 `conversation_history` — 4 AI threads for Rahul

Seed 4 completed advisor threads with written-out transcripts (no placeholders):
- Thread 1: *"Ford SUV under $65k with 7 seats"* — 4 messages, ends with a request preview
- Thread 2: *"Is the 2022 Bronco Big Bend worth it?"* — 2 messages, includes an AICarCard reply
- Thread 3: *"Compare the two Honda quotes I got"* — 6 messages, CompareTable with a null cell
- Thread 4: *"Budget pickup under $45k, AWD, sunroof"* — 8 messages, editable request preview

### 13.12 `llm_audits` — 3 sample rows

Seed with realistic audit entries matching the reference values in §10.9:
- A successful `chat_completion`, 2310 ms, 3120 input + 340 output tokens
- A `rag_retrieval` (SQL kb_search), 180 ms, 0 LLM tokens
- A `negotiation_offer` that timed out at 4520 ms, status `error`

### 13.13 `error_logs` — 2 sample rows

Seed with the real error references from the spec:
- `PAGE_SLOW` — endpoint `/requests`, p95 4.2s, environment production
- `BID_QUERY_INVALID` — endpoint `/api/quotes/bid`, 500001, backend

---

## 14. Post-completion run guide

This section is for whoever receives the finished backend. Follow these steps
to get a running system in under 10 minutes.

### 14.1 Prerequisites

- Docker and Docker Compose installed
- Python 3.11 (for local dev only)
- A `.env` file at `backend/.env` — copy `backend/.env.example` and fill in the required values

### 14.2 Environment variables — minimum required

```env
# backend/.env
APP_ENV=development
DATABASE_URL=postgresql+asyncpg://drivedeal:drivedeal@localhost:5432/drivedeal
JWT_SECRET=change-this-to-a-random-32-char-string-before-deploying
ANTHROPIC_API_KEY=sk-ant-your-key-here
CORS_ORIGINS=http://localhost:5173
S3_BUCKET=drivedeal-documents-local
```

### 14.3 Start with Docker Compose

```bash
# From the repo root
docker compose up -d

# Wait for the database to be ready (about 10 seconds), then:
docker compose exec backend python -m alembic upgrade head
docker compose exec backend python scripts/seed.py
```

The API is now live at `http://localhost:8000/api/v1`.
Swagger UI: `http://localhost:8000/api/v1/docs`

### 14.4 Start the frontend

```bash
# From frontend/
npm install
npm run dev
```

The frontend runs at `http://localhost:5173`. It connects to the backend at
`http://localhost:8000/api/v1` via `VITE_API_BASE_URL` in `frontend/.env`.

### 14.5 Login credentials (from seed data)

All accounts use the passwords seeded in §13.1. Use these to log in and explore
each role's experience:

| Role | Email | Password | What you can do |
|---|---|---|---|
| **Buyer (Rahul)** | `rahul01@gmail.com` | `rahul123` | See 4 open requests, the leaderboard on the Bronco, the accepted Jazz deal, chat with the dealer, use Serra AI advisor |
| **Buyer (Adithyaa)** | `adithyaa.ma@gmail.com` | `adithyaa123` | See 1 open request with 0 quotes — exercises empty state |
| **Dealer (Premium)** | `premium@autosales.com` | `premium123` | See the request feed, 5 pending quotes + 1 accepted, the dealer dashboard |
| **Dealer (Navee)** | `hari@naveemotors.com` | `harishhey` | See the feed, the leading Bronco quote, chat inbox |
| **Dealer (Test 2)** | `test2@motors.com` | `test2123` | See the feed, 2 pending quotes on the Bronco and BMW |
| **Support Agent** | `support03@gmail.com` | `support123` | See the ticket queue (2 tickets), verification queue, support console |
| **Admin** | `admin@drivedeal.com` | `admin123` | Full access — approve verifications, manage support members |
| **Pending Dealer** | `pending@dealer.com` | `pending123` | Login is blocked with `DEALER_PENDING_REVIEW` — use this to test the pending state |

### 14.6 Verifying the system is working

1. Open `http://localhost:8000/api/v1/docs` — the Swagger UI must load without authentication
2. Log in as Rahul at `/auth/login` — you should get an access token
3. Use that token to call `GET /requests` — you should see 4 requests
4. Call `GET /requests/{bronco-id}/quotes` — you should see 3 quotes, Navee leading at $70,229
5. Log in as Premium Auto Sales at `/auth/login` — you should get an access token
6. Use that token to call `GET /feed/requests` — you should see open requests near TX
7. Open `http://localhost:5173` in a browser and log in as Rahul — full buyer experience

### 14.7 Resetting the seed data

```bash
# To wipe and re-seed (development only):
docker compose exec backend python -m alembic downgrade base
docker compose exec backend python -m alembic upgrade head
docker compose exec backend python scripts/seed.py
```

### 14.8 Running tests

```bash
# From backend/
pytest --cov=src --cov-report=term-missing tests/

# Lint:
ruff check src/
ruff format --check src/
```
