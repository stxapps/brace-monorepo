import { ApiError, callEndpoint } from '../api/client';
import {
  extractEndpoint,
  type ExtractResult,
  imageProxyEndpoint,
  imageProxyRequestSchema,
} from './endpoints';

// The client binding to `brace-extractor` — the web app's server-tier CAPTURE
// SOURCE, the counterpart of the extension's active-tab `capture.ts`. It is NOT the
// `@stxapps/shared` auth client (`createAuthApiClient`): `brace-extractor` is a
// SEPARATE app on a SEPARATE origin (`extract.brace.to`, not `api.brace.to`) and is
// ANONYMOUS — no bearer token (attaching the account's token would convert the leak
// from "the server saw this URL" into "the server tied this URL to this account",
// the strictly-worse leak the design forbids — docs/link-extraction.md "server
// extraction"). So this is a plain `createApiClient`-style fetch with no auth.
//
// Only the base URL is app-specific (Next inlines `NEXT_PUBLIC_EXTRACT_URL`, wxt
// `WXT_PUBLIC_EXTRACT_URL`), so — like `createAuthApiClient` — the app resolves it
// from its own env and passes it in; the wiring lives here once. A client whose env
// doesn't configure an extractor origin simply builds none (the caller passes
// `null`), and server extraction stays inert.
export interface ExtractClient {
  // Interactive single-URL extract with the image inlined — POST /v1/extract,
  // `inlineImage: true` (honored only for a single URL, so the web app skips the
  // second GET /v1/image round trip when the image fetch succeeds). Returns that
  // URL's own per-URL result (partial success, never all-or-nothing).
  extract(url: string, signal?: AbortSignal): Promise<ExtractResult>;
  // Pull the discovered og:image's bytes through the streaming image proxy — GET
  // /v1/image — for the case the extract response carried only `imageUrl` (no inline
  // bytes). The web app can't read cross-origin image bytes itself (CORS), so the
  // proxy streams them through; the bytes are encrypted into `files/{id}.enc` here.
  fetchImage(url: string, signal?: AbortSignal): Promise<Uint8Array>;
}

export function createExtractClient({
  baseUrl,
  fetch: fetchImpl = fetch,
}: {
  baseUrl: string;
  fetch?: typeof fetch;
}): ExtractClient {
  return {
    async extract(url, signal) {
      const { results } = await callEndpoint(
        { baseUrl, fetch: fetchImpl },
        extractEndpoint,
        { urls: [url], inlineImage: true },
        { signal },
      );
      // Single-URL request → a single result; `url` echoes the input, so correlate by
      // it rather than relying on array position.
      const result = results.find((r) => r.url === url) ?? results[0];
      if (!result) throw new Error('extract: empty result array');
      return result;
    },

    async fetchImage(url, signal) {
      // Re-run the contract's front SSRF gate (http(s) + length) before the network,
      // exactly as `callEndpoint` does for the JSON endpoints — the proxy success
      // body is a binary STREAM, not JSON, so it can't ride `callEndpoint`.
      imageProxyRequestSchema.parse({ url });
      const target = new URL(imageProxyEndpoint.path, baseUrl);
      target.searchParams.set('url', url);
      const res = await fetchImpl(target.toString(), { method: 'GET', signal });
      if (!res.ok) throw new ApiError(res.status, await res.text().catch(() => ''));
      return new Uint8Array(await res.arrayBuffer());
    },
  };
}
