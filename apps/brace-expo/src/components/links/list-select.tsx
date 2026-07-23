import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Check, ChevronsUpDown, Plus } from 'lucide-react-native';

import { type ListItem, useListMutations, useLists } from '@stxapps/expo-react';
import type { TreeNode } from '@stxapps/shared';

import { cn } from '../../lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Icon } from '../ui/icon';
import { Input } from '../ui/input';
import { Text } from '../ui/text';

// The list picker for the link editors — the native cousin of web-ui's
// ListSelect + ListCommand pair (those headers are canonical: the combobox
// shape, why the editors create INLINE and why the create is TOP-LEVEL ONLY).
// A phone has no anchored popover to drop a tree into, so the shell is a
// form-control trigger opening a Dialog (the MoveToDialog idiom) whose body
// carries ListCommand's rules:
//
//  - The filter input is count-gated at SEARCH_THRESHOLD — but forced on
//    whenever this instance can create, since it doubles as the Create row's
//    name field (most accounts are small; without it there'd be nothing to
//    type into).
//  - Two render modes, because filtering breaks indentation's meaning: an
//    empty query shows the indented tree; a non-empty query shows flat matches
//    labelled with their ancestor path ("Work / Cooking / Recipes").
//  - The Create row is `allowCreate`-gated and suppressed on an exact
//    case-insensitive name match (a Create row competing with an identical row
//    right above it reads as a mistake; Settings → Lists still covers the
//    deliberate duplicate).
//  - Creates land top-level at index 0 via useListMutations.create and select
//    immediately — this editor runs in-process, so it creates the entity the
//    moment the name is confirmed (the web rule, NOT the share sheet's
//    deferred-to-Add machinery, which exists only for its process split — see
//    docs/editors.md).
//
// Query state resets on close for free: the Dialog unmounts its content.
// Callers filter only TRASH_ID — never hidden/locked lists (docs/editors.md).

// Below this many lists, scrolling beats a filter box — don't render one
// (unless the input is the create name field, above).
const SEARCH_THRESHOLD = 10;

type ListRow = { item: ListItem; depth: number; ancestors: string[] };

// The live list tree flattened depth-first, carrying each row's ancestor names
// — web list-command's useListRows, verbatim: the path shown on filtered rows
// and on the trigger. `excludeIds` drops rows entirely (Trash in the editors —
// a leaf, so no children get orphaned).
function useListRows(excludeIds?: readonly string[]): ListRow[] {
  const lists = useLists();

  return useMemo(() => {
    const out: ListRow[] = [];
    const walk = (nodes: TreeNode<ListItem>[], ancestors: string[]): void => {
      for (const node of nodes) {
        if (!excludeIds?.includes(node.item.id)) {
          out.push({ item: node.item, depth: node.depth, ancestors });
        }
        walk(node.children, [...ancestors, node.item.name]);
      }
    };
    walk(lists, []);
    return out;
  }, [lists, excludeIds]);
}

