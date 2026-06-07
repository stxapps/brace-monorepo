# database migrations

brace-api has **two database roles with two DIFFERENT migration models** — don't
conflate them:

- **D1 databases** — real **D1**, migrated by `wrangler` from the numbered `.sql`
  files under `migrations/<role>/`. There are two, each its own migration
  history:
  - **accounts** (`ACCOUNTS_DB`) — the account registry + username directory:
    `usernames`, `users`, `account_keys`. The global uniqueness namespace; where
    create-account writes atomically.
  - **sessions** (`SESSIONS_DB`) — bearer-token `sessions` only. Separate db:
    high-churn and not Tier-0 (a lost session regenerates by re-auth).
  - Both hold only small, bounded-per-user rows, so neither nears D1's 10 GB cap;
    `account_db_id` is the pre-cut seam to shard `users`/`account_keys` later
    (see `db/db-routes.ts`).
- **user-data** (`USER_DATA`) — a per-user **Durable Object** SQLite store
  (`src/do/user-data.ts`), one DO instance per user (addressed by
  `idFromName(userId)`). **NOT a D1 database** — `wrangler d1 migrations` does
  **not** touch it; it is migrated **in code**. Documented separately in
  [../../do/README.md](../../do/README.md).

This file covers the **D1** databases only.

## D1 — wrangler-applied

`db/schemas/<role>.sql` is each db's **full-create snapshot** (authoritative shape
of a fresh DB, at-a-glance reference). `db/migrations/<role>/NNNN_*.sql` are the
**incremental** changes applied to live DBs in order; each `0001_init.sql` mirrors
its snapshot.

**Rule:** any change to a deployed DB is a new numbered migration — never edit a
live table by hand. Keep `schemas/<role>.sql` and the migration set in lockstep:
when you add `0002_*.sql`, fold the same change into the snapshot so a fresh DB
matches a migrated one.

`migrations_dir` is set per-binding in `wrangler.jsonc` (`ACCOUNTS_DB` →
`src/db/migrations/accounts`, `SESSIONS_DB` → `src/db/migrations/sessions`).
Target a DB by its **binding name** and pass the env. Convenience Nx targets wrap
these (see `apps/brace-api/package.json` → `migrate`):

```bash
# local (miniflare) — applied inside .wrangler/ state
wrangler d1 migrations apply ACCOUNTS_DB --env development
wrangler d1 migrations apply SESSIONS_DB --env development

# staging / production (needs that account's API token)
wrangler d1 migrations apply ACCOUNTS_DB --env staging

# list applied/pending
wrangler d1 migrations list ACCOUNTS_DB --env development
```
