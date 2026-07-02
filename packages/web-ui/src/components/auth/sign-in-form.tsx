'use client';

import { useSignInForm } from '@stxapps/react';
import type { SignInValues } from '@stxapps/shared';
import { InvalidCredentialsError, useSignIn } from '@stxapps/web-react';
import { Button } from '@stxapps/web-ui/components/ui/button';
import { Field, FieldError, FieldGroup, FieldLabel } from '@stxapps/web-ui/components/ui/field';
import { Input } from '@stxapps/web-ui/components/ui/input';

// Client leaf for the sign-in route. The page stays a Server Component; only
// this interactive form (react-hook-form + zodResolver) runs on the client.
export function SignInForm() {
  const {
    register,
    handleSubmit,
    setError,
    clearErrors,
    formState: { errors, isSubmitting },
  } = useSignInForm();
  const signIn = useSignIn();

  // The credential failure is a submit-level `root` error, not tied to a field,
  // so react-hook-form's onChange re-validation never clears it. Drop it as soon
  // as the user edits either field, otherwise a stale "Incorrect username or
  // password" lingers while they're correcting their input.
  const clearRootError = () => {
    if (errors.root) clearErrors('root');
  };

  async function onSubmit(values: SignInValues) {
    // Inputs are already validated by zodResolver. The hook owns the submit sequence
    // (fetch door → unwrap DEK → sign → session); here we only map its typed failure
    // onto the form. await keeps isSubmitting true for the duration. We don't tell
    // username from password apart — both surface as one root error, matching the
    // generic, enumeration-safe message the hook collapses them into.
    try {
      await signIn.mutateAsync(values);
    } catch (err) {
      if (err instanceof InvalidCredentialsError) {
        setError('root', { message: 'Incorrect username or password' });
      } else {
        setError('root', { message: 'Could not sign in. Please try again.' });
      }
    }
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
            autoFocus
            aria-invalid={!!errors.username}
            {...register('username', { onChange: clearRootError })}
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
            {...register('password', { onChange: clearRootError })}
          />
          <FieldError errors={errors.password ? [errors.password] : undefined} />
        </Field>
        <Field>
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            Sign in
          </Button>
          <FieldError errors={errors.root ? [errors.root] : undefined} />
        </Field>
      </FieldGroup>
    </form>
  );
}
