import { SignInForm } from '@stxapps/web-ui/components/auth/sign-in-form';

import { WEB_APP_URL } from '@/utils/web-app-url';

// Signed-out popup: the SAME presentational sign-in form brace-web uses (shared from
// web-ui; its submit hook posts through this extension's own api client). The footer
// opens the web app's create-account page in a new tab — the extension does its OWN
// sign-in (it can't inherit brace-web's non-extractable key across origins), but it
// never creates accounts itself.
export function SignIn() {
  return (
    <div className="flex w-85 flex-col gap-3 p-4">
      <h1 className="text-base font-semibold">Sign in to Brace</h1>
      <SignInForm />
      <p className="text-sm">
        New to Brace?{' '}
        <button
          type="button"
          className="text-primary"
          onClick={() => {
            void browser.tabs.create({ url: `${WEB_APP_URL}/create-account` });
          }}
        >
          Create an account →
        </button>
      </p>
    </div>
  );
}
