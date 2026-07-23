// The settings drawer's content — the expo port of brace-web's
// `(app)/settings/_panes/sidebar.tsx`: a back-to-the-app button pinned at the
// top, then the section menu (Account, Subscription, Data, Lists, Tags, Misc.,
// About). Each entry navigates to `/settings/[section]`; the active one is
// derived from the pathname (the URL is the source of truth), and the matching
// section route renders the content. On mobile the rail is a Drawer (this
// group's _layout), so selecting an entry also closes it — the links sidebar's
// pattern.

import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { usePathname, useRouter } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { withUniwind } from 'uniwind';

import { Icon } from '../../components/ui/icon';
import { Text } from '../../components/ui/text';
import { cn } from '../../lib/utils';
import { SETTINGS_SECTIONS, type SettingsSection } from './sections';

const StyledSafeAreaView = withUniwind(SafeAreaView);

function NavItem({
  section,
  onSelected,
}: {
  section: SettingsSection;
  // Fired after the row commits its navigation — the drawer closes on it.
  onSelected: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const href = `/settings/${section.id}`;
  const active = pathname === href;

  return (
    <Pressable
      onPress={() => {
        router.push(href);
        onSelected();
      }}
      aria-current={active}
      className={cn(
        'w-full flex-row items-center gap-2 rounded-md px-2 py-2',
        active && 'bg-muted',
      )}
    >
      <Icon
        as={section.icon}
        className={cn('size-4 shrink-0', active ? 'text-foreground' : 'text-muted-foreground')}
      />
      <Text
        numberOfLines={1}
        className={cn(
          'min-w-0 flex-1 text-sm',
          active ? 'text-foreground font-medium' : 'text-muted-foreground',
        )}
      >
        {section.label}
      </Text>
    </Pressable>
  );
}

export function Sidebar({ closeDrawer }: { closeDrawer: () => void }) {
  const router = useRouter();

  return (
    <StyledSafeAreaView className="bg-background flex-1">
      <View className="h-14 flex-row items-center px-2">
        <Pressable
          onPress={() => router.push('/links')}
          aria-label="Back to links"
          className="size-10 items-center justify-center rounded-md"
        >
          <Icon as={ArrowLeft} className="text-foreground size-5" />
        </Pressable>
      </View>

      <ScrollView className="flex-1 px-2 pb-4">
        {SETTINGS_SECTIONS.map((section) => (
          <NavItem key={section.id} section={section} onSelected={closeDrawer} />
        ))}
      </ScrollView>
    </StyledSafeAreaView>
  );
}
