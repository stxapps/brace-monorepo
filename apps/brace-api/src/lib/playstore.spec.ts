import { env } from 'cloudflare:workers';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  acknowledgePlaystorePurchase,
  fetchPlaystoreSubscription,
  playAccessToken,
  resetPlayAccessTokenCache,
} from './playstore';

// The service-account access-token cache and its 401 retry. The Play FLOWS are
// covered end-to-end in routes/iap.spec.ts (which now scripts exactly one token
// exchange per test, pinning "a verify that also acknowledges mints one token,
// not two"); this file pins the edges no route test can reach: the expiry
// window, the refusal to cache a lifetime Google didn't state, and recovery
// from a token that dies before that window is up.
//
// The JWT signing is real (the test pool provides a throwaway RSA key, see
// vitest.config.ts) — only Google's endpoints are stubbed.

let tokenCalls = 0;
let tokenBody: unknown = { access_token: 'tok-1', expires_in: 3600 };
// Statuses each stub returns, one per call (the last one repeats).
let apiStatuses: number[] = [200];
let apiCalls: string[] = [];
let ackStatuses: number[] = [204];
let ackCalls: string[] = [];
const realFetch = globalThis.fetch;

const SUBSCRIPTION_BODY = {
  subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
  acknowledgementState: 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED',
  lineItems: [
    {
      productId: 'plus',
      expiryTime: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      autoRenewingPlan: { autoRenewEnabled: true },
    },
  ],
};

function stubGoogle() {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes('oauth2.googleapis.com/token')) {
      tokenCalls += 1;
      return new Response(JSON.stringify(tokenBody), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.includes('/purchases/subscriptionsv2/tokens/')) {
      const auth = new Headers(init?.headers).get('Authorization') ?? '';
      apiCalls.push(auth);
      const status = apiStatuses[Math.min(apiCalls.length - 1, apiStatuses.length - 1)];
      return new Response(JSON.stringify(status === 200 ? SUBSCRIPTION_BODY : {}), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.includes(':acknowledge')) {
      ackCalls.push(new Headers(init?.headers).get('Authorization') ?? '');
      const status = ackStatuses[Math.min(ackCalls.length - 1, ackStatuses.length - 1)];
      // Google answers a successful acknowledge with 204 No Content.
      return new Response(status === 204 ? null : '{}', { status });
    }
    return realFetch(input as RequestInfo, init);
  }) as typeof fetch;
}

const HOUR_MS = 60 * 60 * 1000;

describe('playAccessToken', () => {
  beforeAll(stubGoogle);
  afterEach(() => {
    resetPlayAccessTokenCache();
    tokenCalls = 0;
    tokenBody = { access_token: 'tok-1', expires_in: 3600 };
    apiStatuses = [200];
    apiCalls = [];
    ackStatuses = [204];
    ackCalls = [];
    vi.restoreAllMocks();
  });

  it('mints once and reuses the token across calls', async () => {
    const now = Date.now();
    expect(await playAccessToken(env, now)).toBe('tok-1');
    expect(await playAccessToken(env, now + 1000)).toBe('tok-1');
    expect(tokenCalls).toBe(1);
  });

  it('re-mints once the refresh margin is reached', async () => {
    const now = Date.now();
    await playAccessToken(env, now);
    tokenBody = { access_token: 'tok-2', expires_in: 3600 };

    // Still inside the window (5 min of margin on a 1h token → 55 min of use).
    expect(await playAccessToken(env, now + 54 * 60 * 1000)).toBe('tok-1');
    expect(tokenCalls).toBe(1);

    // Past it — re-minted BEFORE Google's own expiry, which is the point of the
    // margin: a token handed out here can't lapse mid-flight.
    expect(await playAccessToken(env, now + 56 * 60 * 1000)).toBe('tok-2');
    expect(tokenCalls).toBe(2);
  });

  it('does not cache when the response states no lifetime', async () => {
    tokenBody = { access_token: 'tok-1' };
    const now = Date.now();
    await playAccessToken(env, now);
    await playAccessToken(env, now + 1000);
    expect(tokenCalls).toBe(2);
  });

  it('does not cache a lifetime shorter than the refresh margin', async () => {
    tokenBody = { access_token: 'tok-1', expires_in: 60 };
    const now = Date.now();
    await playAccessToken(env, now);
    await playAccessToken(env, now + 1000);
    expect(tokenCalls).toBe(2);
  });

  it('shares the cache across callers — the token has no user dimension', async () => {
    // What makes cross-request reuse sound: the JWT's claims name the service
    // account and the androidpublisher scope, never a user, so one token serves
    // every account's lookup.
    const now = Date.now();
    await playAccessToken(env, now);
    await playAccessToken(env, now + HOUR_MS / 2);
    expect(tokenCalls).toBe(1);
  });
});

