// The bar above the links list — the expo port of brace-web's
// `(app)/links/_panes/topbar.tsx`: the active selection's name (what the main
// pane is showing) plus the screen's chrome actions. On mobile the leading
// action is the drawer toggle (web's sidebar is always visible); the trailing
// one links to Settings. Web's other actions arrive with their features: add
// (the editor), search (the search bar), bulk edit (view state), and the
// overflow menu's sync entry — sync here is the main list's pull-to-refresh
// instead, the platform idiom.

import { Pressable, View } from 'react-native';
import { DrawerActions } from '@react-navigation/native';
import { useNavigation, useRouter } from 'expo-router';
import { Menu, Settings } from 'lucide-react-native';

import { useLists, useTags } from '@stxapps/expo-react';
import { ALL_LABEL, flattenTree } from '@stxapps/shared';

import { Icon } from '../../components/ui/icon';
import { Text } from '../../components/ui/text';
import { useLinksPage } from './page-provider';

function useSelectionLabel(): string {
  const { selection } = useLinksPage();
  const lists = useLists();
  const tags = useTags();

  if (selection.kind === 'all') return ALL_LABEL;
  // A text search or compound/multi filter has no single-axis name — title the
  // view generically rather than borrowing a stale list/tag name.
  if (selection.kind === 'none') return 'Search';
  if (selection.kind === 'list') {
    // Look the name up in the merged list tree — so a renamed system list shows
    // its override name, not the code default. Flatten since the match may be
    // at any depth.
    return flattenTree(lists).find((n) => n.item.id === selection.id)?.item.name ?? 'Unknown';
  }
  return flattenTree(tags).find((n) => n.item.id === selection.id)?.item.name ?? 'Unknown';
}

export function Topbar() {
  const label = useSelectionLabel();
  const navigation = useNavigation();
  const router = useRouter();

  return (
    <View className="border-border h-14 shrink-0 flex-row items-center gap-3 border-b px-2">
      <Pressable
        onPress={() => navigation.dispatch(DrawerActions.openDrawer())}
        aria-label="Open navigation"
        className="size-10 items-center justify-center rounded-md"
      >
        <Icon as={Menu} className="text-foreground size-5" />
      </Pressable>
      <Text numberOfLines={1} className="min-w-0 flex-1 text-lg font-semibold">
        {label}
      </Text>
      <Pressable
        onPress={() => router.push('/settings')}
        aria-label="Settings"
        className="size-10 items-center justify-center rounded-md"
      >
        <Icon as={Settings} className="text-muted-foreground size-5" />
      </Pressable>
    </View>
  );
}
