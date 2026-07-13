/// <reference types="jest" />
/// <reference types="node" />

// ESM-only node_modules that must be transpiled (single source of truth, shared
// with jest.preset.js / brace-web). jest-expo forces us to override
// transformIgnorePatterns for its RN allowlist, so we can't inherit the preset's
// value — interpolate the shared list into the allowlist instead of hardcoding.
const esmNodeModules = require('../../jest.esm-packages.cjs');

module.exports = {
  displayName: '@stxapps/expo-react',
  preset: 'jest-expo',
  moduleFileExtensions: ['ts', 'js', 'html', 'tsx', 'jsx'],
  setupFilesAfterEnv: ['<rootDir>/src/testing/setup.ts'],
  transform: {
    '[.][jt]sx?$': [
      'babel-jest',
      {
        configFile: __dirname + '/.babelrc.cjs',
      },
    ],
  },
  coverageDirectory: 'test-output/jest/coverage',
  // jest-expo's preset only babel-transforms an allowlist of node_modules;
  // extend it with the ESM-only deps (jest.esm-packages.cjs — e.g.
  // fractional-indexing via @stxapps/shared's barrel, @noble/ed25519 via
  // @stxapps/expo-crypto), or their `export` syntax breaks require(). Metro has
  // no such allowlist, so runtime needs nothing.
  transformIgnorePatterns: [
    `/node_modules/(?!(.pnpm|react-native|@react-native|@react-native-community|expo|@expo|@expo-google-fonts|react-navigation|@react-navigation|@sentry/react-native|native-base|${esmNodeModules.join('|')}))`,
    '/node_modules/react-native-reanimated/plugin/',
  ],
};
