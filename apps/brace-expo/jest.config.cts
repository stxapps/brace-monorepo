/// <reference types="jest" />
/// <reference types="node" />
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
};
