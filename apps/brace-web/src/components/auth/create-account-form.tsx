'use client';

import { useCreateAccountForm } from '@stxapps/react';
import type { CreateAccountValues } from '@stxapps/shared';
import { Button } from '@stxapps/web-ui/components/ui/button';
import { Field, FieldError, FieldGroup, FieldLabel } from '@stxapps/web-ui/components/ui/field';
import { Input } from '@stxapps/web-ui/components/ui/input';

// Client leaf for the create-account route. The page stays a Server Component;
// only this interactive form (react-hook-form + zodResolver) runs on the client.
export function CreateAccountForm() {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useCreateAccountForm();

  async function onSubmit(values: CreateAccountValues) {
    // Inputs are already validated by zodResolver. Remaining steps, left for later:
    //   1. check username uniqueness with the server
    //   2. derive the account via client KDF (@stxapps/web-crypto) → key pair
    //   3. sign a challenge and POST it to exchange for a session id
    // For a taken username, surface it on the field:
    //   setError('username', { message: 'Username is taken' });
    console.log('create account', values);
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
            autoComplete="new-password"
            aria-invalid={!!errors.password}
            {...register('password')}
          />
          <FieldError errors={errors.password ? [errors.password] : undefined} />
        </Field>
        <Field>
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            Create account
          </Button>
        </Field>
      </FieldGroup>
    </form>
  );
}
