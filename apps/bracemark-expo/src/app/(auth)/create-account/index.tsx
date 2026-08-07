import { AuthAltAction } from '../../../features/auth/auth-alt-action';
import { AuthScreen } from '../../../features/auth/auth-screen';
import { CreateAccountForm } from '../../../features/auth/create-account-form';

// `/create-account` — mirrors bracemark-web's `(auth)/create-account/page.tsx`:
// the card chrome (AuthScreen ≈ the web layout's lockup + dog-eared Card, plus
// this page's CardHeader/Content/Footer) around the shared ceremony form. Thin
// by design — the UI lives in `src/features/auth/` because every file under the
// app root becomes a route (no `_`-private folders in expo-router).
//
// This screen keeps a description where /sign-in drops one, because a signup has
// something to set expectations about: both halves of the line name a field this
// form will never show. There is no email address and no reset link, not as
// omissions but because the account has neither (docs/account.md — the secret IS
// the account), and that is exactly what makes the next step hand the user a
// password they are told to save. Saying it before the ceremony starts turns that
// step from a surprise into the thing they were just warned about. It beats the
// product line it replaced ("Start saving links to visit later") on the simple
// ground that whoever is on this screen has already decided to sign up.
//
// It must also hold at EVERY step: this header is static while the form advances
// setup → confirm → recovery beneath it, so a line about the current field would
// go stale behind the user's back. This one describes the account, not the step —
// and it reads truest at the recovery step, where it says why that code exists.
export default function CreateAccountScreen() {
  return (
    <AuthScreen
      title="Create account"
      description="No email address, no password reset — your password is the key to your links."
      footer={<AuthAltAction prompt="Already have an account?" href="/sign-in" action="Sign in" />}
    >
      <CreateAccountForm />
    </AuthScreen>
  );
}
