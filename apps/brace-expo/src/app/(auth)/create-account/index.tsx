import { Link } from 'expo-router';

import { Text } from '../../../components/ui/text';
import { AuthScreen } from '../../../features/auth/auth-screen';
import { CreateAccountForm } from '../../../features/auth/create-account-form';

// `/create-account` — mirrors brace-web's `(auth)/create-account/page.tsx`:
// the card chrome (AuthScreen ≈ the web layout's Card + this page's
// CardHeader/Content/Footer) around the shared ceremony form. Thin by design —
// the UI lives in `src/features/auth/` because every file under the app root
// becomes a route (no `_`-private folders in expo-router).
export default function CreateAccountScreen() {
  return (
    <AuthScreen
      title="Create account"
      description="Start saving links to visit later."
      footer={
        <Text className="text-muted-foreground text-sm">
          Already have an account?{' '}
          <Link href="/sign-in">
            <Text className="text-foreground text-sm font-medium underline">Sign in</Text>
          </Link>
        </Text>
      }
    >
      <CreateAccountForm />
    </AuthScreen>
  );
}
