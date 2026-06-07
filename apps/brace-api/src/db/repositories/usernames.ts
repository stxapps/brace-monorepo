import { canonicalizeUsername } from '@stxapps/shared';

// Username directory repository — lives in ACCOUNTS_DB (the global uniqueness
// namespace). Maps a canonical username → the account it resolves to, plus the
// `account_db_id` routing seam. This is the ONE table that stays global when
// `users`/`account_keys` shard out, so it's always queried via env.ACCOUNTS_DB,
// never through db-routes.

// Public domain entity (camelCase).
export type UsernameEntity = {
  username: string;
  userId: string;
  // Which accounts db holds this user's rows; null ⇒ the primary ACCOUNTS_DB.
  accountDbId: string | null;
};

// Raw row as it sits in D1 (snake_case columns). Internal to this repo.
type UsernameRow = {
  username: string;
  user_id: string;
  account_db_id: string | null;
};

function toEntity(r: UsernameRow): UsernameEntity {
  return { username: r.username, userId: r.user_id, accountDbId: r.account_db_id };
}

export function usernamesRepo(db: D1Database) {
  return {
    // Authoritative username lookup (the GET /v1/auth/username-available endpoint
    // is only a cheap pre-check). Canonicalizes so the lookup matches the stored
    // form and the per-user salt input.
    async findByUsername(username: string): Promise<UsernameEntity | null> {
      const r = await db
        .prepare(`SELECT username, user_id, account_db_id FROM usernames WHERE username = ?`)
        .bind(canonicalizeUsername(username))
        .first<UsernameRow>();
      return r ? toEntity(r) : null;
    },

    // Returns the prepared INSERT so create-account can batch it ATOMICALLY with
    // the users/account_keys writes (all in ACCOUNTS_DB today). The PRIMARY KEY on
    // username is the race-free uniqueness guard — a single constrained INSERT,
    // not a read-then-write — so concurrent claims of the same name can't both win.
    insertStmt(u: {
      username: string;
      userId: string;
      accountDbId?: string | null;
    }): D1PreparedStatement {
      return db
        .prepare(`INSERT INTO usernames (username, user_id, account_db_id) VALUES (?, ?, ?)`)
        .bind(canonicalizeUsername(u.username), u.userId, u.accountDbId ?? null);
    },
  };
}
