# API Audit — Backend Coverage vs Frontend Usage

Date: 2026-10-01

## Verdict

**No backend APIs need to be built.** Every operation the frontend screens perform (or should perform) already has a matching, working FastAPI endpoint. The gap is entirely on the frontend side: the `DriveDealClient` interface (`frontend/src/services/generated/client.ts`) only exposes a subset of what the backend offers, and several screens bypass `client` entirely in favor of a local Zustand mock store (`demoStore.ts`), so their actions never reach the backend regardless of `VITE_USE_MOCKS`.

---

## 1. Full backend endpoint inventory

### Auth (`/auth`, `backend/src/routes/auth.py`)
| Method | Path | Notes |
|---|---|---|
| POST | `/signup/buyer` | returns tokens directly |
| POST | `/signup/dealer` | 202 accepted (pending verification) |
| POST | `/signup/support` | 202 accepted (pending verification) |
| POST | `/login` | |
| POST | `/refresh` | |
| POST | `/logout` | |
| POST | `/forgot-password` | stub (dev) |
| POST | `/reset-password` | dev reset code `DEMO-RESET` |
| GET | `/me` | |

### Profiles (`/profiles`, `profiles.py`)
| Method | Path | Notes |
|---|---|---|
| GET | `/me` | |
| PATCH | `/me` | update own profile fields |
| GET | `/me/preferences` | buyer preferences |
| PUT | `/me/preferences` | create/update buyer preferences |
| GET | `/{profile_id}` | support/admin only |

### Marketplace — requests, quotes, chats, deals (no prefix, `marketplace.py`)
| Method | Path | Notes |
|---|---|---|
| GET | `/requests` | buyer's own requests |
| POST | `/requests` | create |
| GET | `/requests/{id}` | |
| POST | `/requests/{id}/publish` | |
| POST | `/requests/{id}/close` | |
| GET | `/requests/{id}/quotes` | |
| GET | `/feed/requests` | dealer view of open requests |
| GET | `/feed/requests/{id}` | |
| GET | `/quotes` | optional `?request_id=` |
| POST | `/quotes` | dealer creates a quote |
| GET | `/quotes/{id}` | |
| PATCH | `/quotes/{id}/revise` | |
| POST | `/quotes/{id}/accept` | buyer accepts |
| POST | `/quotes/{id}/decline` | buyer declines |
| POST | `/quotes/{id}/withdraw` | dealer withdraws |
| POST | `/requests/{id}/compare-ids` | ids for AI compare |
| GET | `/quotes/{id}/dealer-contact` | |
| POST | `/chats/{quote_id}/request-access` | buyer requests to chat |
| GET | `/chats/requests` | dealer's pending chat requests |
| POST | `/chats/requests/{quote_id}/accept` | |
| POST | `/chats/requests/{quote_id}/decline` | |
| GET | `/chats/{quote_id}` | list messages |
| POST | `/chats/{quote_id}` | send message |
| POST | `/chats/{quote_id}/request-negotiation` | |
| POST | `/chats/{quote_id}/read` | mark read |
| DELETE | `/chats/{quote_id}/clear` | hide for self |
| POST | `/chats/ws-ticket` | short-lived ticket for `/ws` |
| GET | `/deals` | accepted quotes |
| GET | `/deals/{quote_id}` | |
| PATCH | `/deals/{quote_id}/status` | |

### Cars / Inventory (`/cars`, `cars.py`)
| Method | Path | Notes |
|---|---|---|
| GET | `` | all cars (dealer sees own) |
| POST | `` | dealer creates listing |
| GET | `/{car_id}` | |
| PATCH | `/{car_id}` | |
| PATCH | `/{car_id}/status` | available/reserved/sold/inactive |

### Documents (`/documents`, `documents.py`)
| Method | Path | Notes |
|---|---|---|
| POST | `/presign` | dealer gets upload URL |
| POST | `/{document_id}/confirm` | |
| GET | `/{quote_id}` | list w/ download URLs |
| DELETE | `/{quote_id}/{document_id}` | |

### Support (`support.py`)
| Method | Path | Notes |
|---|---|---|
| GET | `/support/tickets` | own tickets |
| GET | `/support/tickets/{id}` | |
| POST | `/support/tickets` | create |
| PATCH | `/support/tickets/{id}` | own update |
| GET | `/support/queue/tickets` | support/admin queue |
| PATCH | `/support/queue/tickets/{id}` | support/admin update |
| GET | `/verifications` | |
| POST | `/verifications/{id}/approve` | |
| POST | `/verifications/{id}/deny` | |
| POST | `/verifications/{id}/reject` | |
| GET | `/members` | |
| GET | `/members/{id}` | |
| PATCH | `/members/{id}/support-role` | |
| POST | `/members/{id}/suspend` | |

