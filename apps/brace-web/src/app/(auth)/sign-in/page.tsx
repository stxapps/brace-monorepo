import type { Metadata } from 'next';
import Link from 'next/link';

import {
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@stxapps/web-ui/components/ui/card';

import { SignInForm } from '@/components/auth/sign-in-form';

export const metadata: Metadata = { title: 'Sign in' };

export default function SignInPage() {
  return (
    <>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>Welcome back to Brace.</CardDescription>
      </CardHeader>

      <CardContent>
        <SignInForm />
      </CardContent>

      <CardFooter className="justify-center">
        <p className="text-sm text-muted-foreground">
          New to Brace?{' '}
          <Link href="/create-account" className="font-medium text-foreground underline">
            Create account
          </Link>
        </p>
      </CardFooter>
    </>
  );
}
