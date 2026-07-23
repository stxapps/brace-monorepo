import { View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { withUniwind } from 'uniwind';

import { SectionContent } from '../../../features/settings/section-content';
import { DEFAULT_SECTION_ID, isSettingsSectionId } from '../../../features/settings/sections';
import { Topbar } from '../../../features/settings/topbar';

// Composites (not core hosts) need Uniwind's HOC to accept `className` — the
// auth-screen's pattern, including keyboard-controller's scroll view so a
// focused field (rename, passwords) stays clear of the keyboard.
const StyledSafeAreaView = withUniwind(SafeAreaView);
const StyledKeyboardAwareScrollView = withUniwind(KeyboardAwareScrollView);

// One settings section, addressed by its id in the path (`/settings/lists`, …)
// — the expo port of brace-web's `(app)/settings/[section]/page.tsx`. The id
// is user-supplied (a deep link can carry anything), so validate it against
// the known sections — anything else lands on the default section (the
// Redirect stands in for web's notFound()). The shared frame is split per the
// platform: the section menu is the Drawer (this group's _layout), the topbar
// renders here above the scrolling content. Thin by convention — the UI is in
// src/features/settings/.
export default function SettingsSectionScreen() {
  const { section } = useLocalSearchParams<{ section: string }>();
  if (!section || !isSettingsSectionId(section)) {
    return <Redirect href={`/settings/${DEFAULT_SECTION_ID}`} />;
  }

  return (
    <StyledSafeAreaView className="bg-background flex-1">
      <View className="min-h-0 flex-1">
        <Topbar section={section} />
        <StyledKeyboardAwareScrollView
          className="flex-1"
          keyboardShouldPersistTaps="handled"
          bottomOffset={16}
        >
          <SectionContent section={section} />
        </StyledKeyboardAwareScrollView>
      </View>
    </StyledSafeAreaView>
  );
}
