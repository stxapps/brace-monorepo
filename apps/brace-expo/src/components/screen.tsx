import { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { withUniwind } from 'uniwind';

// Shared placeholder screen chrome. Lives in `src/components/` — NOT under
// `src/app/` — because expo-router turns every file below the app root into a
// route (there is no `_`-prefixed private-folder convention like brace-web's
// Next.js app dir). Route files under `src/app/` stay thin and import their UI
// from here (or a future `src/features/*`); this is the expo-router analogue of
// brace-web's `(app)/links/_components`, `_panes`, etc.
const StyledSafeAreaView = withUniwind(SafeAreaView);

export function Screen({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <StyledSafeAreaView className="bg-background flex-1">
      <View className="flex-1 items-center justify-center gap-3 px-6">
        <Text role="heading" className="text-foreground font-sans text-2xl font-semibold">
          {title}
        </Text>
        {children}
      </View>
    </StyledSafeAreaView>
  );
}
