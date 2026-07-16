import { useAuth, useSignOut } from '@stxapps/web-react';
import { Button } from '@stxapps/web-ui/components/ui/button';

// The account block — durable identity, not operational sync state. The signed-in
// username used to live in the popup's SyncDetail, but that surface is for the live
// sync cycle (status/pending/last sync); the username never changes and reads better
// paired with the sign-out it scopes. Together they answer "who am I, and how do I
// leave?" — see docs/browser-extension.md (the extension owns its own sign-in).

export function AccountSection() {
  const { username } = useAuth();
  const signOut = useSignOut();

  return (
    <section>
      <h2 className="mt-0 mb-2 font-semibold">Account</h2>
      <div className="flex justify-between py-0.5 text-sm">
        <span>Username</span>
        <span>{username ?? '—'}</span>
      </div>

      <Button
        variant="outline"
        className="mt-4"
        disabled={signOut.isPending}
        onClick={() => signOut.mutate()}
      >
        {signOut.isPending ? 'Signing out…' : 'Sign out'}
      </Button>
    </section>
  );
}
