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
