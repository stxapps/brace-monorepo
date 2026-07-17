// The share sheet's one screen (docs/share-sheet.md): url + title preview, the
// list picker, the tags field, Add. Platform-blind — everything it exchanges
// with the world goes through @stxapps/expo-react's share-store
// (loadShareTaxonomy / saveSharedDraft) and the closeShareSheet host seam, so
// the same component renders inside the iOS extension and Android's
// ShareActivity.
//
// The pickers (share-list-picker / share-tags-picker, presentational) are the
// SHARE-SIZED cousins of the web ListSelect/TagsField (docs/editors.md), and
// this screen upholds the same editor invariants at smaller scope: the draft is
// local component state (copy-to-draft), a typed list/tag name is matched
// case-insensitively against the taxonomy before minting a new one (the
// findOrCreate / exact-match-suppression rule, applied at input time since the
// sheet already holds the taxonomy), the list create is TOP-LEVEL ONLY
// (parentId pinned null at apply — the editors' rule), and ids AND ranks for
// everything new are minted HERE so the draft is idempotent downstream and the
// extension's upload can push complete entities (share-store's header: a
// stale-snapshot rank can only tie, broken by id). Creating a list selects it;
// selecting another list discards the pending create — a new list exists only
// as the share's destination.

import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, Text, View } from 'react-native';

import { newId } from '@stxapps/expo-crypto';
import {
  loadShareTaxonomy,
  saveSharedDraft,
  type ShareDraft,
  type ShareNewEntity,
  type ShareTaxonomy,
} from '@stxapps/expo-react';
import { DEFAULT_LIST_ID, rankBetween } from '@stxapps/shared';

import { apiClient } from '../../lib/api-client';
import { closeShareSheet } from './share-host';
import { ShareListPicker } from './share-list-picker';
import { ShareTagsPicker } from './share-tags-picker';
import type { SharePayload } from './share-url';

type Phase = 'loading' | 'ready' | 'saving' | 'saved';

// How long the ✓ lingers before the sheet dismisses itself.
const SAVED_DISMISS_MS = 900;

// The sheet's container. On iOS, expo-share-extension provides the floating
// sheet (height/background from app.json) — fill it. On Android the activity
// is translucent and full-screen — render the bottom sheet ourselves, with a
// tap-to-dismiss backdrop.
function Sheet({ children }: { children: React.ReactNode }) {
  if (Platform.OS === 'ios') {
    return <View className="flex-1 bg-white p-4 dark:bg-gray-900">{children}</View>;
  }
  return (
    <View className="flex-1 justify-end">
      <Pressable
        testID="share-backdrop"
        onPress={closeShareSheet}
        className="absolute top-0 right-0 bottom-0 left-0 bg-black/40"
      />
      <View className="max-h-[85%] rounded-t-2xl bg-white p-4 dark:bg-gray-900">{children}</View>
    </View>
  );
}

// A terminal message (signed-out, no URL) + Close.
function Notice({ testID, message }: { testID: string; message: string }) {
  return (
    <Sheet>
      <Text
        testID={testID}
        className="py-6 text-center font-sans text-base text-gray-700 dark:text-gray-200"
      >
        {message}
      </Text>
      <Pressable
        onPress={closeShareSheet}
        className="items-center rounded-lg bg-gray-100 py-3 dark:bg-gray-800"
      >
        <Text className="font-sans text-base font-medium text-gray-900 dark:text-gray-50">
          Close
        </Text>
      </Pressable>
    </Sheet>
  );
}

