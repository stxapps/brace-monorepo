// The bulk tag editor behind the bar's "Edit tags" — the expo port of
// brace-web's BulkTagsDialog (`(app)/links/_components/bulk-tags-dialog.tsx`,
// the canonical doc for the diff semantics: seeded with the INTERSECTION of
// the selected links' tags, saved as a DIFF against that seed — added tags are
// added to every link, removed seed tags removed from every link, and a tag
// only SOME links carry is never shown as selected and never touched, so a
// bulk edit can't silently strip tags the user couldn't see). Hoisted to the
// screen level and driven by view-state-provider's `retagging`, like the
// destroy confirm; while open it holds `engaged` so a background sync won't
// repaint the list under the modal. The editor invariants (docs/editors.md)
// hold: draft copied from the seed at mount (closed = fully unmounted, so
// every open starts fresh), dirty means exactly "Save would write something",
// and the accidental close vectors (overlay press, the ✕) are swallowed while
// dirty — the explicit Cancel bypasses the guard.
//
// Divergences from web:
//
//  - The field is a chip toggler over the flattened tag tree (the
//    ShareTagsPicker idiom) instead of web's TagsField chips + popover — every
//    tag renders as a chip, selected = in the draft; the seed's shared tags
//    start selected.
//  - No new-tag creation here — that arrives with the full edit dialog's tags
//    field (web's TagsField `allowCreate`); bulk retag over existing tags is
//    the common case.

import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { type LinkView, useLinkMutations, useTags } from '@stxapps/expo-react';
import { flattenTree } from '@stxapps/shared';

import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { Text } from '../../components/ui/text';
import { cn } from '../../lib/utils';
import { useLinksViewState } from './view-state-provider';

export function BulkTagsDialog() {
  const { retagging, closeRetag } = useLinksViewState();
  if (!retagging) return null;
  return <BulkTagsForm links={retagging} onClose={closeRetag} />;
}

// Order-sensitive equality is fine here: the draft starts FROM the seed, so
// any reordering means the user removed and re-added — a real edit either way.
function sameIds(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

function BulkTagsForm({ links, onClose }: { links: LinkView[]; onClose: () => void }) {
  const { exitBulkEdit } = useLinksViewState();
  const { update } = useLinkMutations();
  const tags = useTags();

  const options = useMemo(
    () => flattenTree(tags).map((n) => ({ id: n.item.id, name: n.item.name })),
    [tags],
  );

  // The seed: tags EVERY selected link carries, in the first link's order (a
  // stable, user-recognizable chip order). Snapshotted once at mount — draft
  // state, not a live binding (the copy-to-draft invariant).
  const [seed] = useState(() =>
    links[0].tagIds.filter((id) => links.every((l) => l.tagIds.includes(id))),
  );
  const [tagIds, setTagIds] = useState<string[]>(seed);
  const [saving, setSaving] = useState(false);

  const isDirty = !sameIds(tagIds, seed);

  const toggle = (id: string) => {
    setTagIds((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]));
  };

  const onSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const added = tagIds.filter((id) => !seed.includes(id));
      const removed = new Set(seed.filter((id) => !tagIds.includes(id)));
      for (const link of links) {
        const kept = link.tagIds.filter((id) => !removed.has(id));
        const next = [...kept, ...added.filter((id) => !kept.includes(id))];
        // Minimal per-link patch: a link already in the target state gets no
        // write (no updatedAt bump reordering the date-modified sort).
        if (!sameIds(next, link.tagIds)) await update(link, { tagIds: next });
      }
      onClose();
      exitBulkEdit();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !isDirty && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit tags</DialogTitle>
          <DialogDescription>
            Tags added here are added to all {links.length} selected{' '}
            {links.length === 1 ? 'link' : 'links'}; a removed tag is removed from all of them.
          </DialogDescription>
        </DialogHeader>
        {options.length === 0 ? (
          <Text className="text-muted-foreground text-sm">No tags yet.</Text>
        ) : (
          <ScrollView className="max-h-60" nestedScrollEnabled>
            <View className="flex-row flex-wrap gap-2">
              {options.map((o) => {
                const selected = tagIds.includes(o.id);
                return (
                  <Pressable
                    key={o.id}
                    onPress={() => toggle(o.id)}
                    accessibilityRole="checkbox"
                    aria-label={`${o.name}: ${selected ? 'selected' : 'not selected'}`}
                    className={cn('rounded-full px-3 py-1.5', selected ? 'bg-primary' : 'bg-muted')}
                  >
                    <Text
                      className={cn(
                        'text-sm',
                        selected ? 'text-primary-foreground' : 'text-muted-foreground',
                      )}
                    >
                      {o.name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>
        )}
        <Text className="text-muted-foreground text-xs">
          Only tags shared by every selected link start selected; a tag on just some of them is left
          untouched.
        </Text>
        <DialogFooter>
          <Button variant="ghost" size="sm" onPress={onClose}>
            <Text>Cancel</Text>
          </Button>
          <Button size="sm" disabled={saving} onPress={() => void onSave()}>
            <Text>{saving ? 'Saving…' : 'Save'}</Text>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
