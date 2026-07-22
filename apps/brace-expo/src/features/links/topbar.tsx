// The bar above the links list — the expo port of brace-web's
// `(app)/links/_panes/topbar.tsx`: the active selection's name (what the main
// pane is showing) plus the screen's chrome actions. On mobile the leading
// action is the drawer toggle (web's sidebar is always visible) and the
// trailing pair is the search toggle — web's persistent search box doesn't fit
// a phone topbar, so it summons the SearchBar row below (view-state-provider
// `searchOpen`) — and the ⋯ overflow menu (more-options-menu.tsx), which
// absorbed the old direct Settings button. Web's remaining actions arrive with
// their features: add (the editor — likely a FAB here, not a topbar slot) and
// bulk edit (joins the ⋯ menu with its toolbar). Sync lives in the ⋯ menu AND
// as the list's pull-to-refresh — the gesture is the platform idiom, the menu
// entry carries the error/retry affordance.

import { Pressable, View } from 'react-native';
import { DrawerActions } from '@react-navigation/native';
import { useNavigation } from 'expo-router';
import { Menu, Search } from 'lucide-react-native';

import { useLists, useTags } from '@stxapps/expo-react';
import { ALL_LABEL, emptyQuery, flattenTree } from '@stxapps/shared';

import { Icon } from '../../components/ui/icon';
import { Text } from '../../components/ui/text';
import { cn } from '../../lib/utils';
import { MoreOptionsMenu } from './more-options-menu';
import { useLinksPage } from './page-provider';
import { useLinksViewState } from './view-state-provider';

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
  const { selection, setQuery } = useLinksPage();
  const { searchOpen, setSearchOpen } = useLinksViewState();

  const toggleSearch = () => {
    if (!searchOpen) {
      setSearchOpen(true);
      return;
    }
    setSearchOpen(false);
    // Closing DISMISSES the search: a committed search resolves `selection` to
    // 'none' (no drawer highlight, generic title), so with the bar gone it
    // would keep filtering the list with no visible surface left to show or
    // clear it — return home instead. A plain list/tag view (bar opened but
    // nothing committed) just hides the bar.
    if (selection.kind === 'none') setQuery(emptyQuery());
  };

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
      <View className="flex-row items-center">
        <Pressable
          onPress={toggleSearch}
          aria-label="Search"
          aria-expanded={searchOpen}
          className={cn(
            'size-10 items-center justify-center rounded-md',
            searchOpen && 'bg-muted',
          )}
        >
          <Icon
            as={Search}
            className={cn('size-5', searchOpen ? 'text-foreground' : 'text-muted-foreground')}
          />
        </Pressable>
        <MoreOptionsMenu />
      </View>
    </View>
  );
}
