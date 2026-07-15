'use client';

// Live read of the plan's saved-link cap against the local library — what the
// create surfaces (brace-web's quick-add popover, the extension popup's editor)
// gate on before they let a save through.
//
// This gate is UX, but not decoration. `maxLinks` is one of the few limits a
// blind server CAN enforce (it counts `links/` paths at `files/sign` — see
// brace-api lib/quota.ts), and it answers an over-cap put with 403
// `upgrade_required`. A local-first save that ignores the cap therefore SUCCEEDS
// locally and then fails forever in the sync engine: the pending op can't drain,
// and every op chunked behind it is stuck too. So the point of checking here is
// to keep the pending queue drainable — not to defend the limit, which the
// server already does.
//
// `count` matches the server's counting rule EXACTLY, which is the one detail
// worth care: every `links/` record, INCLUDING trashed ones. Trash is a listId,
// not a deletion — a trashed link still has its `links/{id}.enc` blob, so the
// server counts it. Counting only what the UI shows would put this number under
// the server's and re-open the wedged-queue hole. (Same rule as
// readExistingLinks in data/import-all-data.ts, the import path's cap check.)
//
// The querier is a single direct Dexie call (no async helper hops), so
// liveQuery's dependency tracking is safe.

import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';

import { LINKS_PREFIX } from '@stxapps/shared';

import { db } from '../data/db';
import { useEntitlements } from './use-entitlements';

export interface LinkQuota {
  // Links in the local store, counted the server's way (incl. trashed). 0 until
  // the first read resolves.
  count: number;
  // The plan's cap; null = unlimited (every paid plan).
  max: number | null;
  // Whether a new link would be refused. False while unlimited.
  atLimit: boolean;
}

export function useLinkQuota(): LinkQuota {
  const { entitlements } = useEntitlements();
  const max = entitlements.maxLinks;
  const count =
    useLiveQuery(() => db.items.where('path').startsWith(LINKS_PREFIX).count(), [], 0) ?? 0;

  return useMemo(() => ({ count, max, atLimit: max !== null && count >= max }), [count, max]);
}
