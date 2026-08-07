// Ambient types for `node:sqlite`, covering only the slice node-sqlite.ts uses.
//
// The workspace pins `@types/node` at 20.x, which predates the module entirely
// (it landed in Node 22.5) — so without this the shim doesn't typecheck. A local
// declaration is deliberately preferred over bumping `@types/node`, which is a
// workspace-wide change for the sake of one test helper.
//
// DELETE THIS FILE when `@types/node` moves to >= 22: the real declarations will
// then conflict with these, which is the intended signal to remove them.
//
// NOT named `node-sqlite.d.ts`: TypeScript drops a `foo.d.ts` from `include`
// when `foo.ts` sits beside it (it assumes the declaration is that file's build
// output), which silently takes these declarations out of the program.

declare module 'node:sqlite' {
  export class StatementSync {
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
    run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
    setReturnArrays(enabled: boolean): void;
  }

  export class DatabaseSync {
    constructor(location: string);
    prepare(sql: string): StatementSync;
    exec(sql: string): void;
    close(): void;
  }
}
