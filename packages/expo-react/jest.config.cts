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
};
