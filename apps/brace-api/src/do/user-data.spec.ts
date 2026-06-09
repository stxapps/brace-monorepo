import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { type UserDataDO, userDataStub } from './user-data';

// The Durable Object is the other thing a Node runner can't test: its schema is
// migrated IN CODE on construction, its op log mints a monotonic seq from real
// SQLite AUTOINCREMENT, and a `put` commit reads the recorded timestamp from a
// real R2 HEAD. Here the DO is a real SQLite-backed instance against real
// (miniflare) R2, so these assertions actually prove the migration ran, the seq
// semantics hold, and the put timestamp is R2's own `LastModified`. RPC methods
// are awaited across the stub.
describe('UserDataDO op log', () => {
  it('appends ops with a strictly increasing seq and reads them back', async () => {
    const stub = userDataStub(env, 'user-a');

    // appendOp('put') HEADs R2, so the object must exist first (R2-first, log-last).
    await env.USER_FILES.put('/notes/a.txt', 'a');
    await env.USER_FILES.put('/notes/b.txt', 'b');

    // A fresh DO implies migrate() created op_logs; the first append proves it.
    const seq1 = await stub.appendOp('put', '/notes/a.txt');
    const seq2 = await stub.appendOp('put', '/notes/b.txt');
    const seq3 = await stub.appendOp('delete', '/notes/a.txt');

    expect(seq2).toBeGreaterThan(seq1);
    expect(seq3).toBeGreaterThan(seq2);

    // Incremental pull from the start returns all ops, oldest first.
    const all = await stub.listOpsSince(0);
    expect(all.map((o) => o.path)).toEqual(['/notes/a.txt', '/notes/b.txt', '/notes/a.txt']);
    expect(all.map((o) => o.op)).toEqual(['put', 'put', 'delete']);

    // A put op carries R2's own LastModified — not a worker clock — so it matches
    // what the fallback R2 listing would report for the same object.
    const headB = await env.USER_FILES.head('/notes/b.txt');
    const putB = all.find((o) => o.op === 'put' && o.path === '/notes/b.txt');
    expect(putB?.updatedAt).toBe(headB?.uploaded.getTime());

    // A delete has no surviving object to HEAD, so it's stamped on the worker clock.
    const del = all.find((o) => o.op === 'delete');
    expect(typeof del?.updatedAt).toBe('number');

    // Pull after a cursor returns only newer ops.
    const tail = await stub.listOpsSince(seq1);
    expect(tail.map((o) => o.seq)).toEqual([seq2, seq3]);
  });

  it('refuses to log a put with no R2 object (op-without-object invariant)', async () => {
    // The HEAD doubles as an existence check: committing a put for a path that
    // isn't in R2 must throw and leave the log untouched, so no client ever pulls
    // an op that 404s. (No env.USER_FILES.put here — the object is absent.)
    //
    // Drive appendOp via runInDurableObject so the rejection stays INSIDE the DO's
    // execution context — asserting on a throw across the RPC stub instead would
    // surface it as a spurious remote pool error.
    const stub = userDataStub(env, 'user-d');

    await runInDurableObject(stub, async (instance) => {
      // runInDurableObject hands back a base DurableObject (it doesn't thread the
      // stub's concrete type), so narrow to the class to reach appendOp.
      await expect((instance as UserDataDO).appendOp('put', '/missing.enc')).rejects.toThrow(
        /no R2 object/,
      );
    });
    expect(await stub.listOpsSince(0)).toHaveLength(0);
  });

  it('isolates each user log in its own DO instance', async () => {
    // Distinct userIds map to distinct DO instances (idFromName), so logs don't
    // bleed across users — the per-user isolation the DO model buys us.
    await env.USER_FILES.put('/b-only.txt', 'b');
    await userDataStub(env, 'user-b').appendOp('put', '/b-only.txt');

    const otherUser = await userDataStub(env, 'user-c').listOpsSince(0);
    expect(otherUser).toHaveLength(0);
  });
});
