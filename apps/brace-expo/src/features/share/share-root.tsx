// The registered share ROOT — what both native hosts mount (docs/share-sheet.md):
// iOS's extension registers it as 'shareExtension' (index.share.js), Android's
// ShareActivity as 'braceShare' (index.js). It only normalizes the host's
// initial props into the one payload shape and renders the screen; keeping it
// this thin is what lets the two hosts share every pixel below it.

import { useMemo } from 'react';

import { ShareScreen } from './share-screen';
import { payloadFromInitialProps, type ShareInitialProps } from './share-url';

// Uniwind wants its CSS imported once at the top of the rendered tree; the
// root _layout does that for the router app, but BOTH share hosts mount this
// root without the router tree (Android's braceShare in the main bundle, the
// iOS extension bundle), so the share tree carries its own import. Double
// evaluation with _layout's is harmless — same module, evaluated once.
import '../../../global.css';

export function ShareRoot(props: ShareInitialProps) {
  const payload = useMemo(() => payloadFromInitialProps(props), [props]);
  return <ShareScreen url={payload.url} title={payload.title} />;
}
