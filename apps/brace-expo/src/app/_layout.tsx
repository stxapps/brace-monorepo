import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { AuthProvider, useQueryManagers } from '@stxapps/expo-react';
import { ApiClientProvider } from '@stxapps/react';

import { apiClient } from '../lib/api-client';

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
//
// ApiClientProvider hands the shared query/mutation hooks the env-configured
// client (lib/api-client.ts, bound to EXPO_PUBLIC_API_URL) so they don't hardcode
// a baseUrl. It wraps AuthProvider — above every route group — because both the
// `(auth)` public endpoints (username check, sign-in, create-account) and the
// `(app)` SyncProvider read through it; this mirrors brace-web's root-level
// ApiClientProvider placement.
//
// AuthProvider wraps the whole Stack (mirroring brace-web's root-level placement)
// so one auth state is shared across every route group: the `(app)` AuthGuard,
// the `(auth)` GuestGuard, and the landing's future AuthedHomeRedirect all read
// the same `useAuth`. It hydrates the session from secure-store once on mount.
const queryClient = new QueryClient();

export default function RootLayout() {
  useQueryManagers();

  return (
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider client={apiClient}>
        <AuthProvider>
          <StatusBar style="auto" />
          <Stack screenOptions={{ headerShown: false }} />
        </AuthProvider>
      </ApiClientProvider>
    </QueryClientProvider>
  );
}
