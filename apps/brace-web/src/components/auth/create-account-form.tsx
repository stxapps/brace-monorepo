'use client';

import { useQueryClient } from '@tanstack/react-query';

import {
  useCreateAccountForm,
  usernameAvailableQueryOptions,
  useUsernameAvailable,
} from '@stxapps/react';
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

import { api } from '../../lib/api';

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
  const queryClient = useQueryClient();

  // Live availability as the user types (debounced + race-safe inside the hook).
  // Only meaningful once the value is a valid format, which gates the query too.
  const username = watch('username');
  const usernameValid = usernameSchema.safeParse(username).success;
  const availability = useUsernameAvailable(username);

  async function onSubmit(values: CreateAccountValues) {
    // Inputs are already validated by zodResolver. Step 1: authoritative
    // availability check on the exact submitted value. fetchQuery reuses the
    // live query's cache, so a paused-on name resolves instantly; the server
    // still re-checks at creation to close the type→submit race.
    try {
      const { available } = await queryClient.fetchQuery(
        usernameAvailableQueryOptions(api, values.username),
      );
      if (!available) {
        setError('username', { message: 'Username is taken' });
        return;
      }
    } catch {
      setError('username', {
        message: 'Could not check username availability. Please try again.',
      });
      return;
    }

    // Remaining steps, left for later:
    //   2. derive the account via client KDF (@stxapps/web-crypto) → key pair
    //   3. sign a challenge and POST it to exchange for a session id
    console.log('create account', values);
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
        </Field>
      </FieldGroup>
    </form>
  );
}
