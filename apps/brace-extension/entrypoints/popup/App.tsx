import { useEffect, useState } from 'react';

import { Button } from '@stxapps/web-ui/components/ui/button';

import type { SavedPage, SavePageResponse } from '@/entrypoints/background';

interface ActiveTab {
  url: string;
  title: string;
}

type Status =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; page: SavedPage }
  | { kind: 'error'; message: string };

function App() {
  const [tab, setTab] = useState<ActiveTab | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  // Show what we're about to save as soon as the popup opens.
  useEffect(() => {
    browser.tabs
      .query({ active: true, currentWindow: true })
      .then(([active]) => setTab({ url: active?.url ?? '', title: active?.title ?? '' }));
  }, []);

  async function handleSave() {
    setStatus({ kind: 'saving' });
    try {
      const res: SavePageResponse = await browser.runtime.sendMessage({
        type: 'SAVE_PAGE',
      });
      if (res.ok) setStatus({ kind: 'saved', page: res.page });
      else setStatus({ kind: 'error', message: res.error });
    } catch (err) {
      setStatus({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return (
    <div className="popup">
      <h1 className="popup-title">Save bookmark</h1>

      <div className="tab-info">
        <p className="tab-title">{tab?.title || 'Loading…'}</p>
        <p className="tab-url">{tab?.url}</p>
      </div>

      <Button onClick={handleSave} disabled={status.kind === 'saving'}>
        {status.kind === 'saving' ? 'Saving…' : 'Save this page'}
      </Button>

      {status.kind === 'error' && <p className="status error">{status.message}</p>}

      {status.kind === 'saved' && (
        <div className="status">
          <p>Saved ✓ ({Math.round(status.page.html.length / 1024)} KB archived)</p>
          <img className="screenshot" src={status.page.screenshot} alt="Page screenshot" />
        </div>
      )}
    </div>
  );
}

export default App;
