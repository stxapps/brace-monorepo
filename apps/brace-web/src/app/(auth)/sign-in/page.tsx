import Link from 'next/link';

import { Button } from '@stxapps/web-ui/components/ui/button';

export default function SignInPage() {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-50">Sign in</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">Welcome back to Brace.</p>
      </header>

      {/* TODO: sign-in form (@stxapps/web-crypto KDF). */}
      <Button className="w-full">Sign in</Button>

      <p className="text-center text-sm text-gray-500 dark:text-gray-400">
        New to Brace?{' '}
        <Link
          href="/create-account"
          className="font-medium text-gray-900 underline dark:text-gray-50"
        >
          Create account
        </Link>
      </p>
    </div>
  );
}
