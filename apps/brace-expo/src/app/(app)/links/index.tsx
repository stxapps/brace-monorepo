import { Text } from 'react-native';
import { Link } from 'expo-router';

import { Screen } from '../../../components/screen';

// `/links` — the home of the signed-in app. Placeholder; the real list (the
// FlashList + drizzle `useLiveQuery` read edge) lands with @stxapps/expo-react's
// data layer. Mirrors brace-web's `(app)/links/page.tsx`.
export default function LinksScreen() {
  return (
    <Screen title="Links">
      <Link href="/settings" asChild>
        <Text className="text-primary font-sans text-base underline">Settings</Text>
      </Link>
    </Screen>
  );
}
