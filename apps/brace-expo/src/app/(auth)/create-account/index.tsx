import { Text } from 'react-native';
import { Link } from 'expo-router';

import { Screen } from '../../../components/screen';

// `/create-account`. Placeholder — the real form is the native port of
// web-ui's CreateAccountForm (built on @stxapps/expo-react's useCreateAccount)
// once that lands. Mirrors brace-web's `(auth)/create-account/page.tsx`.
export default function CreateAccountScreen() {
  return (
    <Screen title="Create account">
      <Link href="/sign-in" asChild>
        <Text className="text-primary font-sans text-base underline">Sign in</Text>
      </Link>
    </Screen>
  );
}
