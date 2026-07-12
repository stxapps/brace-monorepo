// Installs the atob/btoa globals Hermes/Expo lacks — must run before any code
// that decodes base64 (shared's base64ToBytes/bytesToBase64). Kept first, ahead
// of every other import, so the side effect lands before the app tree evaluates.
import '../polyfills';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { useQueryManagers } from '@stxapps/expo-react';

import '../../global.css';

// The root route. expo-router auto-detects this `src/app` directory as the app
// root (no EXPO_ROUTER_APP_ROOT needed), and `expo-router/entry` (package.json
// `main`) is the native entry — there is no registerRootComponent/index.js.
//
// Inter is embedded natively at build time via the expo-font config plugin
// (app.json), under the family name "Inter" (the file's name table was renamed
// from "Inter Variable" by tools/scripts/rename-inter.py). So `fontFamily:
// 'Inter'` / the `font-sans` utility resolve at first paint on both iOS and
// Android with no runtime load — no useFonts, no splash gate. Single variable
// file, mirroring the web/extension build; the `wght` axis backs the
// font-weight utilities. `global.css` is imported here (once, at the top of the
// app tree) as Uniwind wants.
//
// expo-router mounts a NavigationContainer that already provides a safe-area
// context (react-navigation's SafeAreaProviderCompat), so screens can use
// `SafeAreaView` without an explicit SafeAreaProvider here.
const queryClient = new QueryClient();

export default function RootLayout() {
  useQueryManagers();

  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }} />
    </QueryClientProvider>
  );
}
