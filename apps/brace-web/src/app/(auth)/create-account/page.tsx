import type { Metadata } from 'next';
import Link from 'next/link';

import {
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@stxapps/web-ui/components/ui/card';

import { CreateAccountForm } from '@/components/auth/create-account-form';

export const metadata: Metadata = { title: 'Create account' };

export default function CreateAccountPage() {
  return (
    <>
      <CardHeader>
        <CardTitle>Create account</CardTitle>
        <CardDescription>Start saving links to visit later.</CardDescription>
      </CardHeader>

      <CardContent>
        <CreateAccountForm />
      </CardContent>

      <CardFooter className="justify-center">
        <p className="text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link href="/sign-in" className="font-medium text-foreground underline">
            Sign in
          </Link>
        </p>
      </CardFooter>
    </>
  );
}
