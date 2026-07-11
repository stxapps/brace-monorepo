import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Link } from 'expo-router';
import { withUniwind } from 'uniwind';

// The public landing UI (brace-web's `page.tsx` hero). Presentational, and kept
// OUT of `src/app/` so its spec can sit beside it — every file under the app
// root becomes a route. The route that renders it (`src/app/index.tsx`) owns the
// navigation concerns (the authed redirect); this component just renders. Its
// CTAs deep-link into the `(auth)` group, which adds no URL segment, so the
// hrefs are `/create-account` / `/sign-in`.

// Core host components (View, Text) accept `className` directly; SafeAreaView is
// a composite component, so Uniwind's HOC is needed to bridge className→style.
const StyledSafeAreaView = withUniwind(SafeAreaView);

// `font-sans` sets fontFamily: 'Inter' (via the `--font-sans` token). RN has no
// CSS cascade, so it's applied where text renders; once the react-native-
// reusables `Text` component is added, put `font-sans` in its base variant to
// make Inter the app-wide default.
export function Landing() {
  return (
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

        <View className="mt-6 items-center gap-3">
          <Link href="/create-account" asChild>
            <Text className="text-primary font-sans text-base font-medium underline">
              Get started
            </Text>
          </Link>
          <Link href="/sign-in" asChild>
            <Text className="font-sans text-base text-gray-500 underline dark:text-gray-400">
              Sign in
            </Text>
          </Link>
        </View>
      </View>
    </StyledSafeAreaView>
  );
}
