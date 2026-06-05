# D1 migrations

brace-api uses **two database roles**, each with its own migration history:

- **master** (`DB_MASTER`) — lookup/master data only: `users`, `sessions`, the
  `shards` registry. One per Cloudflare account (tier).
- **shard** (`DB_SHARD_1`, `DB_SHARD_2`, …) — per-user data (e.g.
  `file_manifest`). Every shard shares the **same** schema; apply shard
  migrations to **each** shard binding.

## schema.sql vs migrations

- `db/<role>/schema.sql` — the **full-create snapshot**. Authoritative shape of a
  brand-new DB and the at-a-glance reference. Use it to stand up a fresh DB.
- `db/migrations/<role>/NNNN_*.sql` — **incremental** changes applied to **live**
  DBs in order. `0001_init.sql` mirrors `schema.sql`.

**Rule:** any change to a deployed DB is a new numbered migration — never edit a
live table by hand. Keep `schema.sql` and the migration set in lockstep: when you
add `0002_*.sql`, fold the same change into `schema.sql` so a fresh DB matches a
migrated one.

## wrangler wiring

Each d1 binding in `wrangler.jsonc` sets `migrations_dir` so wrangler knows where
each role's migrations live:

- `DB_MASTER` → `src/db/migrations/master`
- `DB_SHARD_N` → `src/db/migrations/shards`

## commands

`migrations_dir` is per-binding, so target a DB by its **binding name** and pass
the env. Convenience Nx targets wrap these (see `apps/brace-api/package.json`):

```bash
# local (miniflare) — applied inside .wrangler/ state
wrangler d1 migrations apply DB_MASTER  --env development
wrangler d1 migrations apply DB_SHARD_1 --env development

# staging / production (needs that account's API token)
wrangler d1 migrations apply DB_MASTER  --env staging
wrangler d1 migrations apply DB_SHARD_1 --env staging

# list applied/pending
wrangler d1 migrations list DB_MASTER --env development
```

## adding a shard

1. `wrangler d1 create brace-shard-2-<tier>` (per tier/account).
2. Add a `DB_SHARD_2` d1 binding under every env in `wrangler.jsonc`
   (`migrations_dir: src/db/migrations/shards`).
3. Add `DB_SHARD_2: D1Database` to `Bindings` in `src/lib/env.ts`.
4. Apply shard migrations to it: `wrangler d1 migrations apply DB_SHARD_2 --env <tier>`.
5. Insert a registry row in **master** so the assigner can place users on it
   (`size_bytes`/`max_bytes`/`size_updated_at` use defaults — 8 GiB cutover):
   `INSERT INTO shards (id, binding_name, status, user_count, capacity, created_at)
   VALUES ('shard_2', 'DB_SHARD_2', 'active', 0, 100000, unixepoch()*1000);`

Placement is **byte-based**: a shard takes new accounts while `size_bytes <
max_bytes` (`max_bytes` defaults to 8 GiB, headroom under D1's ~10 GB cap).
`size_bytes` is refreshed from D1's `meta.size_after` by `refreshShardSizes`
(`src/services/shard-assignment.ts`) — wire it to a Worker `scheduled` (cron)
handler, or the cutover never moves.
