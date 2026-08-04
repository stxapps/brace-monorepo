import { Sidebar } from './_panes/sidebar';
import { Topbar } from './_panes/topbar';

// Shared chrome for every settings section route (`/settings/[section]`): the
// two-pane frame — a full-height sidebar on the left; a topbar above the
// scrolling main pane on the right. The active section's content (the matching
// page) renders into `children`.
//
// The active section lives in the URL PATH now (`/settings/lists`, …), not React
// state — so a section is a real, linkable destination: open `/settings/lists`
// straight from the links page, manage your lists, and Back returns you to
// organizing. That's why there's no provider anymore — the sidebar reads the
// active section from the pathname, each section page reads it from its route
// param, and the URL is the single source of truth.
//
// No 'use client' here — pure composition of client components. The (app) layout
// already gates this behind auth + first sync.
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
