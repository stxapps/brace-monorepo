import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { userDataStub } from './user-data';

// The Durable Object is the other thing a Node runner can't test: its schema is
// migrated IN CODE on construction, and its op log mints a
// monotonic seq from real SQLite AUTOINCREMENT. Here the DO is a real
// SQLite-backed instance, so these assertions actually prove the migration ran
// and the seq semantics hold. RPC methods are awaited across the stub.
describe('UserDataDO op log', () => {
  it('appends ops with a strictly increasing seq and reads them back', async () => {
    const stub = userDataStub(env, 'user-a');

    // A fresh DO implies migrate() created op_logs; the first append proves it.
    const seq1 = await stub.appendOp('put', '/notes/a.txt', 10);
    const seq2 = await stub.appendOp('put', '/notes/b.txt', 20);
    const seq3 = await stub.appendOp('delete', '/notes/a.txt', 0);

    expect(seq2).toBeGreaterThan(seq1);
    expect(seq3).toBeGreaterThan(seq2);

    // Incremental pull from the start returns all ops, oldest first.
    const all = await stub.listOpsSince(0);
    expect(all.map((o) => o.path)).toEqual(['/notes/a.txt', '/notes/b.txt', '/notes/a.txt']);
    expect(all.map((o) => o.op)).toEqual(['put', 'put', 'delete']);

    // Pull after a cursor returns only newer ops.
    const tail = await stub.listOpsSince(seq1);
    expect(tail.map((o) => o.seq)).toEqual([seq2, seq3]);
  });

  it('isolates each user log in its own DO instance', async () => {
    // Distinct userIds map to distinct DO instances (idFromName), so logs don't
    // bleed across users — the per-user isolation the DO model buys us.
    await userDataStub(env, 'user-b').appendOp('put', '/b-only.txt', 1);

    const otherUser = await userDataStub(env, 'user-c').listOpsSince(0);
    expect(otherUser).toHaveLength(0);
  });
});
