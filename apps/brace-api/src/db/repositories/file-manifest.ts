// File-manifest repository — lives in a durable object DB (resolve the right DO instance
// via do-router.ts first). This is the representative user-data table: the
// per-bookmark manifest the sync engine pulls (path + version + size). The
// encrypted blob itself lives in R2; the server only ever sees this metadata.
// See docs/local-first-sync.md.

export type ManifestEntry = {
  path: string;
  version: number;
  size: number;
  updatedAt: number;
};

type ManifestRecord = {
  path: string;
  version: number;
  size: number;
  updated_at: number;
};

export function fileManifestRepo(db: D1Database) {
  return {
    // Incremental pull: entries changed since the client's cursor.
    async listSince(userId: string, since: number): Promise<ManifestEntry[]> {
      const { results } = await db
        .prepare(
          `SELECT path, version, size, updated_at
             FROM file_manifest
            WHERE user_id = ? AND updated_at > ?
            ORDER BY updated_at ASC`,
        )
        .bind(userId, since)
        .all<ManifestRecord>();
      return (results ?? []).map((r) => ({
        path: r.path,
        version: r.version,
        size: r.size,
        updatedAt: r.updated_at,
      }));
    },

    // Push: record a new/edited bookmark after its blob is in R2. Last-writer-
    // wins per path (file-level conflict policy from local-first-sync.md).
    async upsert(userId: string, e: ManifestEntry): Promise<void> {
      await db
        .prepare(
          `INSERT INTO file_manifest (user_id, path, version, size, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(user_id, path) DO UPDATE SET
             version = excluded.version,
             size = excluded.size,
             updated_at = excluded.updated_at`,
        )
        .bind(userId, e.path, e.version, e.size, e.updatedAt)
        .run();
    },
  };
}
