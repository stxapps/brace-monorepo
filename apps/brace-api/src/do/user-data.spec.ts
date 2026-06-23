import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { userDataStub } from './user-data';

// The Durable Object is the other thing a Node runner can't test: its schema is
// migrated IN CODE on construction, its op log keysets off a real (updated_at,
// path) cursor, and the quota map is real SQLite. Here the DO is a real
// SQLite-backed instance, so these assertions actually prove the migration ran,
// the cursor semantics hold, and the quota map tracks. RPC methods are awaited
// across the stub.
//
// commitOps is now a pure batched write against the DO's own SQLite — the R2 HEAD
// (put existence check + R2's LastModified/size, and dropping puts with no object)
// lives in services/sync.ts, which passes only the survivors in. So these tests
// hand commitOps explicit (updatedAt, size) entries and assert they round-trip;
// the R2-first handshake is covered end-to-end in routes/sync.spec.ts.
describe('UserDataDO op log', () => {
  it('commits ops and reads them back over the (updatedAt, path) cursor', async () => {
    const stub = userDataStub(env, 'user-a');

    const { results } = await stub.commitOps([
      { op: 'put', path: 'links/a.enc', updatedAt: 1000, size: 3 },
      { op: 'put', path: 'links/b.enc', updatedAt: 2000, size: 5 },
      { op: 'delete', path: 'links/a.enc', updatedAt: 3000, size: 0 },
    ]);

    // commitOps returns each recorded updatedAt (input order) the client advances
    // its cursor to.
    expect(results.map((r) => r.updatedAt)).toEqual([1000, 2000, 3000]);

    // A full pull from the start (null cursor) returns every op, ordered by
    // (updatedAt, path).
    const { ops, oldestUpdatedAt, newestUpdatedAt, hasMore } = await stub.listOps(null, null, 500);
    expect(hasMore).toBe(false);
    expect(ops.map((o) => o.path).sort()).toEqual(['links/a.enc', 'links/a.enc', 'links/b.enc']);
    expect(oldestUpdatedAt).toBe(1000);
    expect(newestUpdatedAt).toBe(3000);

    // The quota map tracks live objects only: a.enc was deleted, so just b.enc's
    // 5 bytes remain.
    const usage = await stub.usage();
    expect(usage.fileCount).toBe(1);
    expect(usage.totalBytes).toBe(5);
  });

  it('pages with the keyset cursor and reports hasMore', async () => {
    const stub = userDataStub(env, 'user-page');
    let ts = 1000;
    for (const id of ['a', 'b', 'c']) {
      await stub.commitOps([{ op: 'put', path: `links/${id}.enc`, updatedAt: ts, size: 1 }]);
      ts += 1000;
    }

    // limit 2 over 3 ops ⇒ first page is full and hasMore is true.
    const first = await stub.listOps(null, null, 2);
    expect(first.ops).toHaveLength(2);
    expect(first.hasMore).toBe(true);

    // Resume from the last op's (updatedAt, path) ⇒ the remaining op, no more.
    const last = first.ops[first.ops.length - 1];
    const second = await stub.listOps(last.updatedAt, last.path, 2);
    expect(second.ops).toHaveLength(1);
    expect(second.hasMore).toBe(false);
  });

  it('reports null bounds for a never-written log', async () => {
    const empty = await userDataStub(env, 'user-empty').listOps(null, null, 500);
    expect(empty).toEqual({
      ops: [],
      oldestUpdatedAt: null,
      newestUpdatedAt: null,
      hasMore: false,
    });
  });

  it('isolates each user log in its own DO instance', async () => {
    // Distinct userIds map to distinct DO instances (idFromName), so logs don't
    // bleed across users — the per-user isolation the DO model buys us.
    await userDataStub(env, 'user-b').commitOps([
      { op: 'put', path: 'links/only.enc', updatedAt: 1000, size: 1 },
    ]);

    const otherUser = await userDataStub(env, 'user-c').listOps(null, null, 500);
    expect(otherUser.ops).toHaveLength(0);
  });
});
