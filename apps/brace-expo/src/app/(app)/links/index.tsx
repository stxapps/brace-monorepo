import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { withUniwind } from 'uniwind';

import { Main } from '../../../features/links/main';
import { SearchBar } from '../../../features/links/search-bar';
import { Topbar } from '../../../features/links/topbar';
import { LinksViewStateProvider } from '../../../features/links/view-state-provider';

const StyledSafeAreaView = withUniwind(SafeAreaView);

// `/links` — the home of the signed-in app, mirroring brace-web's
// `(app)/links/page.tsx` composition: the topbar above the scrolling main
// pane, wrapped in LinksViewStateProvider (the topbar's search toggle — and
// future bulk-edit toggle — writes the view state the bar row and main pane
// read). SearchBar renders null until summoned (searchOpen, or force-shown by
// a committed search — see topbar's `searchVisible`), so it mounts
// unconditionally here. The sidebar half of web's frame is the Drawer in this
// group's _layout, where LinksPageProvider also lives (the drawer content
// shares it). Thin by convention — the UI is in src/features/links/.
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
    </LinksViewStateProvider>
  );
}
