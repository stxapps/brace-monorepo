import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { userFileKey } from '../lib/r2-keys';
import { type UserDataDO, userDataStub } from './user-data';

// The Durable Object is the other thing a Node runner can't test: its schema is
// migrated IN CODE on construction, its op log keysets off a real (updated_at,
// path) cursor, and a `put` commit reads the recorded timestamp + size from a real
// R2 HEAD. Here the DO is a real SQLite-backed instance against real (miniflare)
// R2, so these assertions actually prove the migration ran, the cursor semantics
// hold, the put timestamp is R2's own `LastModified`, and the quota map tracks. RPC
// methods are awaited across the stub.
//
// commitOp takes the userId (the DO can't recover its own idFromName) and builds
// the R2 key under the per-user prefix, so objects are seeded at userFileKey(uid, …).
describe('UserDataDO op log', () => {
  it('commits ops and reads them back over the (updatedAt, path) cursor', async () => {
    const uid = 'user-a';
    const stub = userDataStub(env, uid);

    // commitOp('put') HEADs R2, so the object must exist first (R2-first, log-last).
    await env.USER_FILES.put(userFileKey(uid, 'meta/a.enc'), 'aaa');
    await env.USER_FILES.put(userFileKey(uid, 'meta/b.enc'), 'bbbbb');

    const putA = await stub.commitOp(uid, 'put', 'meta/a.enc');
    const putB = await stub.commitOp(uid, 'put', 'meta/b.enc');
    const delA = await stub.commitOp(uid, 'delete', 'meta/a.enc');

    expect(typeof putA.updatedAt).toBe('number');
    expect(typeof delA.updatedAt).toBe('number');

    // A full pull from the start (null cursor) returns every op, ordered by
    // (updatedAt, path).
    const { ops, oldestUpdatedAt, newestUpdatedAt, hasMore } = await stub.listOps(null, null, 500);
    expect(hasMore).toBe(false);
    expect(ops.map((o) => o.path).sort()).toEqual(['meta/a.enc', 'meta/a.enc', 'meta/b.enc']);
    expect(oldestUpdatedAt).not.toBeNull();
    expect(newestUpdatedAt).not.toBeNull();

    // A put op carries R2's own LastModified — not a worker clock — so it matches
    // what the fallback R2 listing would report for the same object.
    const headB = await env.USER_FILES.head(userFileKey(uid, 'meta/b.enc'));
    expect(putB.updatedAt).toBe(headB?.uploaded.getTime());

    // The quota map tracks live objects only: a.enc was deleted, so just b.enc's
    // 5 bytes remain.
    const usage = await stub.usage();
    expect(usage.fileCount).toBe(1);
    expect(usage.totalBytes).toBe(5);
  });

  it('pages with the keyset cursor and reports hasMore', async () => {
    const uid = 'user-page';
    const stub = userDataStub(env, uid);
    for (const id of ['a', 'b', 'c']) {
      await env.USER_FILES.put(userFileKey(uid, `meta/${id}.enc`), id);
      await stub.commitOp(uid, 'put', `meta/${id}.enc`);
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

  it('refuses to log a put with no R2 object (op-without-object invariant)', async () => {
    // The HEAD doubles as an existence check: committing a put for a path that
    // isn't in R2 must throw and leave the log untouched, so no client ever pulls
    // an op that 404s. (No env.USER_FILES.put here — the object is absent.)
    //
    // Drive commitOp via runInDurableObject so the rejection stays INSIDE the DO's
    // execution context — asserting on a throw across the RPC stub instead would
    // surface it as a spurious remote pool error.
    const uid = 'user-d';
    const stub = userDataStub(env, uid);

    await runInDurableObject(stub, async (instance) => {
      // runInDurableObject hands back a base DurableObject (it doesn't thread the
      // stub's concrete type), so narrow to the class to reach commitOp.
      await expect(
        (instance as UserDataDO).commitOp(uid, 'put', 'meta/missing.enc'),
      ).rejects.toThrow(/no R2 object/);
    });
    expect((await stub.listOps(null, null, 500)).ops).toHaveLength(0);
  });

  it('isolates each user log in its own DO instance', async () => {
    // Distinct userIds map to distinct DO instances (idFromName), so logs don't
    // bleed across users — the per-user isolation the DO model buys us.
    await env.USER_FILES.put(userFileKey('user-b', 'meta/only.enc'), 'b');
    await userDataStub(env, 'user-b').commitOp('user-b', 'put', 'meta/only.enc');

    const otherUser = await userDataStub(env, 'user-c').listOps(null, null, 500);
    expect(otherUser.ops).toHaveLength(0);
  });
});
