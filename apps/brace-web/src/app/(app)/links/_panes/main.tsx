'use client';

// The main pane: reads the paginated link query once and hands it to whichever
// layout the user picked in Settings → Misc (useSettings.linksLayout). Each layout
// owns its own scroll/virtualization, so this is a thin switch — it's the single
// place the data hook meets the layouts. It also mounts the bulk-edit toolbar
// (shown while the topbar's toggle holds `bulkEditing`) and the page-level
// dialogs the row menus + toolbar drive through view-state-provider (edit /
// delete-permanently): one instance each, OUTSIDE the virtualized rows, so a
// sync repaint can never unmount them mid-interaction.

import { useSettings } from '@stxapps/web-react';

import { BulkEditToolbar } from '../_components/bulk-edit-toolbar';
import { LinkDestroyConfirm } from '../_components/link-destroy-confirm';
import { LinkEditDialog } from '../_components/link-edit-dialog';
import { useLinks } from '../_hooks/use-links';
import { CardLayout } from '../_layouts/card-layout';
import { ListLayout } from '../_layouts/list-layout';
import type { LinkLayoutProps } from '../_layouts/shared';
import { TableLayout } from '../_layouts/table-layout';

const LAYOUTS: Record<string, (props: LinkLayoutProps) => React.ReactNode> = {
  list: ListLayout,
  card: CardLayout,
  table: TableLayout,
};

export function Main() {
  const { linksLayout } = useSettings();
  const { links, pinnedCount, hasMore, showMore, isLoading, hasPending, applyPending } = useLinks();

  const Layout = LAYOUTS[linksLayout];

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <BulkEditToolbar />
      <div className="min-h-0 flex-1">
        <Layout
          links={links}
          pinnedCount={pinnedCount}
          hasMore={hasMore}
          showMore={showMore}
          isLoading={isLoading}
          hasPending={hasPending}
          applyPending={applyPending}
        />
      </div>
      <LinkEditDialog />
      <LinkDestroyConfirm />
    </main>
  );
}
