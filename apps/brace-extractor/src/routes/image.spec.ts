import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { app } from '../app';

function stubFetch(impl: (url: string) => Response): ReturnType<typeof vi.fn> {
  const mock = vi.fn((input: RequestInfo | URL) => Promise.resolve(impl(String(input))));
  vi.stubGlobal('fetch', mock);
  return mock;
}

async function getImage(url: string): Promise<Response> {
  return app.request(`/v1/image?url=${encodeURIComponent(url)}`);
}

// Drive the handler with a real ExecutionContext so the background `cache.put`
// (waitUntil) can be flushed deterministically with `waitOnExecutionContext`.
async function getImageWithCtx(url: string): Promise<Response> {
  const request = new Request(`http://localhost/v1/image?url=${encodeURIComponent(url)}`);
  const ctx = createExecutionContext();
  const res = await app.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GET /v1/image', () => {
  it('streams image bytes through with the upstream content-type', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
    stubFetch(
      () =>
        new Response(bytes, {
          status: 200,
          headers: { 'content-type': 'image/png', 'content-length': String(bytes.length) },
        }),
    );

    const res = await getImage('https://cdn.example.com/i.png');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toContain('immutable');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
  });

  it('rejects a non-image content-type with 415', async () => {
    stubFetch(
      () =>
        new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    );

    const res = await getImage('https://example.com/not-an-image');
    expect(res.status).toBe(415);
    await expect(res.json()).resolves.toEqual({ error: 'unsupported_type' });
  });

  it('rejects an oversized declared body with 413', async () => {
    stubFetch(
      () =>
        new Response('x', {
          status: 200,
          headers: { 'content-type': 'image/jpeg', 'content-length': '20000000' },
        }),
    );

    const res = await getImage('https://cdn.example.com/huge.jpg');
    expect(res.status).toBe(413);
    await expect(res.json()).resolves.toEqual({ error: 'too_large' });
  });

  it('blocks a private-IP URL with 403 and never fetches it', async () => {
    const mock = stubFetch(() => new Response('nope'));

    const res = await getImage('http://10.0.0.1/secret.png');
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: 'blocked' });
    expect(mock).not.toHaveBeenCalled();
  });

  it('maps an upstream 404 to 502', async () => {
    stubFetch(() => new Response('nope', { status: 404 }));

    const res = await getImage('https://cdn.example.com/missing.png');
    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({ error: 'bad_status' });
  });

  it('400s on a non-http(s) url at the contract', async () => {
    const res = await getImage('ftp://example.com/i.png');
    expect(res.status).toBe(400);
  });

  it('serves a repeat request from the edge cache, fetching upstream only once', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9, 8, 7]);
    const mock = stubFetch(
      () =>
        new Response(bytes, {
          status: 200,
          headers: { 'content-type': 'image/webp', 'content-length': String(bytes.length) },
        }),
    );
    // Unique per run so a persisted cache entry can't bleed across test runs.
    const url = `https://cdn.example.com/cache-${crypto.randomUUID()}.webp`;

    const first = await getImageWithCtx(url);
    expect(first.status).toBe(200);
    expect(new Uint8Array(await first.arrayBuffer())).toEqual(bytes);

    const second = await getImageWithCtx(url);
    expect(second.status).toBe(200);
    expect(second.headers.get('content-type')).toBe('image/webp');
    expect(new Uint8Array(await second.arrayBuffer())).toEqual(bytes);

    // Second hit was served from cache — no second upstream fetch.
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('keys the cache on the full url — a different target is a cache miss', async () => {
    const mock = stubFetch(
      (input) =>
        new Response(new TextEncoder().encode(input), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        }),
    );
    const a = `https://cdn.example.com/a-${crypto.randomUUID()}.png`;
    const b = `https://cdn.example.com/b-${crypto.randomUUID()}.png`;

    await (await getImageWithCtx(a)).arrayBuffer();
    await (await getImageWithCtx(b)).arrayBuffer();

    // Distinct URLs → distinct cache keys → both fetched (no false hit).
    expect(mock).toHaveBeenCalledTimes(2);
  });
});