export function ShareScreen({ url, title }: SharePayload) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [taxonomy, setTaxonomy] = useState<ShareTaxonomy | null>(null);
  const [listId, setListId] = useState<string>(DEFAULT_LIST_ID);
  const [newList, setNewList] = useState<ShareNewEntity | null>(null);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [newTags, setNewTags] = useState<ShareNewEntity[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadShareTaxonomy().then(
      (loaded) => {
        if (!alive) return;
        setTaxonomy(loaded);
        setPhase('ready');
      },
      () => {
        if (!alive) return;
        setTaxonomy({ sessionPresent: false, lists: [], tags: [] });
        setPhase('ready');
      },
    );
    return () => {
      alive = false;
    };
  }, []);

  // Let the ✓ linger, then dismiss — as an effect (not a bare setTimeout in the
  // save handler) so unmounting cancels it.
  useEffect(() => {
    if (phase !== 'saved') return;
    const timer = setTimeout(closeShareSheet, SAVED_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  // Pick a list. Selecting away from the pending new list discards it —
  // created-means-selected, so an unselected new list must not be created.
  const selectList = useCallback(
    (id: string) => {
      setListId(id);
      if (newList && id !== newList.id) setNewList(null);
    },
    [newList],
  );

  // Commit a typed list name: reuse an existing list on an exact
  // case-insensitive name match (the ListCommand suppression rule — the
  // deliberate-duplicate case still has the app's Settings → Lists), else mint
  // and select. The rank prepends before the first root list — web ListSelect's
  // create-at-index-0, so the same action lands the same place everywhere.
  const submitListName = useCallback(
    (name: string) => {
      if (!taxonomy) return;
      const lower = name.toLowerCase();
      const existing = taxonomy.lists.find((list) => list.name.toLowerCase() === lower);
      if (existing) {
        setNewList(null);
        setListId(existing.id);
        return;
      }
      // rankBetween(null, null) — the first key — when there are no lists yet.
      const minted: ShareNewEntity = {
        id: newId(),
        name,
        rank: rankBetween(null, taxonomy.lists[0]?.rank ?? null),
      };
      setNewList(minted);
      setListId(minted.id);
    },
    [taxonomy],
  );

  // Commit a typed tag name onto the draft: reuse an existing tag on a
  // case-insensitive name match (findOrCreate), else mint a new one prepended
  // before the first tag — web findOrCreate's create-at-index-0, the same rule
  // submitListName follows, so the same action lands the same place everywhere.
  const submitTagName = useCallback(
    (name: string) => {
      if (!taxonomy) return;
      const lower = name.toLowerCase();
      const existing = taxonomy.tags.find((tag) => tag.name.toLowerCase() === lower);
      if (existing) {
        setSelectedTagIds((ids) => (ids.includes(existing.id) ? ids : [...ids, existing.id]));
        return;
      }
      setNewTags((tags) => {
        if (tags.some((tag) => tag.name.toLowerCase() === lower)) return tags;
        // The group's current head: the previous mint if this session made one
        // (each prepends, so the latest IS the head), else the first existing
        // tag, else null (no tags yet — rankBetween(null, null) is the first
        // key). Chaining off it stacks several new tags newest-first, matching
        // what web's re-read-per-call gives — the array order below is just the
        // draft's set; rank is what orders them.
        const head = tags.length > 0 ? tags[tags.length - 1].rank : (taxonomy.tags[0]?.rank ?? null);
        return [...tags, { id: newId(), name, rank: rankBetween(null, head) }];
      });
    },
    [taxonomy],
  );

  const toggleTag = useCallback((id: string) => {
    setSelectedTagIds((ids) => (ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id]));
  }, []);

  const removeNewTag = useCallback((id: string) => {
    setNewTags((tags) => tags.filter((tag) => tag.id !== id));
  }, []);

  const onAdd = useCallback(async () => {
    if (!url) return;
    setPhase('saving');
    setError(null);
    const draft: ShareDraft = {
      id: newId(),
      url,
      ...(title !== undefined ? { title } : {}),
      listId,
      tagIds: [...selectedTagIds, ...newTags.map((tag) => tag.id)],
      newTags,
      // selectList discards a deselected pending list, so newList non-null
      // means it IS the destination — the guard is belt-and-braces.
      newLists: newList && newList.id === listId ? [newList] : [],
      sharedAt: Date.now(),
    };
    try {
      // The api client powers saveSharedDraft's un-awaited post-write kick
      // (Android inline sync / iOS upload); Add itself only waits on
      // the durable local write.
      await saveSharedDraft(draft, apiClient);
      setPhase('saved');
    } catch {
      setPhase('ready');
      setError('Could not save. Please try again.');
    }
  }, [url, title, listId, newList, selectedTagIds, newTags]);

  if (phase === 'loading' || !taxonomy) {
    return (
      <Sheet>
        <View className="items-center py-10">
          <ActivityIndicator />
        </View>
      </Sheet>
    );
  }

  if (!taxonomy.sessionPresent) {
    return (
      <Notice testID="share-signed-out" message="Open Brace and sign in first to save links." />
    );
  }

  if (url === null) {
    return <Notice testID="share-no-url" message="No link found in what was shared." />;
  }

  if (phase === 'saved') {
    return (
      <Sheet>
        <Text
          testID="share-saved"
          className="py-10 text-center font-sans text-lg font-semibold text-gray-900 dark:text-gray-50"
        >
          ✓ Saved to Brace
        </Text>
      </Sheet>
    );
  }

  return (
    <Sheet>
      <Text
        testID="share-title"
        numberOfLines={1}
        className="font-sans text-base font-semibold text-gray-900 dark:text-gray-50"
      >
        {title ?? url}
      </Text>
      <Text
        testID="share-url"
        numberOfLines={1}
        className="mt-0.5 font-sans text-sm text-gray-500 dark:text-gray-400"
      >
        {url}
      </Text>

      <Text className="mt-4 font-sans text-xs font-medium text-gray-400 uppercase dark:text-gray-500">
        List
      </Text>
      <ShareListPicker
        lists={taxonomy.lists}
        newList={newList}
        selectedId={listId}
        onSelect={selectList}
        onCreateName={submitListName}
      />

      <Text className="mt-4 font-sans text-xs font-medium text-gray-400 uppercase dark:text-gray-500">
        Tags
      </Text>
      <ShareTagsPicker
        tags={taxonomy.tags}
        selectedTagIds={selectedTagIds}
        newTags={newTags}
        onToggle={toggleTag}
        onRemoveNew={removeNewTag}
        onSubmitName={submitTagName}
      />

      {error !== null && (
        <Text
          testID="share-error"
          className="mt-3 font-sans text-sm text-red-600 dark:text-red-400"
        >
          {error}
        </Text>
      )}

      <Pressable
        testID="share-add"
        onPress={onAdd}
        disabled={phase === 'saving'}
        className="bg-primary mt-4 items-center rounded-lg py-3"
      >
        {phase === 'saving' ? (
          <ActivityIndicator color="white" />
        ) : (
          <Text className="font-sans text-base font-semibold text-white">Add to Brace</Text>
        )}
      </Pressable>
    </Sheet>
  );
}
