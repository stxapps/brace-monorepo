import type { Bindings } from '../lib/env';
import { ApiError } from '../lib/errors';
import { type ShardRow,shardsRepo } from './repositories/shards';

// Resolves a logical shard -> the live D1Database for the user's data.
//
// D1 bindings are STATIC (declared in wrangler.jsonc; a Worker can't open a DB
// by id at runtime), so the indirection is: shards.binding_name names a property
// on `c.env`, and we read that binding off the env. This is the single place
// that turns the registry's string into a real D1 handle.

export function getShardDb(env: Bindings, shard: ShardRow): D1Database {
  const db = env[shard.bindingName as keyof Bindings] as D1Database | undefined;
  if (!db) {
    // Registry references a binding that isn't declared/deployed — a config bug,
    // not a client error. 500 so it's caught in observability.
    throw new ApiError(
      500,
      'shard_unavailable',
      `Shard ${shard.id} binding "${shard.bindingName}" is not bound`,
    );
  }
  return db;
}

// Convenience for the common path: given a session's shardId, look the shard up
// in master and return its D1 handle. Throws 500 if the registry row is missing
// (a user pointing at a shard that no longer exists is a data-integrity bug).
export async function resolveShardDb(env: Bindings, shardId: string): Promise<D1Database> {
  const shard = await shardsRepo(env.DB_MASTER).getById(shardId);
  if (!shard) {
    throw new ApiError(500, 'shard_unavailable', `Unknown shard ${shardId}`);
  }
  return getShardDb(env, shard);
}
