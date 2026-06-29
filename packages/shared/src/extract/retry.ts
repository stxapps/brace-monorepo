import { type ExtractError } from './endpoints';

// Which extract errors are PERMANENT (never retry — record `status: 'permanent'`) vs.
// transient (`failed`, retried after `backoff` — sync/extraction.ts). `blocked` (SSRF
// reject) and the content caps (`unsupported_type`, `too_large`) won't change on a retry;
// a bad status / timeout / fetch failure might, so those stay transient. (The contract's
// `bad_status` doesn't carry the code, so a 404 is paced by backoff rather than marked
// permanent up front — the cap bounds the retries either way.)
//
// Lives in `shared`, beside the `ExtractError` enum it classifies, so every server-tier
// client (brace-web today, the future brace-expo) maps the extractor's error vocabulary
// onto the facet's permanent/transient axis by identical rules — the same reason `tierOf`
// and `backoff` (the other shared extraction-outcome rules) live in `shared`.
export function isPermanent(error: ExtractError | undefined): boolean {
  return error === 'blocked' || error === 'unsupported_type' || error === 'too_large';
}
