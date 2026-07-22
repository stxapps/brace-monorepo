import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { withUniwind } from 'uniwind';

import { BulkTagsDialog } from '../../../features/links/bulk-tags-dialog';
import { LinkDestroyConfirm } from '../../../features/links/link-destroy-confirm';
import { Main } from '../../../features/links/main';
import { SearchBar } from '../../../features/links/search-bar';
import { Topbar } from '../../../features/links/topbar';
import { LinksViewStateProvider } from '../../../features/links/view-state-provider';

const StyledSafeAreaView = withUniwind(SafeAreaView);

// `/links` — the home of the signed-in app, mirroring brace-web's
// `(app)/links/page.tsx` composition: the topbar above the scrolling main
// pane, wrapped in LinksViewStateProvider (the topbar's search toggle and the
// ⋯ menu's bulk-edit entry write the view state the bar row and main pane
// read). SearchBar renders null until summoned (searchOpen, or force-shown by
// a committed search — see topbar's `searchVisible`), so it mounts
// unconditionally here — as do the two screen-level dialogs the bulk-edit bar
// requests through view state (`retagging`/`destroying`; hoisted so a list
// repaint can't unmount them mid-edit — web's rationale). The bulk-edit bar
// itself is rendered by Main, which owns the `links` it acts on. The sidebar
// half of web's frame is the Drawer in this group's _layout, where
// LinksPageProvider also lives (the drawer content shares it). Thin by
// convention — the UI is in src/features/links/.
export default function LinksScreen() {
  return (
    <LinksViewStateProvider>
      <StyledSafeAreaView className="bg-background flex-1">
        <View className="min-h-0 flex-1">
          <Topbar />
          <SearchBar />
          <Main />
        </View>
      </StyledSafeAreaView>
      <BulkTagsDialog />
      <LinkDestroyConfirm />
    </LinksViewStateProvider>
  );
}
