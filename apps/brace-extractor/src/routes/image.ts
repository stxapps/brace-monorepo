import { zValidator } from '@hono/zod-validator';
import type { Context } from 'hono';
import { Hono } from 'hono';

import { imageProxyEndpoint } from '@stxapps/shared';

import type { AppEnv } from '../lib/env';
import { ApiError } from '../lib/errors';
import { MAX_IMAGE_BYTES, safeFetch, SafeFetchError, streamWithLimit } from '../lib/safe-fetch';
import { rateLimit } from '../middleware/rate-limit';

// GET /v1/image?url=… — the stateless image proxy (docs "stream-don't-store"). The
// web app can't read cross-origin image bytes (CORS / tainted-canvas) and rendering
// the remote URL directly is the per-paint leak the design forbids — so this STREAMS
// the remote bytes THROUGH and buffers/persists nothing. The client encrypts the
// streamed bytes into `files/{id}.enc` itself.
//
// Same arbitrary-URL fetch as /extract, so it carries the SAME SSRF guard + timeout
// + redirect re-validation (all in safeFetch), plus an `image/*` content-type
// allowlist and the per-response byte ceiling (streamWithLimit). It NEVER resizes or
// transcodes — that would force a full decode (real CPU + OOM risk on the 128 MB
// isolate) and kill the streaming-is-free property; thumbnailing is a deferred
// CLIENT step before encrypt.

// Write the proxied response into the edge cache off the response path. The clone tees
// the streaming body, so the client isn't blocked on the cache write; `waitUntil` keeps
// the put alive past the response when an execution context is present (always, on
// Workers — absent only under `app.request()` in a test, where we just let it run).
function cacheInBackground(c: Context<AppEnv>, cache: Cache, key: Request, res: Response): void {
  const put = cache.put(key, res).catch(() => undefined);
  try {
    c.executionCtx.waitUntil(put);
  } catch {
    void put;
  }
}

// Map an internal fetch failure to a clean HTTP status for this single-resource GET
// (unlike /extract, which records per-URL errors in a 200 body).
function statusForError(code: SafeFetchError['code']): number {
  switch (code) {
    case 'blocked':
      return 403;
    case 'unsupported_type':
      return 415;
    case 'too_large':
      return 413;
    case 'timeout':
      return 504;
    case 'bad_status':
    case 'fetch_failed':
      return 502;
    default:
      return 502;
  }
}

export const imageRoutes = new Hono<AppEnv>().get(
  imageProxyEndpoint.path,
  rateLimit('image'),
  zValidator('query', imageProxyEndpoint.request),
  async (c) => {
    const { url } = c.req.valid('query');

    // Edge cache. The proxied bytes are PLAINTEXT and IDENTICAL for every client (each
    // client encrypts locally, AFTER), so a popular image — one many users saved — is
    // fetched upstream once and served from the shared cache thereafter. The cache saves
    // the upstream fetch + SSRF/parse work + latency (and softens the re-extract churn a
    // flaky image causes), but it does NOT bypass the rate limiter (already run above): a
    // hit still streams bytes to the client, which is the egress the limiter bounds. The
    // key is the full request URL (it carries ?url=), so one target's bytes can never be
    // served for another; CORS is layered on by the global cors() middleware for hits and
    // misses alike, so the cached entry stays CORS-free and origin-agnostic. A hit can
    // skip safeFetch safely — only a validated public 200 was ever cached (every reject
    // throws before the put), so re-serving those bytes exposes nothing new.
    // `caches.default` is the Workers global cache. `@types/node` (pulled into the spec
    // typecheck only) also declares a `caches` whose `CacheStorage` has no `.default`, so
    // reach it through a narrow cast — correct on the Workers runtime where this runs.
    const cache =
      typeof caches !== 'undefined' ? (caches as unknown as { default: Cache }).default : undefined;
    const cacheKey = new Request(c.req.url, { method: 'GET' });
    if (cache) {
      const hit = await cache.match(cacheKey);
      if (hit) return hit;
    }

    let response: Response;
    try {
      ({ response } = await safeFetch(url, 'image/*'));
    } catch (err) {
      if (err instanceof SafeFetchError) {
        throw new ApiError(statusForError(err.code), err.code);
      }
      throw err;
    }

    const contentType = (response.headers.get('content-type') ?? '').split(';')[0].trim();
    if (!contentType.toLowerCase().startsWith('image/')) {
      await response.body?.cancel().catch(() => undefined);
      throw new ApiError(415, 'unsupported_type');
    }

    // Early reject if the upstream declares an oversized body — cheaper than
    // streaming up to the cap before aborting. (streamWithLimit is still the real
    // ceiling, for when Content-Length is absent or lies.)
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTES) {
      await response.body?.cancel().catch(() => undefined);
      throw new ApiError(413, 'too_large');
    }

    if (!response.body) {
      throw new ApiError(502, 'fetch_failed');
    }

    // Stream the bytes through, hard-aborting past the ceiling. Forward ONLY safe,
    // relevant headers — never upstream cookies/auth — and let the client cache the
    // (immutable) image. CORS headers are added by the global cors() middleware.
    const limited = response.body.pipeThrough(streamWithLimit(MAX_IMAGE_BYTES));
    const headers = new Headers({
      'content-type': contentType,
      'cache-control': 'public, max-age=86400, immutable',
      'x-content-type-options': 'nosniff',
    });
    const proxied = new Response(limited, { status: 200, headers });

    // Populate the edge cache off the response path (the clone tees the stream). Only
    // this validated 200 is ever cached — every reject threw above and never reaches here.
    if (cache) cacheInBackground(c, cache, cacheKey, proxied.clone());
    return proxied;
  },
);
