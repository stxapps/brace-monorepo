// Session repository — lives in the MASTER DB. We store the token HASH (never
// the raw token; see lib/ids.ts) and carry user_id so the auth guard
// resolves "bearer token -> user" in a single read.

// Public domain entity (camelCase). Behavior can hang off this later; for now
// it's the shape services/routes consume.
export type SessionEntity = {
  id: string;
  userId: string;
  expiresAt: number; // epoch ms
};

// Raw row as it sits in D1 (snake_case columns). Internal to this repo.
type SessionRow = {
  id: string;
  token_hash: string;
  user_id: string;
  expires_at: number;
};

function toEntity(r: Omit<SessionRow, 'token_hash'>): SessionEntity {
  return { id: r.id, userId: r.user_id, expiresAt: r.expires_at };
}

export function sessionsRepo(db: D1Database) {
  return {
    // Looked up by the auth guard on every protected request. Returns null when
    // no row matches (unknown/revoked token).
    async findByTokenHash(tokenHash: string): Promise<SessionEntity | null> {
      const row = await db
        .prepare(
          `SELECT id, user_id, expires_at
             FROM sessions WHERE token_hash = ?`,
        )
        .bind(tokenHash)
        .first<Omit<SessionRow, 'token_hash'>>();
      return row ? toEntity(row) : null;
    },

    async insert(s: {
      id: string;
      tokenHash: string;
      userId: string;
      expiresAt: number;
    }): Promise<void> {
      await db
        .prepare(
          `INSERT INTO sessions (id, token_hash, user_id, created_at, expires_at, last_seen_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(s.id, s.tokenHash, s.userId, Date.now(), s.expiresAt, Date.now())
        .run();
    },

    async deleteById(id: string): Promise<void> {
      await db.prepare(`DELETE FROM sessions WHERE id = ?`).bind(id).run();
    },

    // Housekeeping: drop expired rows so the master table stays small. Call from
    // a scheduled handler (cron trigger) once that's wired.
    async deleteExpired(now: number = Date.now()): Promise<void> {
      await db.prepare(`DELETE FROM sessions WHERE expires_at < ?`).bind(now).run();
    },
  };
}
