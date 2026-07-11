/// <reference types="jest" />
/// <reference types="node" />
module.exports = {
  displayName: '@stxapps/expo-react',
  preset: 'jest-expo',
  moduleFileExtensions: ['ts', 'js', 'html', 'tsx', 'jsx'],
  setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
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
  // extend it with fractional-indexing (ESM-only, reached via @stxapps/shared's
  // barrel), or its `export` syntax breaks require(). Metro has no such
  // allowlist, so runtime needs nothing.
  transformIgnorePatterns: [
    '/node_modules/(?!(.pnpm|react-native|@react-native|@react-native-community|expo|@expo|@expo-google-fonts|react-navigation|@react-navigation|@sentry/react-native|native-base|fractional-indexing))',
    '/node_modules/react-native-reanimated/plugin/',
  ],
};
