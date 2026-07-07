import { createExtractClient, type ExtractClient } from '@stxapps/shared';

// App-level binding of the `brace-extractor` client to its OWN origin —
// `extractor.brace.to`, set per environment via `NEXT_PUBLIC_EXTRACT_URL`. This is a
// DIFFERENT origin from brace-api's `NEXT_PUBLIC_API_URL` (lib/api-client.ts) on purpose:
// the extractor is the one component that fetches arbitrary user URLs, kept apart
// from the blind sync broker so "api.brace.to only ever sees ciphertext" stays
// code-provable (docs/link-extraction.md "server extraction"). It's anonymous — no
// auth client — so this is the plain shared `createExtractClient`, not
// `createAuthApiClient`.
//
// Unlike lib/api-client.ts, a MISSING env var is NOT fatal: server extraction is an opt-in
// feature off by default, so an environment that doesn't configure an extractor just
// leaves the client null and the ExtractionProvider loop inert — the app still runs.
const baseUrl = process.env.NEXT_PUBLIC_EXTRACT_URL;

export const extractClient: ExtractClient | null = baseUrl
  ? createExtractClient({ baseUrl })
  : null;
