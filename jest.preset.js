const nxPreset = require('@nx/jest/preset').default;
const esmNodeModules = require('./jest.esm-packages.cjs');

// passWithNoTests: packages can be generated before they have specs; a project
// with zero test files should be green, not a hard jest exit-1 (was failing
// `npm run test` for the not-yet-tested libs).
module.exports = {
  ...nxPreset,
  passWithNoTests: true,
  // Transpile ESM-only deps (see jest.esm-packages.cjs) instead of ignoring
  // them. Inherited by every preset-based package; a package that sets its own
  // `transformIgnorePatterns` would override this, so don't.
  transformIgnorePatterns: [
    `/node_modules/(?!(?:${esmNodeModules.join('|')})/)`,
    '\\.pnp\\.[^\\/]+$',
  ],
};
