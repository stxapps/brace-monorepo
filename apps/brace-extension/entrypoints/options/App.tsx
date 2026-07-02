import { useAuth, useSignOut } from '@stxapps/web-react';
import { Button } from '@stxapps/web-ui/components/ui/button';

import { ThemeSection } from './ThemeSection';

// The Settings page — durable configuration only: a theme picker (the one synced
// setting that applies here — see ThemeSection) plus sign-out. Operational state lives
// in the toolbar popup: sync status (and its detail view) is the popup's SyncPill /
// SyncDetail, and extraction progress is in brace-web's Settings → Extraction (the app
// that runs the extraction loop). This page holds nothing that changes on its own.
function App() {
  const { status } = useAuth();

  if (status === 'loading') {
    return <div className="mx-auto flex w-115 max-w-full flex-col gap-5 p-6">Loading…</div>;
  }
  if (status !== 'authenticated') {
    return (
      <div className="mx-auto flex w-115 max-w-full flex-col gap-5 p-6">
        <p>Sign in from the toolbar popup to manage settings.</p>
      </div>
    );
  }
  return <AuthedApp />;
}

function AuthedApp() {
  const signOut = useSignOut();

  return (
    <div className="mx-auto flex w-115 max-w-full flex-col gap-5 p-6">
      <h1 className="m-0 text-base font-semibold">Brace — Settings</h1>

      <ThemeSection />

      <Button variant="outline" disabled={signOut.isPending} onClick={() => signOut.mutate()}>
        {signOut.isPending ? 'Signing out…' : 'Sign out'}
      </Button>
    </div>
  );
}

export default App;
