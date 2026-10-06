# DriveDeal — Database Schema v2 (Normalised)

> **Archived design document.** This file records the original 15-table normalization proposal and is not the
> current runtime schema. Use [`schema-erd.mmd`](schema-erd.mmd) and
> `backend/src/repositories/schema/tables.py` for the implemented 20-table model.

> **Status:** Target design. Replaces the 40-table live schema.
> **Source of truth for this doc:** live catalog dump + 12 sample CSVs from
> `C:\Users\Syed Thameemuddin\Downloads\example tables data` (2,558 real rows).
> **Engine:** PostgreSQL 15+ (RDS) + `postgis` + `pg_trgm` + `unaccent`.
> **No `pgvector`** — agent retrieval is SQL, not vector similarity. See §2 "Delta 9".

---

## 1. What changed and why

The live schema grew by hand in the Supabase SQL editor — only **one** real migration file
exists (`backend/supabase/migrations/20260828000000_match_car_rag_documents.sql`). The
result was 40 tables, no `UNIQUE` constraints, no `CHECK` constraints, and JSONB blobs
doing the work of real columns. The sample data proves the damage:

| Live data problem | Evidence from CSVs | Fix in v2 |
|---|---|---|
| Untyped JSONB requirement blob | `buyer_requests.requirements` has **25 distinct keys** — `Brand` *and* `Car Brand`, `Car Type` *and* `Body Type`, `Color` *and* `Exterior Color` | 20 typed columns on `buyer_requests` |
| Free-text geography | `profiles.location` = `Texas`, `Texas, USA`, `Texas\|COUNTRY:US`, `Texas\|COUNTRY:USA`, `Frisco`, `Frisco, TX 750`, `Fisco texas`, `Texas, Firco`, `Tesax,34` — 15 variants for 3 US states, plus 4 non-US values | US-only `states` master + `state_id` FK |
| Free-text brand | `brands_sold` = `["Toyota"]`; `cars.brand` has both `Mercedes` and `Mercedes-Benz` as separate values | `brands` master + `brand_id` FK |
| Binary in the row | `dealer_quotes.files` holds base64 data-URLs (13 of 39 rows) | removed → `deal_documents.image_paths` (S3 keys) |
| Near-duplicate tables | `support_agent_verifications` (2 rows) + `support_dealer_verifications` (13 rows), identical columns | merged into `support_verifications` |
| Near-duplicate tables | `support_customer_tickets` (2 rows) + `support_dealer_tickets` (7 rows), identical columns | merged into `support_tickets` + `category` |
| Denormalised profile copy | `support_*.profile_data` stores a full JSONB dump of the `profiles` row | removed — read through `profile_id` |
| No audit trail | only `created_at` exists; 0 of 15 tables track *who* changed what | `created_at`/`updated_at`/`created_by`/`updated_by` on all 16 |

**16 tables remain** (the original 15 plus `payments`, added later for premium billing). 37 tables dropped.

---

## 2. Table inventory

| # | Table | Domain | Origin |
|---|---|---|---|
| 1 | `states` | Master | **new** |
| 2 | `brands` | Master | **new** |
| 3 | `profiles` | Identity | kept, trimmed |
| 4 | `users` | Identity | **new** |
| 5 | `cars` | Marketplace | kept, extended |
| 6 | `conversation_history` | AI | was `checkpoints` + `checkpoint_blobs` + `checkpoint_writes` |
| 7 | `buyer_preference` | AI | was `user_memories` + `conversation_cache` |
| 8 | `buyer_requests` | Request | kept, de-blobbed |
| 9 | `deal_quotes` | Request | was `dealer_quotes` |
| 10 | `deal_chats` | Deal | unchanged |
| 11 | `deal_documents` | Deal | reshaped for S3 |
| 12 | `support_tickets` | Support | was `support_customer_tickets` + `support_dealer_tickets` |
| 13 | `support_verifications` | Support | was `support_agent_verifications` + `support_dealer_verifications` |
| 14 | `llm_audits` | Ops | **new** |
| 15 | `error_logs` | Ops | **new** |
| 16 | `payments` | Billing | **new** — premium-subscription ledger |

### Conventions used throughout

- **UUID** primary keys (`gen_random_uuid()`), except `llm_audits.id` which is `bigserial`
  because it is a high-volume append-only log.
- **Audit columns** on all 16 tables: `created_at`, `updated_at`, `created_by`, `updated_by`.
  `created_by`/`updated_by` are `text` holding **either** the literal `'system'` **or** a
  `profiles.id` uuid, enforced by a `CHECK`. *Decision: a `uuid`-or-`'system'` sentinel in
  `text` is the only single-column way to express "backend wrote this" and "this user
  edited that" together.* A separate `*_system boolean` pair would be FK-safe but doubles
  the columns to 30 and adds a two-state invariant to every read.
