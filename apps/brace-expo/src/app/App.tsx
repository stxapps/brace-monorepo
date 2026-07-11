import { Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { withUniwind } from 'uniwind';

import { useQueryManagers } from '@stxapps/expo-react';

import '../../global.css';

const queryClient = new QueryClient();

// Core host components (View, Text) accept `className` directly; SafeAreaView is
// a composite component, so Uniwind's HOC is needed to bridge className→style.
const StyledSafeAreaView = withUniwind(SafeAreaView);

const Home = () => (
  <StyledSafeAreaView className="flex-1 bg-white dark:bg-gray-950">
    <View className="flex-1 items-center justify-center gap-2 px-6">
      <Text
        testID="heading"
        role="heading"
        className="text-2xl font-semibold text-gray-900 dark:text-gray-50"
      >
        Brace.to
      </Text>
      <Text className="text-center text-base text-gray-500 dark:text-gray-400">
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
