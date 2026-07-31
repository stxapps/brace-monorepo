// The share sheet's tag picker — the share-sized RN cousin of the web
// TagsField/TagsCommand pair (docs/editors.md), presentational like
// ShareListPicker: rows in, events out. Existing tags toggle as chips; pending
// sheet-minted tags render as removable chips; the free-text input feeds the
// screen's reuse-or-mint (findOrCreate) rule. The screen owns all of that
// logic — this owns only the chip/input rendering, so the same component can
// serve the snapshot-fed sheet and any future live-fed editor.

import { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';

import type { ShareNewEntity, ShareTaxonomyTag } from '@stxapps/expo-react';

import { Input } from '../../components/ui/input';
import { Text } from '../../components/ui/text';

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
                  ? 'rounded-full bg-primary px-3 py-1'
                  : 'rounded-full bg-secondary px-3 py-1'
              }
            >
              <Text
                className={
                  selected ? 'text-sm text-primary-foreground' : 'text-sm text-secondary-foreground'
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
            className="rounded-full bg-primary px-3 py-1"
          >
            <Text className="text-sm text-primary-foreground">{tag.name} ×</Text>
          </Pressable>
        ))}
      </View>
      <Input
        testID="share-tag-input"
        value={input}
        onChangeText={setInput}
        onSubmitEditing={submit}
        placeholder="Add a tag…"
        autoCapitalize="none"
        autoCorrect={false}
        submitBehavior="submit"
        className="mt-2"
      />
    </View>
  );
}
