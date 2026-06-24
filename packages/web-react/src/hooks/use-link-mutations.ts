'use client';

// Edit operations for links, bound to the active account and wired to a sync
// kick — the link sibling of useListMutations. Today it owns just `create` (the
// quick-add flow from the topbar); rename/move/remove/setTags land here as the
// editor grows. Each op writes exactly ONE link file (`links/{id}.enc`) via
// writeLink, the same one-file-per-entity LWW model the lists/tags/pins use.

import { useCallback, useMemo } from 'react';

import { ENC_SUFFIX, LINKS_PREFIX } from '@stxapps/shared';
import { newId } from '@stxapps/web-crypto';

import { useAuth } from '../contexts/auth-provider';
import { useSync } from '../contexts/sync-provider';
import { writeLink } from '../data/mutations';
import { type LinkItem } from '../data/queries';

// What the add form collects. `title` is intentionally absent: a link is saved
// from just a URL, and its title is back-filled by a later metadata fetch (so
// the row may render blank for a beat). `listId` always resolves to a concrete
// list at the call site (the active list, or My List as the inbox default).
export interface LinkDraft {
  url: string;
  listId: string;
  tagIds: string[];
  // Optional free-text note the user typed at save.
  // Stored inline on the link (`note` on linkSchema); omitted/blank → no note.
  note?: string;
}

export interface LinkMutations {
  // Create a link from a draft. Returns the created link so the UI can
  // focus/scroll to its new row, mirroring useListMutations.create. A blank URL
  // is a no-op (returns null).
  create: (draft: LinkDraft) => Promise<LinkItem | null>;
}

export function useLinkMutations(): LinkMutations {
  const { username } = useAuth();
  const { requestSync } = useSync();

  const create = useCallback(
    async (draft: LinkDraft) => {
      if (!username) throw new Error('useLinkMutations: no active account');

      const url = draft.url.trim();
      if (url === '') return null;

      const id = newId();
      // createdAt: 0 → writeLink stamps it now (same first-write contract as
      // writeList); path is the well-known store key its blob will live at.
      const link: LinkItem = {
        title: '',
        url,
        tagIds: draft.tagIds,
        listId: draft.listId,
        createdAt: 0,
        updatedAt: 0,
        path: `${LINKS_PREFIX}${id}${ENC_SUFFIX}`,
      };

      // A blank note stays absent (not an empty string) — keeps the link's blob
      // minimal and matches "omitted → no note".
      const note = draft.note?.trim();
      await writeLink(username, link, note ? { note } : {});
      requestSync();
      return { ...link, ...(note ? { note } : {}) };
    },
    [username, requestSync],
  );

  return useMemo<LinkMutations>(() => ({ create }), [create]);
}
