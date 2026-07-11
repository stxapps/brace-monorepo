// Ambient declaration for side-effect CSS imports (e.g. `import '../../global.css'`).
// Uniwind consumes global.css through the Metro transform at build time; TypeScript
// only needs to know the module exists. uniwind-env.d.ts is generated and can't hold
// this, so it lives here.
declare module '*.css';
