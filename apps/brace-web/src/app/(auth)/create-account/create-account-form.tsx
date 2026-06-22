'use client';

import { useCreateAccountForm, useUsernameAvailable } from '@stxapps/react';
import { type CreateAccountValues, usernameSchema } from '@stxapps/shared';
import { Button } from '@stxapps/web-ui/components/ui/button';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@stxapps/web-ui/components/ui/field';
import { Input } from '@stxapps/web-ui/components/ui/input';

import { useCreateAccount, UsernameCheckError, UsernameTakenError } from './use-create-account';

// Client leaf for the create-account route. The page stays a Server Component;
// only this interactive form (react-hook-form + zodResolver) runs on the client.
export function CreateAccountForm() {
  const {
    register,
    handleSubmit,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useCreateAccountForm();
  const createAccount = useCreateAccount();

  // Live availability as the user types (debounced + race-safe inside the hook).
  // Only meaningful once the value is a valid format, which gates the query too.
  const username = watch('username');
  const usernameValid = usernameSchema.safeParse(username).success;
  const availability = useUsernameAvailable(username);

  async function onSubmit(values: CreateAccountValues) {
    // Inputs are already validated by zodResolver. The hook owns the submit
    // sequence (availability re-check → KDF → sign → session); here we only map
    // its typed failures onto the right form field. await keeps isSubmitting
    // true for the duration.
    try {
      await createAccount.mutateAsync(values);
    } catch (err) {
      if (err instanceof UsernameTakenError) {
        setError('username', { message: 'Username is taken' });
      } else if (err instanceof UsernameCheckError) {
        setError('username', {
          message: 'Could not check username availability. Please try again.',
        });
      } else {
        setError('root', { message: 'Could not create account. Please try again.' });
      }
    }
  }

  // Inline hint mirrors the query state, but never fights a hard field error.
  let usernameHint: { text: string; taken: boolean } | null = null;
  if (usernameValid && !errors.username) {
    if (availability.isFetching) usernameHint = { text: 'Checking availability…', taken: false };
    else if (availability.data?.available === false)
      usernameHint = { text: 'Username is taken', taken: true };
    else if (availability.data?.available === true)
      usernameHint = { text: 'Username is available', taken: false };
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
            {...register('username')}
          />
          <FieldError errors={errors.username ? [errors.username] : undefined} />
          {usernameHint ? (
            <FieldDescription className={usernameHint.taken ? 'text-destructive' : undefined}>
              {usernameHint.text}
            </FieldDescription>
          ) : null}
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
          <Button
            type="submit"
            className="w-full"
            disabled={isSubmitting || availability.data?.available === false}
          >
            Create account
          </Button>
          <FieldError errors={errors.root ? [errors.root] : undefined} />
        </Field>
      </FieldGroup>
    </form>
  );
}
