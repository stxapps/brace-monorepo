// The Lists settings section — the expo port of brace-web's
// `(app)/settings/[section]/_lists/lists-section.tsx` (the canonical doc:
// editable rows over the same ordered tree the sidebar shows — inline rename,
// reorder among siblings, reparent, delete, per-row locks — every edit through
// useListMutations' one-file-per-op writes). Divergences here:
//
//  - Reorder/reparent is BUTTONS-ONLY (up/down + "Move to"): web documents the
//    buttons as the complete keyboard/mouse fallback to its dnd-kit drag layer,
//    and dnd-kit is web-only — a native drag surface can join later without
//    touching the mutations.
//  - "Move to" opens a hoisted picker DIALOG instead of web's ListCommand
//    submenu — a scrollable tree inside a nested dropdown doesn't fit a phone;
//    the exclusion rules (forbiddenParentIds, current parent disabled, "Top
//    level" target) are identical.
//  - Rename focuses via a ref after the menu closes (no Radix
//    onCloseAutoFocus on native).

import { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import {
  Archive,
  ArrowDownAZ,
  ArrowDownZA,
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CornerUpRight,
  EyeOff,
  Folder,
  Inbox,
  KeyRound,
  Lock,
  LockOpen,
  type LucideIcon,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react-native';

import {
  type ListLockInfo,
  useEntitlements,
  useListMutations,
  useLists,
  useLockMutations,
  useLocks,
} from '@stxapps/expo-react';
import { ARCHIVE_ID, isSystemListId, type ListItem, MY_LIST_ID, TRASH_ID } from '@stxapps/shared';

import { LockPasswordDialog } from '../../components/lock-password-dialog';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { Icon } from '../../components/ui/icon';
import { Input } from '../../components/ui/input';
import { Text } from '../../components/ui/text';
import { usePaywall } from '../../contexts/paywall-provider';
import { cn } from '../../lib/utils';
import { childrenOf, flattenToRows, forbiddenParentIds, type ListRow } from './tree-helpers';

const NO_COLLAPSED_IDS: ReadonlySet<string> = new Set();

type SortDir = 'asc' | 'desc';

// Alphabetical by name, tie-broken by id so the order is deterministic and
// stable across re-sorts — web's rule, verbatim.
function sortedByName<T extends { name: string; id: string }>(items: T[], dir: SortDir): T[] {
  return [...items].sort((a, b) => {
    const byName = a.name.localeCompare(b.name);
    if (byName !== 0) return dir === 'asc' ? byName : -byName;
    return a.id.localeCompare(b.id);
  });
}

function listIcon(id: string): LucideIcon {
  if (id === MY_LIST_ID) return Inbox;
  if (id === ARCHIVE_ID) return Archive;
  if (id === TRASH_ID) return Trash2;
  return Folder;
}

// Inline rename. Uncontrolled so typing never round-trips through the store;
// commits when editing ends (blur or return). `key`ed by the stored name in the
// parent so an external rename (another device) refreshes the field.
function RenameField({
  list,
  onRename,
  inputRef,
}: {
  list: ListItem;
  onRename: (name: string) => void;
  inputRef?: React.RefObject<TextInput | null>;
}) {
  return (
    <Input
      ref={inputRef}
      defaultValue={list.name}
      aria-label="List name"
      className="h-9 border-transparent bg-transparent px-2 shadow-none"
      onEndEditing={(e) => onRename(e.nativeEvent.text)}
    />
  );
}

// The per-row overflow menu: rename, reorder within siblings, reparent, lock
// (device-local), delete — web's RowActions inventory minus its submenu
// nesting ("Move to" and "Sort sub-lists" hoist to dialogs/flat entries).
function RowActions({
  row,
  lock,
  onFocusName,
  onMoveUp,
  onMoveDown,
  onMoveTo,
  onSortChildren,
  onAddLock,
  onUnlock,
  onRemoveLock,
  onDelete,
}: {
  row: ListRow;
  // The row's OWN lock (lock-provider's listLocks), undefined when none exists.
  lock: ListLockInfo | undefined;
  onFocusName: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onMoveTo: () => void;
  onSortChildren: (dir: SortDir) => void;
  onAddLock: () => void;
  onUnlock: () => void;
  onRemoveLock: () => void;
  onDelete: () => void;
}) {
  const isFirst = row.index === 0;
  const isLast = row.index === row.siblings.length - 1;
  const deletable = !isSystemListId(row.item.id);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Pressable
          aria-label="List actions"
          className="size-9 items-center justify-center rounded-md"
        >
          <Icon as={MoreHorizontal} className="text-muted-foreground size-4" />
        </Pressable>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onPress={onFocusName}>
          <Icon as={Pencil} className="size-4" />
          <Text>Rename</Text>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={isFirst} onPress={onMoveUp}>
          <Icon as={ChevronUp} className="size-4" />
          <Text>Move up</Text>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={isLast} onPress={onMoveDown}>
          <Icon as={ChevronDown} className="size-4" />
          <Text>Move down</Text>
        </DropdownMenuItem>
        <DropdownMenuItem onPress={onMoveTo}>
          <Icon as={CornerUpRight} className="size-4" />
          <Text>Move to…</Text>
        </DropdownMenuItem>
        {row.hasChildren && (
          <>
            <DropdownMenuItem onPress={() => onSortChildren('asc')}>
              <Icon as={ArrowDownAZ} className="size-4" />
              <Text>Sort sub-lists A → Z</Text>
            </DropdownMenuItem>
            <DropdownMenuItem onPress={() => onSortChildren('desc')}>
              <Icon as={ArrowDownZA} className="size-4" />
              <Text>Sort sub-lists Z → A</Text>
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        {/* Lock inventory: no lock → offer one; locked → unlock (reveals a
            hidden list until relaunch); any lock → remove (password-gated). */}
        {lock === undefined ? (
          <DropdownMenuItem onPress={onAddLock}>
            <Icon as={Lock} className="size-4" />
            <Text>Lock list…</Text>
          </DropdownMenuItem>
        ) : (
          <>
            {lock.locked && (
              <DropdownMenuItem onPress={onUnlock}>
                <Icon as={LockOpen} className="size-4" />
                <Text>Unlock…</Text>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onPress={onRemoveLock}>
              <Icon as={KeyRound} className="size-4" />
              <Text>Remove lock…</Text>
            </DropdownMenuItem>
          </>
        )}
        {deletable && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onPress={onDelete}>
              <Icon as={Trash2} className="size-4" />
              <Text>Delete</Text>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// The create-a-list row pinned at the top. The plus turns into a cancel once
// the field is active (focused or non-empty); a confirm (check) appears on the
// right. Confirming prepends the new list to the root group.
export function CreateRow({
  placeholder,
  onCreate,
}: {
  placeholder: string;
  onCreate: (name: string) => Promise<void>;
}) {
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);
  const active = focused || value !== '';

  const reset = () => {
    setValue('');
    setFocused(false);
  };
  const confirm = async () => {
    if (value.trim() === '') return reset();
    try {
      await onCreate(value);
      setValue('');
    } catch {
      // Keep the typed value for a retry; onCreate already surfaced the error.
    }
  };

  return (
    <View className="border-border flex-row items-center gap-1 border-b px-1 py-1.5">
      <Pressable
        aria-label={active ? 'Cancel' : placeholder}
        className="size-9 items-center justify-center rounded-md"
        onPress={() => {
          if (active) reset();
        }}
      >
        <Icon as={active ? X : Plus} className="text-muted-foreground size-4" />
      </Pressable>
      <Input
        value={value}
        placeholder={placeholder}
        aria-label={`${placeholder} name`}
        className="h-9 min-w-0 flex-1 border-transparent bg-transparent px-2 shadow-none"
        onChangeText={setValue}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onSubmitEditing={() => void confirm()}
      />
      {active && (
        <Pressable
          aria-label="Create"
          className="size-9 items-center justify-center rounded-md"
          onPress={() => void confirm()}
        >
          <Icon as={Check} className="text-muted-foreground size-4" />
        </Pressable>
      )}
    </View>
  );
}

// One row. Indented by depth; the up/down + kebab controls carry every edit
// (see the header — buttons are the whole reorder surface here).
function Row({
  row,
  collapsedIds,
  lock,
  onToggle,
  onRename,
  onMoveUp,
  onMoveDown,
  onMoveTo,
  onSortChildren,
  onAddLock,
  onUnlock,
  onRemoveLock,
  onDelete,
}: {
  row: ListRow;
  collapsedIds: ReadonlySet<string>;
  lock: ListLockInfo | undefined;
  onToggle: () => void;
  onRename: (name: string) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onMoveTo: () => void;
  onSortChildren: (dir: SortDir) => void;
  onAddLock: () => void;
  onUnlock: () => void;
  onRemoveLock: () => void;
  onDelete: () => void;
}) {
  // Focus the inline name field when Rename is picked from the kebab. The menu
  // closes on select; defer one beat so focus isn't stolen by its teardown.
  const nameRef = useRef<TextInput | null>(null);
  const focusName = () => {
    setTimeout(() => nameRef.current?.focus(), 50);
  };

  return (
    <View
      className="border-border/60 flex-row items-center gap-1 border-b px-1 py-1"
      style={row.depth > 0 ? { paddingLeft: 4 + row.depth * 16 } : undefined}
    >
      {row.hasChildren ? (
        <Pressable
          aria-label={collapsedIds.has(row.item.id) ? 'Expand' : 'Collapse'}
          className="size-9 items-center justify-center rounded-md"
          onPress={onToggle}
        >
          <Icon
            as={collapsedIds.has(row.item.id) ? ChevronRight : ChevronDown}
            className="text-muted-foreground size-4"
          />
        </Pressable>
      ) : (
        <View className="size-9 shrink-0" />
      )}

      <Icon as={listIcon(row.item.id)} className="text-muted-foreground size-4 shrink-0" />

      <View className="min-w-0 flex-1">
        <RenameField
          key={`${row.item.id}:${row.item.name}`}
          inputRef={nameRef}
          list={row.item}
          onRename={onRename}
        />
      </View>

      {/* Lock chrome: locked/unlocked state, plus the collapse flag while it's
          relevant (a list is only hidden from the sidebar while locked). */}
      {lock && (
        <View className="shrink-0 flex-row items-center gap-1.5 px-1">
          {lock.hideList && lock.locked && (
            <Icon
              as={EyeOff}
              className="text-muted-foreground size-3.5"
              aria-label="Hidden from sidebar"
            />
          )}
          {lock.locked ? (
            <Icon as={Lock} className="text-muted-foreground size-3.5" aria-label="Locked" />
          ) : (
            <Icon as={LockOpen} className="text-muted-foreground size-3.5" aria-label="Unlocked" />
          )}
        </View>
      )}

      <RowActions
        row={row}
        lock={lock}
        onFocusName={focusName}
        onMoveUp={onMoveUp}
        onMoveDown={onMoveDown}
        onMoveTo={onMoveTo}
        onSortChildren={onSortChildren}
        onAddLock={onAddLock}
        onUnlock={onUnlock}
        onRemoveLock={onRemoveLock}
        onDelete={onDelete}
      />
    </View>
  );
}

// The hoisted "Move to" picker — the dialog stand-in for web's ListCommand
// submenu: "Top level" first, then every list at its tree indent, minus the
// forbidden parents (the row's own subtree, no-children containers); the
// current parent shows but is disabled.
function MoveToDialog({
  row,
  rows,
  excludeIds,
  onSelect,
  onClose,
}: {
  row: ListRow;
  // The FULL flattened tree (no collapse) so every candidate parent shows.
  rows: ListRow[];
  excludeIds: ReadonlySet<string>;
  onSelect: (parentId: string | null) => void;
  onClose: () => void;
}) {
  const candidates = rows.filter((r) => !excludeIds.has(r.item.id));

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-full max-w-sm">
        <DialogHeader>
          <DialogTitle>Move “{row.item.name}” to</DialogTitle>
        </DialogHeader>
        <ScrollView className="max-h-80" nestedScrollEnabled>
          <Pressable
            disabled={row.parentId === null}
            onPress={() => onSelect(null)}
            className={cn(
              'flex-row items-center gap-2 rounded-md px-2 py-2.5',
              row.parentId === null && 'opacity-50',
            )}
          >
            <Icon as={CornerUpRight} className="text-muted-foreground size-4" />
            <Text className="text-sm">Top level</Text>
            {row.parentId === null && (
              <Text className="text-muted-foreground text-xs">current</Text>
            )}
          </Pressable>
          {candidates.map((candidate) => {
            const current = candidate.item.id === row.parentId;
            return (
              <Pressable
                key={candidate.item.id}
                disabled={current}
                onPress={() => onSelect(candidate.item.id)}
                className={cn(
                  'flex-row items-center gap-2 rounded-md px-2 py-2.5',
                  current && 'opacity-50',
                )}
                style={candidate.depth > 0 ? { paddingLeft: 8 + candidate.depth * 16 } : undefined}
              >
                <Icon as={listIcon(candidate.item.id)} className="text-muted-foreground size-4" />
                <Text numberOfLines={1} className="min-w-0 flex-1 text-sm">
                  {candidate.item.name}
                </Text>
                {current && <Text className="text-muted-foreground text-xs">current</Text>}
              </Pressable>
            );
          })}
        </ScrollView>
      </DialogContent>
    </Dialog>
  );
}

export function ListsSection() {
  const lists = useLists();
  const { entitlements } = useEntitlements();
  const paywall = usePaywall();
  const { create, rename, move, destroy, reorder } = useListMutations();
  const { listLocks, unlockList } = useLocks();
  const { addListLock, removeListLock } = useLockMutations();

  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(NO_COLLAPSED_IDS);
  const [error, setError] = useState<string | null>(null);
  // The pending lock intent from a row's kebab — drives the single hoisted
  // LockPasswordDialog below (web's page-level pattern).
  const [lockDialog, setLockDialog] = useState<{
    mode: 'add' | 'unlock' | 'remove';
    listId: string;
  } | null>(null);
  // The pending "Move to" intent — drives the hoisted MoveToDialog.
  const [movingId, setMovingId] = useState<string | null>(null);

  const rows = useMemo(() => flattenToRows(lists, collapsedIds), [lists, collapsedIds]);
  // The picker needs every row regardless of collapse state.
  const allRows = useMemo(() => flattenToRows(lists, NO_COLLAPSED_IDS), [lists]);
  const movingRow = movingId ? allRows.find((r) => r.item.id === movingId) : undefined;

  const toggle = (id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const siblingsWithout = (row: ListRow) =>
    row.siblings.filter((sibling) => sibling.id !== row.item.id);

  // Sort one sibling group (root when parentId is null) alphabetically. reorder
  // writes only the rows whose rank changes, so re-sorting an ordered group is
  // a no-op.
  const sortGroup = (parentId: string | null, dir: SortDir) =>
    run(reorder(sortedByName(childrenOf(lists, parentId), dir)));

  const run = (op: Promise<unknown>) => {
    setError(null);
    void op.catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };

  const moveTo = (row: ListRow, parentId: string | null) => {
    setMovingId(null);
    // Moving UNDER a list nests it (the Plus lever); moving to "Top level"
    // (null) flattens and stays free — so a downgraded user can always un-nest.
    if (parentId !== null && !entitlements.nestedLists) {
      paywall.show('nestedLists');
      return;
    }
    const dest = childrenOf(lists, parentId).filter((s) => s.id !== row.item.id);
    run(move(row.item, parentId, dest, dest.length));
  };

  return (
    <View className="px-4 py-8">
      <Text role="heading" className="text-xl font-semibold">
        Lists
      </Text>
      <Text className="text-muted-foreground mt-1 mb-4 text-sm">
        Create, rename, reorder, and nest your lists. My List, Archive, and Trash are built in — you
        can rename and reorder them, but not delete them.
      </Text>

      {error && (
        <View className="bg-destructive/10 mb-3 rounded-md px-3 py-2">
          <Text className="text-destructive text-sm">{error}</Text>
        </View>
      )}

      <View className="mb-2 flex-row justify-end">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm">
              <Icon as={ArrowUpDown} className="size-4" />
              <Text>Sort</Text>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onPress={() => sortGroup(null, 'asc')}>
              <Icon as={ArrowDownAZ} className="size-4" />
              <Text>A → Z</Text>
            </DropdownMenuItem>
            <DropdownMenuItem onPress={() => sortGroup(null, 'desc')}>
              <Icon as={ArrowDownZA} className="size-4" />
              <Text>Z → A</Text>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </View>

      <View className="border-border rounded-lg border">
        <CreateRow
          placeholder="New list"
          onCreate={async (name) => {
            // Not run() like the other ops: CreateRow awaits this to clear its
            // field only on success, so we surface the error here and re-throw
            // to keep the typed value.
            setError(null);
            try {
              await create(name, null, childrenOf(lists, null), 0);
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
              throw e;
            }
          }}
        />

        {rows.map((row) => (
          <Row
            key={row.item.id}
            row={row}
            collapsedIds={collapsedIds}
            lock={listLocks.get(row.item.id)}
            onToggle={() => toggle(row.item.id)}
            onRename={(name) => run(rename(row.item, name))}
            onMoveUp={() => run(move(row.item, row.parentId, siblingsWithout(row), row.index - 1))}
            onMoveDown={() =>
              run(move(row.item, row.parentId, siblingsWithout(row), row.index + 1))
            }
            onMoveTo={() => setMovingId(row.item.id)}
            onSortChildren={(dir) => sortGroup(row.item.id, dir)}
            onAddLock={() =>
              // Gate at the affordance, before any password dialog: a free
              // user never types a secret into a form that can't submit.
              // Unlock/remove stay open below so a downgraded (ex-Plus)
              // user can always reach their existing locks.
              entitlements.locks
                ? setLockDialog({ mode: 'add', listId: row.item.id })
                : paywall.show('locks')
            }
            onUnlock={() => setLockDialog({ mode: 'unlock', listId: row.item.id })}
            onRemoveLock={() => setLockDialog({ mode: 'remove', listId: row.item.id })}
            onDelete={() => run(destroy(row.item))}
          />
        ))}
      </View>

      {movingRow && (
        <MoveToDialog
          row={movingRow}
          rows={allRows}
          excludeIds={forbiddenParentIds(lists, movingRow.item.id)}
          onSelect={(parentId) => moveTo(movingRow, parentId)}
          onClose={() => setMovingId(null)}
        />
      )}

      {lockDialog?.mode === 'add' && (
        <LockPasswordDialog
          onOpenChange={(open) => !open && setLockDialog(null)}
          title="Lock list"
          description="This list will be locked on this device only. If you forget the password, sign out to remove all locks on this device."
          submitLabel="Lock"
          checkboxLabel="Also hide this list from the sidebar while locked"
          onSubmit={async (password, hideList) => {
            await addListLock(lockDialog.listId, password, { hideList });
          }}
        />
      )}
      {lockDialog?.mode === 'unlock' && (
        <LockPasswordDialog
          onOpenChange={(open) => !open && setLockDialog(null)}
          title="Unlock list"
          description="Enter the password to unlock this list until the app reloads."
          submitLabel="Unlock"
          onSubmit={async (password) => {
            if (!(await unlockList(lockDialog.listId, password))) {
              throw new Error('Password is not correct. Please try again.');
            }
          }}
        />
      )}
      {lockDialog?.mode === 'remove' && (
        <LockPasswordDialog
          onOpenChange={(open) => !open && setLockDialog(null)}
          title="Remove lock"
          description="Enter the password to remove the lock from this list."
          submitLabel="Remove"
          onSubmit={async (password) => {
            if (!(await removeListLock(lockDialog.listId, password))) {
              throw new Error('Password is not correct. Please try again.');
            }
          }}
        />
      )}
    </View>
  );
}
