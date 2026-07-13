/// <reference types="jest" />
/// <reference types="node" />

// ESM-only node_modules that must be transpiled (single source of truth, shared
// with jest.preset.js / brace-web). jest-expo forces us to override
// transformIgnorePatterns for its RN allowlist, so we can't inherit the preset's
// value — interpolate the shared list into the allowlist instead of hardcoding.
const esmNodeModules = require('../../jest.esm-packages.cjs');

module.exports = {
  displayName: '@stxapps/brace-expo',
  preset: 'jest-expo',
  moduleFileExtensions: ['ts', 'js', 'html', 'tsx', 'jsx'],
  setupFilesAfterEnv: ['<rootDir>/src/testing/setup.ts'],
  // Never scan build output: `typecheck` (tsc --build) emits declaration files
  // under out-tsc/, and a `.spec.d.ts` there matches jest's default testMatch —
  // running it as an empty suite fails with "must contain at least one test".
  testPathIgnorePatterns: ['/node_modules/', '/out-tsc/'],
  moduleNameMapper: {
    '[.]svg$': '@nx/expo/plugins/jest/svg-mock',
    '[.]css$': '<rootDir>/src/testing/css-mock.js',
  },
  transform: {
    '[.][jt]sx?$': [
      'babel-jest',
      {
        configFile: __dirname + '/.babelrc.js',
      },
    ],
    '^.+[.](bmp|gif|jpg|jpeg|mp4|png|psd|svg|webp|ttf|otf|m4v|mov|mp4|mpeg|mpg|webm|aac|aiff|caf|m4a|mp3|wav|html|pdf|obj)$':
      require.resolve('jest-expo/src/preset/assetFileTransformer.js'),
  },
  coverageDirectory: '../../coverage/apps/brace-expo',
  // jest-expo's preset only babel-transforms an allowlist of node_modules;
  // extend it with the ESM-only deps (jest.esm-packages.cjs — e.g.
  // fractional-indexing via @stxapps/shared's barrel, @noble/ed25519 via
  // @stxapps/expo-crypto — same block as @stxapps/expo-react's jest config), or
  // their `export` syntax breaks require(). Metro has no such allowlist, so
  // runtime needs nothing.
  transformIgnorePatterns: [
    `/node_modules/(?!(.pnpm|react-native|@react-native|@react-native-community|expo|@expo|@expo-google-fonts|react-navigation|@react-navigation|@sentry/react-native|native-base|${esmNodeModules.join('|')}))`,
    '/node_modules/react-native-reanimated/plugin/',
  ],
};
