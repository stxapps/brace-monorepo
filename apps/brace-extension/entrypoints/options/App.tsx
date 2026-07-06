import { useAuth } from '@stxapps/web-react';

import { AccountSection } from './AccountSection';
import { ThemeSection } from './ThemeSection';

// The Settings page — durable configuration only: the signed-in account (username +
// sign-out) plus a theme picker (the one synced setting that applies here — see
// ThemeSection). Operational state lives in the toolbar popup: sync status (and its
// detail view) is the popup's SyncPill / SyncDetail, and extraction progress is in
// brace-web's Settings → Extraction (the app that runs the extraction loop). This page
// holds nothing that changes on its own.
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
  return (
    <div className="mx-auto flex w-115 max-w-full flex-col gap-5 p-6">
      <h1 className="text-base font-semibold">Settings</h1>

      <AccountSection />

      <ThemeSection />
    </div>
  );
}

export default App;
