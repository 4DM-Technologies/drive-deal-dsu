# DriveDeal — Business Solution Document

> **This file is an instruction prompt.** It is written to be handed to an AI
> development agent. It contains no implementation code. It defines *what*
> DriveDeal is, *who* uses it, *what rules govern it*, and *what "done" means*.
>
> **Companion documents (read all three before building anything):**
>
> | Document | Purpose |
> |---|---|
> | [`solution-business.md`](./solution-business.md) | this file — domain, rules, acceptance criteria |
> | [`solution-backend.md`](./solution-backend.md) | FastAPI / SQLAlchemy / LangGraph implementation contract |
> | [`solution-frontend.md`](./solution-frontend.md) | React implementation contract + design system |
> | [`schema-visualizer.md`](./schema-visualizer.md) | **authoritative** 15-table data dictionary + real sample rows |
> | [`schema-erd.mmd`](./schema-erd.mmd) | Mermaid `erDiagram` source for the same 15 tables |
>
> **Rule of precedence.** If this document and `schema-visualizer.md` disagree,
> `schema-visualizer.md` wins on column names, types, constraints and indexes.
> Where this document deliberately departs from it, the departure is listed
> in [§14 Schema deltas](#14-schema-deltas-from-schema-visualizermd) and is
> binding.

---

## 0. What DriveDeal is in one paragraph

DriveDeal is a **reverse marketplace** for used/new car purchasing in the
**United States only**. The traditional car site is a dealer posting inventory
and a buyer browsing it. DriveDeal inverts that: **a buyer posts what they want
to buy**, and **verified dealers compete to bid on it with an itemised
out-the-door price**. This is the single most important idea in the product and
every screen, rule and metric flows from it. There is no inventory browse-first
funnel. There is a demand post, and suppliers chase it.

This is a supply-and-demand marketplace with a **soft bidding** mechanic
(section 4.4), **deal negotiation over realtime chat** (section 6), a
**support/verification back-office** (section 7), and two **AI agents** for
buyer guidance (section 8).

---

## 1. Personas, roles and account lifecycle

### 1.1 The four roles

`profiles.role` is a closed set of four values. There is no self-service role
escalation; role is assigned at signup and can only be changed by a `support`
or `admin` account.

| Role | Who they are | Can log in immediately? | Home surface |
|---|---|---|---|
| `buyer` | A consumer shopping for a car. Signs up with name, phone, city & state, email, password. | **Yes**, on signup | Buyer dashboard — their requests, incoming quotes, orders, AI advisor |
| `dealer` | A dealership representative who wants to fulfil buyer demand. Signs up with a much longer, dealership-attesting form (section 1.3). | **No.** Blocked in `pending` until a support/admin agent approves | Dealer dashboard — the open request feed, their quotes, their deals, leaderboard position |
| `support` | A DriveDeal support agent. Signs up with name, phone, location, extra info. | **No.** Blocked in `pending` until an `admin` approves | Support console — tickets, verification queue, members |
| `admin` | DriveDeal staff with authority to approve support agents, dealers and buyers. | Seeded, never self-served | Full support console + approval authority |

> **Terminology is standardised on "dealer" everywhere.** An earlier draft of the
> schema called this role `seller`. The v1 `profiles.role` CHECK constraint and
> all 17 live `seller` rows are migrated to `dealer`. Never use the word
> "seller" in UI copy, API field names, or documentation. If you encounter
> `seller` in a legacy column (`cars.seller_id`), that is a historical artifact
> — see §14 delta 2.

### 1.2 Buyer signup

Fields, all required unless noted:

| Field | Validation |
|---|---|
| Full Name | non-empty after trim |
| Phone Number | `^\+?[0-9]{7,15}$` |
| City & State | free-text city + a `state_id` resolved from the US `states` master, e.g. `Frisco, TX` → `Texas / TX` |
| Email | unique across `profiles.email` |
| Password | Argon2id hashed into `users.password_hash`; never stored, logged or returned in plaintext |

On submit: insert `profiles` (role `buyer`) + `users` (credentials, 1:1) in one
transaction, issue a JWT immediately, land the buyer on their dashboard.

> **The "Use temp mail" helper is a demo affordance only.** It fills the form
> with a disposable address so the flow can be walked without a real inbox. It
> is not a security control and must not gate anything.

### 1.3 Dealer signup — the long form

Dealer signup collects the identity of a *business*, not just a person. All
fields required unless noted.

| Field | Notes |
|---|---|
| Representative Name | the human being |
| Dealership Name | |
| DBA (Optional) | "doing business as" |
| Branch (e.g. Westside) | → `profiles.branch_name` |
| Dealer License No. | **unique** across all profiles; the primary anti-duplication key for a real business |
| City & State | `state_id` from the US `states` master |
| Country | US only in v1; still captured because a US state is ambiguous without it |
| Dealership Phone | `^\+?[0-9]{7,15}$` |
| Website URL | validated scheme `https?://` |
| Supported Brands | multi-select of `brands` master rows → stored as the dealer's inventory brand set |
| Email / Password | as buyer |

**On submit the account is created but permanently unable to log in.** A
`support_verifications` row is inserted with `category = 'dealer'`, generated
`ticket_id` (format `DV<epoch-seconds>`, e.g. `DV1788882726`), and
`status = 'pending'`. The profile's `users.is_active` stays `false`. Any login
attempt returns a **403 with a distinct error code** (`DEALER_PENDING_REVIEW`),
not a generic 401 — the dealer needs to know the difference between "wrong
password" and "not yet approved".

Only after `status` becomes `approved` does `users.is_active` flip to `true`,
`email_sent` becomes `true`, and the dealer receive an approval email. Denial
sets `status = 'denied'` and appends a human-readable reason to the
`support_verifications.notes` jsonb trail.

**Reference rows from production** (use these as fixtures, they are real):
`DV1788882726` → approved, `DV1788278835` → denied, `DV1788793917` → pending,
`SA97379` → agent approved.

### 1.4 Support signup — deliberately hard to reach

Support agents get "power" over other people's accounts (they approve dealers,
resolve tickets, read everything). That makes open support signup a security
risk: a hostile actor can mass-register as support, get approved socially, and
land inside every dealer's data.

Mitigations, in order of strength:

1. **The real control is the backend.** No `support` or `admin` capability is
   reachable without a JWT whose `role` claim is literally `support` or `admin`.
   UI hiding is cosmetic defence-in-depth, never the gate.
2. **No self-service support signup is linked anywhere in the buyer or dealer
   public navigation.** `/support/signup` is reachable only by direct URL.
