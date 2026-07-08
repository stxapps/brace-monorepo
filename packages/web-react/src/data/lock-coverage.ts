import type { TreeNode } from '@stxapps/shared';

import type { LockRecord } from './db';
import type { ListItem } from './queries';

// Pure lock-coverage resolution, split out of lock-provider so it can be unit
// tested without React/Dexie/crypto. A lock on a list COVERS its whole subtree
// (otherwise Show All / tag views / search would leak the children's links and
// the lock would be decorative). This resolves, per list, the NEAREST locked
// self-or-ancestor lock — the covering lock a password prompt for the list
// verifies against, and unlocking which releases everything it covers.

export interface Coverage {
  // Every list whose links are currently gated (covered by a locked lock,
  // descendants included).
  lockedListIds: ReadonlySet<string>;
  // The covered lists that should also disappear from the sidebar/pickers.
  hiddenListIds: ReadonlySet<string>;
  // Covered list id → the covering lock row's id (nearest locked self-or-ancestor).
  coveringLockIds: ReadonlyMap<string, string>;
}

export const EMPTY_COVERAGE: Coverage = {
  lockedListIds: new Set(),
  hiddenListIds: new Set(),
  coveringLockIds: new Map(),
};

// Walk the list forest resolving each list's covering lock. `ancestorLockId` is
// the nearest locked ancestor's lock row (it wins as the covering lock — you must
// open the outermost door first; an inner lock takes over on the recompute after
// that unlock). `ancestorHidden` propagates hide from any locked ancestor, and a
// list's OWN locked hide flag applies even under a non-hiding ancestor lock.
function walkCoverage(
  nodes: TreeNode<ListItem>[],
  lockRows: ReadonlyMap<string, LockRecord>,
  unlockedIds: ReadonlySet<string>,
  ancestorLockId: string | null,
  ancestorHidden: boolean,
  out: { locked: Set<string>; hidden: Set<string>; covering: Map<string, string> },
): void {
  for (const node of nodes) {
    const own = lockRows.get(node.item.id);
    const ownActive = own !== undefined && !unlockedIds.has(own.id) ? own : undefined;
    const lockId = ancestorLockId ?? ownActive?.id ?? null;
    const isHidden = ancestorHidden || (ownActive?.hideList ?? false);
    if (lockId !== null) {
      out.locked.add(node.item.id);
      out.covering.set(node.item.id, lockId);
      if (isHidden) out.hidden.add(node.item.id);
    }
    walkCoverage(node.children, lockRows, unlockedIds, lockId, isHidden, out);
  }
}

export function computeCoverage(
  lists: TreeNode<ListItem>[],
  lockRows: ReadonlyMap<string, LockRecord>,
  unlockedIds: ReadonlySet<string>,
): Coverage {
  if (lockRows.size === 0) return EMPTY_COVERAGE;
  const out = {
    locked: new Set<string>(),
    hidden: new Set<string>(),
    covering: new Map<string, string>(),
  };
  walkCoverage(lists, lockRows, unlockedIds, null, false, out);
  return { lockedListIds: out.locked, hiddenListIds: out.hidden, coveringLockIds: out.covering };
}
