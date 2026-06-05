# D1 migrations

brace-api uses **two database roles**, each with its own migration history:

- **master** (`DB_MASTER`) — lookup/master data only: `users`, `sessions`.
  One per Cloudflare account (tier).
- **durable objects** — one durable object per user (e.g.
  `file_manifest`). Every durable object shares the **same** schema; apply durable object
  migrations to **each** durable object binding.

## schema.sql vs migrations

- `db/schemas/<role>.sql` — the **full-create snapshot**. Authoritative shape of a
  brand-new DB and the at-a-glance reference. Use it to stand up a fresh DB.
- `db/migrations/<role>/NNNN_*.sql` — **incremental** changes applied to **live**
  DBs in order. `0001_init.sql` mirrors `schemas/<role>.sql`.

**Rule:** any change to a deployed DB is a new numbered migration — never edit a
live table by hand. Keep `schemas/<role>.sql` and the migration set in lockstep:
when you add `0002_*.sql`, fold the same change into `schemas/<role>.sql` so a
fresh DB matches a migrated one.

## wrangler wiring

Each d1 binding in `wrangler.jsonc` sets `migrations_dir` so wrangler knows where
each role's migrations live:

- `DB_MASTER` → `src/db/migrations/master`
- `DO_USER_DATA` → `src/db/migrations/dos`

## commands

`migrations_dir` is per-binding, so target a DB by its **binding name** and pass
the env. Convenience Nx targets wrap these (see `apps/brace-api/package.json`):

```bash
# local (miniflare) — applied inside .wrangler/ state
wrangler d1 migrations apply DB_MASTER  --env development

# staging / production (needs that account's API token)
wrangler d1 migrations apply DB_MASTER  --env staging

# list applied/pending
wrangler d1 migrations list DB_MASTER --env development
```

## adding a durable object for each user

1. 