export function ListSelect({
  value,
  onValueChange,
  excludeIds,
  allowCreate,
}: {
  value: string;
  onValueChange: (listId: string) => void;
  // List ids to leave out of the options — e.g. Trash in the editors, where
  // trashing is its own explicit action, never a "move".
  excludeIds?: readonly string[];
  // Offer the Create row (see the header) — the editors opt in; a picker that
  // only reassigns an existing link must not.
  allowCreate?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const lists = useLists();
  const { create } = useListMutations();
  const rows = useListRows(excludeIds);
  const selected = rows.find((row) => row.item.id === value);

  const searchable = rows.length > SEARCH_THRESHOLD || allowCreate === true;
  const trimmed = query.trim();
  const q = trimmed.toLowerCase();
  const filtering = searchable && q.length > 0;
  const visibleRows = filtering
    ? rows.filter(({ item }) => item.name.toLowerCase().includes(q))
    : rows;

  const canCreate =
    allowCreate === true &&
    trimmed !== '' &&
    !rows.some(({ item }) => item.name.toLowerCase() === q);

  const close = (nextOpen: boolean) => {
    if (!nextOpen) setQuery('');
    setOpen(nextOpen);
  };

  const select = (listId: string) => {
    onValueChange(listId);
    close(false);
  };

  // Prepend to the root group — `lists` IS that group (useLists returns the
  // top level), and index 0 matches the settings CreateRow. Select the new
  // list right away; its row reaches the trigger a beat later, when useLists
  // catches up (the same catch-up gap web's trigger has).
  const onCreate = async () => {
    if (creating || trimmed === '') return;
    setCreating(true);
    try {
      const list = await create(
        trimmed,
        null,
        lists.map((node) => node.item),
        0,
      );
      if (list) select(list.id);
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <Pressable
        onPress={() => close(true)}
        accessibilityRole="combobox"
        aria-expanded={open}
        aria-label="List"
        className="border-input bg-background dark:bg-input/30 h-10 flex-row items-center justify-between gap-2 rounded-md border px-3 shadow-sm shadow-black/5"
      >
        {selected ? (
          <Text numberOfLines={1} className="min-w-0 flex-1">
            {selected.ancestors.length > 0 && (
              <Text className="text-muted-foreground">{`${selected.ancestors.join(' / ')} / `}</Text>
            )}
            {selected.item.name}
          </Text>
        ) : (
          <Text numberOfLines={1} className="text-muted-foreground min-w-0 flex-1">
            Choose a list
          </Text>
        )}
        <Icon as={ChevronsUpDown} className="text-muted-foreground size-4 shrink-0" />
      </Pressable>
      <Dialog open={open} onOpenChange={close}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Choose a list</DialogTitle>
          </DialogHeader>
          {searchable && (
            <Input
              value={query}
              onChangeText={setQuery}
              placeholder={allowCreate ? 'Search or create lists…' : 'Search lists…'}
              aria-label={allowCreate ? 'Search or create lists' : 'Search lists'}
              autoCapitalize="none"
              autoCorrect={false}
              className="h-9"
            />
          )}
          <ScrollView className="max-h-80" nestedScrollEnabled keyboardShouldPersistTaps="handled">
            {/* Suppressed when there's a Create row: that row IS the next step. */}
            {visibleRows.length === 0 && !canCreate && (
              <Text className="text-muted-foreground px-2 py-2.5 text-sm">No lists found.</Text>
            )}
            {visibleRows.map(({ item, depth, ancestors }) => (
              <Pressable
                key={item.id}
                onPress={() => select(item.id)}
                accessibilityRole="menuitem"
                className="active:bg-muted flex-row items-center justify-between gap-2 rounded-md px-2 py-2.5"
                style={!filtering && depth > 0 ? { paddingLeft: depth * 12 + 8 } : undefined}
              >
                <Text numberOfLines={1} className="min-w-0 flex-1">
                  {filtering && ancestors.length > 0 && (
                    <Text className="text-muted-foreground">{`${ancestors.join(' / ')} / `}</Text>
                  )}
                  {item.name}
                </Text>
                {item.id === value && (
                  <Icon as={Check} className="text-muted-foreground size-4 shrink-0" />
                )}
              </Pressable>
            ))}
            {canCreate && (
              <Pressable
                disabled={creating}
                onPress={() => void onCreate()}
                accessibilityRole="menuitem"
                className={cn(
                  'active:bg-muted flex-row items-center gap-2 rounded-md px-2 py-2.5',
                  creating && 'opacity-50',
                )}
              >
                <Icon as={Plus} className="text-muted-foreground size-4 shrink-0" />
                <Text numberOfLines={1} className="min-w-0 flex-1">
                  Create “{trimmed}”
                </Text>
              </Pressable>
            )}
          </ScrollView>
        </DialogContent>
      </Dialog>
    </>
  );
}
