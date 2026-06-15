import { Main } from './main';
import { SettingsPageProvider } from './settings-page-provider';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';

// The settings page. A server component that just composes the client pieces: the
// two-pane frame (full-height sidebar on the left; a topbar above the scrolling
// main pane on the right), all wrapped in SettingsPageProvider so the sidebar
// (sets section), topbar (title + close), and main (renders the section) share
// one state.
//
// No 'use client' here — pure composition of client components, no hooks of its
// own. The (app) layout already gates the page behind auth + first sync.
export default function SettingsPage() {
  return (
    <SettingsPageProvider>
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar />
          <Main />
        </div>
      </div>
    </SettingsPageProvider>
  );
}