- **Who writes what.** A row written by a backend job, migration, cron, or service-role
  call has `created_by = 'system'`. A row created or edited by a signed-in user carries
  that user's `profiles.id`. This is set by trigger, never by the client — see
  [`set_audit_actor()`](#set_audit_actor) in §2.1.
- **Actor FKs** (`buyer_id`, `dealer_id`, `seller_id`, `sender_id`, `caller_id`) all point at
  `profiles.id`, because `users` is a credentials-only table (see §4.4).
- All timestamps are `timestamptz`, stored UTC.
- `pg_trgm` + `unaccent` extension for fuzzy `states`/`brands` lookup.
- **No `pgvector`.** There is no `cars.embedding` column and no vector index
  (Delta 9). The relational schema *is* the knowledge base: the agent emits
  SQLAlchemy ORM queries against the typed columns above, which is why so many of
  them are typed rather than JSONB. Review text inside `cars.reviews` is matched
  with `ILIKE`/`tsvector`, not cosine distance.

### 2.1 `set_audit_actor()` — the audit trigger

The four audit columns are never written by application code. A single `BEFORE INSERT OR
UPDATE` trigger on all 16 tables resolves the actor:

- `auth.uid()` returns a value → a signed-in user did this → store that `profiles.id`
- `auth.uid()` returns `NULL` → backend job, cron, migration, or service-role call →
  store `'system'`

The same trigger bumps `updated_at` on every `UPDATE`. A `DEFAULT now()` alone is **not**
enough — a column default only applies on `INSERT`, so without this trigger `updated_at`
would still hold the creation time after every edit.

```sql
CREATE OR REPLACE FUNCTION set_audit_actor() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor text := COALESCE(auth.uid()::text, 'system');
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := COALESCE(NEW.created_at, now());
    NEW.created_by := v_actor;
  END IF;
  NEW.updated_at := now();
  NEW.updated_by := v_actor;
  RETURN NEW;
END; $$;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY[
    'states','brands','profiles','users','cars','conversation_history',
    'buyer_preference','buyer_requests','deal_quotes','deal_chats',
    'deal_documents','support_tickets','support_verifications',
    'llm_audits','error_logs']
  LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_audit_%1$s BEFORE INSERT OR UPDATE ON %1$I
         FOR EACH ROW EXECUTE FUNCTION set_audit_actor()', t);
  END LOOP;
END $$;
```

**Why `SECURITY DEFINER`:** the trigger runs as the invoking role, which under RLS may
lack `SELECT` on `profiles`. `SECURITY DEFINER` with a pinned `search_path` lets the
function read `auth.uid()` safely without opening a hole.

**The client cannot forge an actor.** Because the trigger overwrites `created_by` on insert
and `updated_by` on update, a caller that sets `updated_by = 'someone-else'` is silently
corrected. This is the whole point — audit columns that the client supplies are not an
audit trail.

**Two deliberate exceptions**, both documented at their tables:

- `profiles.created_by` is `'system'` on the very first insert, because the profile row
  does not exist yet and therefore has no id to record. Every subsequent write by that
  user is recorded normally.
- `llm_audits` is an append-only log; the trigger's `UPDATE` branch is never reached
  because updates are rejected.

---

## 3. Master / reference tables

### 3.1 `states`

Master list of US states. Replaces every free-text `location` and `Location` requirement
value. **US-only** — the marketplace lists US cars exclusively, so no country columns exist.

**Columns**

| Name | Type | Null | Default | Key / Constraints | Notes |
|---|---|---|---|---|---|
| `id` | `uuid` | NO | `gen_random_uuid()` | **PK** | |
| `name` | `text` | NO | — | `UNIQUE` | Canonical name, e.g. `Texas` |
| `code` | `text` | NO | — | `UNIQUE`, `CHECK (code ~ '^[A-Z]{2}$')` | USPS abbreviation, e.g. `TX` |
| `is_active` | `boolean` | NO | `true` | | Soft-disable, never hard delete |
| `created_at` | `timestamptz` | NO | `now()` | | |
| `updated_at` | `timestamptz` | NO | `now()` | | |
| `created_by` | `text` | YES | `'system'` | `CHECK (created_by = 'system' OR created_by ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')` | `auth.uid()`, else `'system'` |
| `updated_by` | `text` | YES | `'system'` | `CHECK (updated_by = 'system' OR updated_by ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')` | `auth.uid()`, else `'system'` |

**Indexes:** `UNIQUE (name)`, `UNIQUE (code)`, `GIN (name gin_trgm_ops)`

**Sample data** (50 states + DC; derived from the 15 location variants present in
`profiles_rows.csv`)

| id | name | code | is_active |
|---|---|---|---|
| `3a1f9c02-7b41-4e8a-9d15-6c02e8b7f001` | Texas | `TX` | true |
| `3a1f9c02-7b41-4e8a-9d15-6c02e8b7f002` | Washington | `WA` | true |
| `3a1f9c02-7b41-4e8a-9d15-6c02e8b7f003` | New York | `NY` | true |
| `3a1f9c02-7b41-4e8a-9d15-6c02e8b7f004` | California | `CA` | true |
| `3a1f9c02-7b41-4e8a-9d15-6c02e8b7f005` | District of Columbia | `DC` | true |
| `3a1f9c02-7b41-4e8a-9d15-6c02e8b7f006` | Illinois | `IL` | true |
| `3a1f9c02-7b41-4e8a-9d15-6c02e8b7f007` | Florida | `FL` | true |
| `3a1f9c02-7b41-4e8a-9d15-6c02e8b7f008` | Georgia | `GA` | true |

> **Migration trap 1 — corrupt values.** The live data contains 4 malformed US values —
> `Fisco texas`, `Texas, Firco`, `Tesax,34`, and one empty string. These cannot be
> auto-matched and must be quarantined and manually assigned. The empty string must be
> rejected by a `NOT NULL` + `state_id` FK, which is exactly why the FK is introduced.
>
> **Migration trap 2 — non-US values.** 4 profile rows carry Indian locations
> (`CHENNAI` ×2, `CHENNAI|COUNTRY:India` ×2). Because `states` is US-only there is no
> target row for them. Decide per row: remap to a US state if it was a data-entry error,
> or leave `state_id NULL` (the column is nullable precisely for this). Also note the
> 2 rows whose value is an empty string cannot be `NOT NULL` in the legacy column but are
> rejected by the new FK.

---

### 3.2 `brands`

Master list of vehicle manufacturers. Replaces `profiles.brands_sold` (`text[]`),
`cars.brand` (`text`) and `dealers.brands` (`text[]`).

`country_code` is the **country of origin / HQ of the marque** — *not* the country the car
is listed in. DriveDeal only sells US cars, but a buyer may legitimately ask for
"Indian cars", "Japanese cars" or "German cars", and buyers filter by marque origin. The
column also serves a premium/import heuristic, so it is retained here even though `states`
is US-only.

**Columns**

| Name | Type | Null | Default | Key / Constraints | Notes |
|---|---|---|---|---|---|
| `id` | `uuid` | NO | `gen_random_uuid()` | **PK** | |
| `name` | `text` | NO | — | `UNIQUE` | Canonical, e.g. `Mercedes-Benz` |
| `logo_url` | `text` | YES | | S3/CDN path | |
| `country_code` | `text` | YES | | `CHECK (country_code ~ '^[A-Z]{2}$')` | Marque origin, ISO 3166-1 alpha-2, e.g. `IN` for Mahindra. NULL only if genuinely unknown |
| `is_premium` | `boolean` | NO | `false` | | Drives advisor tiering |
| `is_active` | `boolean` | NO | `true` | | |
| `created_at` | `timestamptz` | NO | `now()` | | |
| `updated_at` | `timestamptz` | NO | `now()` | | |
| `created_by` | `text` | YES | `'system'` | `CHECK (created_by = 'system' OR created_by ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')` | `auth.uid()`, else `'system'` |
| `updated_by` | `text` | YES | `'system'` | `CHECK (updated_by = 'system' OR updated_by ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')` | `auth.uid()`, else `'system'` |

**Indexes:** `UNIQUE (name)`, `GIN (name gin_trgm_ops)`, `INDEX (country_code) WHERE is_active`

**Sample data** (from the 33 distinct brand strings in `cars_rows.csv` + `profiles_rows.csv`)

| id | name | country_code | is_premium | is_active |
|---|---|---|---|---|
| `7b2e5a10-4c8d-4f21-9a3b-1d9e6c4f1001` | Toyota | `JP` | false | true |
| `7b2e5a10-4c8d-4f21-9a3b-1d9e6c4f1002` | Honda | `JP` | false | true |
| `7b2e5a10-4c8d-4f21-9a3b-1d9e6c4f1003` | Ford | `US` | false | true |
| `7b2e5a10-4c8d-4f21-9a3b-1d9e6c4f1004` | BMW | `DE` | true | true |
| `7b2e5a10-4c8d-4f21-9a3b-1d9e6c4f1005` | Mercedes-Benz | `DE` | true | true |
| `7b2e5a10-4c8d-4f21-9a3b-1d9e6c4f1006` | Tesla | `US` | true | true |
| `7b2e5a10-4c8d-4f21-9a3b-1d9e6c4f1007` | Mahindra | `IN` | false | true |
| `7b2e5a10-4c8d-4f21-9a3b-1d9e6c4f1008` | McLaren | `GB` | true | true |

> **Note:** live data contains **both** `Mercedes` (3 rows) and `Mercedes-Benz` (1 row) as
> distinct values. The master table collapses them to one canonical `Mercedes-Benz` row;
> the migration must remap both old values to that single `id`.
>
> `country_code` cannot be derived from any live column, so the migration must hard-code
> the mapping (33 rows). It is **not** derived from `cars.state_id`, which is US-only.

---

## 4. Identity

### 4.1 `profiles` — person master

One row per human. `id` is the Supabase Auth uid.

**Columns**

| Name | Type | Null | Default | Key / Constraints | Notes |
|---|---|---|---|---|---|
| `id` | `uuid` | NO | — | **PK**, `REFERENCES auth.users(id) ON DELETE CASCADE` | |
| `state_id` | `uuid` | YES | | `REFERENCES states(id) ON DELETE SET NULL` | **replaces `location`** |
| `full_name` | `text` | NO | — | `CHECK (length(trim(full_name)) > 0)` | |
| `email` | `text` | YES | | `UNIQUE`, `CHECK (email ~* '^[^@]+@[^@]+')` | |
| `role` | `text` | NO | `'buyer'` | `CHECK (role IN ('buyer','seller','support','admin'))` | See §9 |
| `phone` | `text` | YES | | `CHECK (phone ~ '^\+?[0-9]{7,15}$')` | |
| `address` | `text` | YES | | | Street-level, kept as free text |
| `dealership_name` | `text` | YES | | | Sellers only |
| `branch_name` | `text` | YES | | | Sellers only |
| `dealer_license` | `text` | YES | | `UNIQUE` | Sellers only |
| `website` | `text` | YES | | | Sellers only |
| `coordinates` | `geography(Point,4326)` | YES | | | `GIST` index |
| `extra_info` | `text` | YES | | | |
| `terms_accepted` | `boolean` | NO | `false` | | **Added by `solution-backend.md` §2 Delta 10.** `true` once the account accepted the Terms. The server rejects signup when it is false or absent with `VALIDATION_ERROR` |
| `terms_version` | `text` | NO | `'2026-09-01'` | | **Delta 10.** The version string the user was shown. Server-assigned from the `TERMS_VERSION` constant, never taken from the request |
| `terms_accepted_at` | `timestamptz` | YES | | | **Delta 10.** `now()` at signup, written with the row so no account exists without a consent record. Deliberately nullable: a `NULL` on a backfilled legacy row means *not consented*, and is never backfilled with the migration timestamp |
| `trial_started_at` | `timestamptz` | YES | | | **Subscription.** Stamped by the server on a dealer's first login; `NULL` = trial never started (buyers and staff never get one) |
| `trial_expires_at` | `timestamptz` | YES | | | **Subscription.** `trial_started_at` + `DEALER_TRIAL_DAYS` (60). Expiry is evaluated on read, never by a background job |
| `is_premium` | `boolean` | NO | `false` | | **Subscription.** Convenience flag maintained with `premium_expires_at`; entitlement is always derived from `premium_expires_at > now()` |
| `premium_expires_at` | `timestamptz` | YES | | | **Subscription.** One year from the last successful `payments` row. `NULL` or past = not premium |
| `created_at` | `timestamptz` | NO | `now()` | | |
| `updated_at` | `timestamptz` | NO | `now()` | | |
| `created_by` | `text` | YES | `'system'` | `CHECK (created_by = 'system' OR created_by ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')` | `auth.uid()`, else `'system'` |
| `updated_by` | `text` | YES | `'system'` | `CHECK (updated_by = 'system' OR updated_by ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')` | `auth.uid()`, else `'system'` |

**Removed:** `brands_sold` (`text[]`) → `brands` master; `location` (`text`) → `states`

**Terms acceptance** is three columns here rather than a separate
`terms_acceptances` table: one account has one signup, and an account
re-created after deletion is a new `profiles` row, so a per-account column is
sufficient and avoids a 16th table. Full rules in `solution-backend.md` §2
Delta 10.
master; `ask_ai` (`text`); `acls` (`jsonb`); `avatar_url` (`text`).

> **`acls` removal — no functional loss.** The column held per-row permission overrides.
> Authorization is now expressed entirely by RLS policies keyed on `profiles.id` (see §14),
> which is the only mechanism actually used. Dropping `acls` also removes the last JSONB
> column from `profiles`, so the table is now fully typed. If per-user exceptions are ever
> needed again they belong in a dedicated table, not a JSONB bag on the row.
>
> **`ask_ai` removal.** Free-text advisor nudge with no consumer in the v2 feature set —
> the advisor pipeline is driven by `buyer_preference` and `buyer_requests`, not by a
> per-profile prompt string.
>
> **`avatar_url` removal.** The column was `NULL` for all 85 live profile rows, so nothing
> reads it. Avatars, if the UI ever needs them, belong in the auth provider's user metadata
> (`auth.users.raw_user_meta_data`) or in the same S3 path used for `deal_documents` — not
> as an unindexed URL on the transactional profile row.

**Seller-brand relationship after removal:** dealers are many-to-many with brands, so this
needs a junction. To stay at 15 tables, `cars.brand_id` is the authoritative brand link (a
dealer's inventory *is* their brand portfolio) and `brands_sold` is derived by
`SELECT DISTINCT brand_id FROM cars WHERE seller_id = <dealer>`.

**Sample data** (real rows, `profiles_rows.csv`)

| id | full_name | email | role | state_id | dealership_name | branch_name | dealer_license | brands_sold (removed) |
|---|---|---|---|---|---|---|---|---|
| `250d3f1c-3f4b-4cf6-8e7f-b1c972e2237f` | Adithyaa Anand | adithyaa.ma@gmail.com | buyer | → `TX` | — | — | — | — |
| `6c795ae0-edb8-4546-aef2-dab9edc2221f` | Harish | harish02@gmail.com | seller | → `WA` | hari | harishhey | US030202 | `["Ford"]` |
| `58493f78-aca9-4917-9b49-5c9ce8d9556e` | Naveen | naveen@01gmail.com | seller | → `TX` | Navee | Naveen | TEST-DLR-0004 | `["Honda"]` |
| `55a4688d-b55f-4c6b-8d9f-4ae617d614fd` | test2 | test2@gmail.com | seller | → `TX` | Test 2 Motors | — | — | `["Tesla","BMW"]` |
| `4772bb1a-ee75-4f45-b8e6-53d70f6e42b1` | Support03 | support03@gmail.com | support | → `TX` | — | — | — | — |

---

### 4.2 `users` — credentials (1:1 with profile)

Holds **only** the account credential linked to a profile.

**Columns**

| Name | Type | Null | Default | Key / Constraints | Notes |
|---|---|---|---|---|---|
| `id` | `uuid` | NO | `gen_random_uuid()` | **PK** | |
| `profile_id` | `uuid` | NO | — | `UNIQUE`, `REFERENCES profiles(id) ON DELETE CASCADE` | Enforces 1:1 |
| `password_hash` | `text` | YES | — | `CHECK (password_hash IS NULL OR password_hash ~ '^\\$argon2id\\$')` | **Never plaintext.** NULL = Supabase-Auth-managed account |
| `is_active` | `boolean` | NO | `true` | | |
| `last_login_at` | `timestamptz` | YES | | | |
| `created_at` | `timestamptz` | NO | `now()` | | |
| `updated_at` | `timestamptz` | NO | `now()` | | |
| `created_by` | `text` | YES | `'system'` | `CHECK (created_by = 'system' OR created_by ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')` | `'system'` on sign-up — the row does not exist yet, so there is no id to record |
| `updated_by` | `text` | YES | `'system'` | `CHECK (updated_by = 'system' OR updated_by ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')` | `auth.uid()`, else `'system'` |

> **⚠️ Security note — read before implementing.** Supabase Auth (GoTrue) already stores
> credentials in `auth.identities`, hashed. If this column is populated you are running a
> **second, parallel credential system** and must handle Argon2id verification, rotation,
> and lockout yourself. The recommended posture is `password_hash` stays `NULL` and this
> table acts purely as an account/activation registry. The `CHECK` constraint above makes
> a plaintext password physically unstorable.

**Sample data** (synthesised from the 28 real `profiles` rows)

| id | profile_id | password_hash | is_active | last_login_at |
|---|---|---|---|---|
| `c4e1a902-7f35-4d18-b2c6-91a0e7d3f001` | `250d3f1c-3f4b-4cf6-8e7f-b1c972e2237f` | `NULL` | true | 2026-09-28 11:14:03+00 |
| `c4e1a902-7f35-4d18-b2c6-91a0e7d3f002` | `6c795ae0-edb8-4546-aef2-dab9edc2221f` | `NULL` | true | 2026-09-28 09:02:41+00 |
| `c4e1a902-7f35-4d18-b2c6-91a0e7d3f003` | `4772bb1a-ee75-4f45-b8e6-53d70f6e42b1` | `$argon2id$v=19$m=65536,t=3,p=4$...` | true | 2026-09-08 07:44:19+00 |

---

### 4.3 `payments` — premium-subscription ledger

One row per successful (or failed/refunded) subscription payment. The table is append-only in
practice: a new row is written on every checkout and the caller's new expiry is computed from the
previous `premium_expires_at` (stacking) or from `now()`.

**Columns**

| Name | Type | Null | Default | Key / Constraints | Notes |
|---|---|---|---|---|---|
| `id` | `uuid` | NO | `gen_random_uuid()` | **PK** | |
| `profile_id` | `uuid` | NO | — | `REFERENCES profiles(id) ON DELETE CASCADE`, indexed | The subscriber |
| `plan` | `text` | NO | — | `CHECK (plan IN ('dealer_premium','buyer_premium'))` | Price tier is derived from this, not from `profiles.role` at read time |
| `amount` | `numeric(12,2)` | NO | — | | `500.00` dealer, `100.00` buyer — from `PREMIUM_PRICE_BY_ROLE` |
| `currency` | `char(3)` | NO | `'USD'` | | |
| `payment_method` | `text` | NO | — | `CHECK (payment_method IN ('credit_card','debit_card'))` | |
| `card_brand` | `text` | YES | | | Detected brand (`visa`, `mastercard`, …) — **the only card-derived value stored besides the last four** |
| `card_last4` | `char(4)` | YES | | | Full PAN and CVV are accepted by `POST /payment` for UX parity and **never persisted** |
| `status` | `text` | NO | `'succeeded'` | `CHECK (status IN ('succeeded','failed','refunded'))` | Checkout is simulated: well-formed cards always `succeeded` |
| `premium_expires_at` | `timestamptz` | YES | | | The profile expiry this payment produced — the audit answer to "why does my plan end then?" |
| `created_at` / `updated_at` / `created_by` / `updated_by` | | | | audit columns | As everywhere (§2) |

**Derived entitlement, not stored state.** `profiles.is_premium` / `premium_expires_at` are a
cache of "the newest successful payment's outcome"; `subscription_state()` always recomputes
`premium_active` from `premium_expires_at > now()`, and the dealer trial
(`trial_started_at` → `trial_expires_at`, 3-quote cap) sits below premium in the precedence order.

---

## 5. Marketplace

### 5.1 `cars`

**Columns**

| Name | Type | Null | Default | Key / Constraints | Notes |
|---|---|---|---|---|---|
| `id` | `uuid` | NO | `gen_random_uuid()` | **PK** | |
| `seller_id` | `uuid` | NO | — | `REFERENCES profiles(id) ON DELETE RESTRICT` | |
| `brand_id` | `uuid` | NO | — | `REFERENCES brands(id) ON DELETE RESTRICT` | **replaces `brand` text** |
| `state_id` | `uuid` | YES | | `REFERENCES states(id) ON DELETE SET NULL` | New — for geo search |
| `title` | `text` | NO | — | | Denormalised display label |
| `model` | `text` | NO | — | | |
| `trim` | `text` | YES | | | New — trim level |
| `body_type` | `text` | YES | | | Was `type` |
| `seating_capacity` | `int2` | YES | | `CHECK (seating_capacity BETWEEN 1 AND 15)` | **New** — required so `buyer_preference.seater_count` ("7 seater") has something to match |
| `condition` | `text` | YES | | `CHECK (condition IN ('New','Used','Certified'))` | **New** — a fact about the specific car; matches `buyer_preference.condition` |
| `mileage` | `int4` | YES | | `CHECK (mileage >= 0)` | **New** — odometer, matches `buyer_preference.max_mileage` |
| `model_year` | `int4` | YES | | `CHECK (model_year BETWEEN 1990 AND 2035)` | Was `year` |
| `fuel` | `text` | YES | | `CHECK (fuel IN ('Petrol','Diesel','Hybrid','Electric','CNG','LPG','Other'))` | |
| `transmission` | `text` | YES | | `CHECK (transmission IN ('Automatic','Manual','CVT','Dual Clutch','Other'))` | |
| `drivetrain` | `text` | YES | | `CHECK (drivetrain IN ('FWD','RWD','AWD','4WD','Other'))` | New |
| `price` | `numeric(12,2)` | NO | — | `CHECK (price >= 0)` | |
| `color` | `text` | YES | | | Hex, e.g. `#2d6a4f` |
| `color_name` | `text` | YES | | | |
| `description` | `text` | YES | | | |
| `rating` | `numeric(2,1)` | YES | | `CHECK (rating BETWEEN 0 AND 5)` | Cached average |
| `reviews` | `jsonb` | NO | `'[]'::jsonb` | `CHECK (jsonb_typeof(reviews) = 'array')` | **New** — review array |
| `images` | `text[]` | NO | `'{}'::text[]` | | S3/Supabase storage URLs |
| `status` | `text` | NO | `'draft'` | `CHECK (status IN ('draft','active','sold','removed'))` | |
| `views` | `int4` | NO | `0` | `CHECK (views >= 0)` | |
| `created_at` | `timestamptz` | NO | `now()` | | |
| `updated_at` | `timestamptz` | NO | `now()` | | |
| `created_by` | `text` | YES | `'system'` | `CHECK (created_by = 'system' OR created_by ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')` | `auth.uid()`, else `'system'` |
| `updated_by` | `text` | YES | `'system'` | `CHECK (updated_by = 'system' OR updated_by ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')` | `auth.uid()`, else `'system'` |

**Indexes**
- `GIST (images)` — not applicable; use `GIN (reviews jsonb_path_ops)`
- `BRIN (created_at)`
- `btree (status, brand_id, price)`, `btree (brand_id, model_year DESC)`, `btree (state_id)`
- `btree (seating_capacity)`, `btree (condition)` — drive `buyer_preference` matching

**`reviews` jsonb shape**

```json
[
  {
    "rating": 4.5,
    "title": "Great car, minor niggles",
    "body": "Owned for 18 months. Engine is smooth, but infotainment lags.",
    "author_name": "A. Raman",
    "source": "owner_reported",
    "created_at": "2026-08-14T10:22:31+00:00"
  }
]
```

**Sample data** (real rows, `cars_rows.csv` — 85 rows, 84 active, years 2021–2026)

| id | seller_id | brand_id | title | model | model_year | body_type | seating_capacity | transmission | price | rating | color_name | status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `00e22c60-88c0-40ef-a12d-365ecbbd4185` | `86f88611-…` | → `mclaren` | McLaren Artura | Artura | 2026 | Supercar | 2 | Automatic | 240000.00 | 4.9 | Forest Green | active |
| `0360579d-0fb3-48d1-b172-aab715f6d994` | `86f88611-…` | → `lamborghini` | Lamborghini Huracan | Huracan | 2025 | Luxury | 2 | Automatic | 260000.00 | 4.8 | Pearl White | active |

> `seating_capacity`, `condition` and `mileage` are **not present in the live CSVs** — they
> are new columns and must be populated during the migration (dealer enters them on
> listing, or the advisor pipeline infers them from `title` + `model`). Until then they are
> `NULL`, which the match query in §6.2 treats as "no constraint", so nothing breaks.

> Observed `body_type` distribution in live data: SUV 30, Sedan 19, Hatchback 7, Coupe 6,
> MUV 6, Luxury 5, Sports Car 4, Crossover 3, Convertible 2, Supercar 2. All 10 values are
> preserved in the new `body_type` column (no `CHECK` restricts it, since the list is
> taxonomy-driven and expected to grow).

---

## 6. AI layer

### 6.1 `conversation_history` — AI chat checkpoints

LangGraph checkpoint store. One row per checkpoint *step*; many checkpoints per thread.

> **Composite PK is mandatory.** `thread_id` alone cannot be the primary key — a thread
> accumulates one checkpoint per graph node invocation. The live `checkpoints` table
> already used a 3-part PK `(thread_id, checkpoint_ns, checkpoint_id)`.

**Columns**

| Name | Type | Null | Default | Key / Constraints | Notes |
|---|---|---|---|---|---|
| `thread_id` | `text` | NO | — | **PK (1 of 2)** | e.g. `dce16b4b-…` , `neg_2fa7ac94-…` |
| `checkpoint_id` | `text` | NO | — | **PK (2 of 2)** | UUID per step |
| `parent_checkpoint_id` | `text` | YES | | | Chain linkage |
| `user_id` | `uuid` | NO | — | `REFERENCES profiles(id) ON DELETE CASCADE` | **Scopes thread ownership** |
| `thread_type` | `text` | NO | `'chat'` | `CHECK (thread_type IN ('chat','negotiation','advisor','dealer'))` | Separates thread namespaces |
| `checkpoint` | `jsonb` | NO | `'{}'::jsonb` | | Serialised LangGraph state |
| `metadata` | `jsonb` | NO | `'{}'::jsonb` | | Step metadata, token counts |
| `created_at` | `timestamptz` | NO | `now()` | | |
| `updated_at` | `timestamptz` | NO | `now()` | | |
| `created_by` | `text` | YES | `'system'` | `CHECK (created_by = 'system' OR created_by ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')` | `auth.uid()`, else `'system'` |
| `updated_by` | `text` | YES | `'system'` | `CHECK (updated_by = 'system' OR updated_by ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')` | `auth.uid()`, else `'system'` |

**Indexes**
- `PRIMARY KEY (thread_id, checkpoint_id)` — checkpoint replay
- `btree (thread_id, created_at DESC)` — thread history read
- `btree (user_id, thread_type, created_at DESC)` — **chat-list query**
- `btree (parent_checkpoint_id)` — graph traversal

**⚠️ Consequence of having no `chat_sessions` table.** Listing a user's chats is now:

```sql
SELECT thread_id,
       max(created_at)                          AS last_active_at,
       (metadata->>'title')                     AS title
FROM conversation_history
WHERE user_id = $1 AND thread_type = 'chat'
GROUP BY thread_id, metadata->>'title'
ORDER BY last_active_at DESC;
```

This works, but it means:
- **No chat titles.** `title` is not reliably in `metadata` on every step, so the sidebar
  cannot show a stable name. It must be re-derived or read from the first step.
- **No archiving.** `is_archived` has nowhere to live.
- **Cost.** The `GROUP BY` scans every checkpoint row for the user. At 2,555 chat messages
  in the sample data across 318 threads this is cheap; at 10M+ checkpoints it needs the
  `(user_id, thread_type, created_at DESC)` index above and a `DISTINCT ON` rewrite.
- **Deletes are per-thread**, never per-step: `DELETE … WHERE thread_id = $1`.

**Sample data** (thread ids taken from the real `chat_messages_rows.csv` session ids)

| thread_id | checkpoint_id | parent_checkpoint_id | user_id | thread_type | created_at |
|---|---|---|---|---|---|
| `dce16b4b-9378-4c05-87f1-a66f679b2550` | `cp_01J9Z4K2M7QW` | `cp_01J9Z4K1P3RD` | `bdc31c9e-f6ed-40d0-a32f-706062f81d77` | chat | 2026-09-16 19:42:54+00 |
| `dce16b4b-9378-4c05-87f1-a66f679b2550` | `cp_01J9Z4K2M8XA` | `cp_01J9Z4K2M7QW` | `bdc31c9e-f6ed-40d0-a32f-706062f81d77` | chat | 2026-09-16 19:42:55+00 |
| `neg_2fa7ac94-8871-4909-8175-438a4ca16c41` | `cp_01J9A1B7T9ZM` | `NULL` | `bdc31c9e-f6ed-40d0-a32f-706062f81d77` | negotiation | 2026-09-09 17:31:10+00 |
| `1df42731-daa9-4438-b2bb-566641595c2b` | `cp_01J9C4D2F1QK` | `NULL` | `bdc31c9e-f6ed-40d0-a32f-706062f81d77` | advisor | 2026-09-18 14:34:15+00 |

`checkpoint` payload for row 1:

```json
{"messages": [
  {"role": "user", "content": "show me top 5 luxury cars in us"},
  {"role": "assistant", "content": "Great! Here's a full summary of your request …"}
]}
```

---

### 6.2 `buyer_preference`

A buyer's stated car preferences, held as **one row per buyer**. A buyer says *"I like Ford,
I want a 7 seater, automatic"* and the AI resolves that sentence into `brand_id`,
`seater_count` and `transmission`. There is no separate `id` — `profile_id` is both the PK
and the FK, so the relationship is strictly 1:1 and "this buyer has no preferences yet" is
represented by the absence of a row.

Replaces `user_memories` (free-text blob) and `conversation_cache` (per-session summary).

**Why typed columns and not a key-value bag:** every preference column is named identically
to its `cars` counterpart, so a single `JOIN` applies the whole preference set with no
`jsonb` extraction and no `preference_key IN (...)` filter. This is the opposite of the old
`buyer_requests.requirements` JSONB, which needed 25 key-variant rewrites.

**Columns**

| Name | Type | Null | Default | Key / Constraints | Notes |
|---|---|---|---|---|---|
| `profile_id` | `uuid` | NO | — | **PK**, `REFERENCES profiles(id) ON DELETE CASCADE` | 1:1 with `profiles` |
| `brand_id` | `uuid` | YES | | `REFERENCES brands(id) ON DELETE SET NULL` | Primary wanted marque |
| `other_brand_ids` | `uuid[]` | YES | | | Additional marques. `GIN` index. ⚠️ Postgres cannot FK-validate array elements — see note below |
| `model_preference` | `text` | YES | | | Free text, e.g. `Bronco` |
| `body_type` | `text` | YES | | | Same domain as `cars.body_type`, and **deliberately unconstrained** — see the note below |
| `seater_count` | `int2` | YES | | `CHECK (seater_count BETWEEN 2 AND 15)` | *"7 seater"* |
| `transmission` | `text` | YES | | `CHECK (transmission IN ('Automatic','Manual','CVT','Dual Clutch','Other'))` | *"automatic"*. Domain is identical to `cars.transmission` on purpose |
| `drivetrain` | `text` | YES | | `CHECK (drivetrain IN ('FWD','RWD','AWD','4WD','Other'))` | Domain identical to `cars.drivetrain` |
| `fuel_type` | `text` | YES | | `CHECK (fuel_type IN ('Petrol','Diesel','Hybrid','Electric','CNG','LPG','Other'))` | Domain identical to `cars.fuel` |
| `condition` | `text` | YES | | `CHECK (condition IN ('New','Used','Certified'))` | Domain identical to `cars.condition` |
| `exterior_color` | `text` | YES | | | Matches `cars.color_name` (not the hex `cars.color`) |
| `min_year` | `int4` | YES | | `CHECK (min_year BETWEEN 1990 AND 2035)` | |
| `max_mileage` | `int4` | YES | | `CHECK (max_mileage >= 0)` | |
| `budget_min` | `int4` | YES | | `CHECK (budget_min >= 0)` | |
| `budget_max` | `int4` | YES | | `CHECK (budget_max >= budget_min)` | |
| `must_have_features` | `text[]` | YES | | | e.g. `['sunroof','leather','apple_carplay']`. `GIN` index |
| `never_want_features` | `text[]` | YES | | | Hard exclusions, applied with `NOT ILIKE ANY` |
| `source` | `text` | NO | `'manual'` | `CHECK (source IN ('manual','ai_inferred','imported'))` | |
| `confidence` | `numeric(3,2)` | YES | | `CHECK (confidence BETWEEN 0 AND 1)` | AI confidence when `source = 'ai_inferred'` |
| `created_at` | `timestamptz` | NO | `now()` | | |
| `updated_at` | `timestamptz` | NO | `now()` | | |
| `created_by` | `text` | YES | `'system'` | `CHECK (created_by = 'system' OR created_by ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')` | `auth.uid()`, else `'system'` |
| `updated_by` | `text` | YES | `'system'` | `CHECK (updated_by = 'system' OR updated_by ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')` | `auth.uid()`, else `'system'` |

**Indexes:** `btree (brand_id)`, `GIN (other_brand_ids)`, `GIN (must_have_features)`,
`btree (seater_count)`, `btree (transmission)`, `btree (condition)`

**Sample data** (one row per buyer, derived from the criteria stated in
`buyer_requests_rows.csv` and the live chat)

| profile_id | brand_id | other_brand_ids | body_type | seater_count | transmission | drivetrain | condition | min_year | budget_max | must_have_features | source | confidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `bdc31c9e-f6ed-40d0-a32f-706062f81d77` | → Ford | `[→ Toyota]` | SUV | 7 | Automatic | AWD | Used | 2021 | 65000 | `['sunroof','leather','apple_carplay']` | `ai_inferred` | 0.92 |
| `250d3f1c-3f4b-4cf6-8e7f-b1c972e2237f` | — | — | Sedan | — | Automatic | — | New | — | 45000 | `['sunroof']` | `manual` | 1.00 |
| `6c795ae0-edb8-4546-aef2-dab9edc2221f` | → Ford | — | — | 7 | Manual | — | Used | 2018 | 52000 | `['third_row']` | `ai_inferred` | 0.74 |

> **`body_type` is intentionally unconstrained here, and that is a correction.**
> An earlier draft of this table carried
> `CHECK (body_type IN ('Sedan','SUV','Sports Car','Hatchback','Truck','Van','Wagon','Convertible','Coupe'))`,
> which was wrong twice over. It omitted MUV, Luxury, Crossover and Supercar —
> values that appear 6, 5, 3 and 2 times respectively in the live `cars` data, so a
> buyer who wanted an MUV could not save the preference the matcher filters on. It
> also admitted `Truck`, `Van` and `Wagon`, which no live car carries, so the
> preference would match nothing. An exact list here and an open-ended list on
> `cars.body_type` (§5) is the wrong way round: the two columns are compared with
> `=` in the preference query below, so they must share one domain. Both are
> unconstrained, matching the `BodyType` schema in `design/openapi.yaml`, which is
> a plain `string` described as taxonomy-driven and expected to grow.

> **⚠️ `other_brand_ids` has no foreign key.** Postgres cannot attach a FK to array
> elements, so a deleted brand leaves an orphan uuid behind. Mitigated by
> `ON DELETE SET NULL` on `brand_id`, a periodic
> `DELETE FROM buyer_preference WHERE brand_id IS NULL AND other_brand_ids <@ ...`, and the
> fact that the array is a *soft* preference — an orphan is ignored by the match query
> rather than producing wrong results. The clean alternative is a 16th junction table,
> which the 15-table target rules out.
>
> `other_brand_ids` and `must_have_features` / `never_want_features` are the only arrays on
> a 1:1 row, and all three are deliberate: they are genuinely multi-valued attributes of a
> single buyer, which a FK-constrained junction table is the only other way to model — and
> that would add a 16th table. The three other arrays in the schema (`cars.images`,
> `buyer_requests.must_haves`, `deal_documents.image_paths`) hold opaque S3 keys or free
> tags and never needed element-level integrity.

**How a preference is applied**

```sql
SELECT c.*, b.name AS brand, b.country_code
FROM   cars c
JOIN   brands b ON b.id = c.brand_id
JOIN   buyer_preference p ON p.profile_id = auth.uid()
WHERE  c.status = 'active'
  AND (p.brand_id IS NULL OR c.brand_id = p.brand_id
                             OR c.brand_id = ANY (p.other_brand_ids))
  AND (p.body_type      IS NULL OR c.body_type      = p.body_type)
  AND (p.seater_count   IS NULL OR c.seating_capacity >= p.seater_count)
  AND (p.transmission   IS NULL OR c.transmission   = p.transmission)
  AND (p.drivetrain     IS NULL OR c.drivetrain     = p.drivetrain)
  AND (p.condition      IS NULL OR c.condition      = p.condition)
  AND (p.exterior_color IS NULL OR c.color_name     = p.exterior_color)
  AND (p.min_year       IS NULL OR c.model_year    >= p.min_year)
  AND (p.max_mileage    IS NULL OR c.mileage       <= p.max_mileage)
  AND (p.budget_max     IS NULL OR c.price         <= p.budget_max)
  AND (p.budget_min     IS NULL OR c.price         >= p.budget_min)
  AND NOT EXISTS (SELECT 1 FROM unnest(p.never_want_features) f
                  WHERE c.title ILIKE '%' || f || '%')
ORDER BY CASE WHEN c.brand_id = p.brand_id THEN 0 ELSE 1 END, c.price ASC;
```

Every `NULL` preference column is a wildcard, so a partial statement like *"I like Ford"*
still matches the whole catalogue. A buyer with no row in `buyer_preference` gets no
filtering at all, which is the desired default.

---

## 7. Request → Deal

### 7.1 `buyer_requests`

The `requirements` JSONB blob is **removed** and decomposed into 20 typed columns. The
buyer's criteria are now directly comparable against `cars` columns in SQL.

**Columns**

| Name | Type | Null | Default | Key / Constraints | Notes |
|---|---|---|---|---|---|
| `id` | `uuid` | NO | `gen_random_uuid()` | **PK** | |
| `buyer_id` | `uuid` | NO | — | `REFERENCES profiles(id) ON DELETE CASCADE` | |
| `brand_id` | `uuid` | YES | | `REFERENCES brands(id) ON DELETE RESTRICT` | Marque-level match. Marque-*origin* match (e.g. "show me Indian cars") is not stored on the request — resolve it at match time by joining `cars → brands` and filtering `brands.country_code`, since one brand is the natural unit for origin |
| `buyer_area_state_id` | `uuid` | YES | | `REFERENCES states(id) ON DELETE SET NULL` | **New** — `buyer_area` |
| `model` | `text` | YES | | | Free text: `Bronco`, `Mustang GT` |
| `trim` | `text` | YES | | | |
| `body_type` | `text` | YES | | | `Sedan`, `SUV`, `Sports Car` … |
| `fuel_type` | `text` | YES | | | `Petrol`, `Diesel`, `Electric`, `CNG` |
| `transmission` | `text` | YES | | | `Automatic`, `Manual` |
| `drivetrain` | `text` | YES | | | |
| `condition` | `text` | YES | | `CHECK (condition IN ('New','Used','Certified'))` | |
| `color` | `text` | YES | | | |
| `year_min` | `int4` | YES | | `CHECK (year_min BETWEEN 1990 AND 2035)` | Range, not a point |
| `year_max` | `int4` | YES | | `CHECK (year_max >= year_min)` | |
| `budget_min` | `numeric(12,2)` | YES | | `CHECK (budget_min >= 0)` | |
| `budget_max` | `numeric(12,2)` | YES | | `CHECK (budget_max >= budget_min)` | |
| `target_otd_price` | `numeric(12,2)` | YES | | `CHECK (target_otd_price >= 0)` | Was `'Target Quote Price'` |
| `paying_with` | `text` | YES | | | Was `'Paying With'` |
| `trade_in` | `boolean` | YES | `false` | | |
| `must_haves` | `text[]` | NO | `'{}'::text[]` | | Was `'Must Haves'` |
| `search_radius_miles` | `int4` | YES | | `CHECK (search_radius_miles > 0)` | Was `'Search Radius'` |
| `timeline` | `text` | YES | | `CHECK (timeline IN ('ASAP','Within 1 week','Within 2 weeks','Just exploring'))` | |
| `buyer_area` | `text` | YES | | | Free text: `Frisco`, `Downtown` |
| `request_expire` | `timestamptz` | YES | | **New** | "I need this car in 20 days" |
| `additional_information` | `text` | YES | | **New** | Free-form anything else |
| `market_brief` | `jsonb` | YES | | | AI research brief |
| `coordinates` | `geography(Point,4326)` | YES | | `GIST` | |
| `status` | `text` | NO | `'draft'` | `CHECK (status IN ('draft','open','closed','expired','fulfilled'))` | |
| `created_at` | `timestamptz` | NO | `now()` | | |
| `updated_at` | `timestamptz` | NO | `now()` | | |
| `created_by` | `text` | YES | `'system'` | `CHECK (created_by = 'system' OR created_by ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')` | `auth.uid()`, else `'system'` |
| `updated_by` | `text` | YES | `'system'` | `CHECK (updated_by = 'system' OR updated_by ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')` | `auth.uid()`, else `'system'` |

**Indexes**
- `btree (buyer_id, created_at DESC)` — buyer request list
- `btree (status, created_at DESC) WHERE status = 'open'` — **partial**, seller feed
- `btree (brand_id, body_type, budget_max)` — matching
- `btree (request_expire) WHERE status = 'open'` — **partial**, expiry sweep
- `GIST (coordinates)`

**`request_expire` vs `expires_at`.** These are different concepts and both are retained:

| | `buyer_requests.request_expire` | `deal_quotes.expires_at` |
|---|---|---|
| Meaning | "I need the car by …" — buyer deadline | "This quote is valid until …" — dealer deadline |
| Owner | Buyer | Dealer |
| Set by | Conversational AI ("I need it in 20 days") | Dealer at quote creation |

**Sample data** (real rows, decomposed from `requirements` JSONB in `buyer_requests_rows.csv`)

| id | buyer_id | brand_id | model | body_type | fuel_type | transmission | condition | year_min | budget_max | target_otd_price | search_radius_miles | timeline | buyer_area | buyer_area_state_id | status | request_expire |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `0b77057f-ed69-44bd-910d-34bf19f42e3e` | `bdc31c9e-…` | → `ford` | Bronco | Sedan | Gasoline | Automatic | New | 2025 | 45000 | 42000 | 50 | Within 2 weeks | Frisco | → `TX` | open | 2026-09-29 08:07:09+00 |
| `15348fd2-764e-4e06-a5ec-6ffa6a08ecc5` | `250d3f1c-…` | → `ford` | Mustang GT | Sports Car | — | — | New | | | | 100 | Just exploring | Frisco | → `TX` | open | NULL |
| `15cd4afa-fcf7-4fc0-9af6-ca56d49f5fbb` | `bdc31c9e-…` | → `honda` | Jazz | Hatchback | Petrol | Automatic | New | 2026 | 30000 | 28000 | 25 | Within 1 week | Frisco | → `TX` | open | 2026-09-20 12:00:00+00 |
| `2d2db297-0598-480b-87d8-f2b0a811fe57` | `bdc31c9e-…` | → `bmw` | 5 Series | Sedan | Petrol | Automatic | New | 2024 | 80000 | 70000 | 50 | Within 2 weeks | Dallas | → `TX` | open | 2026-10-15 12:00:00+00 |

`market_brief` for `15cd4afa-…` (real, truncated):

```json
{"summary": "The 2026 Honda Jazz has been officially launched in China …",
 "highlight": "The Honda Jazz is a well-respected small car with a practical interior …",
 "caution": "Some owners report issues with battery drain and air conditioning faults …",
 "price_band_low": 24000, "price_band_high": 25000}
```

**Status distribution in live data:** `open` 27, `expired` 10, `closed` 4, `draft` 1
(of 42 rows). Note `expired` is produced by a `pg_cron` job — see §11.

---

### 7.2 `deal_quotes` (was `dealer_quotes`)

**Changes vs live:** renamed `request_id` → `buyer_request_id`; renamed `otd_total` →
`final_price`; added `deal_documents_id`; dropped `notes`, `files`, `quote_history`,
`deal_status`, `deal_history`.

**Columns**

| Name | Type | Null | Default | Key / Constraints | Notes |
|---|---|---|---|---|---|
| `id` | `uuid` | NO | `gen_random_uuid()` | **PK** | |
| `buyer_request_id` | `uuid` | NO | — | `REFERENCES buyer_requests(id) ON DELETE CASCADE` | **renamed from `request_id`** |
| `buyer_id` | `uuid` | NO | — | `REFERENCES profiles(id) ON DELETE RESTRICT` | Denormalised for fast feed |
| `dealer_id` | `uuid` | NO | — | `REFERENCES profiles(id) ON DELETE RESTRICT` | Denormalised for fast feed |
| `price` | `numeric(12,2)` | NO | — | `CHECK (price >= 0)` | Base price |
| `vehicle_price` | `numeric(12,2)` | YES | | `CHECK (vehicle_price >= 0)` | |
| `doc_fee` | `numeric(12,2)` | YES | `0` | `CHECK (doc_fee >= 0)` | Documentation fee |
| `sales_tax` | `numeric(12,2)` | YES | `0` | `CHECK (sales_tax >= 0)` | |
| `title_reg` | `numeric(12,2)` | YES | `0` | `CHECK (title_reg >= 0)` | Title & registration |
| `trade_in_credit` | `numeric(12,2)` | YES | `0` | `CHECK (trade_in_credit >= 0)` | Reduces the amount payable |
| `final_price` | `numeric(12,2)` | NO | — | `CHECK (final_price >= 0)` | **renamed from `otd_total`.** Out-the-door total, the leaderboard sort key |
| `message` | `text` | YES | | | Dealer pitch |
| `deal_documents_id` | `uuid` | YES | | `REFERENCES deal_documents(id) ON DELETE SET NULL` | **New.** Pointer to the quote's *current* document set — see note below |
| `status` | `text` | NO | `'pending'` | `CHECK (status IN ('pending','negotiating','accepted','declined','withdrawn','expired'))` | |
| `read_by_buyer` | `boolean` | NO | `false` | | Drives notification badge |
| `expires_at` | `timestamptz` | YES | | | Quote validity window |
| `accepted_at` | `timestamptz` | YES | | | Set when `status`→`accepted` |
| `deal_comments` | `text` | YES | | | |
| `buyer_chat_cleared_at` | `timestamptz` | YES | | | Per-side chat soft-delete |
| `dealer_chat_cleared_at` | `timestamptz` | YES | | | Per-side chat soft-delete |
| `created_at` | `timestamptz` | NO | `now()` | | |
| `updated_at` | `timestamptz` | NO | `now()` | | |
| `created_by` | `text` | YES | `'system'` | `CHECK (created_by = 'system' OR created_by ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')` | `auth.uid()`, else `'system'` |
| `updated_by` | `text` | YES | `'system'` | `CHECK (updated_by = 'system' OR updated_by ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')` | `auth.uid()`, else `'system'` |

**The price breakdown.** `price` and `vehicle_price` overlap, and `final_price` is a
stored total rather than a derived one. The live data shows both being written with the
same value, so treat `vehicle_price` as the itemised base and `price` as a legacy
alias kept for the existing feed. The relationship that must hold is:

```
final_price = vehicle_price + doc_fee + sales_tax + title_reg - trade_in_credit
```

**Enforce it with a generated column, not a trigger.** Postgres 12+ can compute the total
so it can never drift from its components:

```sql
final_price numeric(12,2) GENERATED ALWAYS AS
  (vehicle_price + COALESCE(doc_fee,0) + COALESCE(sales_tax,0)
   + COALESCE(title_reg,0) - COALESCE(trade_in_credit,0)) STORED
```

If a dealer must be able to override the arithmetic (discounts, rebates), drop the
generated column and add `CHECK (final_price >= 0)` plus a nightly reconciliation query —
but do not keep both a stored total and independent editable components without that check.

> **`deal_documents_id` creates a circular FK, and it is deliberate.**
> `deal_documents.quote_id → deal_quotes.id` is the *owning* 1:N side (a quote has many
> document uploads). `deal_quotes.deal_documents_id → deal_documents.id` is a convenience
> pointer to the **current** set, so the quote screen does not need a subquery to find the
> latest proofs. The live data genuinely has one quote with two document rows
> (`d3f827dc-…` → `3dae9583-…` and `b447e69b-…`), so this is a pointer, **not** a 1:1
> relationship — do not add `UNIQUE` to `deal_documents.quote_id`.
>
> The cycle is safe because `deal_documents_id` is nullable: insert the quote with
> `deal_documents_id = NULL`, insert the documents, then `UPDATE` the pointer. No
> `DEFERRABLE` needed. `ON DELETE SET NULL` (not `CASCADE`) prevents a double cascade path
> when a quote is deleted and takes its documents with it.

**Removed columns**

| Column | Was | Why removed |
|---|---|---|
| `notes` | `text`, 0/39 rows populated | Never used. `message` covers it |
| `files` | `jsonb`, 13/39 rows = base64 data-URLs | Binary does not belong in a row. Moved to `deal_documents.image_paths` |
| `quote_history` | `jsonb`, 4/39 rows | **⚠ See §11 — this powered price-revision ranking** |
| `deal_status` | `text`, 39/39 rows populated | **⚠ See §11.2 — deletes a live feature with no replacement** |
| `deal_history` | `jsonb`, 9/39 rows populated | **⚠ See §11.2 — 9 rows of real data are discarded** |

**Indexes**
- `btree (buyer_request_id, final_price ASC, created_at ASC)` — **the leaderboard index** (lowest total wins, earliest breaks ties)
- `btree (buyer_id, status, created_at DESC)` — buyer's order list
- `btree (dealer_id, created_at DESC)` — dealer's quote list
- `btree (expires_at) WHERE status IN ('pending','negotiating')` — partial, expiry sweep
- `btree (buyer_id) WHERE read_by_buyer = false` — partial, unread badge
- `btree (deal_documents_id)` — resolves the pointer

**`UNIQUE (buyer_request_id, dealer_id)`** — recommended. 39 live rows across 22 requests
and 11 dealers, with no duplicate `(request, dealer)` pair observed. A dealer must not
submit two competing quotes on the same request.

**Sample data** (real rows, `dealer_quotes_rows.csv`)

| id | buyer_request_id | buyer_id | dealer_id | vehicle_price | doc_fee | sales_tax | title_reg | trade_in_credit | final_price | status | read_by_buyer | expires_at |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `118bd33a-9443-4951-a038-a3ab811284e4` | `af9c2c71-c3f0-4d23-be56-d5c6193d20a8` | `34a553f7-…` | `6c795ae0-…` | 65345.00 | 800.00 | 4084.00 | 0.00 | 0.00 | 70229.00 | pending | false | 2026-09-10 14:09:05+00 |
| `2fa7ac94-8871-4909-8175-438a4ca16c41` | `c327f8a9-094b-4c03-b00a-5bb901625f37` | `bdc31c9e-…` | `82d81b31-…` | 32600.00 | 150.00 | 2038.00 | 203.00 | 0.00 | 34991.00 | accepted | true | NULL |

> The live rows are internally consistent: `65345 + 800 + 4084 + 0 - 0 = 70229` and
> `32600 + 150 + 2038 + 203 - 0 = 34991`. So the generated-column definition above
> reproduces the real `otd_total` values exactly and can be backfilled without reconciliation.

`message` for `118bd33a-…` (real):
> "In-stock Blueprint XLE AWD with blind-spot monitor and roof rails. Price includes all
> fees — financing available at 5.9% APR for qualified buyers. Happy to lock this in today."

**Status distribution in live data:** `pending` 24, `accepted` 14, `negotiating` 1.

> The `deal_status` values are dropped from this table entirely, so the live distribution
> `Paperwork going on` 31, `Dispatch` 3, `Funds Arranged` 2, `Paperwork ready` 1,
> `Delivery` 1, `Withdrawn` 1 is recorded here only as migration evidence. See §11.2.

---

### 7.3 `deal_chats` — unchanged

Post-acceptance buyer↔dealer messaging, scoped to a quote. Only the audit columns are added.

**Columns**

| Name | Type | Null | Default | Key / Constraints | Notes |
|---|---|---|---|---|---|
| `id` | `uuid` | NO | — | **PK** | Client-generated (`crypto.randomUUID()`) for optimistic UI |
| `quote_id` | `uuid` | NO | — | `REFERENCES deal_quotes(id) ON DELETE CASCADE` | |
| `sender_id` | `uuid` | NO | — | `REFERENCES profiles(id) ON DELETE CASCADE` | |
| `message` | `text` | NO | — | `CHECK (length(message) > 0)` | |
| `created_at` | `timestamptz` | NO | `now()` | | **added** |
| `updated_at` | `timestamptz` | NO | `now()` | | **added** |
| `created_by` | `text` | YES | `'system'` | `CHECK (created_by = 'system' OR created_by ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')` | `auth.uid()`, else `'system'` — **added** |
| `updated_by` | `text` | YES | `'system'` | `CHECK (updated_by = 'system' OR updated_by ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')` | `auth.uid()`, else `'system'` — **added** |

**Indexes:** `btree (quote_id, created_at ASC)`, `btree (sender_id, created_at DESC)`

**Soft delete** is per-side via `deal_quotes.buyer_chat_cleared_at` /
`dealer_chat_cleared_at`; rows are never deleted.

**Sample data** (real rows, `deal_chats_rows.csv`)

| id | quote_id | sender_id | message | created_at |
|---|---|---|---|---|
| `05fd4db1-df75-4305-b766-66cf289f208c` | `2fa7ac94-…` | `bdc31c9e-…` (buyer) | "Hi Premium Auto Sales, I'm ready with my funds arrangement. I'll be financing the remaining balance of $34,691 with a loan. …" | 2026-09-09 17:28:46+00 |
| `3eadf8fa-b3b6-4f13-8a3c-0941bc1a74db` | `b5a5e627-…` | `82d81b31-…` (dealer) | "2days" | 2026-08-28 08:08:08+00 |
| `5a39b264-1d24-4bfa-be42-afce5fc67954` | `3e2c0f81-…` | `bdc31c9e-…` (buyer) | "I have accepted your quote! Let's finalize the details." | 2026-09-28 11:14:03+00 |
| `5ab68b0f-66f8-4711-8c35-d4250fb6ee88` | `2fa7ac94-…` | `82d81b31-…` (dealer) | "…" | 2026-08-20 15:45:11+00 |

---

### 7.4 `deal_documents` — reshaped for S3

**Removed:** `file_name`, `doc_type`, `storage_path`, `uploaded_at` (→ `created_at`),
`deal_status` (redundant with `deal_quotes.deal_status`).
**Added:** `image_paths` (jsonb array), `document_path` (text).

**Columns**

| Name | Type | Null | Default | Key / Constraints | Notes |
|---|---|---|---|---|---|
| `id` | `uuid` | NO | `gen_random_uuid()` | **PK** | |
| `quote_id` | `uuid` | NO | — | `REFERENCES deal_quotes(id) ON DELETE CASCADE` | |
| `dealer_id` | `uuid` | NO | — | `REFERENCES profiles(id) ON DELETE CASCADE` | |
| `image_paths` | `jsonb` | NO | `'[]'::jsonb` | `CHECK (jsonb_typeof(image_paths) = 'array')` | **Array of S3 keys.** e.g. `["<quote_id>/1788874160802.png"]` |
| `document_path` | `text` | YES | | S3 key, e.g. `<quote_id>/1788976307405.pdf` | One document per row |
| `created_at` | `timestamptz` | NO | `now()` | | Was `uploaded_at` |
| `updated_at` | `timestamptz` | NO | `now()` | | |
| `created_by` | `text` | YES | `'system'` | `CHECK (created_by = 'system' OR created_by ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')` | `auth.uid()`, else `'system'` |
| `updated_by` | `text` | YES | `'system'` | `CHECK (updated_by = 'system' OR updated_by ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')` | `auth.uid()`, else `'system'` |

**Design rationale.** `doc_type` was derived purely from the file extension
(`Seller.jsx:1289` — `.pdf` → `Document`, everything else → `Image`), which mis-filed
`.docx` as an image. The distinction is now structural: an `image_paths` array means
screenshots/photos, a `document_path` means a real document. No classification logic
needed, and multi-image sets are first-class (the old `doc_type` could not represent them).

**`file_name` removal.** The S3 key carries the extension, and the original filename was
never needed server-side. If a human-readable label is required, derive it from the key
basename at read time.

**Indexes:** `btree (quote_id, created_at DESC)`, `btree (dealer_id)`

**Sample data** (real rows, `deal_documents_rows.csv` — 10 rows; `image_paths` /
`document_path` derived from the live `storage_path` column)

| id | quote_id | dealer_id | image_paths | document_path | created_at |
|---|---|---|---|---|---|
| `11645219-8edf-4264-b8ce-4e3e3a4fa08f` | `724c2d61-…` | `82d81b31-…` | `[]` | `724c2d61-b1be-47ba-9458-0f4001204a1b/1788875882219.pdf` | 2026-09-08 13:58:04+00 |
| `1f15297b-ecb4-44f4-ac24-8c66c902384a` | `30655845-…` | `6c795ae0-…` | `[]` | `30655845-5bc4-439d-ad13-02ad86c5bd0a/1788877536663.pdf` | 2026-09-08 14:25:37+00 |
| `3dae9583-389c-44ba-9a06-7db3f20f8db1` | `d3f827dc-…` | `82d81b31-…` | `["d3f827dc-9744-4601-a80f-73dc5b1d60cd/1788874160802.png"]` | `NULL` | 2026-09-08 13:29:21+00 |
| `b447e69b-7a83-47cf-acdf-7f21eac486bb` | `d3f827dc-…` | `82d81b31-…` | `[]` | `d3f827dc-9744-4601-a80f-73dc5b1d60cd/1788976307405.pdf` | 2026-09-09 17:51:50+00 |
| `c0684f2b-654e-456a-a228-d5d3f789affe` | `e8c57e13-…` | `79d4770e-…` | `[]` | `e8c57e13-6e33-459d-85be-6441e25a7e93/1788884844538.pdf` | 2026-09-08 16:27:25+00 |

> The live `deal_documents.deal_status` column is dropped. 9 of 9 non-null values simply
> mirrored `deal_quotes.deal_status`, so the same logical state was stored in two places
> and could drift.

---

## 8. Support

### 8.1 `support_tickets` (merged customer + dealer)

**Columns**

| Name | Type | Null | Default | Key / Constraints | Notes |
|---|---|---|---|---|---|
| `id` | `uuid` | NO | `gen_random_uuid()` | **PK** | |
| `ticket_id` | `text` | NO | — | `UNIQUE (category, ticket_id)` | Human ref: `TIC-316519`, `DS9940692696` |
| `category` | `text` | NO | — | `CHECK (category IN ('customer','dealer','internal'))` | **New** — segregates the two streams |
| `caller_id` | `uuid` | YES | | `REFERENCES profiles(id) ON DELETE SET NULL` | |
| `caller_email` | `text` | YES | | | Denormalised, survives account deletion |
| `issue_summary` | `text` | NO | — | | |
| `issue_description` | `text` | YES | | | |
| `issue_image_url` | `text` | YES | | | Screenshot of the fault |
| `status` | `text` | NO | `'new'` | `CHECK (status IN ('new','in-progress','on-hold','resolved','closed'))` | |
| `priority` | `text` | NO | `'medium'` | `CHECK (priority IN ('low','medium','high','urgent'))` | |
| `notes` | `jsonb` | NO | `'[]'::jsonb` | `CHECK (jsonb_typeof(notes) = 'array')` | Timeline of agent comments |
| `rca` | `text` | YES | | | Root-cause analysis |
| `created_at` | `timestamptz` | NO | `now()` | | |
| `updated_at` | `timestamptz` | NO | `now()` | | |
| `created_by` | `text` | YES | `'system'` | `CHECK (created_by = 'system' OR created_by ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')` | `auth.uid()`, else `'system'` |
| `updated_by` | `text` | YES | `'system'` | `CHECK (updated_by = 'system' OR updated_by ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')` | `auth.uid()`, else `'system'` |

**Indexes:** `UNIQUE (category, ticket_id)`, `btree (category, status, priority)`,
`btree (caller_id, created_at DESC)`

> **Why `UNIQUE (category, ticket_id)` and not `UNIQUE (ticket_id)`.** The two legacy
> tables used disjoint prefixes (`TIC-` vs `DS…`), so a bare unique constraint happens to
> work today — but it makes the two tables inseparable. Including `category` lets both
> streams coexist safely and lets a future `internal` category reuse any prefix.

**Sample data** (real rows, merged from both legacy CSVs)

| id | ticket_id | category | caller_id | caller_email | issue_summary | status | priority | created_at |
|---|---|---|---|---|---|---|---|---|
| `812a926c-7600-4e48-9185-b337b5f02883` | `TIC-316519` | customer | `bdc31c9e-…` | yuvi01@gmail.com | The web page was more slow | new | medium | 2026-09-02 14:54:45+00 |
| `649fa8a9-0c1f-45d2-b911-74d682a4f551` | `DS9940692696` | dealer | `82d81b31-…` | rahul01@gmail.com | Bidding is not working properly | in-progress | medium | 2026-09-02 21:03:24+00 |

`notes` for `812a926c-…` (real):
```json
[{"ts": "2026-09-02T16:09:03.244Z", "text": "working", "agent": "support02@gmail.com"}]
```

`rca` for `649fa8a9-…` (real, truncated):
> "A developer error in the backend integration caused the bidding service to query the
> database incorrectly, preventing the correct bidding function from being retrieved."

---

### 8.2 `support_verifications` (merged agent + dealer)

**Removed:** `profile_data` — a full JSONB dump of the `profiles` row. Read through
`profile_id` instead; a denormalised copy cannot stay in sync.

**Columns**

| Name | Type | Null | Default | Key / Constraints | Notes |
|---|---|---|---|---|---|
| `id` | `uuid` | NO | `gen_random_uuid()` | **PK** | |
| `ticket_id` | `text` | NO | — | `UNIQUE (category, ticket_id)` | `DV1788882726`, `SA97379` |
| `category` | `text` | NO | — | `CHECK (category IN ('dealer','agent','customer'))` | **New** — replaces the split tables |
| `profile_id` | `uuid` | YES | | `REFERENCES profiles(id) ON DELETE CASCADE` | Subject of the verification |
| `proof_docs` | `jsonb` | NO | `'[]'::jsonb` | `CHECK (jsonb_typeof(proof_docs) = 'array')` | S3 keys of uploaded proof |
| `status` | `text` | NO | `'pending'` | `CHECK (status IN ('pending','approved','denied','rejected'))` | |
| `notes` | `jsonb` | NO | `'[]'::jsonb` | `CHECK (jsonb_typeof(notes) = 'array')` | Decision trail |
| `email_sent` | `boolean` | NO | `false` | | Notification flag |
| `created_at` | `timestamptz` | NO | `now()` | | |
| `updated_at` | `timestamptz` | NO | `now()` | | |
| `created_by` | `text` | YES | `'system'` | `CHECK (created_by = 'system' OR created_by ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')` | `auth.uid()`, else `'system'` |
| `updated_by` | `text` | YES | `'system'` | `CHECK (updated_by = 'system' OR updated_by ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')` | `auth.uid()`, else `'system'` |

**Indexes:** `UNIQUE (category, ticket_id)`, `btree (profile_id)`,
`btree (status, created_at DESC) WHERE status = 'pending'`

**Sample data** (real rows, merged from `support_dealer_verifications_rows.csv` + `support_agent_verifications_rows.csv`)

| id | ticket_id | category | profile_id | status | email_sent | created_at |
|---|---|---|---|---|---|---|
| `000ed3fe-4945-4199-a95a-4a6dff3800c5` | `DV1788882726` | dealer | `b866fe89-31a1-4b14-9247-118c83c8210c` | approved | true | 2026-09-08 15:52:05+00 |
| `0bebb0c3-29f1-44f4-b122-a88fba122e34` | `DV1788278835` | dealer | `7ab81d0f-db7f-42fb-8b44-f1bd7ed08687` | denied | true | 2026-09-01 16:07:14+00 |
| `4cac1879-8502-42ba-8140-d321aba9b77` | `DV1788793917` | dealer | `c5d69c6d-f348-4bba-bfac-9f295b7984de` | pending | false | 2026-09-08 09:14:22+00 |
| `624abc59-cc81-4b08-85f9-89d26f621e8f` | `DV-MANUAL` | dealer | `82d81b31-cf25-438c-a293-62c0ec219876` | approved | true | 2026-09-09 11:02:00+00 |
| `b1e876b4-da1f-41e6-9eaf-1955cf13af4f` | `SA97379` | agent | `4772bb1a-ee75-4f45-b8e6-53d70f6e42b1` | approved | true | 2026-09-02 20:11:16+00 |

**Status distribution:** `approved` 8, `denied` 3, `pending` 1 (11 dealer rows) +
1 agent row approved.

> `DV-MANUAL` is a hand-created reference row in the live data. It is kept here as-is;
> if it is test residue it should be deleted rather than migrated.
>
> One live row has a **NULL `profile_id`** (`fe9ac6f0-…`, ticket `DV1788349154`) — an
> orphan with no subject. Either backfill it or drop the row during migration.

---

## 9. Observability

### 9.1 `llm_audits`

One row per LLM invocation. Adapted from the supplied SQLAlchemy model.

| Original | Change | Reason |
|---|---|---|
| `id` `int` PK autoincrement | **kept** | High-volume append-only log; uuid PK would bloat the index |
| `uuid` | kept | Client-side correlation id |
| `task_type`, `model_name`, `input_tokens`, `output_tokens`, `total_tokens`, `latency_ms`, `status`, `is_active`, `is_deleted` | kept | |
| `email_id` FK → `emails.id` | **dropped** | No `emails` table in this project |
| `chat_message_id` FK → `chat_messages.id` | **dropped → `thread_id`** | `chat_messages` is removed; `thread_id` links to `conversation_history` |
| `modified_at` | **renamed** `updated_at` | Standardised across all 16 tables |
| `modified_by` | **renamed** `updated_by` | Standardised across all 16 tables |
| — | **added** `uuid`, `provider`, `error_code`, `updated_at`, `updated_by` | Correlation + failure diagnosis |

**Columns**

| Name | Type | Null | Default | Key / Constraints | Notes |
|---|---|---|---|---|---|
| `id` | `bigserial` | NO | `nextval(…)` | **PK** | |
| `uuid` | `uuid` | NO | `gen_random_uuid()` | `UNIQUE` | Public correlation id |
| `task_type` | `varchar(50)` | NO | — | `CHECK (task_type IN ('chat_completion','car_validation','quote_scoring','negotiation_offer','rag_retrieval','embedding','summarization','classification'))` | `'embedding'` is **historical only** — kept so the constraint is not rewritten. No embedding call is ever logged in this build; retrieval is `'rag_retrieval'` |
| `provider` | `varchar(50)` | NO | — | `CHECK (provider IN ('groq','google','openai','anthropic','aws_bedrock'))` | New |
| `model_name` | `varchar(100)` | NO | — | | e.g. `openai/gpt-oss-120b` |
| `thread_id` | `text` | YES | | | Soft link to `conversation_history` (no FK — high churn) |
| `input_tokens` | `integer` | NO | `0` | `CHECK (input_tokens >= 0)` | |
| `output_tokens` | `integer` | NO | `0` | `CHECK (output_tokens >= 0)` | |
| `total_tokens` | `integer` | NO | `0` | `CHECK (total_tokens >= 0)` | Should be generated from the two above |
| `latency_ms` | `integer` | YES | | `CHECK (latency_ms >= 0)` | |
| `status` | `varchar(50)` | NO | — | `CHECK (status IN ('success','error','timeout','rate_limited','refused','content_filtered'))` | |
| `error_code` | `varchar(100)` | YES | | | New — when `status <> 'success'` |
| `is_active` | `boolean` | NO | `true` | | |
| `is_deleted` | `boolean` | NO | `false` | | Soft delete for PII scrub |
| `created_at` | `timestamptz` | NO | `now()` | | |
| `updated_at` | `timestamptz` | NO | `now()` | | |
| `created_by` | `text` | YES | `'system'` | `CHECK (created_by = 'system' OR created_by ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')` | `auth.uid()`, else `'system'` |
| `updated_by` | `text` | YES | `'system'` | `CHECK (updated_by = 'system' OR updated_by ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')` | `auth.uid()`, else `'system'` |

> **Generated column recommended:** replace the app-supplied `total_tokens` with
> `GENERATED ALWAYS AS (input_tokens + output_tokens) STORED` so it cannot drift.

**Indexes:** `UNIQUE (uuid)`, `btree (created_at DESC)`, `btree (task_type, created_at DESC)`,
`btree (model_name, created_at DESC)`, `btree (status) WHERE status <> 'success'`

**Sample data** (model names are the real ones in use)

| id | uuid | task_type | provider | model_name | thread_id | input_tokens | output_tokens | total_tokens | latency_ms | status |
|---|---|---|---|---|---|---|---|---|---|---|
| 100001 | `a1b2c3d4-0001-4e5f-8a9b-0c1d2e3f4a5b` | chat_completion | groq | `openai/gpt-oss-120b` | `dce16b4b-9378-…` | 1840 | 412 | 2252 | 2310 | success |
| 100002 | `a1b2c3d4-0002-4e5f-8a9b-0c1d2e3f4a5b` | car_validation | groq | `openai/gpt-oss-20b` | `1df42731-daa9-…` | 620 | 88 | 708 | 940 | success |
| 100003 | `a1b2c3d4-0003-4e5f-8a9b-0c1d2e3f4a5b` | quote_scoring | google | `gemini-2.0-flash` | NULL | 2310 | 195 | 2505 | 1180 | success |
| 100004 | `a1b2c3d4-0004-4e5f-8a9b-0c1d2e3f4a5b` | embedding | google | `gemini-embedding-001` | NULL | 145 | 0 | 145 | 210 | success |
| 100005 | `a1b2c3d4-0005-4e5f-8a9b-0c1d2e3f4a5b` | negotiation_offer | groq | `openai/gpt-oss-120b` | `neg_2fa7ac94-…` | 3120 | 340 | 3460 | 4520 | error |

> Row 100004 is **real historical data** from the live system, retained so the
> table reads truthfully. This build never writes an `embedding` audit row — do
> not treat it as a pattern to copy.

---

### 9.2 `error_logs`

Backend error capture. Complements `llm_audits` (which only covers LLM calls).

**Columns**

| Name | Type | Null | Default | Key / Constraints | Notes |
|---|---|---|---|---|---|
| `id` | `bigserial` | NO | `nextval(…)` | **PK** | |
| `uuid` | `uuid` | NO | `gen_random_uuid()` | `UNIQUE` | Correlation id, shared with logs/traces |
| `level` | `text` | NO | `'ERROR'` | `CHECK (level IN ('DEBUG','INFO','WARN','ERROR','FATAL'))` | |
| `error_code` | `varchar(100)` | YES | | | Application code, e.g. `BID_QUERY_INVALID` |
| `error_message` | `text` | NO | — | `CHECK (length(error_message) > 0)` | |
| `stack_trace` | `text` | YES | | | Truncated to 8 KB |
| `source` | `text` | NO | — | `CHECK (source IN ('frontend','backend','agent','edge_function','worker','cron'))` | |
| `endpoint` | `text` | YES | | | Route or function name |
| `request_id` | `text` | YES | | | Traces a whole request |
| `thread_id` | `text` | YES | | | Link to `conversation_history` |
| `user_id` | `uuid` | YES | | `REFERENCES profiles(id) ON DELETE SET NULL` | |
| `environment` | `text` | NO | `'production'` | `CHECK (environment IN ('development','staging','production'))` | |
| `error_context` | `jsonb` | NO | `'{}'::jsonb` | | Request payload / env snapshot, PII-scrubbed |
| `created_at` | `timestamptz` | NO | `now()` | | |
| `updated_at` | `timestamptz` | NO | `now()` | | |
| `created_by` | `text` | YES | `'system'` | `CHECK (created_by = 'system' OR created_by ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')` | `auth.uid()`, else `'system'` |
| `updated_by` | `text` | YES | `'system'` | `CHECK (updated_by = 'system' OR updated_by ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')` | `auth.uid()`, else `'system'` |

**Indexes:** `btree (created_at DESC)`, `btree (level, created_at DESC)`,
`btree (error_code, created_at DESC)`, `btree (request_id)`, `GIN (error_context)`

**Retention:** partition by month on `created_at`, drop partitions older than 90 days.

**Sample data** (synthesised from the real `rca` text found in the support CSVs)

| id | uuid | level | error_code | error_message | source | endpoint | user_id | environment | created_at |
|---|---|---|---|---|---|---|---|---|---|
| 500001 | `f0e1d2c3-0001-4a5b-9c8d-1e2f3a4b5c6d` | ERROR | `BID_QUERY_INVALID` | A developer error in the backend integration caused the bidding service to query the database incorrectly | backend | `/api/quotes/bid` | `82d81b31-cf25-438c-a293-62c0ec219876` | production | 2026-09-02 21:03:24+00 |
| 500002 | `f0e1d2c3-0002-4a5b-9c8d-1e2f3a4b5c6d` | WARN | `PAGE_SLOW` | All pages are slow — p95 render 4.2s | frontend | `/buyer/requests` | `bdc31c9e-f6ed-40d0-a32f-706062f81d77` | production | 2026-09-02 14:54:45+00 |
| 500003 | `f0e1d2c3-0003-4a5b-9c8d-1e2f3a4b5c6d` | ERROR | `LLM_TIMEOUT` | Model openai/gpt-oss-120b exceeded 30s budget | agent | `negotiation.offer` | NULL | production | 2026-09-09 17:31:10+00 |

---

## 10. ER diagram

### 10.1 Mermaid

The Mermaid ER diagram lives in a **separate file** so this document stays pure
Markdown and renders identically on GitHub, in VS Code and in PDF export.

> **See [`schema-erd.mmd`](./schema-erd.mmd)** for the `erDiagram` source.
> Render it at <https://mermaid.live>, or with the VS Code extension
> *Markdown Preview Mermaid Support*.
> CLI: `mmdc -i schema-erd.mmd -o erd.svg`

### 10.2 ASCII

```
                          ┌──────────┐        ┌──────────┐
                          │  states  │        │  brands  │  (master)
                          └────┬─────┘        └────┬─────┘
                     state_id  │              brand_id │
              ┌────────────────┼──────────────────────┼──────────────┐
              │                │                      │              │
        ┌─────▼─────┐    ┌─────▼─────┐          ┌─────▼─────┐  ┌─────▼─────┐
        │ profiles  │    │   cars    │          │buyer_req… │  │    cars   │
        │ (person)  │    │ (listing) │          │           │  │  (brand)  │
        └─────┬─────┘    └─────┬─────┘          └─────┬─────┘  └───────────┘
              │                │                      │
              │ 1:1            │ seller_id            │ buyer_request_id
        ┌─────▼─────┐          │                      │
        │   users   │          │                      │
        │(password) │          │                      │
        └───────────┘          │                      │
                               │                ┌─────▼──────┐
        ┌──────────────────────┴────────────────┤ deal_quotes │
        │                                        │            │
        │ buyer_id / dealer_id                   └──────┬─────┘
        │                                               │
        │              ┌────────────────┬─────────────┴──────┐
        │              │                │                    │
  ┌─────▼──────────────▼──┐   ┌─────────▼────────┐  ┌────────▼─────────┐
  │    deal_chats        │   │  deal_documents  │  │    error_logs    │
  │ (buyer↔dealer msgs)  │   │  (S3 keys)      │  │                  │
  └──────────────────────┘   └──────────────────┘  └──────────────────┘

  ┌────────────────────┐   ┌─────────────────────┐   ┌──────────────────────┐
  │ buyer_preference   │   │ conversation_history│   │      llm_audits      │
  │ (1:1 w/ profile)   │   │ (thread, checkpoint)│   │  (token/latency log) │
  │  brand, 7-seater,  │   └─────────────────────┘   └──────────────────────┘
  │  automatic, budget │
  └────────────────────┘

  ┌──────────────────┐   ┌──────────────────────┐   ┌─────────────────────┐
  │ support_tickets  │   │ support_verifications│   │      payments       │
  └──────────────────┘   └──────────────────────┘   │ profiles 1:N        │
                                                     │ (premium ledger)    │
                                                     └─────────────────────┘
```

### 10.3 Relationship matrix

| Parent | Child | Cardinality | FK column | On delete | Rationale |
|---|---|---|---|---|---|
| `auth.users` | `profiles` | 1:1 | `profiles.id` | CASCADE | Auth is the identity root |
| `profiles` | `users` | 1:1 | `users.profile_id` | CASCADE | `UNIQUE` enforces it |
| `states` | `profiles` | 1:N | `profiles.state_id` | SET NULL | Don't lose the profile |
| `states` | `cars` | 1:N | `cars.state_id` | SET NULL | |
| `states` | `buyer_requests` | 1:N | `buyer_requests.buyer_area_state_id` | SET NULL | |
| `brands` | `cars` | 1:N | `cars.brand_id` | RESTRICT | Can't orphan a listing |
| `brands` | `buyer_requests` | 1:N | `buyer_requests.brand_id` | SET NULL | |
| `profiles` | `cars` | 1:N | `cars.seller_id` | RESTRICT | |
| `profiles` | `buyer_requests` | 1:N | `buyer_requests.buyer_id` | CASCADE | Request dies with buyer |
| `profiles` | `buyer_preference` | 1:1 | `buyer_preference.profile_id` (PK + FK) | CASCADE | One row per buyer; no row = no preferences stated |
| `profiles` | `conversation_history` | 1:N | `conversation_history.user_id` | CASCADE | |
| `profiles` | `deal_quotes` (×2) | 1:N | `deal_quotes.buyer_id`, `.dealer_id` | RESTRICT | Financial record |
| `profiles` | `deal_chats` | 1:N | `deal_chats.sender_id` | CASCADE | |
| `profiles` | `deal_documents` | 1:N | `deal_documents.dealer_id` | CASCADE | |
| `profiles` | `support_tickets` | 1:N | `support_tickets.caller_id` | SET NULL | Ticket must outlive the user |
| `profiles` | `support_verifications` | 1:N | `support_verifications.profile_id` | CASCADE | |
| `profiles` | `error_logs` | 1:N | `error_logs.user_id` | SET NULL | |
| `profiles` | `payments` | 1:N | `payments.profile_id` | CASCADE | Subscription ledger; a refund/receipt must die with the subscriber |
| `buyer_requests` | `deal_quotes` | 1:N | `deal_quotes.buyer_request_id` | CASCADE | Full cleanup on request delete |
| `deal_quotes` | `deal_chats` | 1:N | `deal_chats.quote_id` | CASCADE | |
| `deal_quotes` | `deal_documents` | 1:N | `deal_documents.quote_id` | CASCADE | Owning side. Do **not** make this 1:1 |
| `deal_quotes` | `deal_documents` | N:1 pointer | `deal_quotes.deal_documents_id` | SET NULL | Convenience pointer to the current doc set; nullable, so the FK cycle is safe |
| `conversation_history` | `llm_audits` | 1:N | *(soft)* `llm_audits.thread_id` | — | No FK: high churn, would cascade-delete audit rows |
| `conversation_history` | `error_logs` | 1:N | *(soft)* `error_logs.thread_id` | — | Same |

> **Why `llm_audits.thread_id` and `error_logs.thread_id` have no FK.** Both are
> append-only logs that must survive deletion of the conversation they describe. A real FK
> with `ON DELETE CASCADE` would erase the cost/incident record. Enforce with a periodic
> orphan sweep instead.

---

## 11. Controlled vocabularies

| Table.Column | Domain | Notes |
|---|---|---|
| `profiles.role` | `buyer` \| `seller` \| `support` \| `admin` | Live counts: seller 17, buyer 8, support 1, admin 1. **`seller` is renamed to `dealer` by `solution-backend.md` §2 Delta 1** — "dealer" is the term everywhere downstream, this row records the live value |
| `cars.status` | `draft` \| `active` \| `sold` \| `removed` | Live: 84/85 `active` |
| `cars.body_type` | 10 observed values, unconstrained | SUV, Sedan, Hatchback, Coupe, MUV, Luxury, Sports Car, Crossover, Convertible, Supercar |
| `cars.fuel` | `Petrol` \| `Diesel` \| `Hybrid` \| `Electric` \| `CNG` \| `LPG` \| `Other` | Live: Petrol 47, Diesel 26, Hybrid 7, Electric 3, CNG 1 |
| `cars.transmission` | `Automatic` \| `Manual` \| `CVT` \| `Dual Clutch` \| `Other` | Live: Automatic 49, Manual 35 |
| `cars.drivetrain` | `FWD` \| `RWD` \| `AWD` \| `4WD` \| `Other` | New column |
| `cars.rating` | `numeric(2,1)`, 0–5 | Live range 4.8–4.9 |
| `buyer_requests.status` | `draft` \| `open` \| `closed` \| `expired` \| `fulfilled` | Live: open 27, expired 10, closed 4, draft 1 |
| `buyer_requests.condition` | `New` \| `Used` \| `Certified` | |
| `buyer_requests.timeline` | `ASAP` \| `Within 1 week` \| `Within 2 weeks` \| `Just exploring` | Live: 2 weeks 36, <2 weeks 2, 1 week 1, ASAP 1, exploring 1 |
| `deal_quotes.status` | `pending` \| `negotiating` \| `accepted` \| `declined` \| `withdrawn` \| `expired` | Live: pending 24, accepted 14, negotiating 1 |
| `deal_quotes.deal_status` *(dropped)* | `Paperwork going on` \| `Funds Arrived` \| `Paperwork ready` \| `Dispatch` \| `Delivery` \| `Completed` \| `Cancelled` | Live: 31/3/2/1/1/1. No longer stored in v2 — see §11.2 |
| `conversation_history.thread_type` | `chat` \| `negotiation` \| `advisor` \| `dealer` | Maps the live thread-id namespaces |
| `support_tickets.category` | `customer` \| `dealer` \| `internal` | The required discriminator |
| `support_tickets.status` | `new` \| `in-progress` \| `on-hold` \| `resolved` \| `closed` | |
| `support_tickets.priority` | `low` \| `medium` \| `high` \| `urgent` | Live: medium only |
| `support_verifications.category` | `dealer` \| `agent` \| `customer` | |
| `support_verifications.status` | `pending` \| `approved` \| `denied` \| `rejected` | Live: approved 8, denied 3, pending 1 |
| `llm_audits.task_type` | 8 values, see §9.1 | |
| `llm_audits.status` | `success` \| `error` \| `timeout` \| `rate_limited` \| `refused` \| `content_filtered` | |
| `error_logs.level` | `DEBUG` \| `INFO` \| `WARN` \| `ERROR` \| `FATAL` | |
| `payments.plan` | `dealer_premium` \| `buyer_premium` | Price tier recorded at checkout; read time never re-derives it from `profiles.role` |
| `payments.status` | `succeeded` \| `failed` \| `refunded` | Checkout is simulated — well-formed cards are always `succeeded` |
| `payments.payment_method` | `credit_card` \| `debit_card` | |

> The `deal_status` values are display strings, not enums. This is a **known wart** — they
> contain spaces and capital letters, so they cannot become a Postgres `ENUM` cleanly and
> must be quoted in every query. They were retained verbatim in the live schema because
> they are rendered directly in the UI. If the lifecycle is reintroduced, a future cleanup
> should move them to slugs (`paperwork_going_on`, `funds_arrived`, …) with a
> display-label map.
>
> Note the live data contains `Funds Arranged` (2 rows), a typo for `Funds Arrived`. Any
> reintroduction must either accept both spellings or remap those 2 rows.

---

## 12. Dropped tables

37 tables removed.

| Group | Tables | Reason |
|---|---|---|
| Chat (old) | `chat_sessions`, `chat_messages`, `conversation_cache` | Replaced by `conversation_history` + `buyer_preference` |
| Direct messaging | `direct_conversations`, `direct_messages` | Replaced by `deal_chats` |
| Commerce | `cart_items`, `orders` | Abandoned flows; quotes → deals is the real path |
| Legacy quoting | `dealers`, `request_assignments`, `quotations`, `negotiation_rounds`, `negotiation_messages`, `deals` | Superseded by `deal_quotes`; `deals` was write-only and orphaned |
| LangGraph internals | `checkpoints`, `checkpoint_blobs`, `checkpoint_writes`, `checkpoint_migrations` | Merged into `conversation_history` |
| RAG / vector | `car_rag_documents`, `CAR FINAL DATA`, `car_specs_ml model`, `test_vector` | Replaced by the typed `cars` columns + inline `cars.reviews`. **No `cars.embedding` column exists** — retrieval is SQL |
| Support | `support_customer_tickets`, `support_dealer_tickets`, `support_agent_verifications`, `support_dealer_verifications` | Merged (see §8) |
| AI eval | `turn_annotations` | LLM-quality harness, not product data |
| Advisor pipeline | 22 × `advisor_*` | `advisor_sources`, `advisor_vehicles`, `advisor_vehicle_trims`, `advisor_source_records`, `advisor_ingestion_runs`, `advisor_observations`, `advisor_specifications`, `advisor_price_observations`, `advisor_documents`, `advisor_document_versions`, `advisor_document_vehicle_links`, `advisor_document_chunks`, `advisor_embedding_profiles`, `advisor_chunk_embeddings`, `advisor_recalls`, `advisor_recall_vehicle_links`, `advisor_refresh_jobs`, `advisor_review_source_policies`, `advisor_review_version_links`, `advisor_review_publications`, `advisor_live_source_policies`, `advisor_live_cache`, `advisor_live_work_items` | 25-table research subsystem; archival, not transactional |
| Other | `user_memories`, `doc_chunks` | Replaced by `buyer_preference` / `deal_documents` |

### 12.1 Dropped database objects

| Object | Action required |
|---|---|
| `expire_stale_buyer_requests()` | **Rewrite or drop.** Reads `buyer_requests.status`/`created_at` and `dealer_quotes.request_id`. Scheduled `pg_cron` job `expire-stale-buyer-requests` at `0 3 * * *`. |
| `match_car_rag_documents()` | Drop — targets the removed `car_rag_documents`. |
| `match_cars()` | Drop — definition was never in the repo. |
| `match_car_final_data()` | Drop — **called by the AI agent but never defined in the repo**; targets `"CAR FINAL DATA"`. |
| `increment_car_view(target_car_id)` | Recreate against `cars.id`. |
| `mark_messages_delivered()` | Drop — `direct_messages` is gone. |
| pg_cron job `expire-stale-buyer-requests` | Un-schedule, then re-register after the function is rewritten. |

---

## 13. Migration notes

### 13.1 Ordered sequence

1. Create extensions: `pg_trgm`, `unaccent`, `postgis`. (`vector` is **not**
   created — see §2 "No `pgvector`".)
2. Create `states`, `brands`; seed `states` with the 50 US states + DC (static list, not
   derived from dirty data) and `brands` from the 33 distinct values in `cars.brand` /
   `profiles.brands_sold`, mapped to canonical names. `brands.country_code` must be
   hard-coded in the migration — there is no source column for it.
3. Create `profiles` v2, `users`; backfill, then add `state_id`.
4. Create `cars` v2 with `brand_id`, `state_id`, `reviews`; backfill brand mapping.
5. Create `buyer_requests` v2 with the 20 decomposed columns; transform each
   `requirements` JSONB row by its 25 key variants.
6. Create `deal_quotes` v2 (rename `otd_total` → `final_price`, rename `request_id` →
   `buyer_request_id`, add `deal_documents_id`, drop 3 columns); `deal_documents` v2;
   `deal_chats` v2. The `deal_documents_id` pointer is backfilled last, after both tables
   exist — leave it `NULL` and fill it in a second pass.
7. Create `conversation_history`, `buyer_preference`; migrate from the LangGraph tables.
8. Create `support_tickets`, `support_verifications`; merge.
9. Create `llm_audits`, `error_logs`.
10. Add RLS policies (see §14); enable realtime on `deal_chats`.
11. Drop the 37 old tables; drop the old RPCs; drop `expire_stale_buyer_requests` and
    re-register its replacement.

### 13.2 Data-quality items that must be handled manually

| # | Table | Issue | Rows |
|---|---|---|---|
| 1 | `profiles` | Corrupt location: `Fisco texas`, `Texas, Firco`, `Tesax,34`, `""` | 4 |
| 2 | `profiles` | **Non-US location** (`CHENNAI` ×2, `CHENNAI\|COUNTRY:India` ×2) — no target row in the US-only `states` table; remap or leave `state_id NULL` | 4 |
| 3 | `cars` / `brands` | `Mercedes` vs `Mercedes-Benz` both present | 3 + 1 |
| 4 | `brands` | `profiles.brands_sold = [""]` (empty string in array) | 1 |
| 5 | `brands` | 33 distinct brand strings needing canonical mapping | 33 |
| 6 | `support_verifications` | `profile_id IS NULL` orphan | 1 (`fe9ac6f0-…`) |
| 7 | `support_verifications` | `DV-MANUAL` hand-created test row | 1 (`624abc59-…`) |
| 8 | `buyer_requests` | `market_brief` populated on only 7 of 42 rows | 35 null |
| 9 | `buyer_requests` | `Timeline` has a typo variant `Less than 2 weeks` vs `Within 2 weeks` | 2 |
| 10 | `buyer_requests` | `requirements` key drift: `Car Brand` vs `Brand`, `Body Type` vs `Car Type`, `Exterior Color` vs `Color`, `Your Area` vs `Location`, `Budget` vs `Target Quote Price` | 8 |
| 11 | `cars` | `title` becomes derivable from `brand_id` + `model` — decide whether to keep the stored value | 85 |
| 12 | `buyer_requests` | `requirements.Location` holds non-US text (`CHENNAI`, `ABC city, USA`, `Washington`) — map to `buyer_area_state_id` or leave NULL | 3 |

### 13.3 ⚠️ Known functional loss

### 11.1 Price-revision ledger (`quote_history`)

Dropping `deal_quotes.quote_history` removes the structured price-revision ledger. The live
anti-sniping logic ranked quotes by `final_price` and used `quote_history` + `expires_at` to
extend competing dealers' windows when a revision landed. **This ranking must now be
computed from `deal_quotes` alone** — it still works for the *current* state
(`ORDER BY final_price ASC, created_at ASC`) but the revision trail is gone. The
`(buyer_request_id, final_price, created_at)` index in §7.2 keeps the query fast.

### 11.2 Deal lifecycle (`deal_status` + `deal_history`)

These two removals are the only ones in this document that **delete live, populated data
with no equivalent** — they are a product decision, not a cleanup.

| Dropped | Rows affected | Replacement |
|---|---|---|
| `deal_status` | 39/39 | **None.** The deal stage is not stored anywhere in v2 |
| `deal_history` | 9/39 | **None.** 9 rows of narrative entries are discarded |

**Consequences to accept explicitly.** After this change:

- Nothing in the 15-table schema records that a deal moved through `Paperwork going on` →
  `Funds Arrived` → `Dispatch` → `Delivery` → `Completed`. `deal_quotes.status` only
  distinguishes `pending` / `negotiating` / `accepted` / `declined` / `withdrawn` /
  `expired`, and `deal_documents.deal_status` was already dropped as a duplicate.
- Any UI, RPC, or edge function reading `deal_quotes.deal_status` will fail at runtime,
  not silently — grep for it before deploying.
- If the lifecycle is needed, it must be reintroduced. The options are a `deal_status`
  column back on `deal_quotes` (simplest, and what the live schema already did), or
  `event_type` + `quote_stage` on `deal_chats` (queryable timeline, but a stage change is
  then an event rather than a field).

---

## 14. Row Level Security

Policies for all 16 tables. `auth.uid()` returns `profiles.id` because `profiles.id` is the
Auth uid.

| Table | Policy | Command | USING | WITH CHECK |
|---|---|---|---|---|
| `states` | Public read | SELECT | `is_active` | — |
| `brands` | Public read | SELECT | `is_active` | — |
| `profiles` | View own | SELECT | `auth.uid() = id` | — |
| `profiles` | Update own | UPDATE | `auth.uid() = id` | — |
| `profiles` | Insert own | INSERT | — | `auth.uid() = id` |
| `profiles` | Support read all | SELECT | `EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('support','admin'))` | — |
| `users` | Self only | ALL | `EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.id = profile_id)` | same |
| `cars` | Public read active | SELECT | `status = 'active'` | — |
| `cars` | Seller manages own | ALL | `auth.uid() = seller_id` | `auth.uid() = seller_id` |
| `buyer_requests` | Buyer owns | ALL | `auth.uid() = buyer_id` | `auth.uid() = buyer_id` |
| `buyer_requests` | Sellers read open | SELECT | `status = 'open'` | — |
| `deal_quotes` | Buyer or dealer reads | SELECT | `auth.uid() = buyer_id OR auth.uid() = dealer_id` | — |
| `deal_quotes` | Dealer inserts | INSERT | — | `auth.uid() = dealer_id` |
| `deal_quotes` | Dealer updates own | UPDATE | `auth.uid() = dealer_id` | `auth.uid() = dealer_id` |
| `deal_quotes` | Buyer accepts | UPDATE | `auth.uid() = buyer_id AND status = 'pending'` | `status = 'accepted'` |
| `deal_chats` | Participant reads | SELECT | `EXISTS (SELECT 1 FROM deal_quotes q WHERE q.id = quote_id AND (q.buyer_id = auth.uid() OR q.dealer_id = auth.uid()))` | — |
| `deal_chats` | Participant writes | INSERT | — | `auth.uid() = sender_id` |
| `deal_documents` | Participant reads | SELECT | `EXISTS (SELECT 1 FROM deal_quotes q WHERE q.id = quote_id AND (q.buyer_id = auth.uid() OR q.dealer_id = auth.uid()))` | — |
| `deal_documents` | Dealer uploads | INSERT | — | `auth.uid() = dealer_id` |
| `conversation_history` | Own threads | ALL | `auth.uid() = user_id` | `auth.uid() = user_id` |
| `buyer_preference` | Own record | ALL | `auth.uid() = profile_id` | `auth.uid() = profile_id` |
| `support_tickets` | Caller reads own | SELECT | `caller_id = auth.uid()` | — |
| `support_tickets` | Authenticated insert | INSERT | — | `caller_id = auth.uid()` |
| `support_tickets` | Support full access | ALL | role IN ('support','admin') | same |
| `support_verifications` | Subject reads own | SELECT | `profile_id = auth.uid()` | — |
| `support_verifications` | Support full access | ALL | role IN ('support','admin') | same |
| `llm_audits` | Backend only | ALL | `false` (service_role) | — |
| `error_logs` | Backend only | ALL | `false` (service_role) | — |
| `payments` | Backend only | ALL | `false` (service_role) | — |

**Hardening the live policies.** The current live policies contain three defects that must
not be carried forward:

| Live policy | Defect |
|---|---|
| `dealer_quotes` → `Enable read access for all users` `USING (true)` | Any authenticated user can read every quote in the platform, including `final_price` and buyer financials. Delete this policy. |
| `negotiation_messages` → `negotiation_messages_allow_all` `USING (true) WITH CHECK (true)` | Fully open table. |
| `conversation_cache` → `Allow public read/insert/update` `USING (true)` | Fully open table. |

---

## 15. Realtime

| Table | Event | Filter | Reason |
|---|---|---|---|
| `deal_chats` | INSERT, UPDATE | `quote_id=eq.<id>` | Live buyer↔dealer messaging |
| `deal_quotes` | UPDATE | `buyer_request_id=eq.<id>` | Live leaderboard re-rank on revision |

Requires `REPLICA IDENTITY FULL` on both tables, or the filter only sees `NEW.id`.

---

## 16. Summary counts

| Metric | Live | v2 | Δ |
|---|---|---|---|
| Tables | 40 | 16 | **−24** |
| Columns (approx.) | ~700 | ~210 | −490 |
| JSONB blobs holding structured data | 7 | 2 (`market_brief`, `reviews`) | −5 |
| Tables with `UNIQUE` constraints | 4 | 15 | +11 |
| Tables with `CHECK` constraints | 0 | 16 | +16 |
| Tables with full audit columns | 0 | 16 | +16 |
| Free-text geography values | 15 | 0 | −15 |
| Free-text brand values | 33 | 0 | −33 |
| Tables with documented RLS | 22 | 16 | −6 (and all defects fixed) |