// The recovery the refresh margin can't provide: a token revoked before its
// stated expiry (key rotation) would otherwise poison the isolate for the rest
// of the window.
describe('playApiFetch (via fetchPlaystoreSubscription)', () => {
  beforeAll(stubGoogle);
  afterEach(() => {
    resetPlayAccessTokenCache();
    tokenCalls = 0;
    tokenBody = { access_token: 'tok-1', expires_in: 3600 };
    apiStatuses = [200];
    apiCalls = [];
    ackStatuses = [204];
    ackCalls = [];
    vi.restoreAllMocks();
  });

  it('drops the cached token on a 401 and retries once with a fresh one', async () => {
    apiStatuses = [401, 200];
    tokenBody = { access_token: 'tok-1', expires_in: 3600 };

    // Warm the cache, then let the API reject that token.
    await playAccessToken(env, Date.now());
    expect(tokenCalls).toBe(1);
    tokenBody = { access_token: 'tok-2', expires_in: 3600 };

    const snapshot = await fetchPlaystoreSubscription(env, 'play-token-1');
    expect(snapshot?.productId).toBe('plus');
    // Retried with a NEWLY minted token, not the rejected one.
    expect(apiCalls).toEqual(['Bearer tok-1', 'Bearer tok-2']);
    expect(tokenCalls).toBe(2);
  });

  it('leaves the fresh token cached for the next caller', async () => {
    apiStatuses = [401, 200];
    await fetchPlaystoreSubscription(env, 'play-token-1');
    const mintsAfterRecovery = tokenCalls;

    apiStatuses = [200];
    await fetchPlaystoreSubscription(env, 'play-token-2');
    expect(tokenCalls).toBe(mintsAfterRecovery);
  });

  it('gives up after one retry — a second 401 is a real auth failure', async () => {
    apiStatuses = [401];
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // Non-ok, non-404 surfaces as a throw (callers turn it into a 5xx /
    // redelivery), and the retry does NOT become a loop.
    await expect(fetchPlaystoreSubscription(env, 'play-token-1')).rejects.toThrow(
      'Play Developer API 401',
    );
    expect(apiCalls).toHaveLength(2);
    expect(tokenCalls).toBe(2);
    // The fresh token failing the same way is the credential's problem, and
    // says so — that's the line worth alerting on, not the first 401.
    expect(error).toHaveBeenCalledWith(expect.stringContaining('after a fresh token'));
  });

  it('does not retry a 404 — a garbage purchase token is not an auth problem', async () => {
    apiStatuses = [404];
    expect(await fetchPlaystoreSubscription(env, 'play-token-1')).toBeNull();
    expect(apiCalls).toHaveLength(1);
    expect(tokenCalls).toBe(1);
  });
});

// The acknowledge's 4xx handling. Every 4xx returns false either way — the
// client's finishTransaction is the primary path — so what's pinned here is the
// LOG LEVEL, which is the whole point of the split: an unhealable credential
// failure must not read as the routine already-acknowledged race.
describe('acknowledgePlaystorePurchase', () => {
  beforeAll(stubGoogle);
  afterEach(() => {
    resetPlayAccessTokenCache();
    tokenCalls = 0;
    tokenBody = { access_token: 'tok-1', expires_in: 3600 };
    apiStatuses = [200];
    apiCalls = [];
    ackStatuses = [204];
    ackCalls = [];
    vi.restoreAllMocks();
  });

  it('reports success on Google 204', async () => {
    expect(await acknowledgePlaystorePurchase(env, 'plus', 'play-token-1')).toBe(true);
  });

  it('logs a 403 as an error — the credential cannot acknowledge at all', async () => {
    ackStatuses = [403];
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(await acknowledgePlaystorePurchase(env, 'plus', 'play-token-1')).toBe(false);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('403'));
    expect(error.mock.calls[0][0]).toContain('service-account credential');
  });

  it('logs a 400 quietly — that is the already-acknowledged race', async () => {
    ackStatuses = [400];
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    expect(await acknowledgePlaystorePurchase(env, 'plus', 'play-token-1')).toBe(false);
    expect(error).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('already acknowledged?'));
  });

  it('retries a 401 with a fresh token before calling it a credential failure', async () => {
    ackStatuses = [401];
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(await acknowledgePlaystorePurchase(env, 'plus', 'play-token-1')).toBe(false);
    // playApiFetch's one retry, THEN the 401 branch — not the benign one.
    expect(ackCalls).toHaveLength(2);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('service-account credential'));
  });

  it('still throws on a 5xx — that one is worth a redelivery', async () => {
    ackStatuses = [503];
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(acknowledgePlaystorePurchase(env, 'plus', 'play-token-1')).rejects.toThrow(
      'Play Developer API 503',
    );
  });
});
