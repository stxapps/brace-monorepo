'use client';

import * as React from 'react';
import { ChevronLeft, RefreshCw } from 'lucide-react';

import { useUsernameAvailable } from '@stxapps/react';
import {
  canonicalizePassword,
  canonicalizeUsername,
  generatePassphrase,
  generateRecoveryCode,
  NEW_PASSWORD_MIN_LENGTH,
  newPasswordSchema,
  PASSWORD_MIN_GUESSES_LOG10,
  usernameSchema,
} from '@stxapps/shared';
import { useCreateAccount, UsernameTakenError } from '@stxapps/web-react';
import { PasswordInput } from '@stxapps/web-ui/components/auth/password-input';
import {
  PasswordStrengthMeter,
  usePasswordStrength,
} from '@stxapps/web-ui/components/auth/password-strength';
import { ShowOnceSecret } from '@stxapps/web-ui/components/auth/show-once-secret';
import { Button } from '@stxapps/web-ui/components/ui/button';
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@stxapps/web-ui/components/ui/field';
import { Input } from '@stxapps/web-ui/components/ui/input';

// The "Secure your account" ceremony (docs/account.md). Because the account is a
// password-derived wallet — no email, no server-side reset — the safe path is the
// DEFAULT path: a generated ~77-bit passphrase, shown once wallet-style, with a
// "type my own" escape hatch gated by a zxcvbn strength floor. Three steps:
//   1. setup    — username + choose a password (generated default | typed own)
//   2. confirm  — re-enter it, verifying the user can reproduce it (no reset!)
//   3. recovery — a generated recovery code (a second door), show-once, SKIPPABLE
// then create the account (with the recovery door iff they set one up).
//
// Not react-hook-form: the multi-step secret ceremony (generate, reveal, confirm,
// re-generate) is local UI state, and the only validated inputs are username
// (usernameSchema) and password (newPasswordSchema + the zxcvbn gate), checked inline.

type Step = 'setup' | 'confirm' | 'recovery';
type Mode = 'generated' | 'own';

