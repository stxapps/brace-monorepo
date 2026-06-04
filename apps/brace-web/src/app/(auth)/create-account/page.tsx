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

export default function CreateAccountPage() {
  return (
    <>
      <CardHeader>
        <CardTitle>Create account</CardTitle>
        <CardDescription>Start saving links to visit later.</CardDescription>
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
              <Input id="password" type="password" autoComplete="new-password" required />
            </Field>
          </FieldGroup>
        </form>
      </CardContent>

      <CardFooter className="flex-col gap-4">
        <Button type="submit" className="w-full">
          Create account
        </Button>
        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link href="/sign-in" className="font-medium text-foreground underline">
            Sign in
          </Link>
        </p>
      </CardFooter>
    </>
  );
}
