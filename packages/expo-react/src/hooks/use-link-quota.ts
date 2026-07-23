// Live read of the plan's saved-link cap against the local library — the expo
// port of web-react's use-link-quota (that header is canonical: the gate is
// UX but load-bearing — the server enforces `maxLinks` at `files/sign` with a
// 403, so an over-cap save would succeed locally and then wedge the pending
// sync queue forever; and `count` matches the server's counting rule exactly,
// every `links/` record INCLUDING trashed ones). The count is `countLinks`
// (queries.ts — the same trash-inclusive rule import-all-data's cap check
// uses), live over `items` via useLiveRead.

import { useMemo } from 'react';

import { countLinks } from '../data/queries';
import { useEntitlements } from './use-entitlements';
import { useLiveRead } from './use-live-read';

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
  const count = useLiveRead(() => countLinks(), [], ['items']) ?? 0;

  return useMemo(() => ({ count, max, atLimit: max !== null && count >= max }), [count, max]);
}
