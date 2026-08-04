// The registered share ROOT — what both native hosts mount (docs/share-sheet.md):
// iOS's extension registers it as 'shareExtension' (index.share.js), Android's
// ShareActivity as 'bracemarkShare' (index.js). It only normalizes the host's
// initial props into the one payload shape and renders the screen; keeping it
// this thin is what lets the two hosts share every pixel below it.

import { useMemo } from 'react';

import { ShareScreen } from './share-screen';
import { payloadFromInitialProps, type ShareInitialProps } from './share-url';

// Uniwind wants its CSS imported once at the top of the rendered tree; the
// root _layout does that for the router app, but BOTH share hosts mount this
// root without the router tree (Android's bracemarkShare in the main bundle, the
// iOS extension bundle), so the share tree carries its own import. Double
// evaluation with _layout's is harmless — same module, evaluated once.
import '../../../global.css';

// What this tree may import from `components/ui` — the iOS side of the fence.
// Android's bracemarkShare rides the MAIN bundle (index.js, which already imports
// expo-router/entry), so every ui component is resident there and costs nothing.
// iOS is the separate `index.share.js` bundle, where docs/share-sheet.md's rule
// applies: everything the entry transitively imports is init cost paid on every
// cold share. That splits components/ui in two, by INIT cost rather than bytes:
//
//   OK    text, input, button, checkbox, icon — cn/cva/@rn-primitives/slot,
//         all pure functions with no module-level side effects.
//   AVOID dialog, dropdown-menu, alert-dialog, native-only-animated-view —
//         they pull react-native-reanimated and @rn-primitives/portal, i.e. a
//         native runtime initialized on every cold share. The sheet is one
//         screen with two pickers; it has no need for portals or modals.
//
// The split only HOLDS because components/ui has no barrel index.ts and Metro
// does not meaningfully tree-shake: each import names its own file, so the
// graph stays tight. If a barrel is ever added, importing through it here would
// silently drag reanimated into the extension bundle.

export function ShareRoot(props: ShareInitialProps) {
  const payload = useMemo(() => payloadFromInitialProps(props), [props]);
  return <ShareScreen url={payload.url} title={payload.title} />;
}
