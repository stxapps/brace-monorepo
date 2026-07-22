// Edit operations for links, bound to the active account and wired to a sync
// kick — the expo port of web-react's use-link-mutations (that file is the
// canonical doc for each op's semantics: the one-file-per-entity LWW model,
// the re-read-before-merge, destroy's satellite sweep). Ported so far: `update`
// (the general edit every bulk action rides — move list, retag, archive,
// restore, trash are all patches) and `destroy` (the permanent delete behind
// Trash's "Delete permanently"). The remaining siblings (`create`,
// `saveCustomImage`, `deleteCustomImage`) arrive with the add/edit editors —
// they need flows (quick-add, image picking + resizing) not on this platform
// yet.

import { useCallback, useMemo } from 'react';

import { useAuth } from '../contexts/auth-provider';
import { useSync } from '../contexts/sync-provider';
import {
  deleteExtraction,
  deleteFile,
  deleteLink,
  deletePin,
  type LinkPatch,
  writeLink,
} from '../data/mutations';
import { linkIdOf, type LinkItem, readExtraction, readLinkById } from '../data/queries';

export interface LinkMutations {
  // Patch a link's user-authored fields (LinkPatch — an explicitly-undefined
  // field clears it). Every caller rides this one op: move-to-list, archive,
  // restore, trash are all `{ listId }`; the edit dialog passes the full patch.
  update: (link: LinkItem, patch: LinkPatch) => Promise<void>;
  // Permanently delete a link AND its satellites: the `files/` blobs it (or its
  // extraction) references, its `extractions/{id}.enc`, its pin, then the link
  // itself. Irreversible — callers confirm first; "move to Trash" is `update`.
  destroy: (link: LinkItem) => Promise<void>;
}

export function useLinkMutations(): LinkMutations {
  const { username } = useAuth();
  const { requestSync } = useSync();

  const update = useCallback(
    async (link: LinkItem, patch: LinkPatch) => {
      if (!username) throw new Error('useLinkMutations: no active account');

      // Re-read the current blob before merging: the caller's `link` is a row/dialog
      // snapshot, and a sync may have landed a fresher blob since it rendered —
      // writeLink spreads the patch onto what it's handed, so merging onto the stale
      // snapshot would silently resurrect overwritten fields. Gone entirely (deleted
      // on another device) falls back to the snapshot: the edit recreates the link,
      // the honest LWW outcome for edit-vs-delete.
      const current = (await readLinkById(linkIdOf(link))) ?? link;
      await writeLink(username, current, patch);
      requestSync();
    },
    [username, requestSync],
  );

  const destroy = useCallback(
    async (link: LinkItem) => {
      if (!username) throw new Error('useLinkMutations: no active account');

      const id = linkIdOf(link);
      // Freshest copy for the sweep (same staleness argument as `update`): the
      // custom-image ref may have changed since the row rendered.
      const current = (await readLinkById(id)) ?? link;
      const extraction = await readExtraction(id);

      // The link's `files/` content: the user's custom image plus everything the
      // extraction references. Content first, entities after — a briefly-dangling
      // ref reads as "no bytes" (readFileBytes → undefined), whereas deleting the
      // link first would orphan the blobs forever if interrupted.
      const fileIds = [
        current.customImageId,
        extraction?.imageId,
        extraction?.screenshotId,
        extraction?.pageCopyId,
      ].filter((fileId): fileId is string => typeof fileId === 'string');
      for (const fileId of fileIds) await deleteFile(username, fileId);

      // Satellites keyed by the link's id. Absent ones (never extracted, never
      // pinned) are local no-ops + harmless tombstones upstream.
      await deleteExtraction(username, id);
      await deletePin(username, id);
      await deleteLink(username, current);
      requestSync();
    },
    [username, requestSync],
  );

  return useMemo<LinkMutations>(() => ({ update, destroy }), [update, destroy]);
}
