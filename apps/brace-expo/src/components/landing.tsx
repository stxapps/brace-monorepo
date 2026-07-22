import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Link } from 'expo-router';
import { withUniwind } from 'uniwind';

import { Button } from './ui/button';
import { Text } from './ui/text';

// The public landing UI (brace-web's `page.tsx` hero). Presentational, and kept
// OUT of `src/app/` so its spec can sit beside it — every file under the app
// root becomes a route. The route that renders it (`src/app/index.tsx`) owns the
// navigation concerns (the authed redirect); this component just renders. Its
// CTAs deep-link into the `(auth)` group, which adds no URL segment, so the
// hrefs are `/create-account` / `/sign-in`.
//
// Built on the react-native-reusables `Button`/`Text` (src/components/ui/ — the
// shadcn analogue), mirroring brace-web's landing CTAs (`Button` + `Link`
// `asChild`). `font-sans` (Inter) now lives in the reusables `Text` base
// variant, so nothing here restates it; the ui `Text` also supplies
// role="heading" via its heading variants.

// Core host components (View, Text) accept `className` directly; SafeAreaView is
// a composite component, so Uniwind's HOC is needed to bridge className→style.
const StyledSafeAreaView = withUniwind(SafeAreaView);

export function Landing() {
  return (
    <StyledSafeAreaView className="flex-1 bg-white dark:bg-gray-950">
      <View className="flex-1 items-center justify-center gap-2 px-6">
        <Text testID="heading" variant="h3" className="text-gray-900 dark:text-gray-50">
          Brace.to
        </Text>
        <Text className="text-center text-gray-500 dark:text-gray-400">
          Save links to visit later.
        </Text>

        <View className="mt-6 items-center gap-3">
          <Link href="/create-account" asChild>
            <Button>
              <Text>Get started</Text>
            </Button>
          </Link>
          <Link href="/sign-in" asChild>
            <Button variant="link">
              <Text>Sign in</Text>
            </Button>
          </Link>
        </View>
      </View>
    </StyledSafeAreaView>
  );
}
