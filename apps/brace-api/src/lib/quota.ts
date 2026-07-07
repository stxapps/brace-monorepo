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
//  - 'upgrade_required' (403) — a PLAN gate: the free tier storing any `files/`
//    blob (the metadata-only keystone) or exceeding its saved-link cap. The
//    client maps this code to the paywall/upsell UI.
//  - 'quota_exceeded' (403) — a CAPACITY gate on an otherwise-entitled plan
//    (byte ceiling, object-count backstop). The client maps it to "storage full".
//
// Puts are the ONLY gated op. GETs are reading your own data, and deletes ride
// ops/commit ungated — so an over-quota account (e.g. after a downgrade) is
// read-only-plus-delete, never data-loss or lock-out.

import { type Entitlements, FILES_PREFIX, LINKS_PREFIX } from '@stxapps/shared';

import type { FileUsage } from '../do/user-data';
import { HttpError } from './errors';

// Gate one `files/sign` put batch. Conservative on counts: a new object's size
// is unknown until uploaded, so the byte check is on CURRENT usage, and a re-PUT
// of an existing path counts as new (harmless over-count near a ceiling).
export function checkPutQuota(ent: Entitlements, usage: FileUsage, paths: string[]): void {
  if (!ent.blobFiles && paths.some((p) => p.startsWith(FILES_PREFIX))) {
    throw new HttpError(
      403,
      'upgrade_required',
      'Storing images, page content, and archives requires a paid plan',
    );
  }

  if (ent.maxLinks !== null) {
    const newLinks = paths.filter((p) => p.startsWith(LINKS_PREFIX)).length;
    if (newLinks > 0 && usage.linkCount + newLinks > ent.maxLinks) {
      throw new HttpError(
        403,
        'upgrade_required',
        `The free plan holds up to ${ent.maxLinks} links`,
      );
    }
  }

  if (usage.fileCount + paths.length > ent.maxFiles) {
    throw new HttpError(403, 'quota_exceeded', 'File-count quota exceeded');
  }
  if (usage.totalBytes >= ent.maxBytes) {
    throw new HttpError(403, 'quota_exceeded', 'Storage quota exceeded');
  }
}
