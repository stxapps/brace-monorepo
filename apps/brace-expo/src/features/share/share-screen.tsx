// The share sheet's one screen (docs/share-sheet.md): url + title preview, the
// list picker, the tags field, Add. Platform-blind — everything it exchanges
// with the world goes through @stxapps/expo-react's share-store
// (loadShareTaxonomy / saveSharedDraft) and the closeShareSheet host seam, so
// the same component renders inside the iOS extension and Android's
// ShareActivity.
//
// The pickers are the SHARE-SIZED cousins of the web ListSelect/TagsField
// (docs/editors.md), upholding the same invariants at smaller scope: the draft
// is local component state (copy-to-draft), a typed tag is matched
// case-insensitively against existing tags before minting a new one (the
// findOrCreate rule, applied at input time since the sheet already holds the
// taxonomy), and ids for everything new are minted HERE so the draft is
// idempotent downstream (share-store's header).
//
// One deliberate divergence from those web cousins: the list picker PICKS ONLY.
// The web ListSelect can mint a list inline (`allowCreate`); this can't, because
// the iOS taxonomy is a read-only snapshot — see docs/share-sheet.md ("New tags
// yes, new lists no") before adding it.

import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';

import { newId } from '@stxapps/expo-crypto';
import {
  loadShareTaxonomy,
  saveSharedDraft,
  type ShareDraft,
  type ShareTaxonomy,
} from '@stxapps/expo-react';
import { DEFAULT_LIST_ID } from '@stxapps/shared';

import { apiClient } from '../../lib/api-client';
import { closeShareSheet } from './share-host';
import type { SharePayload } from './share-url';

type Phase = 'loading' | 'ready' | 'saving' | 'saved';

// How long the ✓ lingers before the sheet dismisses itself.
const SAVED_DISMISS_MS = 900;

// A tag the user typed that matched nothing — to be created at save. The id is
// minted at ADD-TO-DRAFT time so the chip is stable and the draft idempotent.
interface NewTag {
  id: string;
  name: string;
}

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
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [newTags, setNewTags] = useState<NewTag[]>([]);
  const [tagInput, setTagInput] = useState('');
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

  // Commit the typed tag onto the draft: reuse an existing tag on a
  // case-insensitive name match (findOrCreate), else mint a new one.
  const submitTagInput = useCallback(() => {
    const name = tagInput.trim();
    setTagInput('');
    if (name === '' || !taxonomy) return;
    const lower = name.toLowerCase();
    const existing = taxonomy.tags.find((tag) => tag.name.toLowerCase() === lower);
    if (existing) {
      setSelectedTagIds((ids) => (ids.includes(existing.id) ? ids : [...ids, existing.id]));
      return;
    }
    setNewTags((tags) =>
      tags.some((tag) => tag.name.toLowerCase() === lower)
        ? tags
        : [...tags, { id: newId(), name }],
    );
  }, [tagInput, taxonomy]);

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
  }, [url, title, listId, selectedTagIds, newTags]);

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
      <ScrollView className="mt-1 max-h-40">
        {taxonomy.lists.map((list) => (
          <Pressable
            key={list.id}
            testID={`share-list-${list.id}`}
            onPress={() => setListId(list.id)}
            className="flex-row items-center justify-between py-2"
            style={{ paddingLeft: list.depth * 16 }}
          >
            <Text className="font-sans text-base text-gray-800 dark:text-gray-100">
              {list.name}
            </Text>
            {list.id === listId && <Text className="text-primary font-sans text-base">✓</Text>}
          </Pressable>
        ))}
      </ScrollView>

      <Text className="mt-4 font-sans text-xs font-medium text-gray-400 uppercase dark:text-gray-500">
        Tags
      </Text>
      <View className="mt-1 flex-row flex-wrap gap-2">
        {taxonomy.tags.map((tag) => {
          const selected = selectedTagIds.includes(tag.id);
          return (
            <Pressable
              key={tag.id}
              testID={`share-tag-${tag.id}`}
              onPress={() => toggleTag(tag.id)}
              className={
                selected
                  ? 'bg-primary rounded-full px-3 py-1'
                  : 'rounded-full bg-gray-100 px-3 py-1 dark:bg-gray-800'
              }
            >
              <Text
                className={
                  selected
                    ? 'font-sans text-sm text-white'
                    : 'font-sans text-sm text-gray-700 dark:text-gray-200'
                }
              >
                {tag.name}
              </Text>
            </Pressable>
          );
        })}
        {newTags.map((tag) => (
          <Pressable
            key={tag.id}
            testID={`share-new-tag-${tag.id}`}
            onPress={() => removeNewTag(tag.id)}
            className="bg-primary rounded-full px-3 py-1"
          >
            <Text className="font-sans text-sm text-white">{tag.name} ×</Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        testID="share-tag-input"
        value={tagInput}
        onChangeText={setTagInput}
        onSubmitEditing={submitTagInput}
        placeholder="Add a tag…"
        autoCapitalize="none"
        autoCorrect={false}
        submitBehavior="submit"
        className="mt-2 rounded-lg bg-gray-100 px-3 py-2 font-sans text-base text-gray-900 dark:bg-gray-800 dark:text-gray-50"
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