export function CreateAccountForm() {
  const createAccount = useCreateAccount();

  const [step, setStep] = React.useState<Step>('setup');
  const [username, setUsername] = React.useState('');
  const [usernameTaken, setUsernameTaken] = React.useState(false);

  const [mode, setMode] = React.useState<Mode>('generated');
  // Generated on MOUNT (an effect, not during render) so SSR and client agree —
  // a random value produced during render would hydrate-mismatch.
  const [passphrase, setPassphrase] = React.useState('');
  const [passphraseSaved, setPassphraseSaved] = React.useState(false);
  const [ownPassword, setOwnPassword] = React.useState('');

  const [confirmInput, setConfirmInput] = React.useState('');
  const [confirmError, setConfirmError] = React.useState(false);

  const [recoveryCode, setRecoveryCode] = React.useState('');
  const [recoverySaved, setRecoverySaved] = React.useState(false);

  const [submitError, setSubmitError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setPassphrase(generatePassphrase());
  }, []);

  // Mint the recovery code the first time the user reaches that step.
  React.useEffect(() => {
    if (step === 'recovery' && !recoveryCode) setRecoveryCode(generateRecoveryCode());
  }, [step, recoveryCode]);

  const password = mode === 'generated' ? passphrase : ownPassword;

  // Live username validation + availability (the hook debounces + gates on a valid
  // format internally, like the old form). Parse once and reuse the schema's own
  // message so the specific rule that failed (length, charset, or reserved name)
  // shows through instead of one catch-all string.
  const usernameParse = usernameSchema.safeParse(username);
  const usernameValid = usernameParse.success;
  const availability = useUsernameAvailable(username);
  const usernameAvailable = availability.data?.available === true;

  // Strength only matters on the typed path (the generated passphrase is ~77 bits
  // by construction). Score the CANONICAL form (canonicalizePassword) — the exact
  // string the KEK derives from — so the meter can't disagree with what's stored.
  // Pass the username as a penalty term.
  const { guessesLog10, displayScore } = usePasswordStrength(
    mode === 'own' ? canonicalizePassword(ownPassword) : '',
    [username],
    NEW_PASSWORD_MIN_LENGTH,
  );
  // Parse once and reuse the schema's own message, like the username field above —
  // the meter alone says "Weak" without naming the rule that's blocking, which sends
  // people reaching for symbols when length is what's missing.
  const ownPasswordParse = newPasswordSchema.safeParse(ownPassword);
  // Gate on the raw guess estimate; `displayScore` is the meter's, not the policy's
  // (see PASSWORD_MIN_GUESSES_LOG10).
  // null = estimator still loading; stay closed until it's ready.
  const ownPasswordOk =
    ownPasswordParse.success && guessesLog10 !== null && guessesLog10 >= PASSWORD_MIN_GUESSES_LOG10;

  const passwordChosen =
    mode === 'generated' ? passphrase !== '' && passphraseSaved : ownPasswordOk;
  const canContinueSetup = usernameValid && usernameAvailable && passwordChosen;

  const regeneratePassphrase = () => {
    setPassphrase(generatePassphrase());
    setPassphraseSaved(false);
  };

  const regenerateRecovery = () => {
    setRecoveryCode(generateRecoveryCode());
    setRecoverySaved(false);
  };

  const goConfirm = () => {
    setConfirmInput('');
    setConfirmError(false);
    setStep('confirm');
  };

  const goRecovery = () => {
    // Compare the CANONICAL forms: derivation canonicalizes both, so encodings that
    // derive the same KEK (e.g. a trailing space) must count as a match here too —
    // otherwise we'd reject a re-entry that would actually sign in fine.
    if (canonicalizePassword(confirmInput) !== canonicalizePassword(password)) {
      setConfirmError(true);
      return;
    }
    setStep('recovery');
  };

  const submit = async (withRecovery: boolean) => {
    setSubmitError(null);
    try {
      await createAccount.mutateAsync({
        username: canonicalizeUsername(username),
        password,
        recoveryCode: withRecovery ? recoveryCode : undefined,
      });
      // onSuccess in the hook flips auth state and navigates; nothing to do here.
    } catch (err) {
      if (err instanceof UsernameTakenError) {
        setUsernameTaken(true);
        setStep('setup');
      } else {
        setSubmitError('Could not create account. Please try again.');
      }
    }
  };

  const pending = createAccount.isPending;

  // --- step: setup ----------------------------------------------------------
  if (step === 'setup') {
    const usernameError = usernameTaken
      ? 'Username is taken'
      : username !== '' && !usernameValid
        ? (usernameParse.error?.issues[0]?.message ?? 'Invalid username')
        : null;

    // Only once they've typed something. Length first (the schema owns its own
    // message), then the entropy floor — otherwise a long-but-predictable password
    // would fail with a silent "Fair" meter and no way to know what to change.
    const ownPasswordError =
      ownPassword === ''
        ? null
        : !ownPasswordParse.success
          ? (ownPasswordParse.error?.issues[0]?.message ?? 'Invalid password')
          : guessesLog10 !== null && guessesLog10 < PASSWORD_MIN_GUESSES_LOG10
            ? 'Too predictable — add a few more words, or generate a passphrase instead.'
            : null;

    return (
      <FieldGroup>
        <Field data-invalid={!!usernameError}>
          <FieldLabel htmlFor="username">Username</FieldLabel>
          <Input
            id="username"
            type="text"
            autoComplete="username"
            autoFocus
            aria-invalid={!!usernameError}
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
              setUsernameTaken(false);
            }}
          />
          {usernameError ? (
            <FieldDescription className="text-destructive">{usernameError}</FieldDescription>
          ) : usernameValid && availability.isFetching ? (
            <FieldDescription>Checking availability…</FieldDescription>
          ) : usernameValid && usernameAvailable ? (
            <FieldDescription>Username is available</FieldDescription>
          ) : null}
        </Field>

        {mode === 'generated' ? (
          <Field>
            <FieldLabel>Your passphrase</FieldLabel>
            <FieldDescription>
              We generated a strong passphrase for you. Save it in your password manager — there is
              no way to reset it if it&apos;s lost.
            </FieldDescription>
            <ShowOnceSecret
              id="passphrase-saved"
              secret={passphrase}
              label="Your passphrase"
              saved={passphraseSaved}
              onSavedChange={setPassphraseSaved}
              confirmLabel="I've saved my passphrase somewhere safe."
            />
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={regeneratePassphrase}
                className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
              >
                <RefreshCw className="size-3.5" />
                Regenerate
              </button>
              <button
                type="button"
                onClick={() => setMode('own')}
                className="text-sm text-muted-foreground underline hover:text-foreground"
              >
                Choose my own
              </button>
            </div>
          </Field>
        ) : (
          <Field data-invalid={!!ownPasswordError}>
            <FieldLabel htmlFor="password">Password</FieldLabel>
            <PasswordInput
              id="password"
              autoComplete="new-password"
              aria-invalid={!!ownPasswordError}
              value={ownPassword}
              onChange={(e) => setOwnPassword(e.target.value)}
            />
            <PasswordStrengthMeter displayScore={displayScore} />
            {ownPasswordError ? (
              <FieldDescription className="text-destructive">{ownPasswordError}</FieldDescription>
            ) : null}
            <FieldDescription>
              A generated passphrase is stronger than most typed passwords. If you use your own,
              make it long and unique — there is no way to reset it if it&apos;s lost.{' '}
              <button
                type="button"
                onClick={() => setMode('generated')}
                className="underline hover:text-foreground"
              >
                Generate one instead
              </button>
            </FieldDescription>
          </Field>
        )}

        <Field>
          <Button type="button" className="w-full" disabled={!canContinueSetup} onClick={goConfirm}>
            Continue
          </Button>
        </Field>
      </FieldGroup>
    );
  }

  // --- step: confirm --------------------------------------------------------
  if (step === 'confirm') {
    return (
      <FieldGroup>
        <BackLink onClick={() => setStep('setup')} />
        <Field data-invalid={confirmError}>
          <FieldLabel htmlFor="confirm">Confirm your password</FieldLabel>
          <FieldDescription>Re-enter it to make sure you have it saved correctly.</FieldDescription>
          <PasswordInput
            id="confirm"
            autoComplete="new-password"
            autoFocus
            aria-invalid={confirmError}
            value={confirmInput}
            onChange={(e) => {
              setConfirmInput(e.target.value);
              if (confirmError) setConfirmError(false);
            }}
          />
          {confirmError ? (
            <FieldDescription className="text-destructive">
              That doesn&apos;t match. Check what you saved and try again.
            </FieldDescription>
          ) : null}
        </Field>
        <Field>
          <Button type="button" className="w-full" onClick={goRecovery}>
            Continue
          </Button>
        </Field>
      </FieldGroup>
    );
  }

  // --- step: recovery -------------------------------------------------------
  return (
    <FieldGroup>
      <BackLink onClick={() => setStep('confirm')} />
      <Field>
        <FieldLabel>Recovery code</FieldLabel>
        <FieldDescription>
          Save this recovery code somewhere safe. It&apos;s the only way back into your account if
          you ever lose your password.
        </FieldDescription>
        <ShowOnceSecret
          id="recovery-saved"
          secret={recoveryCode}
          label="Your recovery code"
          saved={recoverySaved}
          onSavedChange={setRecoverySaved}
          confirmLabel="I've saved my recovery code somewhere safe."
        />
        <button
          type="button"
          onClick={regenerateRecovery}
          className="inline-flex items-center gap-1.5 self-start text-sm text-muted-foreground hover:text-foreground"
        >
          <RefreshCw className="size-3.5" />
          Regenerate
        </button>
      </Field>

      <Field>
        <Button
          type="button"
          className="w-full"
          disabled={!recoverySaved || pending}
          onClick={() => submit(true)}
        >
          {pending ? 'Creating account…' : 'Create account'}
        </Button>
        <button
          type="button"
          onClick={() => submit(false)}
          disabled={pending}
          className="mt-1 text-sm text-muted-foreground underline hover:text-foreground disabled:opacity-50"
        >
          Skip for now — I&apos;ll set this up later
        </button>
        {submitError ? (
          <FieldDescription className="text-destructive">{submitError}</FieldDescription>
        ) : null}
      </Field>
    </FieldGroup>
  );
}

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="-ml-1 inline-flex items-center gap-1 self-start rounded text-sm text-muted-foreground hover:text-foreground"
    >
      <ChevronLeft className="size-4" />
      Back
    </button>
  );
}
