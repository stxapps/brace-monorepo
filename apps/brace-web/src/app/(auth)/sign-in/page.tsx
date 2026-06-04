import Link from 'next/link';

import { Button } from '@stxapps/web-ui/components/ui/button';
import {
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@stxapps/web-ui/components/ui/card';
import { Field, FieldGroup, FieldLabel } from '@stxapps/web-ui/components/ui/field';
import { Input } from '@stxapps/web-ui/components/ui/input';

export default function SignInPage() {
  return (
    <>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>Welcome back to Brace.</CardDescription>
      </CardHeader>

      <CardContent>
        <form>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="username">Username</FieldLabel>
              <Input id="username" type="text" autoComplete="username" required />
            </Field>
            <Field>
              <FieldLabel htmlFor="password">Password</FieldLabel>
              <Input id="password" type="password" autoComplete="current-password" required />
            </Field>
          </FieldGroup>
        </form>
      </CardContent>

      <CardFooter className="flex-col gap-4">
        <Button type="submit" className="w-full">
          Sign in
        </Button>
        <p className="text-center text-sm text-muted-foreground">
          New to Brace?{' '}
          <Link href="/create-account" className="font-medium text-foreground underline">
            Create account
          </Link>
        </p>
      </CardFooter>
    </>
  );
}
