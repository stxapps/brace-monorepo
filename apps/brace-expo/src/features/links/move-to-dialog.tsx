// The Move-to picker — the phone stand-in for web's anchored ListCommand
// popover/submenu: the merged list tree (system lists + user lists,
// depth-indented) in a dialog. Shared by the bulk bar (its inline "Move to"
// button) and the row menu (its "Move to" item — web nests a ListCommand
// submenu instead; a dropdown-anchored tree doesn't fit a phone, the same
// reason the bulk bar went dialog). Trash is excluded (trashing is Remove,
// never a "move"); `sharedListId` — the selection's shared list, or the single
// link's own — shows checked and disabled, like web. Holds a live list read
// (useLists), so per-item callers must mount it only while open — one live
// query per virtualized item otherwise (the useTagMap rationale).

import { useMemo } from 'react';
import { Pressable, ScrollView } from 'react-native';
import { Check } from 'lucide-react-native';

import { useLists } from '@stxapps/expo-react';
import { flattenTree, TRASH_ID } from '@stxapps/shared';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Icon } from '../../components/ui/icon';
import { Text } from '../../components/ui/text';

export function MoveToDialog({
  open,
  onOpenChange,
  sharedListId,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sharedListId: string | undefined;
  onSelect: (listId: string) => void;
}) {
  const lists = useLists();
  const options = useMemo(
    () =>
      flattenTree(lists)
        .filter((n) => n.item.id !== TRASH_ID)
        .map((n) => ({ id: n.item.id, name: n.item.name, depth: n.depth })),
    [lists],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move to</DialogTitle>
        </DialogHeader>
        <ScrollView className="max-h-80" nestedScrollEnabled>
          {options.map((o) => (
            <Pressable
              key={o.id}
              disabled={o.id === sharedListId}
              onPress={() => onSelect(o.id)}
              className="active:bg-muted flex-row items-center justify-between gap-2 rounded-md px-2 py-2.5"
              style={o.depth > 0 ? { paddingLeft: o.depth * 12 + 8 } : undefined}
            >
              <Text
                numberOfLines={1}
                className={
                  o.id === sharedListId ? 'text-muted-foreground min-w-0 flex-1' : 'min-w-0 flex-1'
                }
              >
                {o.name}
              </Text>
              {o.id === sharedListId && (
                <Icon as={Check} className="text-muted-foreground size-4 shrink-0" />
              )}
            </Pressable>
          ))}
        </ScrollView>
      </DialogContent>
    </Dialog>
  );
}
