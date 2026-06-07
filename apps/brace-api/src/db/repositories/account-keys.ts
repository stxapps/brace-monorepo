// Account-keys repository — the "doors". One wrapped-DEK blob per access method,
// living in the SAME ACCOUNTS_DB_N shard as this account's `users` row, so the
// credential and its Tier-0 key material commit together in one batch.

export type DoorType = 'password' | 'recovery' | 'passkey';

// Public domain entity (camelCase). Bytes are surfaced as Uint8Array; D1 returns
// BLOBs as ArrayBuffer, converted in toEntity.
export type AccountKeyEntity = {
  userId: string;
  doorType: DoorType;
  wrappedDek: Uint8Array;
  iv: Uint8Array;
  version: number;
};

// Raw row as it sits in D1 (snake_case columns). Internal to this repo.
type AccountKeyRow = {
  user_id: string;
  door_type: DoorType;
  wrapped_dek: ArrayBuffer;
  iv: ArrayBuffer;
  version: number;
};

function toEntity(r: AccountKeyRow): AccountKeyEntity {
  return {
    userId: r.user_id,
    doorType: r.door_type,
    wrappedDek: new Uint8Array(r.wrapped_dek),
    iv: new Uint8Array(r.iv),
    version: r.version,
  };
}

export function accountKeysRepo(db: D1Database) {
  return {
    // All doors for an account. Sign-in reads the 'password' door's blob (served
    // pre-auth) to unwrap the DEK; settings UIs list every door.
    async findByUserId(userId: string): Promise<AccountKeyEntity[]> {
      const { results } = await db
        .prepare(
          `SELECT user_id, door_type, wrapped_dek, iv, version
             FROM account_keys WHERE user_id = ?`,
        )
        .bind(userId)
        .all<AccountKeyRow>();
      return results.map(toEntity);
    },

    // Returns the prepared INSERT so create-account can batch it atomically with
    // the username/users writes. `version` starts at 1 and is bumped on each
    // re-wrap (e.g. password change) so the row is auditable.
    insertStmt(k: {
      userId: string;
      doorType: DoorType;
      wrappedDek: Uint8Array;
      iv: Uint8Array;
      version?: number;
    }): D1PreparedStatement {
      return db
        .prepare(
          `INSERT INTO account_keys (user_id, door_type, wrapped_dek, iv, version, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(k.userId, k.doorType, k.wrappedDek, k.iv, k.version ?? 1, Date.now());
    },
  };
}
