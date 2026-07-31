import { Link } from 'expo-router';

import { Text } from '../../../components/ui/text';
import { AuthScreen } from '../../../features/auth/auth-screen';
import { SignInForm } from '../../../features/auth/sign-in-form';

// `/sign-in` — mirrors brace-web's `(auth)/sign-in/page.tsx`: the card chrome
// (AuthScreen ≈ the web layout's Card + this page's CardHeader/Content/Footer)
// around the sign-in form. Thin by design — the UI lives in
// `src/features/auth/` because every file under the app root becomes a route
// (no `_`-private folders in expo-router).
export default function SignInScreen() {
  return (
    <AuthScreen
      title="Sign in"
      description="Welcome back to Brace."
      footer={
        <Text className="text-sm text-muted-foreground">
          New to Brace?{' '}
          <Link href="/create-account">
            <Text className="text-sm font-medium text-foreground underline">Create account</Text>
          </Link>
        </Text>
      }
    >
      <SignInForm />
    </AuthScreen>
  );
}
