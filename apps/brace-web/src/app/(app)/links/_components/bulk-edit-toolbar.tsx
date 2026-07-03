'use client';

// The toolbar shown while bulk-edit mode is on (view-state-provider
// `bulkEditing`): the selected count on the left, the actions on the right. It
// acts on the hoisted `selectedLinks` snapshot map, so it needs nothing from the
// layouts. The delete action follows the same view split as the row menu:
//
//   in Trash  — "Delete permanently", the one irreversible action, so it goes
//               through the confirmation (requestDestroy → LinkDestroyConfirm,
//               which exits bulk-edit mode after the destroy).
//   elsewhere — "Remove", a reversible move to Trash (`update({ listId })`, the
//               same op the row menu uses), so no confirmation.
//
// Keyed off the ACTIVE VIEW (the page selection), not each link's own listId —
// the toolbar is one button for the whole selection, and navigation exits
// bulk-edit mode (view-state-provider), so the selection always belongs to the
// view whose semantics the button shows.

import { useState } from 'react';
import { Trash2 } from 'lucide-react';

import { TRASH_ID } from '@stxapps/shared';
import { useLinkMutations } from '@stxapps/web-react';
import { Button } from '@stxapps/web-ui/components/ui/button';

import { useLinksPage } from '../_contexts/page-provider';
import { useLinksViewState } from '../_contexts/view-state-provider';

export function BulkEditToolbar() {
  const { selection } = useLinksPage();
  const { bulkEditing, exitBulkEdit, selectedLinks, requestDestroy } = useLinksViewState();
  const { update } = useLinkMutations();
  const [removing, setRemoving] = useState(false);

  if (!bulkEditing) return null;

  const inTrash = selection.kind === 'list' && selection.id === TRASH_ID;
  const count = selectedLinks.size;

  const onRemove = async () => {
    if (removing) return;
    setRemoving(true);
    try {
      for (const link of selectedLinks.values()) {
        await update(link, { listId: TRASH_ID });
      }
      exitBulkEdit();
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border bg-muted/30 px-4">
      <span className="text-sm text-muted-foreground">{count} selected</span>
      <div className="flex items-center gap-2">
        {inTrash ? (
          <Button
            variant="destructive"
            size="sm"
            disabled={count === 0}
            onClick={() => requestDestroy([...selectedLinks.values()])}
          >
            <Trash2 className="size-4" />
            Delete permanently
          </Button>
        ) : (
          <Button
            variant="destructive"
            size="sm"
            disabled={count === 0 || removing}
            onClick={() => void onRemove()}
          >
            <Trash2 className="size-4" />
            {removing ? 'Removing…' : 'Remove'}
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={exitBulkEdit}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
