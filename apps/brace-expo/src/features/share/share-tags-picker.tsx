// The share sheet's tag picker — the share-sized RN cousin of the web
// TagsField/TagsCommand pair (docs/editors.md), presentational like
// ShareListPicker: rows in, events out. Existing tags toggle as chips; pending
// sheet-minted tags render as removable chips; the free-text input feeds the
// screen's reuse-or-mint (findOrCreate) rule. The screen owns all of that
// logic — this owns only the chip/input rendering, so the same component can
// serve the snapshot-fed sheet and any future live-fed editor.

import { useCallback, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import type { ShareNewEntity, ShareTaxonomyTag } from '@stxapps/expo-react';

export function ShareTagsPicker({
  tags,
  selectedTagIds,
  newTags,
  onToggle,
  onRemoveNew,
  onSubmitName,
}: {
  tags: ShareTaxonomyTag[];
  selectedTagIds: string[];
  // Pending sheet-minted tags — always selected; tapping a chip removes it.
  newTags: ShareNewEntity[];
  onToggle: (tagId: string) => void;
  onRemoveNew: (tagId: string) => void;
  // The typed name to reuse-or-mint — the screen decides which.
  onSubmitName: (name: string) => void;
}) {
  const [input, setInput] = useState('');

  const submit = useCallback(() => {
    const name = input.trim();
    setInput('');
    if (name !== '') onSubmitName(name);
  }, [input, onSubmitName]);

  return (
    <View>
      <View className="mt-1 flex-row flex-wrap gap-2">
        {tags.map((tag) => {
          const selected = selectedTagIds.includes(tag.id);
          return (
            <Pressable
              key={tag.id}
              testID={`share-tag-${tag.id}`}
              onPress={() => onToggle(tag.id)}
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
            onPress={() => onRemoveNew(tag.id)}
            className="bg-primary rounded-full px-3 py-1"
          >
            <Text className="font-sans text-sm text-white">{tag.name} ×</Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        testID="share-tag-input"
        value={input}
        onChangeText={setInput}
        onSubmitEditing={submit}
        placeholder="Add a tag…"
        autoCapitalize="none"
        autoCorrect={false}
        submitBehavior="submit"
        className="mt-2 rounded-lg bg-gray-100 px-3 py-2 font-sans text-base text-gray-900 dark:bg-gray-800 dark:text-gray-50"
      />
    </View>
  );
}
