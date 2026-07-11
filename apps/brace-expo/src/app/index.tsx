import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { withUniwind } from 'uniwind';

// Core host components (View, Text) accept `className` directly; SafeAreaView is
// a composite component, so Uniwind's HOC is needed to bridge className→style.
const StyledSafeAreaView = withUniwind(SafeAreaView);

// `font-sans` sets fontFamily: 'Inter' (via the `--font-sans` token). RN has no
// CSS cascade, so it's applied where text renders; once the react-native-
// reusables `Text` component is added, put `font-sans` in its base variant to
// make Inter the app-wide default.
export default function Index() {
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
      </View>
    </StyledSafeAreaView>
  );
}
