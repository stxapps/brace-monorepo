import { Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { withUniwind } from 'uniwind';

import { useQueryManagers } from '@stxapps/expo-react';

import '../../global.css';

// Inter is embedded natively at build time via the expo-font config plugin
// (app.json), under the family name "Inter" (the file's name table was renamed
// from "Inter Variable" by tools/scripts/rename-inter.py). So `fontFamily:
// 'Inter'` / the `font-sans` utility resolve at first paint on both iOS and
// Android with no runtime load — no useFonts, no splash gate. Single variable
// file, mirroring the web/extension build; the `wght` axis backs the
// font-weight utilities.
const queryClient = new QueryClient();

// Core host components (View, Text) accept `className` directly; SafeAreaView is
// a composite component, so Uniwind's HOC is needed to bridge className→style.
const StyledSafeAreaView = withUniwind(SafeAreaView);

// `font-sans` sets fontFamily: 'Inter' (via the `--font-sans` token). RN has no
// CSS cascade, so it's applied where text renders; once the react-native-
// reusables `Text` component is added, put `font-sans` in its base variant to
// make Inter the app-wide default.
const Home = () => (
  <StyledSafeAreaView className="flex-1 bg-white dark:bg-gray-950">
    <View className="flex-1 items-center justify-center gap-2 px-6">
      <Text
        testID="heading"
        role="heading"
        className="font-sans text-2xl font-semibold text-gray-900 dark:text-gray-50"
      >
        Brace.to
      </Text>
      <Text className="text-center font-sans text-base text-gray-500 dark:text-gray-400">
        Save links to visit later.
      </Text>
    </View>
  </StyledSafeAreaView>
);

export const App = () => {
  useQueryManagers();

  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <StatusBar style="auto" />
        <Home />
      </SafeAreaProvider>
    </QueryClientProvider>
  );
};

export default App;
