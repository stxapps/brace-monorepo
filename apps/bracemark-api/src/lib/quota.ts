// Per-user storage quota, enforced at `POST /v1/files/sign` (op: 'put') — the one
// place abuse can be bounded when content is opaque (the server can't inspect a
// blob, only count and size it — but PATHS are visible, so namespaces can be
// gated too). Checked against the durable per-path size map in the user's DO
// (do/repositories/file-sizes.ts), never the disposable op log. See
// docs/local-first-sync.md "authorization & quota".
//
// The LIMITS are no longer constants here: they come from the account's plan via
// the shared `entitlementsOf()` (iap/plans.ts — the same numbers the client
// paywall displays; see docs/business-model.md "tiers"), resolved per request by
// services/iap.ts. This module owns only the GATE — which entitlement blocks
// which put, and with which error code:
//
//  - 'upgrade_required' (403) — a PLAN gate: the free tier exceeding its
//    saved-link cap (`maxLinks`). The client maps this code to the paywall/upsell
//    UI. NOTE: the free tier DOES store `files/` blobs (client-extracted preview
//    images) — there is no per-namespace plan gate, because the server can't tell
//    a preview image from a heavy blob; free blob storage is bounded only by the
//    byte/count backstop below (see docs/business-model.md "tiers").
//  - 'quota_exceeded' (403) — a CAPACITY gate on an otherwise-entitled plan
//    (byte ceiling, object-count backstop). The client maps it to "storage full".
//
// Puts are the ONLY gated op. GETs are reading your own data, and deletes ride
// ops/commit ungated — so an over-quota account (e.g. after a downgrade) is
// read-only-plus-delete, never data-loss or lock-out.

import { type Entitlements, LINKS_PREFIX } from '@stxapps/shared';

import type { FileUsage } from '../do/user-data';
import { HttpError } from './errors';

// Gate one `files/sign` put batch.
//
// `newPaths` is the batch MINUS every path the user already has an object for
// (services/sync.ts resolves it against the DO's size map). Counting only the new
// ones is what makes the cap mean "you may not add a 201st link" rather than "you
// may not touch links": an in-place update — retitle, add a tag, move list, and
// above all move to Trash — re-PUTs an EXISTING `links/` path, adds nothing to any
// total, and must stay allowed at and over the cap. It is also the only way the
// promise in this file's header holds, since Trash-then-delete is how a downgraded
// account gets back under its cap, and the Trash step is a put.
//
// Still conservative on bytes: a new object's size is unknown until it is
// uploaded, so the byte check is on CURRENT usage and an in-place update that
// GROWS a file is charged only on the next batch.
export function checkPutQuota(ent: Entitlements, usage: FileUsage, newPaths: string[]): void {
  if (ent.maxLinks !== null) {
    const newLinks = newPaths.filter((p) => p.startsWith(LINKS_PREFIX)).length;
    if (newLinks > 0 && usage.linkCount + newLinks > ent.maxLinks) {
      throw new HttpError(
        403,
        'upgrade_required',
        `The free plan holds up to ${ent.maxLinks} links`,
      );
    }
  }

  if (usage.fileCount + newPaths.length > ent.maxFiles) {
    throw new HttpError(403, 'quota_exceeded', 'File-count quota exceeded');
  }
  if (usage.totalBytes >= ent.maxBytes) {
    throw new HttpError(403, 'quota_exceeded', 'Storage quota exceeded');
  }
}
