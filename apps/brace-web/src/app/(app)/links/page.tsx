import { LinksPageProvider } from './_contexts/page-provider';
import { LinksViewStateProvider } from './_contexts/view-state-provider';
import { Main } from './_panes/main';
import { Sidebar } from './_panes/sidebar';
import { Topbar } from './_panes/topbar';

// The links page. A server component that just composes the client pieces: the
// two-pane frame (full-height sidebar on the left; a topbar above the scrolling
// main pane on the right), all wrapped in LinksPageProvider so the sidebar (sets
// selection), topbar (layout switch + selection name), and main (reads both)
// share one state. LinksViewStateProvider wraps the topbar + main column (not
// the sidebar): the topbar's bulk-edit toggle writes the same view state the
// main pane's rows and dialogs read.
//
// No 'use client' here — this is pure composition of client components, with no
// hooks or handlers of its own. The provider owns its own Suspense boundary (it
// reads the selection from the URL via useSearchParams), so this stays a plain
// server component. The (app) layout already gates the page behind auth + first
// sync, so by the time it renders the local store is ready to read.
export default function LinksPage() {
  return (
    <LinksPageProvider>
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        <LinksViewStateProvider>
          <div className="flex min-w-0 flex-1 flex-col">
            <Topbar />
            <Main />
          </div>
        </LinksViewStateProvider>
      </div>
    </LinksPageProvider>
  );
}
