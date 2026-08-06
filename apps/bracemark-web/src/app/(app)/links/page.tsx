import { PreviewsPrompt } from './_components/previews-prompt';
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
// Below `md` it is a ONE-pane frame: the rail hides itself and the topbar's
// title summons it as a drawer instead (see those two files, and the settings
// layout — the same trade at the same breakpoint). Nothing here needs to know:
// the rail is `hidden md:flex`, so the main column simply takes the width it
// gives up, and no JS measures a breakpoint the CSS already matched.
//
// `h-dvh`, not `h-screen`: on mobile browsers `100vh` is the viewport with the
// URL bar RETRACTED, so a `h-screen` app shell hangs its bottom edge behind the
// bar until you scroll — and this frame is exactly one screen tall by design
// (the panes scroll inside it), so that bottom edge is the list's last row and
// the page has no scroll of its own to bring it back. The dynamic unit tracks
// the bar. The (app) layout's wrapper matches it.
//
// No 'use client' here — this is pure composition of client components, with no
// hooks or handlers of its own. The provider owns its own Suspense boundary (it
// reads the selection from the URL via useSearchParams), so this stays a plain
// server component. The (app) layout already gates the page behind auth + first
// sync, so by the time it renders the local store is ready to read.
export default function LinksPage() {
  return (
    <LinksPageProvider>
      <div className="flex h-dvh overflow-hidden">
        <Sidebar />
        <LinksViewStateProvider>
          <div className="flex min-w-0 flex-1 flex-col">
            <Topbar />
            {/* The first-run link-previews offer — renders null unless previews are
                still off AND links are actually waiting (see the component). Above
                Main so it reads as chrome rather than a row, and outside it so a
                layout switch or a locked-list swap can't remount it. */}
            <PreviewsPrompt />
            <Main />
          </div>
        </LinksViewStateProvider>
      </div>
    </LinksPageProvider>
  );
}
