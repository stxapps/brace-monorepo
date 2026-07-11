import { Text } from 'react-native';
import { Link } from 'expo-router';

import { Screen } from '../../../components/screen';

// `/sign-in`. Placeholder — the real form is the native port of
// web-ui's SignInForm (built on @stxapps/expo-react's useSignIn) once that
// lands. Mirrors brace-web's `(auth)/sign-in/page.tsx`.
export default function SignInScreen() {
  return (
    <Screen title="Sign in">
      <Link href="/create-account" asChild>
        <Text className="text-primary font-sans text-base underline">Create account</Text>
      </Link>
    </Screen>
  );
}
