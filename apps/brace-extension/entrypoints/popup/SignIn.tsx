import { SignInForm } from '@stxapps/web-ui/components/auth/sign-in-form';

// The web app's origin per build mode — where the extension sends users to CREATE an
// account. The extension does its OWN sign-in (it can't inherit brace-web's
// non-extractable key across origins), but account creation stays on the web app.
const WEB_APP_URL =
  import.meta.env.MODE === 'production'
    ? 'https://app.brace.to'
    : import.meta.env.MODE === 'staging'
      ? 'https://app.staging.brace.to'
      : 'http://localhost:3000';

// Signed-out popup: the SAME presentational sign-in form brace-web uses (shared from
// web-ui; its submit hook posts through this extension's own api client). The footer
// opens the web app's create-account page in a new tab — the extension never creates
// accounts itself.
export function SignIn() {
  return (
    <div className="flex w-[340px] flex-col gap-3 p-4">
      <h1 className="m-0 text-base font-semibold">Sign in to Brace</h1>
      <SignInForm />
      <p className="m-0 text-[13px]">
        New to Brace?{' '}
        <button
          type="button"
          className="cursor-pointer border-0 bg-transparent p-0 text-primary [font:inherit]"
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