3. **Even when reached directly, it creates a `pending` verification, not a
   login.** The form says exactly this: *"Support team accounts require manual
   approval. Please provide your details below."* A support application is
   reviewed by an existing `admin` — approval of a support account is a
   two-person operation, never self-service.

Fields: Full Name, Phone Number, Location Address, Any extra necessary info
(optional), Email, Password → `support_verifications` with
`category = 'agent'`.

### 1.5 The approval state machine (all four roles)

```
signup ──> [profile row + users row (is_active = false)]
              │
              ├── role = buyer ──────────────────> is_active = true   (immediate)
              │
              └── role = dealer | support | admin
                        │
                        ▼
              support_verifications row, status = pending
                        │
        ┌───────────────┼───────────────┐
        ▼               ▼               ▼
    approved         denied          rejected
        │               │               │
        ▼               ▼               ▼
  is_active=true   stays false     stays false
  email_sent=true  reason pushed   reason pushed
                    into notes     into notes
```

`approved`, `denied`, `rejected` are all terminal for that verification row.
A denied applicant may re-apply, which creates a **new** verification row with a
new `ticket_id`; the old row is retained as history.

---

## 2. Domain model

Fifteen tables, fully specified in `schema-visualizer.md` §2 and drawn in
`schema-erd.mmd`. This section gives the *business* reading of each.

### 2.1 Table roles at a glance

| # | Table | Business meaning | Why it exists |
|---|---|---|---|
| 1 | `states` | US states master (50 + DC) | Replaces 15 free-text garbage location strings (`Fisco texas`, `Texas\|COUNTRY:USA`, `CHENNAI`) with one FK |
| 2 | `brands` | Vehicle manufacturer master | Replaces 33 distinct brand strings; collapses `Mercedes` and `Mercedes-Benz` into one canonical row |
| 3 | `profiles` | One row per human, of any role | The person. Everything else points here |
| 4 | `users` | Credentials, 1:1 with `profiles` | Keeps password material out of the person record |
| 5 | `cars` | A physical car a dealer has listed | Inventory. Its typed columns **are** what the AI advisor queries — the advisor writes an ORM query against this table rather than searching an embedding index |
| 6 | `buyer_requests` | A buyer's "I want to buy this" post | **The centre of the marketplace.** This is the product |
| 7 | `deal_quotes` | A dealer's priced response to a request | The competitive unit |
| 8 | `deal_chats` | Buyer ↔ dealer messages, scoped to one quote | Negotiation transport |
| 8a | `deal_quotes.chat_request_*` | A buyer's standing "ask to chat" on one quote | Door 2 of the contact gate (§6.1). Columns on the quote, not a sixteenth table — see `solution-backend.md` Delta 11 |
| 9 | `deal_documents` | S3 keys for photos/PDFs attached to a quote | Proof, window stickers, paperwork |
| 10 | `conversation_history` | LangGraph checkpoints, one row per graph step | Powers the AI agents' memory and conversation switching |
| 11 | `buyer_preference` | What one buyer likes, typed | One row per buyer; the AI distills chats into it |
| 12 | `support_tickets` | A help request from a buyer or dealer | Merged customer + dealer ticket streams via `category` |
| 13 | `support_verifications` | An approval case for a dealer/agent/customer | Merged dealer + agent verification streams via `category` |
| 14 | `llm_audits` | One row per LLM call: tokens, latency, status | Cost and reliability control |
| 15 | `error_logs` | Application errors with request/thread correlation | Incident diagnosis |

Plus the restored columns from §14: `deal_quotes.deal_status` and
`deal_quotes.deal_history`.

### 2.2 The core relationship, stated once

```
buyer ──creates──> buyer_requests ──attracts──> deal_quotes ──one wins──> deal
  │                       │                        │
  │                       │                        ├── deal_chats (negotiation)
  │                       │                        │     └─ opened by acceptance
  │                       │                        │        or an accepted chat request
  │                       │                        ├── deal_quotes.chat_request_*
  │                       │                        │     └─ the buyer's ask to chat
  │                       │                        └── deal_documents (proof)
  │                       │
  └── buyer_preference ───┘ (the AI generalises the buyer's taste)
```

A `buyer_requests` row is **never** a listing and **never** tied to a specific
car. It is a specification. Every `deal_quotes` row points back at one request
and carries its own `buyer_id` and `dealer_id` (denormalised on purpose so the
dealer feed and the buyer notification badge are single-index reads, not
three-way joins).

### 2.3 Identity and geography rules

- **US-only marketplace.** `states` has no country column because the product
  has no non-US market in v1. `brands.country_code` *is* international, but it
  means **where the marque is headquartered**, not where the car is sold — a
  buyer may legitimately ask for "Indian cars", which resolves to
  `brands.country_code = 'IN'` (Mahindra), not to a location.
- Free-text city (`buyer_area`, e.g. `Frisco`) is kept *alongside* the
  `buyer_area_state_id` FK, not instead of it. The city is for humans; the FK
  is for geo-matching dealers by `profiles.coordinates` within
  `buyer_requests.search_radius_miles`.
- `profiles.coordinates` is `geography(Point,4326)` with a GIST index. Buyer
  area geocoding happens once at request creation and is stored on the request,
  so a later address change on the profile does not silently retarget live
  requests.

---

## 3. The buyer request — the product's atomic unit

### 3.1 What a buyer submits

The form's information architecture, exactly as the product defines it:

> **The car you want**
> *Be as specific as you can — better specs get better quotes.*
>
> - Car brand ** (required) — from the `brands` master
> - Model ** (required, free text — the dropdown is gated on brand being chosen first)
> - Body Type (optional)
> - Fuel Type (optional)
> - Model year (optional, range, e.g. `2022`–`2026`)
> - Trim (optional)
> - Drivetrain (optional)
> - Transmission (optional)
> - Additional information (optional) — *"Any specific details you want dealers to know about the car you want…"*
> - Exterior color preference (optional) — `No preference` \| `White` \| `Black` \| `Silver / Gray` \| `Blue` \| `Red` \| `Other`
>
> **Where & when**
> *We notify matching dealers inside your radius.*
>
> - Your area ** (required) — e.g. `Frisco, TX 75034`
> - Search radius (optional) — miles, default `50`
> - Buying timeframe ** (required) — `ASAP` \| `Within 1 week` \| `Within 2 weeks` \| `Just exploring`
> - Anything else for dealers? (optional)

### 3.2 Where each form field lands

This mapping is the contract between the form and the 20 typed columns on
`buyer_requests`. The single most important design decision in the whole
schema: **the old `requirements` jsonb blob had 25 key variants** (`Brand` *and*
`Car Brand`, `Body Type` *and* `Car Type`, `Color` *and* `Exterior Color`) and is
gone.

