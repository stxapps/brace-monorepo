import type { Bindings } from '../lib/env';

// Resolve a stored `account_db_id` to the D1 binding holding that user's `users`
// + `account_keys` rows. This is the sharding SEAM. Two properties make it a
// non-migration to add capacity later:
//
//  - Routing READS the stored id; it never hashes the userId. So once a user is
//    assigned to a database they stay there for life — adding a shard never
//    moves anyone (unlike `hash(userId) % N`, where changing N rehashes
//    everyone). New signups simply get assigned the new id going forward.
//  - The global `usernames` directory always stays in ACCOUNTS_DB (global
//    uniqueness can't be sharded), so it is looked up via env.ACCOUNTS_DB
//    directly, NOT through this function — only user/account_keys reads/writes
//    route here.
//
// Today there is exactly ONE account database (ACCOUNTS_DB), which holds both the
// directory and every user's account rows, so every account stores
// `account_db_id = NULL` ("the primary db") and this function always returns
// ACCOUNTS_DB. To add a shard when ACCOUNTS_DB nears D1's 10 GB cap: provision
// `accounts_db_1`, add its binding in wrangler.jsonc + lib/env.ts, add a `case`
// below, and point new signups at it in services/account.ts. Existing users
// (NULL) keep resolving to ACCOUNTS_DB, untouched.
export function accountsDb(env: Bindings, accountDbId?: string | null): D1Database {
  switch (accountDbId ?? null) {
    case null:
      return env.ACCOUNTS_DB;
    // case 'accounts_db_1':
    //   return env.ACCOUNTS_DB_1;
    default:
      throw new Error(`accountsDb: unknown account_db_id "${accountDbId}"`);
  }
}
