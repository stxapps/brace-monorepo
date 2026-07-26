jest.mock('expo/src/winter/ImportMetaRegistry', () => ({
  ImportMetaRegistry: {
    get url() {
      return null;
    },
  },
}));

// These ship official jest mocks — the real modules need a native runtime.
jest.mock('@react-native-community/netinfo', () =>
  require('@react-native-community/netinfo/jest/netinfo-mock.js'),
);
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
jest.mock('react-native-keyboard-controller', () =>
  require('react-native-keyboard-controller/jest'),
);

// gesture-handler can't be imported for real here: its JS pulls React Native's
// internal renderer (RNRenderer), which asserts that `react` and
// `react-native-renderer` are the exact same version — the hoisted react is
// ahead of the one RN 0.81 bundles, so merely importing it fails the suite. A
// gesture needs a native runtime anyway, so the stub keeps only the shape the
// settings tables' drag layer builds against (drag-sort.tsx): a chainable
// builder, and a detector that renders its child. Rendering a draggable row is
// then testable; the gesture itself is device-only.
jest.mock('react-native-gesture-handler', () => {
  const gesture = new Proxy({}, { get: (_target, _prop) => () => gesture }) as Record<
    string,
    unknown
  >;
  return {
    Gesture: { Pan: () => gesture, Tap: () => gesture, LongPress: () => gesture },
    GestureDetector: ({ children }: { children: React.ReactNode }) => children,
    GestureHandlerRootView: ({ children }: { children: React.ReactNode }) => children,
  };
});

// Uniwind's className→style bridge runs in the Metro transform / native
// runtime; under jest the HOC is an identity wrapper (className is ignored), and
// the `Uniwind` runtime (ThemeProvider's `setTheme`) is a no-op stub.
jest.mock('uniwind', () => ({
  withUniwind: (Component: unknown) => Component,
  Uniwind: { setTheme: jest.fn() },
}));

if (typeof global.structuredClone === 'undefined') {
  global.structuredClone = (object) => JSON.parse(JSON.stringify(object));
}