| Form field | Column | Type | Notes |
|---|---|---|---|
| Car brand | `brand_id` | uuid FK → `brands` | Marque-level match only. "Show me Indian cars" is resolved at match time via `brands.country_code`, not stored |
| Model | `model` | text | Free text: `Bronco`, `Mustang GT` |
| Body Type | `body_type` | text | |
| Fuel Type | `fuel_type` | text | |
| Model year | `year_min`, `year_max` | int4 ×2 | A **range**, not a point. `CHECK (year_max >= year_min)` |
| Trim | `trim` | text | |
| Drivetrain | `drivetrain` | text | |
| Transmission | `transmission` | text | |
| Additional information | `additional_information` | text | |
| Exterior color preference | `color` | text | `No preference` stores `NULL`, not the literal string |
| Your area | `buyer_area` (text) + `buyer_area_state_id` (uuid FK) + `coordinates` (geography) | 3 cols | See §2.3 |
| Search radius | `search_radius_miles` | int4 | `CHECK (> 0)`, default 50 |
| Buying timeframe | `timeline` | text | 4-value CHECK domain |
| Anything else for dealers | — | — | Folds into `additional_information`; the schema has no second free-text column |
| — (not in form) | `budget_min`, `budget_max`, `target_otd_price` | numeric | Optional in the manual form, **but** the AI advisor (§8.3) is expected to elicit them |
| — (not in form) | `condition`, `must_haves`, `trade_in`, `paying_with`, `request_expire`, `market_brief`, `status` | — | AI/derived/backoffice |

**Real decomposed rows** (from `buyer_requests_rows.csv`, use as fixtures):

| id | brand | model | body_type | year_min | budget_max | target_otd | radius | timeline | area | status |
|---|---|---|---|---|---|---|---|---|---|---|
| `0b77057f-ed69-44bd-910d-34bf19f42e3e` | Ford | Bronco | Sedan | 2025 | 45000 | 42000 | 50 | Within 2 weeks | Frisco, TX | open |
| `15348fd2-764e-4e06-a5ec-6ffa6a08ecc5` | Ford | Mustang GT | Sports Car | — | — | — | 100 | Just exploring | Frisco, TX | open |
| `15cd4afa-fcf7-4fc0-9af6-ca56d49f5fbb` | Honda | Jazz | Hatchback | 2026 | 30000 | 28000 | 25 | Within 1 week | Frisco, TX | open |
| `2d2db297-0598-480b-87d8-f2b0a811fe57` | BMW | 5 Series | Sedan | 2024 | 80000 | 70000 | 50 | Within 2 weeks | Dallas, TX | open |

> Note the first row: `Bronco` is an SUV in reality but the source data says
> `body_type = 'Sedan'`. Buyer-entered data is not taxonomy-validated in v1
> beyond the free-text column. Do not build a matcher that assumes buyers
> classify correctly.

### 3.3 Request lifecycle

```
        draft ──submit──> open ──quote accepted──> fulfilled  (terminal, happy)
                          │  │
                          │  ├──buyer closes────> closed    (terminal)
                          │  ├──expiry sweep───> expired   (terminal)
                          │  └──dealer re-quotes────────> back to open
```

| Status | Meaning | Who sets it |
|---|---|---|
| `draft` | Started but not published. Only the owner sees it | Buyer |
| `open` | **In the dealer feed.** This is the only status visible to non-owning dealers | Buyer (on submit) |
| `closed` | Buyer withdrew it | Buyer |
| `expired` | `request_expire` passed, swept by a scheduled job | System |
| `fulfilled` | A quote on it was accepted | System, on quote acceptance |

**The expiry sweep** is a scheduled job (cron, `0 3 * * *` in the legacy
deployment — see `schema-visualizer.md` §12.1 for the function that must be
rewritten). It moves `open` → `expired` where `request_expire < now()`. Live
distribution: `open` 27, `expired` 10, `closed` 4, `draft` 1 of 42 rows.

> **`request_expire` is not `deal_quotes.expires_at`.** `request_expire` is the
> *buyer's* deadline ("I need this car by the 15th") and is set from the
> `timeline` field or by the AI. `expires_at` is the *dealer's* deadline ("this
> quote is valid until Friday") and is set at quote creation. Both exist, they
> mean different things, do not conflate them.

---

## 4. Quotes, soft bidding, and deals

### 4.1 What a dealer quotes

The dealer's quote form mirrors the buyer's out-the-door breakdown:

> **Vehicle price** — negotiated sale price
> **Documentation fee**
> **Sales tax** — 6.25% of vehicle price (auto-computed, read-only line)
> **Title & registration**
> **Trade-in credit** — *"If applicable"*
> **Out-the-door total** — computed, this is the number that actually competes

**The arithmetic invariant, which must hold for every quote at all times:**

```
final_price = vehicle_price + doc_fee + sales_tax + title_reg - trade_in_credit
```

This is enforced in the database as a **generated stored column**, not a
trigger and not application code, so it cannot drift:

```sql
final_price numeric(12,2) GENERATED ALWAYS AS
  (vehicle_price + COALESCE(doc_fee,0) + COALESCE(sales_tax,0)
   + COALESCE(title_reg,0) - COALESCE(trade_in_credit,0)) STORED
```

Sales tax is **derived from the buyer's state**, because US sales tax is
state-and-county specific and Texas happens to be 6.25%. The quote form shows
`6.25% of vehicle price` and recomputes `sales_tax` live as the dealer types
`vehicle_price`. A dealer may override the derived tax line (rebates,
out-of-state buyers) but never the total.

**Real quote rows:**

| id | vehicle_price | doc_fee | sales_tax | title_reg | trade_in | final_price | status |
|---|---|---|---|---|---|---|---|
| `118bd33a-9443-4951-a038-a3ab811284e4` | 65345.00 | 800.00 | 4084.00 | 0.00 | 0.00 | **70229.00** | pending |
| `2fa7ac94-8871-4909-8175-438a4ca16c41` | 32600.00 | 150.00 | 2038.00 | 203.00 | 0.00 | **34991.00** | accepted |

Both are internally consistent, so a generated column reproduces them exactly
with no backfill reconciliation.

### 4.2 Quote lifecycle

```
                ┌────────── revision ──────────┐
                ▼                              │
  pending ──> negotiating ──> accepted ──> (deal_status lifecycle, §4.6)
     │             │
     │             └── buyer requests a counter-offer ──> back to negotiating
     │
     ├──> declined   (buyer rejects)
     ├──> withdrawn  (dealer pulls it)
     └──> expired    (dealer-set expires_at passed)
```

