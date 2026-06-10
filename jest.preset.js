const nxPreset = require('@nx/jest/preset').default;

// passWithNoTests: packages can be generated before they have specs; a project
// with zero test files should be green, not a hard jest exit-1 (was failing
// `npm run test` for the not-yet-tested libs).
module.exports = { ...nxPreset, passWithNoTests: true };
