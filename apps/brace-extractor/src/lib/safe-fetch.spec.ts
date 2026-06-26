import { describe, expect, it } from 'vitest';

import { bytesToBase64, readAllWithLimit, SafeFetchError } from './safe-fetch';

// The body-capping + base64 helpers used by the inline-image path. The redirect /
// SSRF behavior of safeFetch is covered via the routes (extract/image .spec.ts) and
// ssrf.spec.ts; these are the pure size/encoding edges.
describe('readAllWithLimit', () => {
  it('returns the full body when it is within the cap', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const out = await readAllWithLimit(new Response(bytes), 100);
    expect(out).toEqual(bytes);
  });

  it('throws too_large once the body exceeds the cap', async () => {
    const bytes = new Uint8Array(50);
    await expect(readAllWithLimit(new Response(bytes), 10)).rejects.toMatchObject({
      name: 'SafeFetchError',
      code: 'too_large',
    });
  });

  it('throws a SafeFetchError specifically', async () => {
    const bytes = new Uint8Array(50);
    await expect(readAllWithLimit(new Response(bytes), 10)).rejects.toBeInstanceOf(SafeFetchError);
  });
});

describe('bytesToBase64', () => {
  it('round-trips arbitrary bytes through atob', () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 255, 128, 1]);
    const decoded = Uint8Array.from(atob(bytesToBase64(bytes)), (c) => c.charCodeAt(0));
    expect(decoded).toEqual(bytes);
  });

  it('handles a body larger than the fromCharCode chunk size', () => {
    // 0x8000 is the chunk boundary in bytesToBase64; cross it to exercise chunking.
    const bytes = new Uint8Array(0x8000 + 100).map((_, i) => i % 256);
    const decoded = Uint8Array.from(atob(bytesToBase64(bytes)), (c) => c.charCodeAt(0));
    expect(decoded).toEqual(bytes);
  });
});