| Status | Who sets it | Meaning |
|---|---|---|
| `pending` | Dealer, on submit | Awaiting buyer. The default |
| `negotiating` | Both | A chat conversation is open on this quote (section 6) |
| `accepted` | **Buyer only** | The quote won. Creates the deal (§4.6) |
| `declined` | Buyer only | Buyer said no. Still visible, marked closed |
| `withdrawn` | Dealer only | Dealer retracted it |
| `expired` | System | `expires_at` passed |

> **Only the buyer may set `accepted`.** This mirrors the RLS `WITH CHECK
> (status = 'accepted')` intent in `schema-visualizer.md` §14 and must be
> enforced identically at the API and repository layer. A dealer marking their
> own quote accepted is not a feature, it is a bug.

**`UNIQUE (buyer_request_id, dealer_id)`** is recommended and binding. A dealer
may not hold two competing quotes on the same request — they revise the one they
have (section 4.5). 39 live rows across 22 requests and 11 dealers contain no
duplicate pair.

### 4.3 Dealer notification and the feed

Dealers see a **request feed** — every open buyer request, filterable by
brand, body type, budget, distance, timeframe. Delivery is geographic: a
dealer is notified about a request when
`ST_DWithin(dealer.coordinates, request.coordinates, request.search_radius_miles)`.
The single most important query in the product is therefore
`(status, created_at DESC) WHERE status = 'open'` **plus** a GIST bounding
filter, both of which are indexed in `schema-visualizer.md` §7.1.

### 4.4 Soft bidding — the precise rules

**This is a bid, but not exactly a bid.** Nothing is auto-awarded, nothing
expires on a timer that punishes the buyer, and the buyer is never raced. The
dealer set is visible to the buyer at all times as a priced leaderboard.

Three pieces of UI copy define the mechanic, and the backend must produce
exactly these three states:

| Copy shown | Condition |
|---|---|
| `Deal Accepted!` | This quote's `status = 'accepted'` |
| `You are leading` | This quote has the **lowest `final_price`** among all non-terminal quotes on the request |
| `Revision may be needed` | Another dealer has quoted **lower** than this one |

**Definitions, precisely:**

- **Leading quote** = `MIN(final_price)` over quotes on the request where
  `status IN ('pending','negotiating')`. Ties broken by `created_at ASC` (the
  earlier quote keeps the lead). This is the `btree (buyer_request_id,
  final_price ASC, created_at ASC)` index from `schema-visualizer.md` §7.2 —
  the leaderboard is a single index scan, not a computed ranking.
- **"Revision may be needed"** = the dealer is **not** leading, **and** the
  buyer's current leading total is below this dealer's total. It is an
  *advisory*, never an automated penalty. The dealer may ignore it entirely and
  keep their quote as-is. It is not a system warning, it is a competitive fact
  the dealer is allowed to know.
- **"Bidding window: Open"** = the buyer's request `status = 'open'`. When the
  request moves to `fulfilled` / `closed` / `expired`, the window reads
  `Closed` and no further quotes may be created on it.

**Buyer's request screen** shows, for a request with multiple dealers quoting:

1. The request specification, and its `status` as `Live` / `Pending` / `Closed`
2. **A count of how many quotes exist** — `SELECT COUNT(*) FROM deal_quotes
   WHERE buyer_request_id = $1 AND status IN ('pending','negotiating')`
3. **A side-by-side comparison of every quoting dealer**: dealership name,
   every price line (`vehicle_price`, `doc_fee`, `sales_tax`, `title_reg`,
   `trade_in_credit`), the computed `final_price`, the lead flag, the revision
   flag, and the validity window
4. An **Accept** action per dealer
5. A **"Compare"** affordance that hands the selected set to the AI compare
   agent (§8.4)

**Accepting** is the irreversible moment. It sets the quote `accepted`, stamps
`accepted_at`, flips the request to `fulfilled`, transitions every sibling quote
to `declined`, and opens the deal (§4.6). The buyer is **not** told the
dealer's phone number before accepting — that is the consideration for the
dealer's real-world effort, and §6.1 sets out the single alternative: the buyer
may ask to chat, and the dealer may choose to open it. Either door releases the
same contact block — representative name, dealership name, branch, phone,
website, and a direct line into the chat — on the buyer's Orders page, with the
chat icon beside it.

### 4.5 Quote revision — the anti-sniping replacement

The legacy system ranked live bids and used a `quote_history` jsonb ledger plus
`expires_at` to **extend competing dealers' windows** whenever a revision
landed — an anti-sniping technique. `schema-visualizer.md` §11.1 documents that
`quote_history` is being dropped and the ranking must be computed from
`deal_quotes` alone.

**The restored `deal_history` column** (see §14 delta 3) closes this. Every
revision appends an immutable entry:

```json
[
  {"ts": "2026-09-08T13:29:21Z", "actor_id": "82d81b31-…", "actor_role": "dealer",
   "event": "quote_revised",
   "previous_final_price": 34991.00, "new_final_price": 33600.00,
   "was_leading": false, "now_leading": true,
   "competitors_extended": ["2fa7ac94-…"], "note": "dropped doc fee to match market"}
]
```

**Revision rules, binding:**

1. Only a **dealer who already holds a quote on the request** may revise it.
2. Revision overwrites the price columns; the previous values are appended to
   `deal_history` **in the same transaction**. History is never rewritten.
3. A revision that becomes the new lowest `final_price` re-writes the
   `deal_documents_id` pointer if documents were re-uploaded, and **pushes a
   realtime event** on the `buyer_request_id` channel so the buyer's leaderboard
   re-ranks without a refresh.
4. A revision that is *lower* than the current leader extends the `expires_at`
   of every competing `pending` quote by a fixed grace period (24h, capped at
   the original + 7 days). This is the anti-sniping behaviour, now expressed
   against a durable ledger instead of an unqueryable blob.
5. Once `status IN ('accepted','declined','withdrawn')` the quote is
   **immutable**. A dealer who needs to change a closed quote creates a new
   application; they cannot edit history.
6. `deal_history` appends are recorded with `created_by = <dealer uuid>` so
   "who changed what, when" is answerable for every dollar.

### 4.6 The deal — lifecycle restored

A **deal** is not a table. A deal is a `deal_quotes` row with
`status = 'accepted'`, seen from the two sides of the transaction. The buyer
calls it an **Order** (`/orders`), the dealer calls it a **Deal** (`/deals`);
same row, two lenses, filtered by whether `auth.uid()` equals `buyer_id` or
`dealer_id`.

