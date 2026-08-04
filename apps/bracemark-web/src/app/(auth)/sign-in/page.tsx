import type { Metadata } from 'next';
import Link from 'next/link';

import { SignInForm } from '@stxapps/web-ui/components/auth/sign-in-form';
import {
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@stxapps/web-ui/components/ui/card';

export const metadata: Metadata = { title: 'Sign in' };

export default function SignInPage() {
  return (
    <>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>Welcome back to Bracemark.</CardDescription>
      </CardHeader>

      <CardContent>
        <SignInForm />
      </CardContent>

      <CardFooter className="justify-center">
        <p className="text-sm text-muted-foreground">
          New to Bracemark?{' '}
          <Link href="/create-account" className="font-medium text-foreground underline">
            Create account
          </Link>
        </p>
      </CardFooter>
    </>
  );
}
