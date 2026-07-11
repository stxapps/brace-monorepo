// The device-local expo-sqlite + drizzle database — the Dexie 'brace-data'
// analogue (web-react db.ts) as the brace-expo data layer gets built. Tables
// arrive as their features are ported; today it holds `locks` (see
// lock-store.ts). drizzle's useLiveQuery over these tables is the Dexie
// liveQuery analogue, which is why the connection opens with
// enableChangeListener (useLiveQuery subscribes to sqlite's change events).
//
// Greenfield schema policy: no migrations. The DDL below runs idempotently on
// open; when a table changes shape, edit it in place and recreate dev
// databases (delete the app / clear its data) rather than adding a migration
// step.

import { drizzle, type ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { openDatabaseSync } from 'expo-sqlite';

// Device-local app/list locks. IMPORTANT: locks gate UI locally (they are never
// synced — different devices can lock different lists), and a lock guards
// already-decrypted data sitting on the device, so what's stored is a one-way
// password VERIFIER (@stxapps/expo-crypto lock-verifier), never the password or
// a reversible copy. Whether a lock is currently UNLOCKED is in-memory React
// state only (the future lock-provider), so every lock re-engages on relaunch —
// nothing here tracks it.
export const locks = sqliteTable('locks', {
  // `APP_LOCK_ID` for the app lock, else the locked list's id (stable across
  // renames). One row per lock.
  id: text('id').primaryKey(),
  kind: text('kind', { enum: ['app', 'list'] }).notNull(),
  // The verifier pair (hex — see LockVerifier in @stxapps/expo-crypto).
  salt: text('salt').notNull(),
  hash: text('hash').notNull(),
  // List locks only: while locked, also hide the list (and its subtree) from the
  // sidebar and the list pickers — not just gate its links.
  hideList: integer('hide_list', { mode: 'boolean' }),
});

const schema = { locks };

const DB_NAME = 'brace-data.db';

// Opened lazily on first use (not at module load) so merely importing the
// package barrel never touches the native sqlite module — jest and tooling can
// import sibling modules without a mock for this one.
let db: ExpoSQLiteDatabase<typeof schema> | null = null;

export function getDb(): ExpoSQLiteDatabase<typeof schema> {
  if (!db) {
    const sqlite = openDatabaseSync(DB_NAME, { enableChangeListener: true });
    // WAL lets the change-listener reads proceed while a write is in flight.
    sqlite.execSync('PRAGMA journal_mode = WAL;');
    sqlite.execSync(`CREATE TABLE IF NOT EXISTS locks (
      id TEXT PRIMARY KEY NOT NULL,
      kind TEXT NOT NULL,
      salt TEXT NOT NULL,
      hash TEXT NOT NULL,
      hide_list INTEGER
    );`);
    db = drizzle(sqlite, { schema });
  }
  return db;
}
