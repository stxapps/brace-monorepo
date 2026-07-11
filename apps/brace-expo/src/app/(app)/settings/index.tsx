import { Text } from 'react-native';
import { Link } from 'expo-router';

import { Screen } from '../../../components/screen';

// `/settings`. Placeholder. brace-web splits settings into
// `settings/[section]/page.tsx` (account/lists/tags/data/…); the expo-router
// equivalent when those land is a dynamic route `settings/[section].tsx`
// alongside this index. Mirrors brace-web's `(app)/settings/page.tsx`.
export default function SettingsScreen() {
  return (
    <Screen title="Settings">
      <Link href="/links" asChild>
        <Text className="text-primary font-sans text-base underline">Back to links</Text>
      </Link>
    </Screen>
  );
}
