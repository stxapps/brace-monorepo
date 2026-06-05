'use client';

import { useSignInForm } from '@stxapps/react';
import type { SignInValues } from '@stxapps/shared';
import { Button } from '@stxapps/web-ui/components/ui/button';
import { Field, FieldError, FieldGroup, FieldLabel } from '@stxapps/web-ui/components/ui/field';
import { Input } from '@stxapps/web-ui/components/ui/input';

// Client leaf for the sign-in route. The page stays a Server Component; only
// this interactive form (react-hook-form + zodResolver) runs on the client.
export function SignInForm() {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useSignInForm();

  async function onSubmit(values: SignInValues) {
    // Inputs are already validated by zodResolver. Remaining steps, left for later:
    //   1. derive the account via client KDF (@stxapps/web-crypto) → key pair
    //   2. sign a challenge and POST it to exchange for a session id
    // For bad credentials, surface it on the form:
    //   setError('root', { message: 'Incorrect username or password' });
    console.log('sign in', values);
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate>
      <FieldGroup>
        <Field data-invalid={!!errors.username}>
          <FieldLabel htmlFor="username">Username</FieldLabel>
          <Input
            id="username"
            type="text"
            autoComplete="username"
            aria-invalid={!!errors.username}
            {...register('username')}
          />
          <FieldError errors={errors.username ? [errors.username] : undefined} />
        </Field>
        <Field data-invalid={!!errors.password}>
          <FieldLabel htmlFor="password">Password</FieldLabel>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            aria-invalid={!!errors.password}
            {...register('password')}
          />
          <FieldError errors={errors.password ? [errors.password] : undefined} />
        </Field>
        <Field>
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            Sign in
          </Button>
        </Field>
      </FieldGroup>
    </form>
  );
}
