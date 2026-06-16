// node_modules packages that ship raw ESM (`"type": "module"`, bare `export`)
// and therefore must be transpiled by jest instead of ignored. Jest skips all
// of node_modules by default, so every jest project that transitively imports
// one of these needs it whitelisted in `transformIgnorePatterns`.
//
// Single source of truth, consumed by:
//   - jest.preset.js          → all preset-based packages (shared, react, …)
//   - apps/brace-web/jest.config.cts → next/jest (overrides preset, patched there)
//
// vitest-based projects (brace-api) don't need this — esbuild handles ESM.
module.exports = ['fractional-indexing'];
