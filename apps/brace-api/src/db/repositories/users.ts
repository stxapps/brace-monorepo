// User repository — lives in the MASTER DB. The master row is the user's
// identity + the shard assignment; the user's actual data lives in the shard DB
// named by `shard_id` -> shards.binding_name (see shard-router.ts).

export type UserRow = {
  id: string;
  username: string;
  shardId: string;
  createdAt: number;
};

type UserRecord = {
  id: string;
  username: string;
  shard_id: string;
  created_at: number;
};

function toRow(r: UserRecord): UserRow {
  return { id: r.id, username: r.username, shardId: r.shard_id, createdAt: r.created_at };
}

export function usersRepo(db: D1Database) {
  return {
    async findById(id: string): Promise<UserRow | null> {
      const r = await db
        .prepare(`SELECT id, username, shard_id, created_at FROM users WHERE id = ?`)
        .bind(id)
        .first<UserRecord>();
      return r ? toRow(r) : null;
    },

    // Authoritative username check (the GET /auth/username-available endpoint is
    // only a cheap pre-check). `username` is stored lower-cased for a
    // case-insensitive UNIQUE constraint.
    async findByUsername(username: string): Promise<UserRow | null> {
      const r = await db
        .prepare(`SELECT id, username, shard_id, created_at FROM users WHERE username = ?`)
        .bind(username.toLowerCase())
        .first<UserRecord>();
      return r ? toRow(r) : null;
    },

    // Called by services/account.ts once a shard has been assigned. The UNIQUE
    // constraint on username closes the create-account race the pre-check can't.
    async insert(u: { id: string; username: string; shardId: string }): Promise<void> {
      await db
        .prepare(
          `INSERT INTO users (id, username, shard_id, created_at) VALUES (?, ?, ?, ?)`,
        )
        .bind(u.id, u.username.toLowerCase(), u.shardId, Date.now())
        .run();
    },
  };
}
