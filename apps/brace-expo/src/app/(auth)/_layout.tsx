import { Stack } from 'expo-router';

// The auth group — `/sign-in`, `/create-account`. A `(group)` adds no URL
// segment (identical semantics to Next.js), so this mirrors brace-web's
// `src/app/(auth)`: focused screens with no app navigation.
//
// TODO(auth): once @stxapps/expo-react ships the auth layer, port brace-web's
// `(auth)/layout.tsx` GuestGuard — bounce already-authenticated visitors to
// `/links`. The expo-router idiom is `<Redirect href="/links" />` here (or a
// `<Stack.Protected guard={!isAuthed}>` around the screens).
export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