`schema-visualizer.md` §11.2 documents that `deal_status` and `deal_history`
were being dropped and that this **deletes live data with no replacement** — 39
of 39 `deal_status` values and 9 narrative `deal_history` entries. Per the
product decision to restore the lifecycle, both columns come back
(§14 deltas 1 and 3):

**`deal_status` — the post-acceptance stages** (stored as **slugs**, with a
display-label map in the UI; the legacy values contained spaces and capital
letters and cannot be a clean Postgres `ENUM`):

| Slug | Display label | Who advances it |
|---|---|---|
| `null` | — | Deal just accepted; lifecycle not started |
| `paperwork_going_on` | Paperwork going on | Dealer |
| `funds_arrived` | Funds arrived | Dealer |
| `dispatch` | Dispatch | Dealer |
| `delivery` | Delivery | Dealer |
| `completed` | Completed | Buyer (confirms receipt) |
| `cancelled` | Cancelled | Dealer or support |

> The legacy data contains both `Funds Arranged` (2 rows) and `Funds Arrived`
> (2 rows) — a typo in the source. The slug set uses `funds_arrived`; any
> reintroduction must remap the two typo rows rather than carry both spellings.

**Both sides get a Deal/Order detail page** showing: the full itemised price
breakdown, the deal status stepper, the document checklist (§4.7), the chat
thread, and — for the buyer, once the §6.1 contact gate is open — the dealer's
contact block. The support console can read and advance deal status for dispute
resolution and records who did it.

### 4.7 Deal documents

`deal_documents` holds **S3 keys, never binary**. The legacy schema stored
base64 data-URLs inline in a jsonb column (13 of 39 rows) and classified files
by extension, which mis-filed a `.docx` as an image. The new shape is
structural and needs no classifier:

| Column | Holds | Example |
|---|---|---|
| `image_paths` jsonb array | Zero or more **photos/screenshots** | `["<quote_id>/1788874160802.png"]` |
| `document_path` text | Zero or one **real document** | `<quote_id>/1788976307405.pdf` |

`deal_documents.quote_id` is a **1:N** owning relationship — a quote can have
many uploads over its life. `deal_quotes.deal_documents_id` is a nullable
convenience pointer to the *current* set. The circular FK is deliberate and safe
precisely because the pointer is nullable: insert quote with pointer `NULL`,
insert documents, then `UPDATE` the pointer. **Do not add `UNIQUE` to
`deal_documents.quote_id`.** Real data has one quote with two document rows.

### 4.8 Real message rows, for tone reference

Buyer↔dealer chat is short, transactional, and often mid-negotiation. Build the
UI to render these gracefully — no thread ever has more than a handful of turns
in the sample data.

- *"Hi Premium Auto Sales, I'm ready with my funds arrangement. I'll be financing the remaining balance of $34,691 with a loan. …"*
- *"2days"*
- *"I have accepted your quote! Let's finalize the details."*

---

## 5. Roles and what each can see

Enforced twice: once as a route/dependency guard in the API, and once as a
repository-layer ownership check. `schema-visualizer.md` §14 is the
authoritative intent; §14 delta 5 of this document says how it is expressed
under FastAPI + RDS instead of Supabase.

| Resource | buyer | dealer | support | admin |
|---|---|---|---|---|
| Own profile | read/write | read/write | read/write | read/write |
| Any profile | — | — | read | read |
| `states`, `brands` | read | read | read | read |
| `cars` (active) | read | read | read | read |
| `cars` (own listings) | — | create/read/update | read | read |
| `buyer_requests` | CRUD own | read `open` only | read all | read all |
| `deal_quotes` | read own-side; **accept**; **request chat** | CRUD own-side; **revise**; **accept/decline a chat request** | read all | read all |
| `deal_chats` | read/write where they are `buyer_id` | read/write where they are `dealer_id` | read all | read all |
| `deal_documents` | read (own quotes) | CRUD (own quotes) | read all | read all |
| `buyer_preference` | CRUD own | — | read | read |
| `conversation_history` | CRUD own threads | CRUD own threads | — | — |
| `support_tickets` | CRUD own, raise + view | CRUD own, raise + view | CRUD all | CRUD all |
| `support_verifications` | read own (status only) | read own (status only) | CRUD all | CRUD all |
| `llm_audits`, `error_logs` | — | — | read | read |

