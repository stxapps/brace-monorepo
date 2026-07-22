// The share sheet's list picker — the share-sized RN cousin of the web
// ListSelect/ListCommand pair (docs/editors.md), presentational by design:
// rows in, events out. The screen owns the create logic (exact-match reuse vs.
// mint — the ListCommand suppression rule) and hands down the pending new list;
// this renders the tree rows, the pending row, and the inline "New list" input
// that makes create a sub-task of the save, exactly like the web editors'
// `allowCreate`. Rows-as-props (not a live query) is what lets the same
// component serve the iOS snapshot and Android's live read — and, later, any
// live-hook-fed in-app editor.

import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import type { ShareNewEntity, ShareTaxonomyList } from '@stxapps/expo-react';

export function ShareListPicker({
  lists,
  newList,
  selectedId,
  onSelect,
  onCreateName,
}: {
  lists: ShareTaxonomyList[];
  // The one pending sheet-minted list (created = selected; the screen discards
  // it when another row is picked), rendered as the top row.
  newList: ShareNewEntity | null;
  selectedId: string;
  onSelect: (listId: string) => void;
  // The typed name to reuse-or-mint — the screen decides which.
  onCreateName: (name: string) => void;
}) {
  const [input, setInput] = useState('');

  const submit = useCallback(() => {
    const name = input.trim();
    setInput('');
    if (name !== '') onCreateName(name);
  }, [input, onCreateName]);

  return (
    <View>
      {/* nestedScrollEnabled: this scrolls inside the Sheet's outer ScrollView
          (Android needs the explicit opt-in; iOS nests natively).
          keyboardShouldPersistTaps: picking a row right after typing a name
          must land while the keyboard is still up. */}
      <ScrollView className="mt-1 max-h-40" nestedScrollEnabled keyboardShouldPersistTaps="handled">
        {newList && (
          <Pressable
            testID="share-new-list"
            onPress={() => onSelect(newList.id)}
            className="flex-row items-center justify-between py-2"
          >
            <Text className="font-sans text-base text-gray-800 dark:text-gray-100">
              {newList.name}
            </Text>
            {newList.id === selectedId && (
              <Text className="text-primary font-sans text-base">✓</Text>
            )}
          </Pressable>
        )}
        {lists.map((list) => (
          <Pressable
            key={list.id}
            testID={`share-list-${list.id}`}
            onPress={() => onSelect(list.id)}
            className="flex-row items-center justify-between py-2"
            style={{ paddingLeft: list.depth * 16 }}
          >
            <Text className="font-sans text-base text-gray-800 dark:text-gray-100">
              {list.name}
            </Text>
            {list.id === selectedId && <Text className="text-primary font-sans text-base">✓</Text>}
          </Pressable>
        ))}
      </ScrollView>
      <TextInput
        testID="share-list-input"
        value={input}
        onChangeText={setInput}
        onSubmitEditing={submit}
        placeholder="New list…"
        autoCapitalize="none"
        autoCorrect={false}
        submitBehavior="submit"
        className="mt-2 rounded-lg bg-gray-100 px-3 py-2 font-sans text-base text-gray-900 dark:bg-gray-800 dark:text-gray-50"
      />
    </View>
  );
}
