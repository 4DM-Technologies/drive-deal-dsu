# DriveDeal — Frontend Solution Document

> **This file is an instruction prompt.** Hand it to an AI development agent
> together with [`solution-business.md`](./solution-business.md). It contains no
> application code — it is the contract the implementation must satisfy.
>
> **Build order: FRONTEND AND BACKEND TOGETHER.** The frontend connects to the
> real backend API from day one. There is no mock-data phase — build both in
> parallel, wire them together immediately, and iterate on real data. The
> `src/services/mocks/` layer exists only as a type contract and test harness,
> never as the running data source.
>
> **The single most important instruction in this file is §4.** A technically
> correct app that looks generic, feels dated, or makes the user hunt for
> controls has failed. Read §4 before writing any component.
>
> **The second most important instruction is §4.1 and §4.3.** The theme is
> **light and warm** — never dark-first, never high-contrast harsh white. The
> palette is warm whites, warm grays, and a deep automotive blue accent. A
> screen that looks cold, clinical, or like a dark SaaS dashboard has failed
> regardless of how correct its markup is.

---

## 0. Stack — pinned

| Concern | Choice | Notes |
|---|---|---|
| Framework | **React 19** + **TypeScript 5** (`strict`) | `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` on |
| Build | **Vite** | The CI Docker build runs `npm run build` and serves `dist/` |
| Routing | **React Router 7** (data router) | `createBrowserRouter` |
| Server state | **TanStack Query v5** | Treats the mock layer as a server — the *same* hooks work unchanged when a real API replaces it. Never mirror it into a global store |
| Client state | **Zustand** | UI-only: sidebar open, active thread, filters, mock-mode flags |
| Styling | **Tailwind CSS v4** + **shadcn/ui** | Copy, don't fork-and-abandon. Keep the component source in the repo |
| Animation | **Motion** (`motion/react`) | Scroll reveals, layout transitions, the 3→4 message expansion |
| Realtime | A **mock realtime** driver that mirrors the future WebSocket protocol | §2.6. Built now so realtime UX is demonstrable without a server |
| AI streaming | A **mock SSE stream** matching the future `/ai/chat` event contract | §2.7. `status` → `token` → `card` → `done`, with the thinking indicator designed against it |
| Forms | **React Hook Form** + **Zod** | One schema per form, reused for validation and mock-side assertions |
| Icons | **Lucide React** | Line icons at consistent stroke width. Never emoji as UI icons |
| Car imagery | Generated + optimised, served from a CDN | §4.6 — quality is a product requirement |

**No** component library beyond shadcn. **No** CSS-in-JS runtime.
**No** dark-mode-first anything — see §4.1.

---

## 1. Directory structure — the layout CI enforces

Stage 2 of the CI pipeline fails the build if any of these is missing.

```
frontend/
├── Dockerfile                    # exists
├── .dockerignore                 # exists
├── package.json                  # REQUIRED
├── package-lock.json             # REQUIRED — the Dockerfile COPYs it
├── serve.json                    # REQUIRED — the Dockerfile COPYs it
├── index.html
├── vite.config.ts
├── tsconfig.json
├── components.json               # shadcn
├── eslint.config.js
├── .env                          # VITE_USE_MOCKS=true
└── src/                          # REQUIRED DIR
    ├── main.tsx
    ├── App.tsx
    ├── index.css
    ├── assets/                   # REQUIRED DIR — images, generated car media
    ├── types/                    # REQUIRED DIR — app-wide types
    ├── helpers/                  # REQUIRED DIR — pure utilities
    ├── ui/                       # REQUIRED DIR — the view layer
    │   ├── navigations/          # REQUIRED DIR — routes + shells
    │   ├── screens/              # REQUIRED DIR — one per route
    │   └── reusables/            # REQUIRED DIR — shared components
    └── services/                 # REQUIRED DIR — everything data-shaped
        ├── platform/             # REQUIRED DIR — env, storage, logger, toast, queryClient
        ├── domains/              # REQUIRED DIR — entity-level operations
        ├── screens/              # REQUIRED DIR — per-screen orchestration
        ├── bff/                  # REQUIRED DIR — backend-for-frontend composition
        ├── generated/            # REQUIRED DIR — the API CONTRACT (types + client interface)
        └── mocks/                # mock data + mock client implementation
```

### 1.1 The four rules of the layering

1. **Screens never import screens.** A screen composes `reusables` +
   `ui/navigations` + `services/screens`. Zero cross-screen imports — enforced
   by an ESLint `no-restricted-imports` rule, not by discipline.
2. **`services/` never imports `ui/`.** The data layer has no knowledge of
   components. This is what makes it testable without a DOM, and it is why the
   mock layer is a legitimate place for business-shaped data.
3. **`reusables/` are presentational.** Props in, UI out. A reusable that calls
   a query hook is a screen wearing a disguise.
4. **Absolute imports only**, aliased `@/` → `src/`. Plus: **no `any`** in
   `services/`, `types/` or `generated/`.

### 1.2 What each `services/` tier is for

| Tier | Responsibility | May import | Must not |
|---|---|---|---|
| `platform/` | Cross-cutting infrastructure: env flags, `localStorage` wrapper, `queryClient`, `logger`, `toast`, session/auth state | `types` | Know about any specific entity |
| `generated/` | **The contract.** Hand-authored TypeScript types for every entity and every operation the app needs, plus a `DriveDealClient` interface declaring each operation. Written against [`schema-visualizer.md`](../define/schema-visualizer.md) today; later replaced by OpenAPI codegen without changing a single call site | `types` | Contain implementations or data |
| `mocks/` | Fixture data + a `MockClient` implementing `DriveDealClient` + the mock realtime driver | `generated`, `platform` | Contain JSX or route knowledge |
| `domains/` | One module per entity (`requests.ts`, `quotes.ts`, `deals.ts`, `chats.ts`, `ai.ts`, `support.ts`, `verifications.ts`, `auth.ts`, `reference.ts`, `profiles.ts`). Each exports typed hooks + query keys over the `DriveDealClient` | `generated`, `mocks`, `platform` | Contain JSX or route knowledge |
| `screens/` | One module per screen: composes domain hooks into a view-model, owns screen-local state | `domains`, `generated`, `platform` | Contain raw data access |
| `bff/` | **Backend-for-frontend.** Composes *multiple* domain operations into the one shape a screen actually needs | `domains` | Duplicate domain logic — it composes, it does not re-fetch |

### 1.3 `types/`

Cross-cutting types that are not part of the data contract: route param unions,
the role union `'buyer' | 'dealer' | 'support' | 'admin'`, form option types,
the comparison result shapes, the realtime message union, and view-model types.
Any type mirroring a data-contract enum is re-declared here **with a
compile-time exhaustiveness check**, so adding a value breaks the build rather
than rendering a blank cell.

```ts
type AssertEqual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
type _checkFuel = AssertEqual<ContractFuel, UiFuelOption>;   // must be `true`
```

### 1.4 `helpers/`

