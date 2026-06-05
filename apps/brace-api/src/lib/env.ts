// Typed Workers runtime context for the whole app. Hono is parameterized with
// `AppEnv` (see app.ts), so `c.env` (bindings) and `c.var` (request-scoped
// values) are typed everywhere — middleware, routes, services.
//
// brace-api runs ONLY on Cloudflare Workers (no Node entry), so every binding
// below arrives on `c.env` at runtime, provided per-env by wrangler.jsonc. The
// one exception is tests: `app.request()` runs the app with NO env, so `c.env`
// is `undefined` there — middleware must tolerate missing bindings (see how
// corsOrigins() and the rate-limit middleware guard for it).

// The native Workers Rate Limiting binding. Its type isn't shipped in
// @cloudflare/workers-types yet, so declare the slice we use. Window/volume
// (`simple.limit` / `simple.period`) are configured per-binding in
// wrangler.jsonc; the binding only exposes `limit({ key })` at runtime.
export interface RateLimit {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export type Bindings = {
  // Comma-separated CORS allow-list (see app.ts). Set in every wrangler env.
  CORS_ORIGINS: string;

  // --- D1 (sqlite) — sharded; see db/shard-router.ts ----------------------
  // D1 bindings are STATIC: a Worker can't bind a database by id at runtime.
  // So we pre-declare the master plus one binding per shard, and the `shards`
  // registry table (in master) maps a logical shard_id -> a binding name here.
  // Master holds ONLY lookup/master data (users, sessions, shard registry) so
  // it never approaches D1's size cap; user data lives in the shard DBs.
  DB_MASTER: D1Database;
  DB_SHARD_1: D1Database;
  // Add DB_SHARD_2, … here (and a matching d1 binding in wrangler.jsonc plus a
  // `shards` row) as capacity grows. Nothing else needs to change.

  // --- R2 — encrypted bookmark blobs (see docs/local-first-sync.md) -------
  FILES: R2Bucket;

  // --- Rate limiting — native binding, one binding per volume "tier" -------
  // The native binding's window is 10s or 60s only, so a literal "1 req/sec"
  // is expressed as the tight tier (10 req / 10s). Counters are per-colo.
  API_RATE_LIMIT: RateLimit; // standard tier
  API_RATE_LIMIT_TIGHT: RateLimit; // tight tier (sensitive endpoints)
};

// The session resolved by the auth guard (middleware/auth.ts) and read by
// protected handlers via `c.get('session')`. Carrying shardId here means a
// protected handler reaches the user's shard with no extra master lookup.
export type SessionContext = {
  id: string;
  userId: string;
  shardId: string;
};

export type Variables = {
  session: SessionContext;
};

// The single Hono generic used across the app: `new Hono<AppEnv>()`.
export type AppEnv = { Bindings: Bindings; Variables: Variables };
