import Link from 'next/link';

import { Button } from '@stxapps/web-ui/components/ui/button';

export default function CreateAccountPage() {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-50">Create account</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Start saving links to visit later.
        </p>
      </header>

      {/* TODO: account-creation form (@stxapps/web-crypto KDF). */}
      <Button className="w-full">Create account</Button>

      <p className="text-center text-sm text-gray-500 dark:text-gray-400">
        Already have an account?{' '}
        <Link
          href="/sign-in"
          className="font-medium text-gray-900 underline dark:text-gray-50"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