### Reference (`/reference`, `reference.py`)
| Method | Path | Notes |
|---|---|---|
| GET | `/states` | |
| GET | `/states/{code}/tax-rate` | |
| GET | `/brands` | |

### AI (`/ai`, `ai.py`)
| Method | Path | Notes |
|---|---|---|
| POST | `/chat` | SSE stream |
| POST | `/compare` | |
| GET | `/threads` | |
| GET | `/threads/{id}` | |
| POST | `/request-preview` | |

### Realtime
| Protocol | Path | Notes |
|---|---|---|
| WS | `/ws?token=` | notifications/heartbeat — **cannot run on Vercel serverless**, needs a persistent host (Render/Fly/ECS/etc.) |

---

## 2. What the frontend `DriveDealClient` interface currently exposes

Defined in `frontend/src/services/generated/client.ts`:

```
auth: { login, me }
requests: { list, get, create }
quotes: { list, get, create }
documents: { list, upload }
chats: { list }
inventory: { list }
support: { listTickets, createTicket, members, member, updateMemberRole }
verifications: { list }
ai: { chat, threads, thread }
```

This is a **small slice** of what's listed in section 1. Missing from the typed client entirely (not wired to any backend call from the UI at all):

- `auth.signup*`, `auth.refresh`, `auth.logout`
- `profiles.update`, `profiles.preferences` (get/put)
- `requests.publish`, `requests.close`
- `quotes.accept`, `quotes.decline`, `quotes.revise`, `quotes.withdraw`, `quotes.dealerContact`
- `chats.send`, `chats.requestAccess`, `chats.acceptRequest`, `chats.declineRequest`, `chats.markRead`
- `deals.list`, `deals.get`, `deals.updateStatus`
- `cars.create`, `cars.update`, `cars.updateStatus` (dealer-side listing management)
- `support.updateTicket`, `verifications.decide` (approve/deny/reject)
- `reference.states`, `reference.brands`, `reference.taxRate`

## 3. Where the frontend bypasses even what's already wired

Confirmed by reading every screen (session date: 2026-10-01 audit) — these UI actions call the local `demoStore` mock store directly and **never** call `client.*`, so they never reach the backend even with `VITE_USE_MOCKS=false`:

- Buyer request list/detail (`HomeScreen`, `RequestsScreen`, `DealerListScreen`, `ChatScreen`, `AdvisorScreen`, `RequestDetailScreen`) — read from `demoStore`, never `client.requests.list()/get()`
- Creating a new buyer request (`NewRequestScreen`) — `demoStore.addRequest()`, never `client.requests.create()`
- Quote lifecycle: accept/decline/revise/withdraw, deal status updates — all local-only (`RequestDetailScreen`, `QuoteDetailScreen`)
- Chat request/accept/decline and sending messages — local-only (`ChatScreen`)
- Support ticket status updates + verification decisions (`SupportScreens.tsx`) — local-only; this screen also *reads* its ticket/verification lists from `demoStore` instead of `client.support.listTickets()`/`client.verifications.list()`, so a ticket created for real via `SupportReporter` won't even appear in the queue here
- Buyer preferences (`ProfileScreen`) — local-only (though the backend endpoint `/profiles/me/preferences` exists and is ready)
- Signup (`SignupScreen`) — calls `demoStore.loginAs()`, never `POST /auth/signup/*`; a "new account" is never actually created in the database

## 4. Auth/session mechanics (frontend)

- Token storage is consistent and correct: `drivedeal.accessToken` / `drivedeal.refreshToken` in `localStorage`, attached as `Authorization: Bearer` on every real request.
- **Gap**: nothing calls `client.auth.me()` to validate a persisted session on load — route guards (`guards.tsx`) trust the Zustand-persisted session object blindly.
- **Gap**: `drivedeal.refreshToken` is stored but never used — no 401 → refresh-token retry flow exists in `httpClient.ts`'s `request()`. An expired 60-minute access token just makes every subsequent API call fail with a generic error instead of silently refreshing or redirecting to login.

## 5. Bottom line

- Backend: **complete**, no new endpoints required for anything currently in the UI's scope.
- Frontend: needs (a) the `DriveDealClient` interface + `httpClient.ts` extended to cover the missing operations in section 2, and (b) the screens listed in section 3 rewired from `demoStore` mutators to the corresponding `client.*` calls, plus (c) the session-validation/token-refresh gap in section 4 addressed.
