'use client';

// Edit operations for lists — rename, reorder, reparent — bound to the active
// account and wired to a sync kick. Each op writes exactly ONE list file
// (writeList), which is the whole point of the rank/parentId model: moving a list
// never rewrites its siblings, so concurrent moves on two devices don't collide.
//
// Reorder and move are the same write (a new `rank`, optionally a new `parentId`);
// "reorder" is just "move within the same parent". The caller supplies the
// destination sibling group and target index; rankForIndex turns that into the
// key to persist. Trash can't be a parent and a list can't be its own parent —
// both rejected here, and buildTree is the read-time safety net for any
// cross-device cycle that slips through.

import { useCallback, useMemo } from 'react';

import { rankForIndex, TRASH_ID } from '@stxapps/shared';

import { useAuth } from '@/contexts/auth-provider';
import { useSync } from '@/contexts/sync-provider';
import { writeList } from '@/data/mutations';
import type { ListItem } from '@/data/queries';

export interface ListMutations {
  rename: (list: ListItem, name: string) => Promise<void>;
  // Place `list` at `index` within `parentId`'s children. `siblings` is that
  // destination group as currently ordered, EXCLUDING `list` itself (so an
  // in-group reorder passes the group minus the moved row). `parentId` is null
  // for the root.
  move: (
    list: ListItem,
    parentId: string | null,
    siblings: ListItem[],
    index: number,
  ) => Promise<void>;
}

export function useListMutations(): ListMutations {
  const { username } = useAuth();
  const { requestSync } = useSync();

  const rename = useCallback(
    async (list: ListItem, name: string) => {
      if (!username) throw new Error('useListMutations: no active account');
      const trimmed = name.trim();
      if (trimmed === '' || trimmed === list.name) return;
      await writeList(username, list, { name: trimmed });
      requestSync();
    },
    [username, requestSync],
  );

  const move = useCallback(
    async (list: ListItem, parentId: string | null, siblings: ListItem[], index: number) => {
      if (!username) throw new Error('useListMutations: no active account');
      if (parentId === TRASH_ID) throw new Error('Trash cannot contain lists');
      if (parentId === list.id) throw new Error('A list cannot be its own parent');
      await writeList(username, list, { parentId, rank: rankForIndex(siblings, index) });
      requestSync();
    },
    [username, requestSync],
  );

  return useMemo<ListMutations>(() => ({ rename, move }), [rename, move]);
}