Pure, unit-testable, no React and no I/O: `currency` (US formatting; whole
dollars for display, cents only where a breakdown demands it), `dateTime`
(relative + absolute, local zone), `validation` (shared Zod fragments), `url`
(safe external links — `https?` only, never `javascript:`), `result` (a
`Result<T, E>` for the fallible operations that legitimately fail, e.g.
geocoding a buyer's area), `match` (the pure leaderboard logic — see §2.5).

---

## 2. The mock data layer

This is the part that makes frontend-first possible. Build it before any
screen.

### 2.1 One contract, two implementations

```
domain hooks  ──►  DriveDealClient (interface, in generated/)
                        │
                        ├── MockClient        (mocks/)  ← VITE_USE_MOCKS=true
                        └── HttpClient       (platform/, later)
```

`generated/client.ts` declares every operation the app needs:

```ts
export interface DriveDealClient {
  auth: {
    login(email: string, password: string): Promise<AuthSession>;
    logout(): Promise<void>;
    getSession(): Promise<AuthSession | null>;
  };
  reference: { listStates(): Promise<State[]>; listBrands(): Promise<Brand[]> };
  requests: {
    list(): Promise<RequestSummary[]>;
    get(id: string): Promise<RequestDetail>;
    create(input: CreateRequestInput): Promise<RequestDetail>;
    publish(id: string): Promise<RequestDetail>;
    close(id: string): Promise<RequestDetail>;
    listQuotes(id: string): Promise<QuoteView[]>;
    feed(filters: FeedFilters): Promise<FeedItem[]>;          // dealer
  };
  quotes: {
    list(): Promise<QuoteView[]>;
    get(id: string): Promise<QuoteDetail>;
    create(input: CreateQuoteInput): Promise<QuoteDetail>;
    revise(id: string, input: ReviseQuoteInput): Promise<QuoteDetail>;
    accept(id: string): Promise<Deal>;
    decline(id: string): Promise<QuoteDetail>;
    withdraw(id: string): Promise<QuoteDetail>;
  };
  deals: { list(): Promise<DealSummary[]>; get(id: string): Promise<DealDetail>;
           advanceStatus(id: string, next: DealStatus): Promise<DealDetail> };
  chat: { history(quoteId: string): Promise<ChatMessage[]>;
          send(quoteId: string, body: string, id: string): Promise<ChatMessage>;
          clear(quoteId: string): Promise<void>;
          requestNegotiation(quoteId: string, body: string): Promise<QuoteDetail> };
  ai: { chat(input: AiChatInput): AsyncIterable<AiStreamEvent>;   // SSE-shaped, §2.7
        listThreads(): Promise<AiThread[]>;
        getThread(id: string): Promise<AiThreadDetail>;
        newThread(): Promise<AiThread>;
        compare(input: CompareInput): Promise<ComparisonResult>;
        previewRequest(): Promise<RequestPreview> };
  support: { listTickets(): Promise<Ticket[]>; createTicket(i: NewTicket): Promise<Ticket>;
             queue(f: TicketFilters): Promise<Ticket[]>; updateTicket(id: string, i: TicketUpdate): Promise<Ticket> };
  verifications: { list(): Promise<Verification[]>; decide(id: string, d: VerificationDecision): Promise<Verification> };
  profiles: { me(): Promise<Profile>; updateMe(i: ProfileUpdate): Promise<Profile> };
}
```

**Every screen talks to this interface and nothing else.** Swapping mock for HTTP
is a one-line change in `platform/client.ts` and touches no screen. That is the
whole architecture — do not let a `fetch` call leak into a screen.

### 2.2 The data is a real, coherent story — not random filler

Mock data is a design tool. It must describe **one believable scenario** end to
end, so that every screen has something true to display and every interaction
has a consequence. Use a single cast of characters, reused everywhere, so
thread continuity is visible when the user navigates between screens.

**Cast — all of these are the real uuids from `schema-visualizer.md`, so the
frontend and backend refer to the same entities forever:**

| Who | Id | Details |
|---|---|---|
| Buyer — Adithyaa | `250d3f1c-3f4b-4cf6-8e7f-b1c972e2237f` | `adithyaa.ma@gmail.com`, Frisco TX, sedan fan, budget ≤ $45,000, must-have `sunroof` |
| Buyer — Rahul | `bdc31c9e-f6ed-40d0-a32f-706062f81d77` | `rahul01@gmail.com`, Frisco TX, AI-inferred: Ford, SUV, 7 seats, automatic, AWD, used, min year 2021, ≤ $65,000, `['sunroof','leather','apple_carplay']`, confidence `0.92` |
| Dealer — Premium Auto Sales | `82d81b31-cf25-438c-a293-62c0ec219876` | TX, Ford + Honda, ~4.6★ |
| Dealer — Navee Motors | `6c795ae0-edb8-4546-aef2-dab9edc2221f` | WA, `hari` / `harishhey`, licence `US030202` |
| Dealer — Test 2 Motors | `55a4688d-b55f-4c6b-8d9f-4ae617d614fd` | TX, Tesla + BMW |
| Support agent | `4772bb1a-ee75-4f45-b8e6-53d70f6e42b1` | `support03@gmail.com`, TX |
| Pending dealer | `b866fe89-31a1-4b14-9247-118c83c8210c` | verification `DV1788882726` |

**The scenario, and it must be internally consistent across every screen:**

1. **Rahul** has **4 open buyer requests** (the four real rows in
   `schema-visualizer.md` §7.1 — Ford Bronco, Ford Mustang GT, Honda Jazz, BMW
   5 Series) with **6 quotes between them**, so `/requests` has a live count and
   the leaderboard is non-trivial.
2. On the **Ford Bronco** request, **Navee Motors is leading at $70,229.00** —
   the real row `118bd33a-9443-4951-a038-a3ab811284e4`, which breaks down
   exactly: `65345 + 800 + 4084 + 0 − 0 = 70229`. **Premium Auto Sales and Test
   2 Motors are higher**, so both show `Revision may be needed`. Every
   arithmetic identity in the data must actually hold.
3. On the **Honda Jazz** request, Rahul has **already accepted** Premium Auto
   Sales' quote — the real row `2fa7ac94-…`, `32600 + 150 + 2038 + 203 − 0 =
   34991`, `status: accepted`. This drives the Orders page, the deal status
   stepper, and the dealer's contact reveal.
4. That accepted deal has a **chat thread** seeded with the real messages from
   `schema-visualizer.md` §7.3 — including the buyer's *"I have accepted your
   quote!"* and the dealer's *"2days"* — plus 4 more you write, so the thread
   renders with real texture and the dealer has something to reply to.
5. **Adithyaa** has 1 request with **0 quotes**, so the buyer's empty state is
   also demonstrable.
6. **Dealer Premium Auto Sales** has 5 quotes in `pending`, one `accepted`, and
   one showing `Revision may be needed` — which is what makes their `/quotes`
   list and their dashboard KPIs real numbers rather than zero.
7. **Tickets**: `TIC-316519` (customer, *"The web page was more slow"*, `new`)
   and `DS9940692696` (dealer, *"Bidding is not working properly"*,
   `in-progress`) — both real, with their real `notes` and `rca` text. These are
   the exact records that give the support console something real to render.
8. **Verifications**: `DV1788793917` `pending`, `DV1788882726` `approved`,
   `DV1788278835` `denied`, `SA97379` agent `approved`. All real ids, so the
   queue shows every state at once.
9. **AI threads with real AI replies** for Rahul — the advisor must be
   demonstrable with zero typing, so seed **4 sessions** with written-out
   transcripts, not placeholders:

   | Session | Title | Shape it demonstrates |
   |---|---|---|
   | 1 | *"Ford SUV under $65k with 7 seats"* | **4 messages** — crosses into expanded mode, and ends with the **request preview** mid-confirmation |
   | 2 | *"Is the 2022 Bronco Big Bend worth it?"* | 2 messages — popover mode, a `AICarCard` reply with provenance |
   | 3 | *"Compare the two Honda quotes I got"* | 6 messages — a `CompareTable` reply with a `null` cell rendering **not reported**, plus an inline `Accept this offer` action |
   | 4 | *"Budget pickup under $45k, AWD, sunroof"* | 8 messages — the full 4–5 turn intake ending in an **editable request preview** the buyer could submit |

   Every assistant message must be **written, coherent prose that reads like a
   competent advisor** — correct tone, no filler, no "Great question!". Each
   carries `provenance` (which car row or KB fact it came from). Ragged
   `last_active_at` values, newest first.

   **`ai.chat` must not be a canned lookup.** A keyword match against seeded
   replies is a dead end the moment a user types anything else. Implement a
   deterministic mock **classifier** mirroring `solution-backend.md` §10.2:

   - match `intent` (car lookup / comparison / request building / price /
     review / spec) and pull the right fixture, so *"compare these"* returns the
     comparison fixture mid-conversation
   - **name a specific car and the reply cites that car's real row** — price,
     mileage, rating, and `"mileage not reported"` where the column is null
   - stream the reply in **25–40 ms chunks** with a typing indicator, so the
     streaming path in §6.4 is real
   - emit the **same `status` phases the backend will send**, on the same timing
     model — see §2.7. The mock is where the thinking indicator gets designed
   - during intake, **accumulate fields** across turns and echo the growing
     `buyer_preference` so the 3-message→full-advisor transition has content to
     carry over
   - a buyer-supplied **budget or spec that contradicts the fixtures** gets an
     honest *"I don't have a match for that in the current inventory"* — never
     a fabricated car
   - `ai.compare` and `ai.previewRequest` are real operations over the seeded
     quotes and preferences, not stubs
10. **`cars` inventory**: 12 listings across Honda, Ford, BMW, Tesla, Mercedes-Benz
    and McLaren with the observed body-type mix (SUV, Sedan, Hatchback, Coupe,
    MUV, Luxury, Sports Car, Crossover, Convertible, Supercar), real-ish years
    2021–2026, prices $19,900–$260,000, ratings, and 2–5 reviews each. Include
    at least one listing with a **missing `mileage`** and one with **no reviews**,
    so "not reported" rendering (§5) is exercised by real data.

**Every `created_at` must be plausible relative to "now"** — the UI shows
relative timestamps ("2 hours ago", "Revision needed 3 days ago"), and fixture
dates frozen at build time will read as wrong. Compute them as offsets from the
current date at module load, not as hard-coded strings.

### 2.3 `generated/` types must match the schema exactly

The mock data is only useful if its shape is the shape the backend will return.
So `generated/types.ts` is transcribed from
[`schema-visualizer.md`](../define/schema-visualizer.md), column for column:

- `Profile`, `State`, `Brand`, `BuyerRequest`, `Quote`, `Deal`, `ChatMessage`,
  `Ticket`, `Verification`, `AiThread`, `Car`, `BuyerPreference`, `ComparisonResult`.
- `role`: `'buyer' | 'dealer' | 'support' | 'admin'`
- `buyerRequestStatus`: `'draft' | 'open' | 'closed' | 'expired' | 'fulfilled'`
- `quoteStatus`: `'pending' | 'negotiating' | 'accepted' | 'declined' | 'withdrawn' | 'expired'`
- `dealStatus`: `'paperwork_going_on' | 'funds_arrived' | 'dispatch' | 'delivery' | 'completed' | 'cancelled'`
- `timeline`: `'ASAP' | 'Within 1 week' | 'Within 2 weeks' | 'Just exploring'`
- `fuel`, `transmission`, `drivetrain`, `condition`, `bodyType` — the controlled
  vocabularies from `schema-visualizer.md` §11, verbatim. **Do not invent values
  or spellings.** `Mercedes` and `Mercedes-Benz` are one brand.
- **Money is a `string`.** `final_price: "70229.00"`. Not a number — never
  parse a money value as a float (§7.3).
- Nullable columns are `| null`, not optional. A `null` spec must render as
  **"not reported"**, never as an empty cell or a zero.
- Geolocation is `{ lat: number; lng: number }` plus a display `area` string.

> **This file is the contract the backend is held to.** When the backend is
> built, `HttpClient` must satisfy `DriveDealClient` exactly. A mock field the
> backend omits, or a backend field the mock never had, is a defect in one of
> them — not something a screen should paper over.

### 2.4 Mock behaviour must be more than static data

Static arrays are not a mock. The product is interactive; the mocks must
reproduce the **rules** so those interactions are real:

| Operation | Mock behaviour |
|---|---|
| `create` / `revise` / `accept` / `advanceStatus` | Mutate the in-memory store, so state persists across navigation and a refresh within the session |
| `accept` | Transactional: the quote becomes `accepted`, `accepted_at` is set, the request becomes `fulfilled`, **every sibling quote becomes `declined`** |
| `revise` | Recompute the out-the-door total, re-rank the leaderboard, and set the correct `revision_needed` flags on the other dealers |
| `advanceStatus` | Enforce the legal transition order; reject an illegal jump with a `422 ILLEGAL_TRANSITION` |
| `login` | Accept three seeded credentials — one per persona — and reject anything else with `401 INVALID_CREDENTIALS`. Support a **role switcher in dev only**, gated on `import.meta.env.DEV` |
| `getSession` | Return the persisted session, so a refresh keeps you signed in |
| Every call | **Simulated latency of 200–600 ms** (see §2.5) |

**Persist the store to `localStorage`** so a refresh does not reset the demo
halfway through, with a `Reset demo data` action in a dev-only footer. The whole
narrative must survive a reload.

### 2.5 Latency, errors and the leaderboard rule

**Latency simulation is not optional.** Without it, every screen is developed
against an instant, unrealistic data source and the loading skeletons, the
disabled submit states, the 240 ms minimum-display guard and the optimistic
update rollbacks all get built wrong. Simulate:

- list reads 200–400 ms, single-record reads 150–300 ms, writes 350–600 ms
- **jitter**, so the UI is never mechanically uniform
- occasional **600–1,200 ms** on one request in twenty, to exercise skeletons
- a `?chaos` URL flag that forces errors and slow responses on demand

**Errors must be reachable**, otherwise error states are built blind. Every mock
operation must be able to return the real envelope:

```json
{ "error": { "code": "ILLEGAL_TRANSITION", "message": "…", "request_id": "…" } }
```

Every screen must be demonstrable in its error state.

**The leaderboard is pure logic, in `helpers/match.ts`, and must be unit tested** —
it is the product's most consequential calculation and it is trivially
regression-testable:

```ts
// Sort by out-the-door total ascending; ties broken oldest-first.
sortLeaderboard(quotes)                                  // ORDER BY final_price ASC, created_at ASC
markLeader(quotes)      // exactly one is_leading = the first after sorting
markRevisionNeeded(quotes)  // non-leading AND below the leading total
computeOtd({ vehiclePrice, docFee, salesTax, titleReg, tradeInCredit })
  // vehiclePrice + docFee + salesTax + titleReg - tradeInCredit
```

A test must assert that exactly one quote is `is_leading`, that ties break on
creation time, and that `computeOtd` reproduces the real figures in §2.2
(`70229.00` and `34991.00`). **Both the mock client and the UI must call these
helpers** — never duplicate the arithmetic in two places.

### 2.6 Mock realtime

The buyer↔dealer chat and the live leaderboard are realtime features. Build a
`mocks/realtime.ts` that mirrors the future WebSocket protocol, so the client
side is already correct:

```ts
type RealtimeFrame =
  | { type: 'chat_message';       seq: number; at: string; data: ChatMessage }
  | { type: 'chat_request';       seq: number; at: string; data: ChatAccessRequest }
  | { type: 'chat_read';          seq: number; at: string; quoteId: string; lastReadMessageId: string }
  | { type: 'leaderboard_updated';seq: number; at: string; data: { requestId: string; quotes: LeaderboardRow[] } }
  | { type: 'deal_status';        seq: number; at: string; data: DealSummary }
  | { type: 'quote_update';       seq: number; at: string; data: QuoteSummary }
  | { type: 'request_update';     seq: number; at: string; data: RequestSummary }
  | { type: 'heartbeat';          seq: number; at: string }
  | { type: 'error';              seq: number; at: string; code: string; message: string }
  | { type: 'connection';         state: 'live' | 'reconnecting' | 'offline' };
```

One socket per tab, for everything. There is no per-conversation connection and
no `subscribe` frame — the server decides what this profile may see and pushes
only that, so the client cannot widen its own access by asking.

- An `EventBus` in `platform/` that the mock client publishes to, and the
  realtime client subscribes to. Swapping the bus for a real `WebSocket` later
  touches one file.
- **A self-conversation mode:** switching persona to a dealer and then to the
  buyer makes the dealer's messages arrive live. The entire negotiation loop is
  demonstrable with no server, which is the point.
- **A chat-request simulator.** The negotiation door is a separate state machine
  from the accept door, and it is the one a demo usually forgets. Add a dev-only
  "simulate dealer accepts the chat request" trigger so the pending → accepted
  flip, the contact unlock, and the first message arriving are all visible in
  one click.
- **An automatic revision:** while the buyer watches the Ford Bronco
  leaderboard, a mock dealer can submit a lower quote after ~20 s, so the
  re-ranking without a refresh is visible on demand. Include a dev-only
  "Simulate rival quote" trigger — this is the product's signature interaction
  and it must be easy to show.
- **A connection-drop simulator.** Realtime UX that has never lost its socket
  tells you nothing about recovery. The `?chaos` flag drops the connection; the
  client must show `Reconnecting…` and recover.

### 2.7 AI streaming and the thinking indicator — the buyer never waits on a blank screen

**This is the single most important interaction in the product.** The mock must
implement the exact SSE shape the backend will send (`solution-backend.md`
§10.8), because the frontend ships first and the streaming UI gets designed and
proven here against dummy data.

**The mock `ai.chat` returns an async iterator of the same five events:**

```ts
type AiStreamEvent =
  | { type: 'status';  phase: 'classifying' | 'searching' | 'crawling' | 'composing'; label: string }
  | { type: 'token';   text: string }        // incremental, never cumulative
  | { type: 'card';    kind: 'car' | 'compare' | 'requestPreview'; payload: unknown }
  | { type: 'sources'; items: { url: string; title: string }[] }
  | { type: 'done';    threadId: string; messagesUsed: number; expandedUi: boolean };
```

**The timing model the mock must reproduce, and why it matters:**

| Phase | Mock delay | Real cause | Label the buyer sees |
|---|---|---|---|
| `classifying` | 250–400 ms | One small classifier call | *"Understanding your question"* |
| `searching` | 400–900 ms | The generated ORM query runs | *"Checking available cars"* |
| `crawling` | 1.5–3.5 s | **A Crawl4AI fetch.** Real and slow | *"Looking this up online"* |
| `composing` | 200–400 ms | Generation begins | no label — typing indicator takes over |
| then `token` | 25–40 ms/chunk | token stream | — |

The `crawling` row is why this matters. A turn that goes online is **long**, and
if the buyer sees nothing for three seconds they assume the app is broken and
send the message again.

**The thinking indicator — design rules:**

1. **It renders inside the message list as an assistant turn**, not as a
   separate spinner over the page and not in place of the input. The composer
   stays usable — the buyer can keep typing while the agent works.
2. **A three-dot pulse, then named phases.** Dots alone for the first ~1.5 s,
   then the phase label replaces them. Dots with a phase label underneath beats
   dots alone; a spinner with no words is the traditional-site failure mode.
3. **The label is the backend's `label` field, shown verbatim** — do not
   re-derive it client-side from `phase`. One source of truth for the copy.
4. **Phases are cumulative, never jumpy.** The label may change; the bubble
   must not resize, re-measure, or shift the conversation. Fixed min-height from
   the first frame, or the layout jumps on every phase change.
5. **A `crawling` phase gets a subtle different treatment** — a small globe or
   link glyph beside the label. It is telling the user their answer depends on
   an external request, which sets an honest expectation about the wait.
6. **`aria-live="polite"` on the phase label.** A screen reader user must hear
   *"Looking this up online"*, not silence.
7. **The stop control appears the instant the first event arrives** and aborts
   the mock iterator. A half-received reply stays in the thread, marked
   `Stopped` — it is never silently discarded, and the buyer can regenerate.
8. **A 12 s watchdog.** If no event has arrived in 12 s, the indicator switches
   to *"Still working on this — you can keep typing"* rather than spinning
   silently forever. A stall must be visible as a stall.
9. **Tokens render as they arrive**, with a cursor on the in-flight bubble.
   Markdown/rich content is **re-parsed on a rAF throttle**, never per token —
   per-token markdown parsing is a visible jank source.
10. **No artificial delay after the last token.** The moment the stream ends the
    bubble is final and the composer re-enables. A fake 300 ms pause to look
    "smooth" is a lie the user feels as lag.
11. **Cards arrive as `card` events, not as prose.** When an `AICarCard` or
    `CompareTable` lands mid-reply it animates in below the text so far, and the
    text stream continues after it. The frontend must never parse the text to
    build a table.
12. **Every screen that can stream must have its streaming state designed.** The
    popover (messages 1–3) and the full `/chatbot` view have different widths
    and must both be correct — build the indicator once in `ui/reusables/` and
    parameterise it, or the two will drift.
13. **The scroll stays pinned to the newest token** while streaming, and the
    moment the user scrolls up it **stops auto-scrolling** and shows a
    *"Jump to latest"* pill. Yanking the viewport back is hostile.

**Failure states are part of the contract.** A `?chaos` trigger must be able to
fail mid-stream — after a few tokens — and the UI must keep the partial text,
show a small inline *"Couldn't finish that reply"* with a `Try again` action,
and leave the thread usable. A stream that dies open is the worst outcome in
this whole section.

**Accessibility, non-negotiable:** the growing bubble carries
`aria-live="polite"`; a user who cannot see the animation is told the reply is
arriving. The composer is never disabled during a stream — they can type the
next message, and it sends when the stream closes.

## 3. Routing

### 3.1 Common

| Path | Screen | Access |
|---|---|---|
| `/` | **Loading / splash** — a real animated brand moment, not a spinner, resolving in 400–900 ms then routing on | public |
| `/signup` | **Account type selection** — two large choices: Buyer or Dealer. Routes to the correct signup form. Support path is never listed | public |
| `/signup/buyer` | Buyer signup — the four-field form | public |
| `/signup/dealer` | Dealer signup — the long dealership form | public |
| `/signup/support` | **Support agent signup — the manual-approval form. Unlinked from public navigation, direct URL only** (§3.6) | public |
| `/terms`, `/privacy` | The actual Terms and Privacy documents. Signup links to them; they are real pages, not modals | public |
| `/login` | **One** login page. Role is not selected; it is read from the session after sign-in and the user is routed onward. In dev, seeded persona buttons make the three roles one click away | public |
| `/home` | **Role router.** Reads the role from the session and renders the buyer home, dealer dashboard, or support console. No role picker in the UI | authed |
| `/logout` | Action endpoint: clear session, redirect to `/` | authed |
| `/unauthorized` | 403 — explains the block in the user's own role's language | authed |
| `*` | 404 that names the real navigation instead of a dead end | public |

> **One login page, three distinct signup flows.** Login is a single page at
> `/login` — role is never chosen at login, it is read from the session. But the
> three signup flows are **separate routes** (`/signup/buyer`, `/signup/dealer`,
> `/signup/support`) with dedicated UIs. This is how real applications handle
> it: you land on a landing or login page, you choose *who you are signing up as*
> (buyer or dealer), and you are taken to that flow's dedicated page. There is no
> single "register" form that tries to serve all three personas.
>
> **The signup entry point is a role chooser, not a form.** `/signup` (no suffix)
> is a dedicated **account type selection screen** — two large, visually distinct
> choices: "I want to buy a car" (→ `/signup/buyer`) and "I represent a dealership"
> (→ `/signup/dealer`). Each choice has its own illustration, heading, and a one-
> line description. The support path (`/signup/support`) is never listed here —
> it is direct-URL only. This is the natural, real-application entry point that
> users expect: choose your role, then fill out a form tailored to that role.
>
> **The three signup forms look and feel different**, not just in their fields but
> in their visual direction: the buyer signup is warm and aspirational (you are
> here to find your next car), the dealer signup is professional and form-heavy
> (this is a business registration). Both share the same shell, the same
> `TermsCheckbox`, and the same submit rules, but the headings, the subtext, and
> the imagery must match the persona.

> **Support signup is hidden at the UI level, and that is cosmetic only.** The
> real control is authorisation: no support capability is reachable without a
> support role, and a support signup creates a *pending* verification requiring
> approval. Do not write a comment implying the UI hiding is a security
> boundary.

### 3.2 Buyer

| Path | Screen |
|---|---|
| `/profiles` | View and edit the profile, plus the AI-derived `buyer_preference` as **editable chips** — a buyer must be able to see and correct what the AI thinks they want. That is the trust contract of the advisor |
| `/requests` | The buyer's requests. Each card: spec summary, `Live`/`Pending`/`Closed` pill, **quote count badge**, leading total, leading dealer |
| `/requests/:id` | The request detail and quote leaderboard — the product's most important screen (§6.2) |
| `/orders`, `/orders/:id` | Accepted deals as orders: itemised breakdown, deal status stepper, dealer contact, documents, chat entry |
| `/chat`, `/chat/:quoteId` | Conversation list and the buyer↔dealer thread. The list must tolerate a thread that is not open yet — a pending chat request is listed as a waiting item, not a conversation |
| `/chat/requests` | **Dealer only** — the triage inbox of pending chat requests. The dealer's answer to "who is waiting on me", and the screen where `POST /chats/requests/{id}/accept` is decided. Not a chat thread list |
| `/chatbot` | The full AI advisor interface — session switcher, rich cards, inline actions. **Buyer-only** (§3.8) |

### 3.3 Dealer

| Path | Screen |
|---|---|
| `/home` | **The dashboard** (§6.3) — the numbers a dealer opens the app to see |
| `/feed`, `/feed/:requestId` | The request feed: open buyer requests, geo-filtered, with match scoring and a one-tap quote action. A dealer sees the spec and distance, **never the buyer's identity or contact** |
| `/quotes`, `/quotes/:id` | The dealer's quotes with per-quote state, the full price breakdown, the revision form, and the chat |
| `/deals`, `/deals/:id` | Won deals — the same accepted quotes, the dealer's lens |
| `/inventory` | The dealer's own `cars` listings |
| `/chat`, `/chat/:quoteId` | Same chat surfaces |

> Buyer pages say *Orders* and dealer pages say *Deals*. These are **the same
> underlying accepted quote, rendered from two sides.** Implement one
> `DealDetail` component parameterised by side. Do not build two divergent
> screens for one row.

### 3.4 Support

| Path | Screen |
|---|---|
| `/support` | Console home: queue health, open verifications, SLA-breached tickets |
| `/help-support` | The raise-a-ticket surface for buyers and dealers |
| `/tickets`, `/tickets/:id` | Role-aware — own tickets for buyers/dealers, the full filtered queue for support/admin. Detail has a timeline and an `rca` field on resolve |
| `/verifications` | The approval queue. Approve / deny / reject with a mandatory reason. **`agent` category is admin-only** |
| `/support-members` | The support roster with approval history |

### 3.5 The three signup forms and the Terms checkbox

All three forms share a shell, a `TermsCheckbox`, and the submit rules in §6.5.
They differ in length and in what happens after submit.

| Form | Fields | On success |
|---|---|---|
| Buyer | Full name, email, phone, password | Signed in. Land on `/home` |
| Dealer | Full name, email, phone, password, dealership name, branch name, dealer licence, state, address, brands sold, website | **Not signed in.** A pending state screen: *"Your dealer account is awaiting support review — you'll get an email once it's approved"* with a link back to login |
| Support | See §3.6 | **Not signed in.** The same pending pattern, worded for agent review |

#### The Terms and Conditions checkbox — required on all three

Every account-creating form ends with a required, unchecked checkbox:

> ☐ I agree to DriveDeal's [Terms of Service] and [Privacy Policy]

**Rules, all binding:**

1. **Required, and unchecked by default.** A pre-ticked consent box is not
   consent. Submit stays disabled until it is checked, and the disabled reason
   is stated — *"Accept the terms to continue"* — not left to be guessed.
2. **`Terms of Service` and `Privacy Policy` are separate links** to real routes
   (`/terms`, `/privacy`), opened in a **new tab** so a half-read document never
   destroys a half-filled form. Both pages get a last-updated date.
3. **Unchecking must re-lock submit**, immediately, with a brief shake on the
   checkbox and `aria-live` announcement. A form that still submits after
   consent is withdrawn is a legal defect, not a UI nit.
4. The checkbox sits **above the submit button, in the form's own visual rhythm** —
   not buried in a footer, and not inside a dialog that appears on submit.
5. Error state: the row renders `Accept the terms to continue` beneath it in
   `--danger`, wired via `aria-describedby`.
6. No pre-checked, no "by signing up you agree" text substitution, and no
   dark-pattern link styling — the links look like links and are reachable by
   keyboard.

### 3.6 `/signup/support` — the manual-approval agent form

**Unlinked from public navigation; reachable by direct URL only.** The form
copy is fixed product copy and is reproduced exactly:

> ### Support team accounts require manual approval
> Please provide your details below.
>
> | Field | Type | Required | Notes |
> |---|---|---|---|
> | Full Name | text | yes | |
> | Phone Number | tel | yes | US format, digits only on entry, formatted on blur — `(469) 555-0142` |
> | Location Address | text + state | yes | Free-text street line **plus** a `State` select from `reference.listStates()`. Not one combined string |
> | Any extra necessary info (optional) | textarea | no | Label it *optional*. 3 rows, placeholder *"Anything that helps us verify you"* |
> | Email address | email | yes | |
> | Create password | password | yes | **Label states "min 6 chars"** — see the note below |

**The six fields in that order, the heading, and the sub-line are the approved
product copy.** Do not add a company field, a "how did you hear about us"
select, an avatar upload, or a CAPTCHA to this form.

> **⚠️ "min 6 chars" is a product decision, and it is weak.** A 6-character
> minimum is not an acceptable password policy for an account that can reach
> customer data. Implement it as written, but **flag it to the user before
> shipping** and keep the rule in one place (`helpers/password.ts`) so raising
> it to 8+ characters plus a breached-password check is a one-line change with
> no form edits. Do not silently "fix" the copy and do not silently ship it.

**Post-submit state — this is the part that matters:**

- No session is created and no token is issued. A support signup produces a
  `users` row with `is_active = false` and a pending `agent` verification.
- The response renders a **pending screen**, not a login redirect and not an
  error. Copy: *"Your support account is pending approval. Our team reviews
  every request — you'll get an email once it's approved."* Plus the
  submitted email shown back, and a `Back to login` link.
- The button enters a real pending state, and the form is **not** reset — a
  failed submit must not lose the typed details (§6.5).
- `/unauthorized` must word itself for this case, not as a 403: *"Support
  access requires an approved account."*

### 3.7 Route guards

Three layers, in order. Skipping any one is a security or UX defect.

1. **Session layer** — no session, no access beyond `/`, `/login`, `/terms`,
   `/privacy`, and the three signup pages. Redirect to `/login?next=<path>` and
   restore `next` after login.
2. **Role layer** — the role gates route groups. A buyer hitting `/verifications`
   gets `/unauthorized`, never a blank render and never a redirect loop. **The
   AI surface is buyer-only** (§3.8) and is guarded as a route group, not merely
   hidden in the nav.
3. **Resource layer** — route guards are **not** authorisation. A buyer
   navigating to another buyer's `/requests/:id` must get a proper not-found
   state (the mock client enforces this too, or the screen will never be built
   to handle it).

In mock mode the session is a seeded object in `localStorage` holding a role.
That is fine for a demo, and it must be labelled as demo-only in the code.

### 3.8 The AI surface is buyer-only

**The advisor and the compare agent are buyer features. Dealers, support agents
and admins do not get them.** Enforce it three ways — all three, because any one
alone is bypassable:

| Layer | Rule |
|---|---|
| **Navigation** | The advisor FAB and any AI nav entry render **only** when `role === 'buyer'`. A dealer sees no floating button on any page |
| **Route** | `/chatbot` and the compare action live in a buyer-guarded route group. A dealer navigating directly to `/chatbot` gets `/unauthorized` — never a blank screen, never a redirect loop |
| **Client** | The mock `ai.*` methods **reject for a non-buyer session** with `403 FORBIDDEN_ROLE`, so the frontend's error handling is built against the real response rather than discovering the gap later |

Consequences that are easy to miss and must be honoured:

- The **dealer quote form and the dealer dashboard have no AI affordance** at
  all — not a disabled button, not a tooltip. Dealers compete on price and
  response time, and a greyed-out advisor would read as a broken feature.
- The **compare action is a buyer affordance on `/requests/:id`** (choosing
  quotes to compare) and is **not** surfaced in the dealer's `/quotes` list.
- Support agents get tickets and verifications, not an advisor. A support agent
  who asks the AI about a ticket gets a redirect to support, per
  `solution-business.md` §8.1.
- The `AdvisorWidget` and `CompareTable` components take a role prop and
  self-hide, so no screen can accidentally render them for the wrong role.

### 3.9 Every click does something, and the app never feels like a website

This is the difference between a real product and a set of pages, and it is
where most generated frontends fail hardest. Two rules, then the mechanics.

**Rule 1 — no dead controls.** Every button, link, tab, chip, row and card that
*looks* interactive **is** interactive. If an action is not available in the
current state, the control is either absent or carries a real explanation of
what would enable it. There are no `href="#"`, no `onClick={() => {}}` stubs,
and no buttons that only navigate nowhere.

| Control | Must do |
|---|---|
| Primary CTA | One per screen, top-right or in the form's natural end position. It performs its named action |
| Secondary | Real navigation, visually subordinate. Never a same-weight pair of primaries |
| Destructive | Confirm via `AlertDialog` naming the specific object — *"Decline this $34,991 offer?"* — never a generic *"Are you sure?"* |
| Card | Clickable regions get `cursor: pointer`, a hover state, keyboard focus, and `Enter`/`Space` activation. A card is a link, so it renders an anchor |
| Table row | Clickable row navigates; the row's own buttons `stopPropagation` so the row handler does not also fire |
| Nav item | The current page is visibly current (`aria-current="page"`), not just highlighted |
| Toggle / switch | Optimistic update, then rollback on failure, with the reason in a toast |
| Icon-only button | **Must have** `aria-label` and a tooltip. An unlabelled icon is not shippable |

**Rule 2 — navigation is continuous, never a hard cut.** The user should never
feel the app reload. Use the View Transitions API where available, with a Motion
fallback, and a `prefers-reduced-motion` instant path.

| Transition | Spec |
|---|---|
| Route change | 150–200 ms cross-fade, outgoing content `y: 0 → -4` and fading, incoming from `y: 8` — **subtle**. Never slide a whole page in from the side; that is a mobile pattern and reads as a template |
| Scroll position | Restore to the previous offset on back/forward, `0` on a fresh forward navigation. A back button that lands mid-page is a bug users feel but cannot name |
| Back button | Must work for **every** state change: opening a detail, opening the advisor, a dialog, a sheet, a new tab. A sheet is a route-level overlay so the browser back button closes it |
| Focus | On route change, move focus to the new `<h1>` (or the main landmark). Screen reader users must not be left at the top of a stale page |
| Deep link | Every screen is URL-addressable. The refresh button must not lose the user's place |
| Async route | The previous screen stays visible until the next one is ready — no white flash, no content popping in place. Show progress in the header's thin top bar, not a full-screen takeover |
| 404 / unauthorized | A real designed page naming the real navigation (§3.1), never a bare *"Not found"* |

**Micro-feedback on every action**, so no click is ever silent:

- Every mutation gets an **inline** pending state on the control itself
  (spinner in the button, `aria-busy`), never a global blocking overlay
- Success → a **polite toast** plus the resulting state change visible on
  screen. The toast is not the only evidence; the UI must actually update
- Failure → inline field errors where they exist, otherwise a toast with a
  **retry** action. Never a toast that merely says "something went wrong"
- Destructive actions are the only ones needing a confirm. Confirming every
  save is the annoying-website failure mode
- Keyboard and pointer must both work identically. If it only works with a
  mouse, it does not work

**Hover, focus and active on every interactive element** — 150 ms, `--border`
→ `--accent` at low opacity, never a lift-and-shadow transform on a list of
rows. A link that does not visibly respond to hover is the single most common
tell of a template.

---

## 4. Design system — the most important section

### 4.1 The brief, stated as rules

The target is **current-generation, light, editorial, confident** — the visual
register of Linear, Vercel, Arc, Stripe and Tesla's product surfaces. The
failure modes to design *against* are specific, and they are what makes a site
read as AI-generated:

| Do not | Because |
|---|---|
| Default to a dark or near-black theme | A dark-first surface is a bad user experience here. Light is the default; a dark option, if any, is opt-in and never the initial paint |
| Use harsh cold whites (`#FFFFFF` backgrounds with no warmth) | Cold clinical whites make the interface feel like a hospital admin tool. The palette is warm — `#FAFAF8` or `#FAF9F6` for the page background, not pure white |
| High-contrast harsh color pairings | High contrast hurts. The palette must feel premium and inviting — warm, confident, never aggressive |
| Purple→blue gradient heroes | The single loudest "AI website" tell |
| Glassmorphism everywhere | Glass is a special effect, not a layout system. It destroys legibility over imagery |
| Every card floating on a shadow | Cards need borders and subtle elevation. Shadow is for overlays |
| Purple as the accent | It is the default of every generated UI. Pick a colour that belongs to an automotive brand and defend it (§4.3) |
| Emoji as icons | Renders inconsistently, ignores `stroke-width`, reads as unpolished |
| Generic stock photography | Especially smiling people in headsets. A car marketplace needs cars |
| Center-aligned body copy | Left-align anything longer than two lines |
| Three equal feature cards with icons on top | The template that gives away generated output instantly |
| Inter-only typography at four weights | A single family at four weights is not a type system |
| Centered primary CTA above the fold with three feature bullets | The landing page of a template, not a product |

**The test:** if a screenshot of any page could be pasted next to a screenshot
of a different AI-generated app and be indistinguishable, the page has failed —
however correct its markup is.

### 4.2 Typography

- **Body/UI: Inter** (variable, `-apple-system` fallback chain). Precise,
  excellent at small sizes, and — critically for this product —
  **`font-variant-numeric: tabular-nums` on every price.** Columns of quotes
  must align on the decimal so they can be compared at a glance. A misaligned
  price column makes a leaderboard unreadable.
- **Display: one face with real character.** Instrument Sans, General Sans, or
  Satoshi. Used for h1/h2 and large numerals only. Do not add a third family.
- **Dashboard numerals: tabular, weight 600.** KPI tiles with proportional
  figures jitter on every update, which is unacceptable on a live dashboard.

| Role | Size / line-height | Weight | Tracking |
|---|---|---|---|
| Display (h1) | 56 / 60 | 600 | -0.02em |
| h2 | 36 / 42 | 600 | -0.015em |
| h3 | 24 / 32 | 600 | -0.01em |
| Body | 16 / 26 | 400 | 0 |
| Body small | 14 / 21 | 400 | 0 |
| Label / eyebrow | 12 / 16 | 500 | 0.08em, uppercase |
| Price (large) | 32 / 38 | 600, tabular | -0.01em |
| KPI | 44 / 48 | 600, tabular | -0.02em |

Measure: **60–75 characters** for body copy. Long lines are the fastest way to
make an interface look amateur.

### 4.3 Colour

Light-first, one accent, semantic surfaces, and a genuine dark mode built from
the same tokens rather than an afterthought inversion.

**Accent: a deep automotive blue** — something like `oklch(0.52 0.16 255)`.
Confident, trustworthy, unmistakably automotive, and **not** the default
violet. It carries meaning: this is the colour of DriveDeal's own actions, and
nothing decorative uses it.

| Token | Value | Use |
|---|---|---|
| `--bg` | `#FAF9F6` | Page — warm off-white, never clinical pure white |
| `--surface` | `#F5F4F0` | Cards, panels — slightly warmer than the page |
| `--surface-raised` | `#FEFEFE` + border | Overlays, popovers — lightest surface, still warm |
| `--border` | `#E8E6E0` | The default separator — warm gray, not cold blue-gray |
| `--text` | `#1A1916` | Headings and body — warm near-black, not pure `#000` |
| `--text-muted` | `#78716C` | Secondary — warm stone gray. Never below 4.5:1 on `--bg` |
| `--accent` | `oklch(0.52 0.16 255)` | Primary actions, active nav, links — deep automotive blue |
| `--accent-hover` | one step darker | |
| `--success` | `#16A34A` | `Deal Accepted!`, resolved, leading |
| `--warning` | `#D97706` | `Revision may be needed`, pending approval |
| `--danger` | `#DC2626` | Declined, failed, destructive |
| `--info` | `#0284C7` | Informational |

**The warm palette rule is binding.** Every background, surface and border token
must have warmth in its hue component — no pure-gray or blue-tinted neutrals.
A `#F5F5F5` card on a `#FFFFFF` page with `#E5E5E5` borders looks like a
Google Forms template. A `#F5F4F0` card on a `#FAF9F6` page with `#E8E6E0`
borders looks like a premium product. The difference is 2–3 points of warmth
in the hue, and it is the difference between a site that feels alive and one
that feels cold.

**Status colour mapping is a product rule, not a design choice:**

| State | Colour | Icon |
|---|---|---|
| `Deal Accepted!` | success | circle-check |
| `You are leading` | success | trophy |
| `Revision may be needed` | warning | alert-triangle |
| `Open` bidding window | success | circle-dot |
| `Closed` | neutral | circle |
| `Pending` / pending review | warning | clock |
| `Live` request | accent | radio |
| `Declined` / `Withdrawn` | danger | circle-x |

**Every status is colour + icon + text, never colour alone.** Roughly 1 in 12
men has a colour vision deficiency, and a red/green-only distinction is an
accessibility failure — in a product whose entire meaning is state distinction,
that is not a minor issue.

**Dark mode, if shipped**, gets its own token set (a deep charcoal `#0B0B0C`
surface with desaturated, lightened accents) — never `filter: invert()`. And it
is opt-in, persisted, and never the first paint.

### 4.4 Spacing, radius, elevation

- **4px base** — `4 8 12 16 24 32 48 64 96 128`. No arbitrary values.
- Radius: `sm 6`, `md 10`, `lg 16`, `full 9999`. Cards `lg`, buttons `md`,
  inputs `md`, pills `full`.
- Borders over shadows. A 1px `--border` plus `--surface` reads more expensive
  than a blurred drop shadow and survives dense layouts.
- Elevation is reserved for genuinely floating things — popover, dropdown,
  modal, sticky header. Three levels, the top one subtle.

### 4.5 Motion and scroll behaviour — the difference between "nice" and "generated"

Motion is what makes a site feel designed. It is also the easiest place to
produce nausea, so it has hard limits.

**Reveal on scroll.** Content arrives as it enters the viewport, not all at once
on load. `IntersectionObserver` + Motion — **not** a scroll listener, which
fires per frame and is a jank source.

```tsx
// ui/reusables/Reveal.tsx — one primitive, reused everywhere
// once: true           animate in, never re-animate on scroll-back
// amount: 0.2          trigger when 20% is visible
// y: 16               small rise; larger values feel sluggish
// duration: 0.5, ease: [0.16, 1, 0.3, 1]  (expo-out)
```

| Element | Reveal |
|---|---|
| Section heading | fade + 16px rise, 0 ms delay |
| Body copy / list | fade + rise, **60 ms stagger**, 40 ms between siblings |
| Card grid | fade + rise, **80 ms stagger**, max 6 visible (beyond that, animate as a block) |
| Full-bleed image | slow scale 1.02 → 1 over 0.8 s, or a masked wipe |
| Stat / KPI | fade + rise, and the number **counts up once** on first view (240 ms, ease-out, never looping) |

**Rules, all binding:**

1. **Maximum 16px of travel.** Anything more reads as lag.
2. **Stagger 40–80 ms.** Tighter feels mechanical, slower feels broken.
3. **Duration 300–600 ms.** Above 800 ms is a wait, not an animation.
4. **One eased curve**: `cubic-bezier(0.16, 1, 0.3, 1)`. Mixing curves is the
   fastest way to look unconsidered.
5. **Never animate on scroll-back.** Once revealed, revealed.
6. **Opacity and transform only.** Animating `width`, `height`, `top` or
   `box-shadow` forces layout or paint every frame. A performance rule, not a
   preference.
7. **`prefers-reduced-motion: reduce` is mandatory** — collapse every reveal to
   an instant, no-rise state, and disable the count-up. An app that ignores
   this makes some users physically ill.
8. **Content is never hidden behind an animation that can fail.** If JS fails,
   everything must still be visible. No `opacity: 0` left in the DOM as a
   resting state.
9. **Skeleton, not spinner, for loading**, with a **240 ms minimum display** so
   a fast response does not flash. Skeletons must match the real layout's
   geometry, or the swap is worse than the wait. **The mock latency in §2.5 is
   what makes this buildable correctly.**
10. **Nothing animates on the critical path of a form submit.** A button that
    shimmers for 400 ms before responding feels broken.

**Scroll experience:**

- A sticky header that condenses (72 → 56, border appears) after 24px. Never a
  header that hides on scroll-down and returns on scroll-up — it causes
  misclicks.
- **Scroll restoration:** top on a new route, previous position on
  back/forward. Getting this wrong makes a deep-linked detail page feel broken.
- Long lists get a real scroll container with `content-visibility: auto`
  rather than pagination the user must click through, plus "load more" at the
  tail.
- Anchor links use `scroll-margin-top` to clear the sticky header, so a jump
  never hides its target.

### 4.6 Imagery — a stated product requirement

The brief calls for excellent imagery. Concretely:

- **Car photography is the primary visual asset**, shot or generated to one
  consistent spec: 3/4 front view, neutral background, soft even light, no
  visible plate, **no text baked into the image**, consistent 4:3 for cards and
  16:9 for hero.
- **Style consistency beats per-image beauty.** A set of beautiful but
  stylistically unrelated images looks worse than a coherent, slightly plainer
  set. The 12 mock listings must share one look.
- Deterministic, meaningful **alt text** — a car listing whose alt is "car photo"
  is a dead end for a screen reader. Hero images get real alt; decorative
  imagery gets `alt=""`.
- **Always set explicit `width`/`height`** or `aspect-ratio` to prevent layout
  shift. This directly protects the p95 render target.
- Lazy-load below the fold (`loading="lazy"`, `decoding="async"`); **never**
  lazy-load the hero.
- WebP/AVIF with responsive `srcset`, and a blur placeholder derived from the
  dominant colour rather than a separate tiny asset.
- **Never** a generic smiling-persons stock photo. This is a car marketplace.

### 4.7 Microcopy

- **Describe the outcome, not the mechanism.** "We'll notify 14 dealers near
  Frisco", not "Request submitted successfully".
- **Buttons are verbs with a subject.** "Send quote", "Accept this offer", "Start
  a chat" — never "Submit", "OK", "Yes".
- **Errors say what to do next.** "Your dealer account is awaiting support
  review — you'll get an email once it's approved", not "403 Forbidden".
- **State labels match the product vocabulary exactly** — `Deal Accepted!`, `You
  are leading`, `Revision may be needed`, `Open`. These are product terms; do
  not paraphrase them in the UI.
- **No exclamation marks except `Deal Accepted!`**, which is a product term.
- US English, US currency, US phone and address formats, US state names from
  the reference data — never free text.

### 4.8 Accessibility (WCAG AA is the floor)

Keyboard reachable with a visible focus ring on every interactive element;
`aria-live="polite"` on quote and chat updates so a screen reader announces an
incoming message; labelled controls with errors wired via `aria-describedby`;
AA contrast including muted text; ≥ 44px touch targets; and **connection state
announced, not implied by a dot**.

---

## 5. Component inventory — `src/ui/reusables/`

Build these once, properly. A page that rolls its own card is how a codebase
loses visual consistency.

**Primitives** (shadcn): `Button`, `Input`, `Textarea`, `Select`, `Checkbox`,
`RadioGroup`, `Switch`, `Label`, `Form`, `Card`, `Badge`, `Dialog`, `Sheet`,
`DropdownMenu`, `Tabs`, `Tooltip`, `Popover`, `Calendar`, `Combobox`,
`Skeleton`, `Toast`, `AlertDialog`, `Separator`, `Avatar`, `Progress`, `Reveal`.

**Domain components:**

| Component | Purpose |
|---|---|
| `RequestCard` | A request in a list: spec summary, status pill, quote count, leading total |
| `RequestForm` | The full request field set, with **brand-gated model options** and inline validation |
| `QuoteLeaderboard` | The comparison table. Sticky header, tabular figures, lead and revision flags, per-row Accept |
| `QuoteBreakdown` | The five price lines plus the out-the-door total, with the derived tax line marked editable |
| `QuoteComposer` | The dealer's quote form with a live-computed total and derived sales tax |
| `RevisionBadge` | `Revision may be needed` — informative, not alarming |
| `StatusPill` | One component for every status: colour + icon + label (§4.3) |
| `DealStatusStepper` | The six-slug lifecycle |
| `DealerContactCard` | Revealed post-acceptance only. Must not render an empty shell before then |
| `ChatWindow` | Virtualised thread, optimistic bubbles, read receipts, connection state, per-side clear |
| `ChatComposer` | With the negotiation-request affordance |
| `TicketThread` | Ticket timeline plus `rca` on resolve |
| `VerificationCard` | An approval queue row with a mandatory-reason dialog |
| `DealerDashboardStats` | KPI tiles: leading %, win rate, average response time, revenue in negotiation |
| `AICarCard` | A structured car result from the agent — image, specs, price band, provenance link |
| `CompareTable` | The agent's comparison output, rendering `null` as **"not reported"** in a distinct muted style |
| `SessionList` | The AI conversation switcher |
| `AdvisorWidget` | The floating entry point (§6.4). Buyer-only, self-hiding on role (§3.8) |
| `AiPopover` | The compact three-message surface |
| `ThinkingIndicator` | The named-phase indicator from §2.7. **One component, parameterised by width** — the popover and the full view both use it, or the two drift |
| `StreamedMessage` | An assistant bubble that grows as tokens arrive, with a cursor, `Stop`, partial-on-failure and the jump-to-latest pill (§2.7) |
| `NotReported` | The single component for a missing value, so "not reported" is never spelled inconsistently |

---

## 6. Key screens in detail

### 6.1 `/requests` — the buyer's list

Card grid, newest first: the car spec line (`2024 Ford Bronco · SUV ·
Automatic`), the status pill, a **quote count badge that is the loudest element**
on the card — it is the reason the buyer comes back — the leading total in
tabular figures, and the leading dealership's name. The empty state is not an
illustration; it is one clear sentence and one primary action: *"No requests
yet. Tell the advisor what you're looking for, or post a request."*

### 6.2 `/requests/:id` — the product's centre of gravity

Three bands, in order:

1. **The request** — full spec, `Live`/`Pending`/`Closed`, quote count, days
   remaining, and when the last quote arrived.
2. **The leaderboard** — every quoting dealer side by side, sorted by
   out-the-door total ascending, ties broken oldest-first. Per row: dealership
   name and branch, the five price lines, the total, the `You are leading` /
   `Revision may be needed` state, the validity window, and **Accept**. Highlight
   the leading row with an accent left-border, not a fill.
3. **Compare** — a selection affordance over the quote checkboxes that hands the
   set to the compare agent.

**The accept flow is the product's most important interaction.** A confirmation
dialog that restates the total in full, names the dealer, states that the
dealer's contact details become visible, and explains what happens to the other
open quotes. Acceptance is irreversible, so the confirm step is not optional
friction — it is the informed-consent moment.

**The contact row under each quote, and the chat icon beside it.** This is the
one place the two chat doors are visible, and the row has three mutually
exclusive states driven by `GET /quotes/{id}/dealer-contact`:

| State | Rendered |
|---|---|
| Gate closed | Dealer's public name only. A secondary button: **"Ask to chat"**. A one-line reason: *"Contact details are shared once you accept or the dealer agrees to chat."* No chat icon — the icon renders from `contact_available` alone, never from the quote status |
| Gate closed, request `pending` | The button becomes a non-interactive `Waiting for dealer…` with the request's `requested_at` and an **"Cancel request"** link. Re-submitting is idempotent server-side, but the UI still must not offer it |
| Gate open | The full `DealerContact` block — name, verified badge, phone, email, business, and typical response time — and the **chat icon immediately beside it**, in the same row, not on a separate line. The icon opens `/chat/:quoteId` |

Two details that are easy to get wrong:

- **The gate is the server's answer, not the client's inference.** A pending quote
  whose chat request the dealer just accepted has gate closed in the old rule and
  gate open in the new one. The client must not recompute this from
  `quote.status`; it must read `contact_available`, and re-read it on a
  `chat_request` frame.
- **The "Ask to chat" sheet is a message box, not a form.** One textarea
  (`message`, ≤1000 chars) and a send. A form with "reason code" and "callback
  window" fields converts a conversation into a ticket queue. Whatever the buyer
  types is re-posted as the first chat message when the dealer accepts, so the
  copy should say so: *"This message opens the chat if the dealer agrees."*

**Realtime.** A `leaderboard_updated` frame re-ranks the table in place with a
subtle transition on the moved rows, and new quotes slide in. A polite toast
announces each one. **The buyer's count must be correct without a refresh** —
§2.6's simulator exists so this is demonstrable now. A `chat_request` frame
flips the contact row and the chat icon without a refetch.

### 6.3 `/home` for a dealer — the dashboard

Above the fold, four KPI tiles: **quotes sent (30d)**, **win rate**, **leading
%** (share of requests where this dealer holds the lowest total), and **open
negotiations**. Then the request feed with a match-score indicator, a
`Revision may be needed` alert list, and a quotes-at-a-glance panel. A dealer
opening this app has one question — *where should I spend the next hour?* — and
the answer must be on the first screen.

### 6.4 The AI advisor widget

A persistent floating action button, bottom-right, on **every buyer page**. It
must not obscure content or a scroll affordance, must respect the mobile safe
area, and must be dismissible.

- **Messages 1–3: compact popover.** A modest anchored panel, a single input, no
  session switcher. Tight and fast.
- **On message 4: it expands to the full advisor**, and the transition must be
  **explained** — *"Your conversation is getting detailed — opening full
  advisor"* — because a panel that grows with no explanation is exactly the
  jarring experience this product is trying to avoid. Morph from the FAB's
  position: the panel expands outward and the message list cross-fades into the
  full thread. **The unsent draft and the entire history survive the
  transition.**
- **The full interface** (`/chatbot`): a session sidebar (switch between previous
  conversations or start a new one), rich rendering — `AICarCard` instead of
  plain text, `CompareTable` for comparisons — and **inline actions**, so a
  suggested action is a button in the thread rather than something the user has
  to type.
- **Request assembly is a form, not a message.** When the agent has enough, it
  renders the assembled request as an **editable preview form** with an explicit
  `Create request` confirmation. Human-in-the-loop is a product requirement —
  the AI never silently posts. If the buyer would rather keep chatting, that is
  equally valid and the flow stays open.
- **The thinking indicator is specified in §2.7 and is not optional.** Named
  phases before the first token, tokens as they arrive, a `Stop` control from
  the first event, and a 12 s watchdog. A spinner with no words is exactly the
  traditional-site experience this product must not have.
- **The `crawling` phase is the long one** and the buyer must see it named.
  When the advisor goes online for a fact the database does not have, that wait
  is 2–4 s of real crawl time and it has to be visible.

### 6.5 Forms

Every form — the three signups, the request, the quote, the revision, the
ticket — follows the same rules:

- Validate on blur; re-validate on change after the first submit; submit only
  when valid.
- **Errors appear next to the field, in text, with `aria-describedby`** — never
  only as a red border, never only in a toast.
- **The submit button shows its pending state and is disabled in flight.** A
  double-submit creates two quotes.
- Mock `422` details map onto the correct fields. Branch on the envelope's
  `code`; **never parse `message`**.
- The request form's **model dropdown is gated on brand**, matching the product
  copy *"Select Make first…"*. A disabled, explained dropdown beats an
  unfiltered 200-item list.
- **Preserve entered values on a failed submit.** Losing a half-filled
  dealership application to a 500 is unforgivable.
- Mark required fields explicitly and label optional ones as *optional* — the
  product copy does this, and it removes a whole class of anxiety from long
  forms.

---

## 7. State, data fetching and realtime

### 7.1 TanStack Query conventions

- **Query key factory** per domain, so invalidation is exhaustive by type and a
  typo cannot silently miss.
- `staleTime` 30 s for reference data and 5 min for anything a user will not
  change mid-session; `0` for leaderboards, deals and tickets, which must be
  live.
- Mutations invalidate by **predicate**, not exact key — accepting a quote
  changes the request, its leaderboard, the deal lists on both sides, and the
  unread badge.
- **No data in Zustand.** Zustand holds `sidebarOpen`, `activeThreadId`,
  `activeFilters`, and the connection state. That is the entire list.
- Optimistic updates only where rollback is genuinely correct: chat sends, read
  receipts, status transitions. **An accepted quote is not optimistic** — that is
  a financial transition and the server is its authority. In mock mode the store
  is the authority, so the mock client mutates and the query invalidates.
- Every list screen handles four states explicitly: loading (skeleton matching
  the real geometry), empty (one clear sentence + one action), error (what went
  wrong + a retry), and loaded. A screen that only handles the fourth is not
  done — and the mock's latency and `?chaos` flag are what make the first three
  buildable.

### 7.2 Realtime client

A single `platform/realtime.ts` that today subscribes to the mock bus and later
subscribes to a real `WebSocket`:

- Handshake is a ticket, not a token: `POST /chats/ws-ticket` with the bearer
  token, then `GET /ws?ticket=…`. The ticket is single-use and 60 s, so it is
  fetched per connection attempt and discarded on failure.
- Reconnect with exponential backoff and jitter, capped at 30 s.
- **On reconnect, re-fetch; do not expect a replay.** The server keeps no event
  log, so the socket is a "something changed" signal only. Refetch the chats and
  collections the user was looking at. A client that assumes the socket
  back-fills missed messages will show a permanently stale thread.
- **Watch `seq`.** A frame whose `seq` is not the successor triggers an
  immediate refetch of the affected chat rather than waiting for the next frame.
- **Dedupe by message id** — the client generates `crypto.randomUUID()` and the
  id is the identity of the message, so an optimistic bubble and its echo
  reconcile exactly, and a reconnect cannot duplicate.
- **Send through one path.** `chat.send` over the socket and
  `POST /chats/{quote_id}` must go through the same optimistic-UI + dedupe code.
  The HTTP call is the fallback when the socket is down, not a second feature.
- **Surface connection state** — `Live` / `Reconnecting…` — rather than letting
  a silent channel look like "no new messages".
- Exercise it against the §2.6 drop simulator. Realtime UX that has never lost
  its socket tells you nothing about recovery.

### 7.3 Money

All money is a **string decimal from the contract**, parsed once in
`helpers/currency` and rendered with
`Intl.NumberFormat('en-US', { currency: 'USD' })`. **Never `parseFloat` a money
value for arithmetic** — binary floats lose cents, and the out-of-door total is
computed in one shared helper (§2.5) precisely so it cannot drift. Every
displayed price uses tabular figures.

---

## 8. Non-functional targets

| # | Target | How it is met |
|---|---|---|
| 1 | Lint clean at `--max-warnings=0` | ESLint flat config, zero warnings tolerated |
| 2 | Strict types | `tsc --noEmit` clean; no `any` in `services/`, `types/`, `generated/` |
| 3 | Bundle discipline | Route-level code splitting; the AI bundle is lazily loaded and never in the initial chunk |
| 4 | Image performance | AVIF/WebP, `srcset`, explicit dimensions, blur placeholders |
| 5 | No layout shift | Explicit dimensions everywhere; skeletons match final geometry |
| 6 | Fast render | Cached reference data; virtualised long lists |
| 7 | A11y | WCAG AA contrast, keyboard paths, `aria-live` on chat and leaderboard updates |
| 8 | Reduced motion | `prefers-reduced-motion` honoured globally |
| 9 | Contract integrity | A type-level test asserts `MockClient satisfies DriveDealClient`; the mock data satisfies the schema types |
| 10 | No `console.log` in production builds | ESLint rule, not a habit |

---

## 9. Next-generation frontend standard — visual, motion and interaction

This is not a checklist of things to avoid. It is the positive specification
for how the product must feel. Every screen, every scroll, every button click
must meet this bar. A page that renders correctly but feels like a static
document has failed.

### 9.1 Visual identity — badass, not bland

The product is a car marketplace. It should feel fast, confident and premium —
like opening a well-built native app, not loading a SaaS landing template.

- **Every page has a generated, contextual background image** appropriate to
  its content. The home / splash gets a wide moody automotive shot. The buyer
  requests page gets a lifestyle driving scene. The dealer dashboard gets an
  aerial dealership lot. Support gets something minimal and professional.
  These are full-bleed, subtle, never distracting — a darkened or desaturated
  layer behind the UI, not over it. They never contain baked-in text. They use
  `object-fit: cover` with an `aspect-ratio` set so there is zero layout shift.
- **No white void pages.** A screen that is entirely white cards on a white
  background with no texture, depth or colour personality is not acceptable.
  Every surface gets either a tinted `--surface` background, a subtle noise
  texture (`filter: url(#noise)` at 2% opacity), or a contextual image layer.
- **Depth without shadows.** Cards use a 1px `--border` plus a `2px` inner
  highlight on the top edge (`box-shadow: inset 0 1px 0 rgba(255,255,255,0.08)`)
  to catch light. This reads more expensive than any drop shadow.
- **Accent colour is electric, not decorative.** The automotive blue from §4.3
  must pop on every page — in active states, in the leading quote accent border,
  in the AI FAB pulse, in the status pills. It is not a subtle tint; it is the
  colour that means *"DriveDeal action here"*.
- **Typography has personality.** The display face (Instrument Sans / General
  Sans / Satoshi — pick one and commit) is used at 56 / 48 / 36 with negative
  tracking. Headings must look editorial, not generated.

### 9.2 Scroll experience — content arrives, not pops in

Scroll is the primary way users read this product. Every element that enters
the viewport must do so with intention.

**Specific entry behaviours (all via `Reveal.tsx`, using Motion):**

| Element type | Entry animation | Notes |
|---|---|---|
| Page hero / full-bleed image | Scale `1.04 → 1.00` over `0.8s` ease-out + fade | Creates a "camera pull-back" feel on arrival |
| Section heading | `y: 20 → 0`, `opacity: 0 → 1`, `0.5s` expo-out | Always the first element to enter a new section |
| Body paragraph | `y: 12 → 0`, `opacity: 0 → 1`, `0.45s`, stagger `60ms` per paragraph | Never all at once |
| Card grid (≤6 cards) | `y: 16 → 0`, `opacity: 0 → 1`, stagger `80ms` per card, `0.5s` expo-out | Cards cascade in, not all at once |
| Card grid (>6 cards) | First 6 stagger, rest animate as a batch | Past 6, per-card stagger looks mechanical |
| KPI / stat number | Fade in + count-up from `0` on first entry, `240ms`, ease-out | Once only — never loops, never re-counts on re-scroll |
| List row | `x: -8 → 0`, `opacity: 0 → 1`, stagger `40ms` | Slides in from left — suggests a feed |
| Full-bleed background image | Already visible; applies a slow `scale(1.04 → 1.00)` parallax on scroll | Not a reveal — a living background |

**Rules that cannot be broken:**
- All travel ≤ 20px. Larger values feel like the page is lurching.
- All durations 300–600ms. Nothing above 700ms.
- One easing curve: `cubic-bezier(0.16, 1, 0.3, 1)`.
- `once: true` — elements never re-animate when scrolled back over.
- `prefers-reduced-motion: reduce` collapses all of the above to an instant
  `opacity: 0 → 1` with no travel and no count-up.
- Content is never hidden behind a pending animation. `opacity: 0` is never the
  default resting state — it is only set at the moment the observer fires.

### 9.3 Buttons and interactions — every click is a moment

Buttons are not rectangles with text. Every interactive element must give
tactile, instant feedback.

**Button states — mandatory on every `<Button>`:**

| State | Visual | Timing |
|---|---|---|
| Default | Flat, `--accent` fill or `--border` outline | — |
| Hover | Background lightens `8%` + `box-shadow: 0 0 0 3px` accent at `20% opacity` | `150ms` ease |
| Active (pressed) | `scale(0.97)` + shadow collapses | `80ms` — feels tactile, like a physical press |
| Focus | `box-shadow: 0 0 0 3px` accent at `50% opacity` | Instant |
| Pending | Left-side spinner (`16px`, `1.5s` spin) + text fades to `60%` + `cursor: wait` | No layout shift — text stays; spinner overlays |
| Success | Button briefly turns `--success` for `600ms`, then returns | Gives positive confirmation without a toast for minor actions |
| Disabled | `opacity: 0.5`, `cursor: not-allowed`, and a `Tooltip` explaining *why* | Never a mystery disabled button |

**Destructive buttons** get a `--danger` hover ring and a shake animation
(`keyframes: x 0 → 4 → -4 → 2 → -2 → 0, 300ms`) if the user tries to submit
an unchecked required field.

**Icon-only buttons** render a tooltip (`Tooltip` from shadcn) on hover/focus,
always, and have `aria-label`. No exceptions.

### 9.4 Page transitions and navigation — no hard cuts

Navigating between routes must never feel like a page reload.

- **Route change:** 150–200ms cross-fade. Outgoing content: `opacity: 1 → 0`,
  `y: 0 → -6`. Incoming content: `opacity: 0 → 1`, `y: 8 → 0`. Subtle —
  the user should not consciously notice it, but they will notice its absence.
- **Sheet / drawer open:** slides in from the appropriate edge over `250ms`
  expo-out, with a `backdrop-blur(8px)` scrim that fades in separately.
- **Dialog open:** scales `0.96 → 1.00` + fades over `200ms`. Dialog
  backgrounds scrim with `rgba(0,0,0,0.4)` fading in at `150ms`.
- **Accordion / expand:** content height animates via `layout` in Motion — no
  `max-height` hacks that clip or flash.
- **Tab switch:** active indicator slides with a `layoutId` shared element
  transition. The content cross-fades.
- **Back navigation:** the previous screen's scroll position is restored.
  Instant scroll restoration, no animation — the user is returning, not
  arriving.
- **Async route:** the previous screen stays visible while the next loads.
  A thin accent progress bar runs across the top of the viewport (not a full-
  screen spinner). Once the next screen is ready, the cross-fade happens — no
  white flash, no content popping.

### 9.5 Micro-interactions — the texture of a real product

These are the interactions that users feel but cannot name. Their absence is
what makes a site feel hollow.

| Interaction | Behaviour |
|---|---|
| Card hover | `translateY(-2px)` + border shifts to `--accent` at `30%` opacity over `150ms`. Never a large lift — a card is not a button |
| Row hover | Background `--surface` → `--surface-raised` at `100ms`. No transform |
| Badge / pill hover | Border brightens, background fills at `10%` of the badge colour |
| Input focus | Border `--border` → `--accent`, `box-shadow: 0 0 0 3px` accent at `15%`. Label slides up and shrinks if floating-label pattern is used |
| Switch toggle | Thumb slides with spring physics (`stiffness: 300, damping: 20`). Background fills in the opposite direction simultaneously |
| Toast entry | Slides in from bottom-right, `y: 16 → 0`, fades. Stacks with `y` offset so multiple toasts are distinguishable. Auto-dismiss with a sweep progress bar on the toast itself |
| Leaderboard re-rank | Rows animate to their new `y` positions with a `layout` transition. The new leader row gets a brief `--success` pulse on its left accent border |
| Quote count badge | When count increments via realtime, the badge does a `scale(1 → 1.3 → 1.0)` pop in `200ms` with an accent colour flash |
| AI FAB (the advisor button) | A subtle idle pulse: `box-shadow` breathes from `0 0 0 4px accent@20%` to `0 0 0 8px accent@10%` on a `2s` loop. Stops on hover. Never a spinning ring |
| Skeleton loading | Shimmer sweeps left to right on a `1.5s` loop. Skeleton shapes must match the real content geometry within `±8px` so the swap is invisible |
| Scroll-to-top | A floating pill appears after 400px scroll: `↑ Back to top`. Fades in, fixed position, does not overlap the AI FAB |

### 9.6 Page-specific visual direction

Each page must feel intentional, not like a generic CRUD form.

| Page / screen | Atmosphere | Specific directive |
|---|---|---|
| `/` splash | Dark, cinematic | Full-viewport generated automotive shot — a car in motion, shot at dusk or under dramatic light. The DriveDeal wordmark in the display face, centred, crossfades into `/login` after the brand moment. No CTA, no bullets, no hero copy beyond the name |
| `/login` | Minimal, confident | Split layout: left half a large generated image (cars, dealership, or driver), right half the form on `--bg`. No decorative cards, no feature lists |
| `/signup/buyer`, `/signup/dealer` | Clean, editorial | White form on `--bg`, the display face heading at large size, a thin accent top-border on the form card. The generated image is subtle — a background, not competing |
| `/home` (buyer) | Warm, active | A contextual driving/lifestyle image in the hero band. Requests grid below with animated entry. The AI FAB pulses gently in the corner |
| `/home` (dealer) | Focused, data-driven | The four KPI tiles are large, tabular, and the first thing in the viewport. Below: the feed and revision alert list. No imagery competing with the numbers |
| `/requests/:id` | Authoritative | The leaderboard is the centrepiece. Rows are dense but readable. The leading row has an accent left-border glow — `box-shadow: inset 3px 0 0 --accent`. No full-bleed image here — data takes precedence |
| `/chatbot` | Ambient, intelligent | A very dark or very desaturated background image — abstract, automotive, or spatial. The thread floats on a semi-transparent `--surface` panel. The AI indicator must feel premium, not spinner-like |
| `/orders/:id` | Progress-forward | The `DealStatusStepper` is the hero. Each stage lights up as it activates. The currently active stage pulses with the accent colour |
| `/feed` (dealer) | Dynamic, scan-friendly | Cards have a match-score indicator on the left edge — a coloured bar proportional to the match score, `--success` → `--warning` gradient. Distance and spec are the primary data |

### 9.7 Generated background images — specification

Every page gets a contextual background. These are not stock photos of people.
They are atmospheric, on-brand automotive images generated once, optimised, and
served from `src/assets/backgrounds/`.

**Required images and their tone:**

| File | Used on | Visual brief |
|---|---|---|
| `splash-hero.jpg` | `/` splash | Car in motion, dramatic angle, dusk or dawn light, shallow depth of field, no visible faces, no text |
| `login-split.jpg` | `/login` | Dealership interior or a hero car in a showroom, clean and premium |
| `buyer-home-hero.jpg` | Buyer `/home` hero band | Lifestyle driving — wide shot, open road, aspirational |
| `dealer-dashboard-bg.jpg` | Dealer `/home` background | Aerial or wide dealership lot at golden hour — conveys scale |
| `chatbot-bg.jpg` | `/chatbot` background | Abstract automotive detail — steering wheel, grill, exhaust blur — desaturated, very dark |
| `orders-bg.jpg` | `/orders` header | A car being driven away from a dealership — the handover moment |
| `support-bg.jpg` | Support screens | Minimal office or abstract — neutral, professional |

**Technical requirements, all binding:**
- Every image is WebP with an AVIF alternative: `<source type="image/avif">` in
  a `<picture>` element, or via `srcset`.
- `loading="eager"` on the above-fold hero; `loading="lazy"` on everything else.
- Explicit `width` and `height` attributes (or `aspect-ratio` CSS) on every
  `<img>`. Zero layout shift is a hard requirement.
- `alt=""` on purely decorative background images — they carry no information.
- The image is darkened via a CSS overlay (`::after` with `rgba(0,0,0,0.45)`)
  so text above it always meets AA contrast without touching the image file.
- Blur placeholder: an inline `background-color` matching the image's dominant
  colour, replaced by the image on load. Never a separate tiny blurred asset.

### 9.8 The standard — stated plainly

A screenshot of any screen in this product, shown to someone who has never
heard of DriveDeal, must make them think: *"This looks like a real, funded,
well-designed product"* — not *"this looks like a generated template with some
content in it."*

The difference is texture. Real products have:
- images that belong to the page, not placeholder rectangles
- scroll behaviour where content arrives with intention, not all at once
- buttons that respond instantly and tactilely to every interaction
- navigation that never feels like a reload
- typography that has been chosen and sized, not defaulted
- colour that carries meaning and has personality

Every one of those is specified above. Build them all.

---

## 10. Responsive design — every viewport, every ratio

The product must be fully functional and visually correct at every breakpoint.
Not "mobile-friendly" in the sense of stacking things vertically — genuinely
designed for each context, so a phone user has a real product experience and a
widescreen user does not see content stretched to illegibility.

### 10.1 Breakpoint system

Use Tailwind's breakpoint scale, committed to exactly these values:

| Token | Min-width | Target context |
|---|---|---|
| (default) | 0px | Mobile portrait — `320px` minimum supported width |
| `sm` | 640px | Mobile landscape, small tablet |
| `md` | 768px | Tablet portrait |
| `lg` | 1024px | Tablet landscape, small laptop |
| `xl` | 1280px | Standard laptop / desktop |
| `2xl` | 1536px | Large desktop, widescreen |

**No hardcoded pixel widths in components.** Every layout uses responsive
Tailwind classes (`grid-cols-1 md:grid-cols-2 xl:grid-cols-3`) or `clamp()`
for fluid typography. A component that works at `xl` but breaks at `sm` is not
done.

### 10.2 Layout behaviour at each breakpoint

**Navigation:**

| Viewport | Behaviour |
|---|---|
| Mobile (`< md`) | Bottom navigation bar with 4–5 icon + label items. The hamburger drawer is for secondary nav only — the primary actions must be one tap away, not hidden |
| Tablet (`md–lg`) | Collapsible left sidebar, icon-only by default, expands on hover or tap |
| Desktop (`≥ lg`) | Persistent left sidebar with icon + label. Collapses to icon-only via a toggle that is remembered in Zustand |

The sticky header condenses on all viewports (§4.5). On mobile, the header
shows the logo and a profile avatar only — no nav items compete for the 375px
width.

**Content grids:**

| Grid | Mobile | Tablet | Desktop |
|---|---|---|---|
| Request cards | 1 column | 2 columns | 3 columns |
| Dealer feed | 1 column | 2 columns | 3 columns |
| KPI tiles (dealer) | 2 × 2 | 4 in a row | 4 in a row |
| Car inventory | 1 column | 2 columns | 3–4 columns |
| Quote leaderboard | Stacked cards (each quote is a card) | Stacked cards | Full table with sticky header row |
| AI chat + session list | Chat only (session list is a sheet) | Side-by-side, 280px sidebar | Side-by-side, 320px sidebar |

**The leaderboard on mobile is a special case.** A horizontal table with 6
columns does not fit on 375px. On `< lg` the leaderboard renders each quote
as a card: dealer name + status pill on top, the 5 price lines stacked, the
out-the-door total prominent, and the Accept button at the bottom. On `≥ lg`
it switches to the full table layout. The underlying data is identical — only
the presentation changes.

### 10.3 Typography scales with the viewport

Use `clamp()` for display sizes so type never overflows on small screens and
never looks undersized on large ones:

```css
/* Display h1 */
font-size: clamp(2rem, 5vw, 3.5rem);      /* 32px → 56px */
/* h2 */
font-size: clamp(1.5rem, 3.5vw, 2.25rem); /* 24px → 36px */
/* h3 */
font-size: clamp(1.25rem, 2.5vw, 1.5rem); /* 20px → 24px */
/* Body — fixed, never fluid */
font-size: 1rem; /* 16px always */
/* Body small — fixed */
font-size: 0.875rem; /* 14px always */
```

Body text stays at `16px` on all viewports. Scaling body text smaller on
mobile is a legibility failure, not a space optimisation.

The **60–75 character measure** (§4.2) is enforced with `max-w-prose` on body
copy containers. On wide desktops, text columns must not stretch to 1200px —
that is unreadable.

### 10.4 Touch targets and mobile interaction

- **Minimum 44 × 44px tap target** on every interactive element, enforced via
  `min-h-[44px] min-w-[44px]` or padding. This applies to icon buttons, nav
  items, checkboxes and radio buttons — not just primary buttons.
- **No hover-dependent interactions on touch devices.** Tooltips that only
  appear on hover must also appear on long-press (or be replaced with visible
  labels on mobile). Information hidden behind hover is inaccessible on a
  touchscreen.
- **Swipe gestures where natural:** the chat thread supports swipe-to-reply on
  mobile. The session sidebar opens/closes with a horizontal swipe. These are
  enhancements — the tap equivalent must always exist.
- **The AI FAB (§6.4)** respects the iOS and Android safe area insets:
  `padding-bottom: env(safe-area-inset-bottom)`. It must not sit behind the
  home bar on modern iPhones.
- **Form inputs on mobile** must not trigger an unintended zoom. Set
  `font-size: 16px` on all `<input>` and `<textarea>` elements — iOS Safari
  zooms the viewport when an input's font-size is below `16px`, which is
  hostile on a half-filled form.
- **Scrollable containers** use `-webkit-overflow-scrolling: touch` (or
  `overscroll-behavior: contain`) so list scroll does not bubble to the page.

### 10.5 Background images across viewports

The contextual background images from §9.7 must be cropped and sized for each
viewport, not just scaled:

```html
<picture>
  <source media="(min-width: 1280px)" srcset="buyer-home-hero-xl.avif" type="image/avif">
  <source media="(min-width: 1280px)" srcset="buyer-home-hero-xl.webp" type="image/webp">
  <source media="(min-width: 768px)"  srcset="buyer-home-hero-md.avif" type="image/avif">
  <source media="(min-width: 768px)"  srcset="buyer-home-hero-md.webp" type="image/webp">
  <source srcset="buyer-home-hero-sm.avif" type="image/avif">
  <img src="buyer-home-hero-sm.webp" alt="" loading="eager">
</picture>
```

The mobile crop is portrait-friendly — it must not show only the empty sky
that the landscape crop puts at the top. Every background image has three
crops: `sm` (portrait, square-ish), `md` (landscape tablet), `xl` (wide
desktop). The CSS overlay (§9.7) applies at all sizes.

### 10.6 Scroll animations on mobile

The Motion `Reveal.tsx` component works identically on mobile — `amount: 0.2`
triggers when 20% of the element is visible, which is the same on a phone.
The only mobile-specific rule: **stagger delays are halved on `< md`**.

On a phone, staggered cards that appear 80ms apart across a full-width single
column feel slow because the user scrolls through them sequentially. At
`< md`: card stagger is `40ms`, paragraph stagger is `30ms`. At `≥ md` the
full values from §9.2 apply.

`prefers-reduced-motion` still collapses everything to instant regardless of
viewport.

### 10.7 The split layouts

Two screens use a side-by-side split that collapses on mobile:

**Login (`/login`):** at `≥ lg` — image left, form right. At `< lg` — form
only, full width, with a subtle background image behind it at reduced opacity
(`0.15`). The image panel is never shown at tablet or mobile widths because
it competes for space the form needs.

**AI chatbot (`/chatbot`):** at `≥ md` — session sidebar left, chat right.
At `< md` — chat full screen, session list accessible via a `Sessions` button
in the header that opens a bottom sheet. The session list is never hidden
entirely; it is just repositioned.

### 10.8 Specific mobile screens that need individual attention

These screens have non-trivial mobile layouts and must be designed explicitly,
not just stacked:

| Screen | Mobile-specific design |
|---|---|
| `/requests/:id` leaderboard | Card-per-quote layout (§10.2). The Accept button is full-width, bottom of card. Compare checkboxes appear at top-right of each card |
| `/chatbot` | Bottom-anchored composer, `env(safe-area-inset-bottom)` padding, keyboard-aware scroll — the thread scrolls up when the keyboard opens, composer stays visible |
| `QuoteComposer` (dealer) | Two-column price breakdown collapses to single column. The live-computed total stays pinned at the bottom as a sticky summary bar |
| `DealStatusStepper` | Vertical stepper on mobile (not horizontal). Each stage is a row with the stage name, date, and status icon |
| `ChatWindow` | Full-height on mobile. The `DealerContactCard` collapses into a tappable summary chip at the top of the thread, expanding on tap |
| Navigation (bottom bar) | Maximum 5 items. Labels visible at all times — no icon-only bottom nav, which fails discoverability on first use |

### 10.9 Responsive QA — the minimum test matrix

Before any screen is called done, it must be verified at these exact viewport
widths:

| Width | Context |
|---|---|
| `375px` | iPhone SE / small Android — the tightest common phone |
| `390px` | iPhone 14 / 15 Pro — the most common phone size |
| `430px` | iPhone 14 / 15 Plus — the wide phone |
| `768px` | iPad portrait |
| `1024px` | iPad landscape / small laptop |
| `1280px` | Standard 13" laptop |
| `1440px` | Standard 15" laptop / external monitor |
| `1920px` | Full HD desktop |
| `2560px` | 2K / ultrawide — content must not stretch or look sparse |

At every width: no horizontal scroll on `<body>`, no text overflow, no
overlapping elements, no images without `alt` or dimensions, no tap target
below 44px, and no content hidden behind the safe area or sticky header.

---

## 11. Definition of done — frontend

1. All 13 CI-enforced directories exist; Stage 2 passes.
2. `npm run build` produces a `dist/`; `tsc --noEmit` and `eslint` are clean at
   `--max-warnings=0`.
3. `package.json`, `package-lock.json` and `serve.json` exist, since the
   Dockerfile `COPY`s all three and the build fails without them.
4. `MockClient satisfies DriveDealClient` compiles; `generated/types.ts` matches
   `schema-visualizer.md` column for column, with the controlled vocabularies
   verbatim and money typed as `string`.
5. The §2.2 scenario is fully present and internally consistent — the
   out-of-door arithmetic in the fixtures is correct, the cast is reused across
   screens, and relative timestamps are computed rather than frozen.
6. `helpers/match.ts` is unit tested: one leader, ties on creation time,
   `computeOtd` reproducing `70229.00` and `34991.00`, and the UI calling the
   same helpers rather than duplicating the math.
7. Every mock operation simulates latency with jitter, can return the real error
   envelope, and mutates persisted state so a refresh does not reset the demo.
8. Every route in §3 exists, is guarded on all three layers, and handles loading,
   empty, error and loaded.
9. Screens contain no cross-screen imports; `services/` contains no JSX; ESLint
   makes both fail the build.
10. No server data lives in Zustand.
11. Leaderboard and chat update via the realtime client with no refresh,
    including across a simulated disconnect, and messages reconcile by id with
    no duplicates.
12. The advisor expands from popover to full interface on message 4, preserves
    the transcript and the draft, and **explains** the transition.
13. AI request assembly renders an **editable** confirmation form; publishing
    requires an explicit user action.
14. The dealer contact block is **absent** — not blank — while the contact gate
    is closed, and the chat icon renders from `contact_available` alone.
15. Both chat doors work end to end: accept-then-chat, and
    request → dealer accepts → chat. The pending state is visible and the
    contact never appears before the gate opens.
16. Every reveal respects `prefers-reduced-motion`; no animation exceeds 16px of
    travel or 600 ms; nothing animates on a form's critical path.
17. Every image has correct alt text and explicit dimensions.
18. All statuses render colour + icon + text, never colour alone.
19. Every price uses tabular figures; money is never parsed as a float.
20. `/signup/support` is unlinked from public navigation, and no comment implies
    that UI hiding is a security boundary.
21. The §9 standard is met: every page has a contextual background image, every
    scroll reveal uses the specified motion parameters, every button has all
    required interaction states, navigation never causes a hard cut, and a
    screenshot of any screen reads as a real, well-designed product rather than
    a generated template.
22. Every screen passes the §10.9 responsive QA matrix: no horizontal scroll,
    no overlapping elements, no tap targets below 44px, correct layout at all
    nine tested widths from 375px to 2560px. The leaderboard renders as cards on
    mobile and as a table on desktop. The AI chatbot repositions its session
    list on mobile. No `font-size` below `16px` on form inputs.

---

## 12. Handover — what the backend must honour

When the backend is built, the integration is: implement `HttpClient` against
`DriveDealClient`, swap it in `platform/client.ts`, and set
`VITE_USE_MOCKS=false`. **No screen changes.**

For the backend author, five commitments from this file are binding:

1. **The types in `src/services/generated/types.ts` are the response contract.**
   Field names, nullability, the controlled vocabularies, `money as string`, and
   the `role` union are fixed. A backend field the mock never had, or a mock
   field the backend omits, is a defect in one of them — not something a screen
   should absorb with a fallback.
2. **The error envelope is fixed** — `{ error: { code, message, details, request_id } }`.
   The UI branches on `code` and never parses `message`.
3. **The realtime frame union in §2.6 is the wire format**, message id included.
   The frontend already dedupes and reconnects against it. It is **push-only**:
   the frontend refetches on reconnect and does not expect the server to replay
   missed frames, so a backend that adds a replay endpoint is building something
   nothing calls.
4. **The AI stream event union in §2.7 is the wire format** for `POST /ai/chat`.
   It must arrive as **SSE**, and the **first event must be a `status`** — the
   thinking indicator in `ThinkingIndicator` renders the backend's `label`
   verbatim and has nothing to show without it. A non-streaming reply, or one
   that opens with a long silence, breaks a component the frontend has already
   built and shipped. The `crawling` phase is expected to be slow: the backend
   uses Crawl4AI, so 2–4 s of real fetch time is normal and the UI is designed
   to make that wait legible rather than hidden.
5. **`ai.*` is buyer-only**, and the client already rejects for other roles with
   `403 FORBIDDEN_ROLE` (§3.8). The backend must not expose these to dealers or
   support agents.
6. **The contact gate is one server-side predicate, and the chat icon follows
   `contact_available` from `GET /quotes/{id}/dealer-contact`.** The frontend
   never infers the gate from the quote status on its own — if it did, the two
   would drift the first time a chat request opened a chat on a `pending` quote.
   Before the gate opens the endpoint must 403 with
   `DEALER_CONTACT_WITHHELD` and the chat routes 403 with `CHAT_NOT_OPEN`, not
   return empty collections.
7. **Chat send has two transports and one implementation.** `POST /chats/{quote_id}`
   is the fallback and the WS `chat.send` frame is the fast path; both must run
   the same authorization, dedupe, and `deal_history` code, and both must
   return/ack 201 on a duplicate `id` so the client's retry cannot double-post.
8. **`GET /openapi.json` and `GET /docs` are unauthenticated.** They are the
   pinned contract URL and the UI that renders it. Putting either behind a bearer
   token makes them unlinkable for exactly the integrators who need them first.

The mock layer is not scaffolding to be deleted. It is the executable
specification the backend is tested against, and it stays in the repo as the
test harness for every screen.
