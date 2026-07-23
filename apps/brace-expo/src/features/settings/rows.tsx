// Small row primitives shared across sections: the tappable ActionRow that
// opens a sub-view and the BackLink every sub-view puts at the top (the
// overview-style Account/Data sections), and the CreateRow pinned atop the
// Lists and Tags tables. Web keeps a copy per section (`_account/`/`_lists/`/…
// are self-contained folders by design); here the whole settings feature is
// one folder, so the self-containment argument dissolves and one copy serves
// all.

import { useState } from 'react';
import { Pressable, View } from 'react-native';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  type LucideIcon,
  Plus,
  X,
} from 'lucide-react-native';

import { Icon } from '../../components/ui/icon';
import { Input } from '../../components/ui/input';
import { Text } from '../../components/ui/text';
import { cn } from '../../lib/utils';

// One tappable row on an overview that opens a sub-view. Full-width with a
// leading icon, a title + description, and a trailing chevron affordance.
export function ActionRow({
  icon,
  title,
  description,
  onPress,
  destructive,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  onPress: () => void;
  destructive?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="border-border active:bg-muted/40 w-full flex-row items-center gap-3 rounded-lg border p-4"
    >
      <Icon
        as={icon}
        className={cn(
          'size-5 shrink-0',
          destructive ? 'text-destructive' : 'text-muted-foreground',
        )}
      />
      <View className="min-w-0 flex-1 gap-0.5">
        <Text className={cn('font-medium', destructive && 'text-destructive')}>{title}</Text>
        <Text className="text-muted-foreground text-sm">{description}</Text>
      </View>
      <Icon as={ChevronRight} className="text-muted-foreground size-4 shrink-0" />
    </Pressable>
  );
}

// The create-an-item row pinned at the top of the Lists and Tags tables. The
// plus turns into a cancel once the field is active (focused or non-empty); a
// confirm (check) appears on the right. Confirming hands the name to onCreate
// (both sections prepend into the root group at rank 0).
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

// The back link shared by every sub-view — returns to its section's overview;
// `label` names the section (web's per-section BackLink hardcodes it).
export function BackLink({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <Pressable onPress={onBack} className="mb-4 flex-row items-center gap-1 self-start rounded">
      <Icon as={ChevronLeft} className="text-muted-foreground size-4" />
      <Text className="text-muted-foreground text-sm">{label}</Text>
    </Pressable>
  );
}
