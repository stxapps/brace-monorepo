import * as React from 'react';
import { Pressable, View } from 'react-native';
import { ChevronLeft, RefreshCw } from 'lucide-react-native';

import { useCreateAccount, UsernameTakenError } from '@stxapps/expo-react';
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

import { Button } from '../../components/ui/button';
import { Icon } from '../../components/ui/icon';
import { Input } from '../../components/ui/input';
import { Text } from '../../components/ui/text';
import { cn } from '../../lib/utils';
import { PasswordInput } from './password-input';
import { PasswordStrengthMeter, usePasswordStrength } from './password-strength';
import { ShowOnceSecret } from './show-once-secret';

// The "Secure your account" ceremony — the native port of web-ui's
// components/auth/create-account-form.tsx (see that file and docs/account.md
// for the full rationale). Because the account is a password-derived wallet —
// no email, no server-side reset — the safe path is the DEFAULT path: a
// generated ~77-bit passphrase, shown once wallet-style, with a "type my own"
// escape hatch gated by a zxcvbn strength floor. Three steps:
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
  // Lazy initializer, unlike web's generate-on-mount effect: that dance exists
  // so SSR and client hydration agree, and native has no SSR.
  const [passphrase, setPassphrase] = React.useState(() => generatePassphrase());
  const [passphraseSaved, setPassphraseSaved] = React.useState(false);
  const [ownPassword, setOwnPassword] = React.useState('');

  const [confirmInput, setConfirmInput] = React.useState('');
  const [confirmError, setConfirmError] = React.useState(false);

  const [recoveryCode, setRecoveryCode] = React.useState('');
  const [recoverySaved, setRecoverySaved] = React.useState(false);

  const [submitError, setSubmitError] = React.useState<string | null>(null);

  // Mint the recovery code the first time the user reaches that step.
  React.useEffect(() => {
    if (step === 'recovery' && !recoveryCode) setRecoveryCode(generateRecoveryCode());
  }, [step, recoveryCode]);

  const password = mode === 'generated' ? passphrase : ownPassword;

  // Live username validation + availability (the hook debounces + gates on a valid
  // format internally). Parse once and reuse the schema's own message so the
  // specific rule that failed (length, charset, or reserved name) shows through
  // instead of one catch-all string.
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

  const passwordChosen = mode === 'generated' ? passphraseSaved : ownPasswordOk;
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
            ? 'Too predictable — add a few more words, or generate a password instead.'
            : null;

    return (
      <View className="gap-6">
        <View className="gap-2">
          <Text className="text-sm font-medium">Username</Text>
          <Input
            autoComplete="username-new"
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            className={cn(usernameError && 'border-destructive')}
            value={username}
            onChangeText={(text) => {
              setUsername(text);
              setUsernameTaken(false);
            }}
          />
          {usernameError ? (
            <Text className="text-destructive text-sm">{usernameError}</Text>
          ) : usernameValid && availability.isFetching ? (
            <Text className="text-muted-foreground text-sm">Checking availability…</Text>
          ) : usernameValid && usernameAvailable ? (
            <Text className="text-muted-foreground text-sm">Username is available</Text>
          ) : null}
        </View>

        {mode === 'generated' ? (
          <View className="gap-2">
            <Text className="text-sm font-medium">Your password</Text>
            <Text className="text-muted-foreground text-sm">
              We generated a strong password for you. Save it in your password manager — there is no
              way to reset it if it&apos;s lost.
            </Text>
            <ShowOnceSecret
              secret={passphrase}
              label="Your password"
              saved={passphraseSaved}
              onSavedChange={setPassphraseSaved}
              confirmLabel="I've saved my password somewhere safe."
            />
            <View className="flex-row items-center justify-between">
              <Pressable
                onPress={regeneratePassphrase}
                className="flex-row items-center gap-1.5 py-1"
              >
                <Icon as={RefreshCw} className="text-muted-foreground size-3.5" />
                <Text className="text-muted-foreground text-sm">Regenerate</Text>
              </Pressable>
              <Pressable onPress={() => setMode('own')} className="py-1">
                <Text className="text-muted-foreground text-sm underline">Choose my own</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View className="gap-2">
            <Text className="text-sm font-medium">Password</Text>
            <PasswordInput
              autoComplete="new-password"
              className={cn(ownPasswordError && 'border-destructive')}
              value={ownPassword}
              onChangeText={setOwnPassword}
            />
            <PasswordStrengthMeter displayScore={displayScore} />
            {ownPasswordError ? (
              <Text className="text-destructive text-sm">{ownPasswordError}</Text>
            ) : null}
            <Text className="text-muted-foreground text-sm">
              A password of random words is stronger than most passwords you&apos;d type. If you use
              your own, make it long and unique — there is no way to reset it if it&apos;s lost.
            </Text>
            <Pressable onPress={() => setMode('generated')} className="self-start py-1">
              <Text className="text-muted-foreground text-sm underline">Generate one instead</Text>
            </Pressable>
          </View>
        )}

        <Button disabled={!canContinueSetup} onPress={goConfirm}>
          <Text>Continue</Text>
        </Button>
      </View>
    );
  }

  // --- step: confirm --------------------------------------------------------
  if (step === 'confirm') {
    return (
      <View className="gap-6">
        <BackLink onPress={() => setStep('setup')} />
        <View className="gap-2">
          <Text className="text-sm font-medium">Confirm your password</Text>
          <Text className="text-muted-foreground text-sm">
            Re-enter it to make sure you have it saved correctly.
          </Text>
          <PasswordInput
            autoComplete="new-password"
            autoFocus
            className={cn(confirmError && 'border-destructive')}
            value={confirmInput}
            onChangeText={(text) => {
              setConfirmInput(text);
              if (confirmError) setConfirmError(false);
            }}
          />
          {confirmError ? (
            <Text className="text-destructive text-sm">
              That doesn&apos;t match. Check what you saved and try again.
            </Text>
          ) : null}
        </View>
        <Button onPress={goRecovery}>
          <Text>Continue</Text>
        </Button>
      </View>
    );
  }

  // --- step: recovery -------------------------------------------------------
  return (
    <View className="gap-6">
      <BackLink onPress={() => setStep('confirm')} />
      <View className="gap-2">
        <Text className="text-sm font-medium">Recovery code</Text>
        <Text className="text-muted-foreground text-sm">
          Save this recovery code somewhere safe. It&apos;s the only way back into your account if
          you ever lose your password.
        </Text>
        <ShowOnceSecret
          secret={recoveryCode}
          label="Your recovery code"
          saved={recoverySaved}
          onSavedChange={setRecoverySaved}
          confirmLabel="I've saved my recovery code somewhere safe."
        />
        <Pressable
          onPress={regenerateRecovery}
          className="flex-row items-center gap-1.5 self-start py-1"
        >
          <Icon as={RefreshCw} className="text-muted-foreground size-3.5" />
          <Text className="text-muted-foreground text-sm">Regenerate</Text>
        </Pressable>
      </View>

      <View className="gap-1">
        <Button disabled={!recoverySaved || pending} onPress={() => submit(true)}>
          <Text>{pending ? 'Creating account…' : 'Create account'}</Text>
        </Button>
        <Pressable
          onPress={() => submit(false)}
          disabled={pending}
          className={cn('items-center py-2', pending && 'opacity-50')}
        >
          <Text className="text-muted-foreground text-sm underline">
            Skip for now — I&apos;ll set this up later
          </Text>
        </Pressable>
        {submitError ? <Text className="text-destructive text-sm">{submitError}</Text> : null}
      </View>
    </View>
  );
}

function BackLink({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} className="flex-row items-center gap-1 self-start py-1">
      <Icon as={ChevronLeft} className="text-muted-foreground size-4" />
      <Text className="text-muted-foreground text-sm">Back</Text>
    </Pressable>
  );
}