**Three legacy RLS policies must never be reproduced.** `schema-visualizer.md`
§14 names them explicitly as defects: a `USING (true)` read policy on the old
quotes table (any authenticated user could read every buyer's financials), and
two fully open `USING (true) WITH CHECK (true)` policies on the old negotiation
message and conversation cache tables. Any permission rule you implement must
be a **named, reviewed allow-list**. An `ALLOW ALL` is a security incident.

---

## 6. Realtime chat

Buyer↔dealer messaging is a normal chat surface with realtime delivery over a
WebSocket, scoped to **one quote**, and only between the quote's `buyer_id` and
`dealer_id`. There is no chat without a quote and no quote without exactly one
chat.

### 6.1 The contact gate

**A buyer does not get a dealer's phone number or email because they can see a
price.** Until the buyer has either committed or been given permission, the
dealer is a verified badge and a name. This is the marketplace's whole claim: a
listing is not a lead.

The gate opens through exactly one of two doors:

**Door 1 — the buyer accepts the offer.** Acceptance *is* consent to talk. No
request, no approval, no waiting. The buyer's offer page immediately shows the
full dealer contact with the chat icon beside it.

**Door 2 — the buyer asks to negotiate.** The buyer does not want to accept as-is
but is not gone either, so they send a description of what they want to discuss.
**Nothing opens on the buyer's say-so.** The request is pending, the dealer is
notified, and the dealer decides. On accept, the quote moves to `negotiating`,
the chat opens, the contact unlocks, and the buyer's own message becomes the
first line of the thread — so the dealer sees exactly what they agreed to talk
about.

Declining a chat request costs the buyer nothing except the conversation: the
quote is untouched, the original offer still stands, and they may submit one new
request later. A refusal must not be a dead end.

### 6.2 Rules

1. **A chat is closed until a door opens.** `GET`/`POST /chats/{quote_id}`
   returns `CHAT_NOT_OPEN` before then. This is a real refusal, not an empty
   thread, so the client can say *why*.
2. **The contact gate and the chat gate are the same predicate.** One rule, three
   call sites: `/quotes/{id}/dealer-contact`, `/deals/{id}`, and the chat
   routes. Two rules will disagree the first time a quote reaches `negotiating`
   by a path the other rule did not consider.
3. **The contact block is omitted, not blanked,** while the gate is closed. A
   disabled form leaks that a phone number exists.
4. **The chat icon renders from `contact_available`** and from nothing else. A
   client that infers it from the quote status will show a dead icon on exactly
   the quotes where a chat request was just accepted.
5. **`request-negotiation` and `request-access` are different things.**
   `request-negotiation` is a buyer asking to reopen a *declined* quote for price
   renegotiation — a quote-level action, no chat implied.
   `request-access` is a buyer asking for *permission to talk* on a pending
   quote. Conflating them would mean a dealer's approval is required to reopen a
   quote, which is not the product.
6. **A revised quote (§4.5) posts into the same thread**, so the negotiation
   history and the price history are one narrative. After acceptance the same
   thread continues and becomes the deal's channel through paperwork and
   delivery.
7. **Withdrawing a quote soft-closes the chat and clears the dealer's side.**
   The rows remain, so a later re-quote on the same request does not resurrect
   messages the dealer has already dismissed.
8. **Per-side soft delete only.** `buyer_chat_cleared_at` and
   `dealer_chat_cleared_at` on `deal_quotes` hide the thread from that party's
   view. Rows are **never** deleted. Support can always read the full history.
9. **Message ids are client-generated** (`crypto.randomUUID()`) so the UI can
   render an optimistic bubble and reconcile it when the server echoes back. A
   duplicate id is a no-op, not an error, so a retry after a dropped connection
   never double-posts.
10. **Delivery guarantees:** exactly-once persistence, at-least-once push, and
    the client dedupes on message id. Ordering is by `created_at ASC` within a
    quote. The socket is a notification channel only — on reconnect the client
    re-fetches rather than expecting a replay, so no message is ever lost.
11. **The dealer sees a triage inbox, not a wall.** Pending chat requests are a
    list of `(vehicle, buyer, what they want to discuss, when)` sorted newest
    first, because the dealer's real question is "who should I answer first?"

---

## 7. Support and verification back-office

### 7.1 Tickets

Any signed-in `buyer` or `dealer` raises a ticket from `/help-support`. The
`category` field (`customer` | `dealer` | `internal`) segregates the two streams
while keeping one table — the legacy design had two near-identical tables
(`support_customer_tickets` 2 rows, `support_dealer_tickets` 7 rows) that are
now merged.

`ticket_id` is human-facing and **unique per category, not globally**: buyer
tickets look like `TIC-316519`, dealer tickets like `DS9940692696`. Including
`category` in the unique constraint keeps the two namespaces independent.

**Real tickets:**

| ticket_id | category | caller | issue_summary | status | priority |
|---|---|---|---|---|---|
| `TIC-316519` | customer | `bdc31c9e-…` (buyer) | "The web page was more slow" | new | medium |
| `DS9940692696` | dealer | `82d81b31-…` (dealer) | "Bidding is not working properly" | in-progress | medium |

**Status flow:** `new → in-progress → (on-hold) → resolved → closed`. Support
agents change status, append entries to the `notes` jsonb timeline
(`{"ts","text","agent"}`), and on resolution write a root-cause analysis into
`rca`.

**The two real `rca` values are your acceptance bar for that field** — they
are written like post-mortems, not like status messages:

> *"A developer error in the backend integration caused the bidding service to query the database incorrectly, preventing the correct bidding function from being retrieved."*

> *"All pages are slow — p95 render 4.2s"*

Note both reference concrete, checkable technical causes. A `rca` of "fixed it"
is not acceptable.

### 7.2 The support console

- **Tickets** — filterable queue by `category`, `status`, `priority`; full
  timeline; ability to change status and add notes.
- **Verifications** (`/verifications`) — the approval queue for `dealer` and
  `agent` categories. Approve / deny / reject with a mandatory reason appended
  to `notes`. Approving a dealer flips `users.is_active` and triggers the
  approval email (`email_sent`).
- **Support members** (`/support-members`) — list of `support` and `admin`
  accounts, their status, and approval history.

---

## 8. AI agents

Two buyer-facing agents, one tool belt shared by both, built on LangGraph with
Anthropic Claude. Full graph construction, tool signatures and endpoint
contracts are specified in `solution-backend.md` §10. This section is the
product behaviour.

### 8.1 The advisory agent (`sera-agent`)

An AI car advisor available to every signed-in buyer from a **persistent chat
icon in the bottom-right of every buyer page**. Clicking it opens a chatbot
panel. It is not a support bot — it knows nothing about tickets, and it must
never answer "where is my order" by guessing; it redirects to support.

**Conversation sessions.** The buyer sees their previous conversations and can
switch between them or start a new one at any time. Each session is a distinct
`thread_id` in `conversation_history` with `thread_type = 'advisor'`. Sessions
are titled (derived, since the schema has no `chat_sessions` table) and ordered
by last activity.

**The 3-message rule.** The first three messages are lightweight — a compact
inline chat popover. **On the fourth message the popover expands into the full
advisor interface**: a full-height conversation view, session switcher, rich
rendering, structured car cards instead of plain text, and inline actions.
The expansion is announced to the user ("Your conversation is getting detailed —
opening full advisor") rather than happening silently, because a layout that
jumps with no explanation is the exact experience the product is trying to avoid.

**The 4–5 turn structured intake.** Across roughly four to five turns the agent
should be able to gather enough to *complete and post the entire car-buying
request from §3.1 on the buyer's behalf* — brand, model, body type, fuel, year
range, trim, drivetrain, transmission, colour, area, radius, timeframe, budget.
**This is the agent's highest-value job: converting a conversation into a
submitted `buyer_requests` row.**

**Human-in-the-loop is mandatory at that point.** When the agent believes it has
a complete request it must **not** post silently. It presents a filled-in
preview of the request, asks for confirmation, and lets the buyer edit anything
before submitting. "If not the user can also custom chat" — the buyer may keep
talking instead, and the agent keeps filling fields until the buyer either
confirms or abandons the flow. A partially-filled request stays a `draft`.

**Preference learning.** Every resolved fact is also written to
`buyer_preference` (one row per buyer), with `source = 'ai_inferred'` and a
`confidence` score. The real example is a buyer resolved to: Ford, Toyota as an
alternate, SUV, 7 seats, Automatic, AWD, Used, min year 2021, budget max 65000,
must-have `['sunroof','leather','apple_carplay']`, `confidence = 0.92`. This is
what lets the next conversation start warm, and what drives the `cars` match
query in `schema-visualizer.md` §6.2.

**Answers must be grounded.** A question about a specific car must be answered
from retrieved data with a source attribution. If the knowledge base has nothing
and the web scrape also yields nothing, the agent says so — it never
hallucinates a spec, a price or a review.

**The advisor is buyer-only.** Buyers get the advisor and the compare agent.
Dealers, support agents and admins do not — a dealer sees no advisor entry point
anywhere, and a dealer who navigates directly to it is refused. This is enforced
in the navigation, in the route guard and in the API, not by hiding a button.
Full rules in `solution-frontend.md` §3.8.

**The advisor, the compare agent and their full interface are also the frontend's
demo surface.** The frontend ships on mock data first, so all of the above —
sessions, the 3→4 message expansion, streaming replies, grounded car cards,
comparison tables, the request preview — must be demonstrable locally with
written transcripts before the backend exists. `solution-frontend.md` §2.2
specifies the seeded threads.

### 8.2 Tools available to both agents

| Tool | Purpose | Notes |
|---|---|---|
| `kb_search` | **The database is the knowledge base.** The agent turns the question into a SQLAlchemy ORM query and runs it against `cars`, `brands`, `states`, `buyer_preference`, `deal_quotes`, `profiles`, `conversation_history` — plus the inline `cars.reviews` array when the question is about reviews | First tool always tried. Structured, fast, free, exactly answerable |
| `web_search` | Fetch and read live web pages the database could not answer, using **Crawl4AI** | Only after `kb_search` returns nothing usable. Headless-browser crawl returning LLM-ready markdown. Rate-limited, robots.txt-respecting, cached. **This is the only web tool in v1** |
| `kb_insert` | Persist a new finding — specs, reviews, price observations — into the **typed columns** | **Called by both agents automatically** after a successful crawl |

**There are no vector embeddings in this product.** No `pgvector`, no embedding
column, no semantic index. Retrieval is structured SQL against a schema that is
fully typed, and that is the correct choice here rather than a shortcut: the
questions buyers actually ask — *"an AWD SUV under $65k within 25 miles with a
sunroof"* — are exact predicate sets, and an ORM query answers them exactly
while a vector index can only approximate them. Fuzzy free-text recall is a
known trade-off, covered by `web_search` when the columns run out. See
`solution-backend.md` §2 Delta 9 for what this deletes.

**The `kb_insert` round-trip is a core requirement, not an optimisation.** The
product rationale is explicit: every scraped finding becomes reusable knowledge,
so the *next* identical question is answered from the database with no web call,
no latency and no cost. Both the advisory agent and the compare agent must
write back, and **it must be written into real columns** — a finding parked in a
free-text blob that no ORM predicate can reach is knowledge the advisor can
never retrieve. Implementation detail in `solution-backend.md` §10.4.

### 8.3 The compare agent (`compare-agent`)

The buyer selects two or more of their request boxes and asks for a comparison.
The agent returns a structured, decision-oriented answer — not a wall of text.

The compare agent uses **the same three tools** as the advisory agent
(§8.2) and performs the same `kb_insert` write-back. It must be able to answer
"give me the reviews for the three cars" by falling through `kb_search` →
`web_search` → `kb_insert` when the reviews are not in the database. Because
`kb_search` is an ORM query, the comparison pulls each car's row, spec columns
and the inline `cars.reviews` array directly — the same code path the advisor
uses, with no separate retrieval mode. There is no separate `car_reviews`
table; a review question unnests the jsonb column.

**A comparison output must contain, at minimum:**

- A like-for-like spec table across the selected requests, with **missing data
  shown as "not reported"**, never invented
- Price analysis against each buyer's `target_otd_price` and `budget_max`, and
  the spread between cheapest and dearest out-the-door
- Review sentiment and volume where reviews exist
- A clear recommendation with the reasoning shown, including a stated confidence
- Explicit caveats where the data is thin

**It must not:** invent a spec to fill a gap, silently drop a selected request
because data is missing, or present a recommendation without the evidence that
produced it.

### 8.4 Agent routing

Both agents are reachable through **one endpoint family** with an `agent` key in
the request body:

```json
{ "agent": "sera-agent", "message": "Give me the Honda cars", "thread_id": "..." }
{ "agent": "compare-agent", "message": "Compare my three requests", "thread_id": "..." }
```

The frontend passes the key; the backend routes to the appropriate graph. An
unknown `agent` value is a 422, never a silent fallback to the default agent.

### 8.5 AI accountability

Every LLM call writes one `llm_audits` row: `task_type`, `provider`, model
name, `thread_id`, input/output/total tokens, `latency_ms`, `status`, and
`error_code` on failure. Reference real values — `openai/gpt-oss-120b` at
2,310 ms success, and a `negotiation_offer` that hit 4,520 ms and `status =
error` because it exceeded its 30 s budget. **`llm_audits` is how the product
knows an agent is slow, expensive or failing**; an unlogged LLM call is a bug.
Errors that surface to a user also land in `error_logs` with the same
correlation `uuid` and the same `thread_id`.

---

## 9. Non-functional requirements

These are the product-level commitments. Their technical enforcement is in
`solution-backend.md` §11 and `solution-backend.md` §1.

| # | Requirement | Measurable target |
|---|---|---|
| 1 | Backend test coverage | **≥ 75%** enforced as a hard CI gate that fails the build |
| 2 | Lint/format | `ruff check` and `ruff format --check` both clean, zero warnings |
| 3 | Secret scanning | No hardcoded secrets; gitleaks pass on every PR |
| 4 | Dependency scanning | No known **critical**, fixable vulnerability in Python or Node deps |
| 5 | SAST | No high-severity static analysis finding in `backend/src/` |
| 6 | Pipeline | PR description template enforced; directory-structure compliance enforced on every PR |
| 7 | Page performance | p95 render under 2 s on the buyer's requests list (a real logged complaint was p95 4.2 s — see `TIC-316519` and error log `PAGE_SLOW`) |
| 8 | Realtime latency | Chat message visible to the peer under 1 s |
| 9 | Geographic correctness | All 50 states + DC seeded; zero free-text country/state values accepted at input |
| 10 | Audit completeness | Every one of the 15 tables records `created_at`/`updated_at`/`created_by`/`updated_by`, set by the database, not the client |
| 11 | US-only | No non-US listing can be created; buyer area must resolve to a `states` row |
| 12 | Accessibility | Keyboard-navigable, screen-reader-labelled, WCAG AA contrast on every surface |

---

## 10. Acceptance criteria

A build is acceptable when all of the following are demonstrably true.

**Accounts and access**
1. A buyer can sign up, log in, and land on a buyer dashboard — without any
   support or admin involvement.
2. A dealer can complete the full dealership form and reach a "pending review"
   state, and **cannot** log in while pending. The 403 distinguishes pending
   from bad credentials.
3. A support agent cannot self-approve. `/support/signup` is unlinked from
   public navigation, and even reached directly produces a pending
   verification requiring an admin.
4. JWT role claims are the single source of authorization truth, and a buyer
   token cannot reach any dealer or support endpoint.

**Request and quote**
5. A buyer can submit a request with the exact §3.1 field set, and every field
   lands in its §3.2 column with no jsonb blob.
6. A matching dealer sees that request in their feed, and a non-matching dealer
   (outside `search_radius_miles`) does not.
7. A dealer can submit a quote, and `final_price` equals the §4.1 invariant
   exactly, with a database-level guarantee that it cannot drift.
8. The buyer's request screen shows live request status, an accurate quote
   count, and a side-by-side comparison of all quoting dealers.
9. Exactly one dealer is shown `You are leading`; every other dealer whose total
   is above the leading total is shown `Revision may be needed`; a revision
   re-ranks the leaderboard in realtime without a page refresh.
10. A dealer can revise their quote, and the prior price is permanently retained
    in `deal_history` with the actor recorded.
11. An accepted quote becomes immutable, flips the request to `fulfilled`,
    declines the siblings, and creates the deal.

**Deals and chat**
12. The buyer's Orders page and the dealer's Deals page show the same deal from
    two lenses.
13. The buyer's contact reveal of the dealer happens **only after** the buyer
    accepts the offer, or after the buyer requests a chat and the dealer accepts
    it. On a `pending` quote with no accepted request, `/quotes/{id}/dealer-contact`
    refuses with `DEALER_CONTACT_WITHHELD` and no chat icon is shown.
14. The deal status stepper advances through the six slugs, and every advance
    is recorded with actor and timestamp.
15. Chat is realtime between exactly the two parties, continues across
    acceptance, and supports per-side soft delete with no row deletion.
16. A buyer can ask to negotiate on a declined quote, the quote moves to
    `negotiating`, and the dealer is notified.
17. A chat request carries the buyer's own description, stays pending until the
    dealer acts, and on accept opens the chat, unlocks the contact, and posts the
    description as the first message — in one step the buyer can observe.
18. `/openapi.json` and `/docs` are reachable without signing in, and both render
    the same contract.

**Support**
17. A buyer and a dealer can both raise tickets with correct, distinct
    human-facing ids.
18. Support can filter the queue, change status, add notes, and write an `rca`.
19. Support can approve or deny a dealer verification, and approval actually
    enables the dealer's login.

**AI**
20. The advisor answers in a compact popover for three messages and expands to
    the full interface on the fourth, with the transition explained.
21. The buyer can switch between previous sessions and start a new one, and the
    thread state is restored per session.
22. Across four to five turns the agent can assemble a complete request and
    presents it for **explicit human confirmation** before posting.
23. A question the KB cannot answer falls through to `web_search` (Crawl4AI),
    and the finding is written back via `kb_insert` such that the identical
    question next time is answered with **no** web call.
24. **The buyer never waits on a silent screen.** The advisor streams: a named
    thinking phase appears within a fraction of a second, the phase updates as
    the agent searches and crawls, then the reply arrives token by token. A turn
    that goes online takes seconds, and the buyer is told what is happening for
    all of it. Technical contract in `solution-backend.md` §10.8; the frontend
    builds and ships this first against mock streams in
    `solution-frontend.md` §2.7.
25. The compare agent produces a like-for-like table with explicit
    "not reported" gaps, and a recommendation with visible reasoning.
26. Both agents route off the `agent` key in the request body, and an unknown
    value is rejected rather than defaulted.
27. Every agent call produced an `llm_audits` row with tokens, latency and
    status.

**Data integrity**
28. All 15 tables plus the restored columns exist with the documented `UNIQUE`,
    `CHECK`, and audit constraints, and no client-supplied audit actor survives.
29. The three defective legacy RLS policies are not reproduced anywhere.
30. `mercedes` and `Mercedes-Benz` resolve to one canonical brand row.
31. Buyer input cannot create a non-US state reference or a non-US listing.

---

## 11. Non-goals for v1

State these explicitly so nobody builds them by accident.

| Not in v1 | Why |
|---|---|
| Buyer-side inventory browsing as the primary entry point | DriveDeal is a reverse marketplace; browsing exists only as a supporting AI/advisor surface |
| Financing, loan origination, or payment processing | Out of scope — a deal is a *dealer's promise to sell*, settled outside the platform |
| Vehicle title/registration transfer, or any DMV integration | The `title_reg` line is a **price line**, not a filing |
| Non-US markets, currencies, or states | `states` is US-only by design |
| Dealer subscription/billing tiers, ads, or promoted placement | Quotes compete on price alone in v1; ranking must stay honest |
| Multi-currency, multi-language | US-English only |
| Mobile native apps | Responsive web only |
| In-app payments, escrow, or deposits | See above |
| Live vehicle tracking or VIN-level telematics | Quote-time data is manual and document-attached |
| Test drives scheduling | Not part of the quote/accept/chat loop |
| Automated AI negotiation that accepts or counters on the buyer's behalf | The AI advises and drafts; **only the buyer accepts**. This boundary is a trust property of the product, not a technical limitation |

---

## 12. Open questions for the product owner

Flagged, not blocking v1, but each needs a decision before the corresponding
build step.

1. **Sales tax derivation.** §4.1 assumes the rate comes from the buyer's
   `state_id`. Texas 6.25% is a flat state rate, but most states have
   county/city layers that a state-level table will get wrong. Is a flat
   per-state rate acceptable for v1, or is real jurisdiction lookup required?
2. **Quote visibility between dealers.** Currently every quoting dealer is named
   and fully priced to the buyer, and no dealer sees another's quote. Should
   dealers remain blind to each other, or should anonymity be a dealer-facing
   setting?
3. **Competing request windows.** Nothing currently stops a buyer from keeping
   a request open indefinitely. Should there be a maximum request lifetime, and
   should accepting a quote close sibling requests or leave them open?
4. **`market_brief` population.** Only 7 of 42 live requests have one, and it is
   the most valuable field for a buyer comparing requests. Should the compare
   agent be required to populate it for every new request?
5. **Deletion / right-to-erasure.** A PII-erasure request from a buyer
   collides with `deal_quotes` rows that are a financial record
   (`ON DELETE RESTRICT`). What is the agreed anonymisation policy?
6. **Dealer brand portfolio.** A dealer's "supported brands" has no junction
   table in the 15-table design; §4.1 of `schema-visualizer.md` derives it from
   their listed `cars`. Is a dealer's stated brand set authoritative, or does
   the derived set win?
