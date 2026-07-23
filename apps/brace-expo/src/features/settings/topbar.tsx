// The bar above a settings section — the expo merge of brace-web's settings
// topbar and the links screen's topbar idiom: web's always-visible sidebar
// becomes a Drawer here, so the leading action is the drawer toggle; the title
// names the ACTIVE section (web's static "Settings" title lives in the sidebar
// rail, which on mobile is hidden in the drawer); and the trailing ✕ returns
// to the app (the links page) — the counterpart to the sidebar's back arrow,
// so either surface gets you out.

import { Pressable, View } from 'react-native';
import { DrawerActions } from '@react-navigation/native';
import { useNavigation, useRouter } from 'expo-router';
import { Menu, X } from 'lucide-react-native';

import { Icon } from '../../components/ui/icon';
import { Text } from '../../components/ui/text';
import { SETTINGS_SECTIONS, type SettingsSectionId } from './sections';

export function Topbar({ section }: { section: SettingsSectionId }) {
  const navigation = useNavigation();
  const router = useRouter();
  const label = SETTINGS_SECTIONS.find((s) => s.id === section)?.label ?? 'Settings';

  return (
    <View className="border-border h-14 shrink-0 flex-row items-center gap-3 border-b px-2">
      <Pressable
        onPress={() => navigation.dispatch(DrawerActions.openDrawer())}
        aria-label="Open settings navigation"
        className="size-10 items-center justify-center rounded-md"
      >
        <Icon as={Menu} className="text-foreground size-5" />
      </Pressable>
      <Text numberOfLines={1} className="min-w-0 flex-1 text-lg font-semibold">
        {label}
      </Text>
      <Pressable
        onPress={() => router.push('/links')}
        aria-label="Close settings"
        className="size-10 items-center justify-center rounded-md"
      >
        <Icon as={X} className="text-muted-foreground size-5" />
      </Pressable>
    </View>
  );
}
