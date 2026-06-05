// User repository — lives in the MASTER DB. The master row is the user's
// identity; the user's actual data lives in the durable object
// keyed by `user_id`.

// Public domain entity (camelCase). Behavior can hang off this later; for now
// it's the shape services/routes consume.
export type UserEntity = {
  id: string;
  username: string;
  createdAt: number;
};

// Raw row as it sits in D1 (snake_case columns). Internal to this repo.
type UserRow = {
  id: string;
  username: string;
  created_at: number;
};

function toEntity(r: UserRow): UserEntity {
  return { id: r.id, username: r.username, createdAt: r.created_at };
}

export function usersRepo(db: D1Database) {
  return {
    async findById(id: string): Promise<UserEntity | null> {
      const r = await db
        .prepare(`SELECT id, username, created_at FROM users WHERE id = ?`)
        .bind(id)
        .first<UserRow>();
      return r ? toEntity(r) : null;
    },

    // Authoritative username check (the GET /auth/username-available endpoint is
    // only a cheap pre-check). `username` is stored lower-cased for a
    // case-insensitive UNIQUE constraint.
    async findByUsername(username: string): Promise<UserEntity | null> {
      const r = await db
        .prepare(`SELECT id, username, created_at FROM users WHERE username = ?`)
        .bind(username.toLowerCase())
        .first<UserRow>();
      return r ? toEntity(r) : null;
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
