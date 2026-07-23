// Small row primitives shared by the overview-style sections (Account, Data):
// the tappable ActionRow that opens a sub-view and the BackLink every sub-view
// puts at the top. Web keeps a copy per section (`_account/`/`_data/` are
// self-contained folders by design); here the whole settings feature is one
// folder, so the self-containment argument dissolves and one copy serves both.

import { Pressable, View } from 'react-native';
import { ChevronLeft, ChevronRight, type LucideIcon } from 'lucide-react-native';

import { Icon } from '../../components/ui/icon';
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
