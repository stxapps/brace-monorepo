'use client';

// The Account settings section: who you're signed in as, and the account-level
// danger zone — Delete account. Mirrors the Data section's shape (an overview
// whose rows open focused screens as in-section VIEW STATE, self-contained in
// `_account/`), and deliberately does NOT duplicate sign-out (the topbar owns
// that).
//
// Delete account is the FULL teardown — every synced object, every session, the
// account itself — distinct from Data → "Delete all data" (data only, account
// survives). It's guarded by a fresh password re-entry, not just the session:
// the server refuses the call without a proof signed by the password-derived
// key, so the form here collects the password and useDeleteAccount runs the
// door-fetch → unwrap → sign → POST sequence (docs/data-lifecycle.md). A live
// (renewing or dunning) subscription blocks deletion server-side; the view
// pre-warns from the same entitlements read and points at the Subscription
// section, where Paddle's portal handles cancellation.

import { useState } from 'react';
import { ChevronLeft, ChevronRight, CircleAlert, Loader2, Trash2, UserX } from 'lucide-react';
import Link from 'next/link';

import {
  InvalidCredentialsError,
  SubscriptionActiveError,
  useAuth,
  useDeleteAccount,
  useEntitlements,
} from '@stxapps/web-react';
import { Button } from '@stxapps/web-ui/components/ui/button';
import { Checkbox } from '@stxapps/web-ui/components/ui/checkbox';
import { Input } from '@stxapps/web-ui/components/ui/input';
import { Label } from '@stxapps/web-ui/components/ui/label';

type AccountView = 'overview' | 'delete';

// One tappable row on the overview that opens a sub-view — same presentation as
// the Data section's ActionRow (each section keeps its own copy; they're
// self-contained by design).
function ActionRow({
  icon,
  title,
  description,
  onClick,
  destructive,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-lg border border-border p-4 text-left transition-colors hover:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <span className={`shrink-0 ${destructive ? 'text-destructive' : 'text-muted-foreground'}`}>
        {icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={`font-medium ${destructive ? 'text-destructive' : ''}`}>{title}</span>
        <span className="text-sm text-muted-foreground">{description}</span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

// The back link shared by every sub-view — returns to the overview.
function BackLink({ onBack }: { onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="mb-4 -ml-1 inline-flex items-center gap-1 rounded text-sm text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <ChevronLeft className="size-4" />
      Account
    </button>
  );
}

function DeleteAccountView({ onBack }: { onBack: () => void }) {
  const { subscription } = useEntitlements();
  const { mutate, isPending, error, reset } = useDeleteAccount();
  const [password, setPassword] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  // Reveal the "tick the box first" nudge only after a submit without the box.
  const [nudge, setNudge] = useState(false);

  // The same rule the server enforces with its 409: a subscription that would
  // keep billing (renewing, or in dunning) must be canceled first. Pre-warning
  // from the cached entitlements read spares the user typing their password
  // into a call that's going to be refused — but the SERVER check is the gate;
  // this is UX, and a stale cache just means the 409 lands below instead.
  const subscriptionBlocks = subscription.status === 'grace' || subscription.willRenew;

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (isPending) return;
    if (!confirmed) {
      setNudge(true);
      return;
    }
    setNudge(false);
    mutate({ password });
  };

  const errorText =
    error == null
      ? null
      : error instanceof SubscriptionActiveError
        ? 'Your subscription is still active. Cancel it first, then come back — your data stays put until you do.'
        : error instanceof InvalidCredentialsError
          ? 'Incorrect password.'
          : `Something went wrong: ${error.message} Nothing was deleted — please try again.`;

  return (
    <div>
      <BackLink onBack={onBack} />
      <h2 className="text-xl font-semibold">Delete account</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Permanently delete your account and everything in it: all your data on all your devices,
        your account keys, and every signed-in session.
      </p>
      <p className="mt-3 text-sm text-muted-foreground">
        Your username stays reserved and can&apos;t be registered again — by you or anyone else. If
        you have a canceled subscription with paid time remaining, that time is forfeited. Consider
        exporting your data first (Settings → Data).
      </p>
      <p className="mt-3 text-sm font-medium text-destructive">
        This action cannot be undone. There is no grace period and no recovery.
      </p>

      {subscriptionBlocks && (
        <p className="mt-4 flex items-start gap-2 rounded-lg border border-border p-3 text-sm text-muted-foreground">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          <span>
            You have an active subscription. Cancel it in{' '}
            <Link
              href="/settings/subscription"
              className="underline hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              Subscription settings
            </Link>{' '}
            first — deleting the account doesn&apos;t stop the billing.
          </span>
        </p>
      )}

      <form onSubmit={onSubmit} className="mt-6">
        {/* Fresh proof, not just the session: the server only accepts this call
            signed by the password-derived key, so the password is required here
            even though you're signed in. */}
        <div className="flex max-w-sm flex-col gap-2">
          <Label htmlFor="delete-account-password">Confirm your password</Label>
          <Input
            id="delete-account-password"
            type="password"
            autoComplete="current-password"
            value={password}
            disabled={isPending}
            onChange={(event) => {
              setPassword(event.target.value);
              if (error) reset();
            }}
          />
        </div>

        <Label
          htmlFor="delete-account-confirm"
          className="mt-4 flex items-start gap-3 rounded-lg border border-border p-3"
        >
          <Checkbox
            id="delete-account-confirm"
            checked={confirmed}
            disabled={isPending}
            onCheckedChange={(v) => {
              setConfirmed(v === true);
              setNudge(false);
            }}
            className="mt-0.5"
          />
          <span className="text-sm font-normal">
            Yes, I understand my account and all my data will be permanently deleted, with no way
            back.
          </span>
        </Label>

        {nudge && (
          <p className="mt-2 text-sm text-destructive">Please tick the box above to confirm.</p>
        )}

        <div className="mt-6">
          <Button
            type="submit"
            variant="destructive"
            disabled={isPending || password.length === 0 || subscriptionBlocks}
          >
            {isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Trash2 className="size-4" />
            )}
            {isPending ? 'Deleting account…' : 'Delete account forever'}
          </Button>
        </div>

        {errorText && (
          <p className="mt-3 flex items-start gap-2 text-sm text-destructive">
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
            <span className="wrap-break-words">{errorText}</span>
          </p>
        )}
      </form>
    </div>
  );
}

export function AccountSection() {
  const { username } = useAuth();
  const [view, setView] = useState<AccountView>('overview');

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      {view === 'overview' ? (
        <>
          <h2 className="text-xl font-semibold">Account</h2>
          <p className="mt-1 mb-6 text-sm text-muted-foreground">
            Your account is your username and password — no email, nothing else on file.
          </p>

          <div className="rounded-lg border border-border p-4">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm font-medium">Username</span>
              <span className="truncate text-sm text-muted-foreground">{username}</span>
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-3">
            <ActionRow
              icon={<UserX className="size-5" />}
              title="Delete account"
              description="Permanently delete your account and all your data."
              onClick={() => setView('delete')}
              destructive
            />
          </div>
        </>
      ) : (
        <DeleteAccountView onBack={() => setView('overview')} />
      )}
    </div>
  );
}
