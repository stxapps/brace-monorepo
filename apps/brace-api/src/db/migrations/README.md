# database migrations

brace-api has **two database roles with two DIFFERENT migration models** — don't
conflate them:

- **master** (`MASTER_DB`) — a real **D1** database. Holds lookup/master data
  only: `users`, `sessions`. One per Cloudflare account (tier). Migrated by
  `wrangler` from the numbered `.sql` files in `migrations/master/`.
- **user-data** (`USER_DATA`) — a per-user **Durable Object** SQLite store
  (`src/do/user-data.ts`), one DO instance per user (addressed by
  `idFromName(userId)`). **NOT a D1 database** — `wrangler d1 migrations` does
  **not** touch it; it is migrated **in code**. Documented separately in
  [../../do/README.md](../../do/README.md).

This file covers **master (D1)** only.

## master (D1) — wrangler-applied

`db/schemas/master.sql` is the **full-create snapshot** (authoritative shape of a
fresh DB, at-a-glance reference). `db/migrations/master/NNNN_*.sql` are the
**incremental** changes applied to live DBs in order; `0001_init.sql` mirrors the
snapshot.

**Rule:** any change to a deployed master DB is a new numbered migration — never
edit a live table by hand. Keep `schemas/master.sql` and the migration set in
lockstep: when you add `0002_*.sql`, fold the same change into the snapshot so a
fresh DB matches a migrated one.

`migrations_dir` is set per-binding in `wrangler.jsonc` (`MASTER_DB` →
`src/db/migrations/master`). Target a DB by its **binding name** and pass the env.
Convenience Nx targets wrap these (see `apps/brace-api/package.json` → `migrate`):

```bash
# local (miniflare) — applied inside .wrangler/ state
wrangler d1 migrations apply MASTER_DB --env development

# staging / production (needs that account's API token)
wrangler d1 migrations apply MASTER_DB --env staging

# list applied/pending
wrangler d1 migrations list MASTER_DB --env development
```
