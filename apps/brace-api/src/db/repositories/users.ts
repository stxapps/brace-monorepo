// User repository — lives in the MASTER DB. The master row is the user's
// identity; the user's actual data lives in the durable object
// keyed by `user_id`.

export type UserRow = {
  id: string;
  username: string;
  createdAt: number;
};

type UserRecord = {
  id: string;
  username: string;
  created_at: number;
};

function toRow(r: UserRecord): UserRow {
  return { id: r.id, username: r.username, createdAt: r.created_at };
}

export function usersRepo(db: D1Database) {
  return {
    async findById(id: string): Promise<UserRow | null> {
      const r = await db
        .prepare(`SELECT id, username, created_at FROM users WHERE id = ?`)
        .bind(id)
        .first<UserRecord>();
      return r ? toRow(r) : null;
    },

    // Authoritative username check (the GET /auth/username-available endpoint is
    // only a cheap pre-check). `username` is stored lower-cased for a
    // case-insensitive UNIQUE constraint.
    async findByUsername(username: string): Promise<UserRow | null> {
      const r = await db
        .prepare(`SELECT id, username, created_at FROM users WHERE username = ?`)
        .bind(username.toLowerCase())
        .first<UserRecord>();
      return r ? toRow(r) : null;
    },

    // Called by services/account.ts. The UNIQUE
    // constraint on username closes the create-account race the pre-check can't.
    async insert(u: { id: string; username: string; }): Promise<void> {
      await db
        .prepare(
          `INSERT INTO users (id, username, created_at) VALUES (?, ?, ?)`,
        )
        .bind(u.id, u.username.toLowerCase(), Date.now())
        .run();
    },
  };
}
