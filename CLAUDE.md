<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

## General Guidelines for working with Nx

- For navigating/exploring the workspace, invoke the `nx-workspace` skill first - it has patterns for querying projects, targets, and dependencies
- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- Prefix nx commands with the workspace's package manager (e.g., `pnpm nx build`, `npm exec nx test`) - avoids using globally installed CLI
- You have access to the Nx MCP server and its tools, use them to help the user
- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file - proceed without it if unavailable.
- NEVER guess CLI flags - always check nx_docs or `--help` first when unsure

## Scaffolding & Generators

- For scaffolding tasks (creating apps, libs, project structure, setup), ALWAYS invoke the `nx-generate` skill FIRST before exploring or calling MCP tools

## When to use nx_docs

- USE for: advanced config options, unfamiliar flags, migration guides, plugin configuration, edge cases
- DON'T USE for: basic generator syntax (`nx g @nx/react:app`), standard commands, things you already know
- The `nx-generate` skill handles generator discovery internally - don't call nx_docs just to look up generator syntax

<!-- nx configuration end-->

# Architecture

- Packages: `@stxapps/{shared,react,web-ui,web-crypto,web-react,expo-crypto,expo-react}`. Apps: `brace-web`, `brace-extension`, `brace-api`, `brace-extractor`, `brace-expo`.
- See @docs/architecture.md for lib responsibilities and dependency rules (respect the layering — packages must never import an app). See @docs/setup.md for scaffold commands.

# Package manager

- This monorepo uses **npm** (npm/npx), not pnpm or yarn. The lockfile is `package-lock.json`.
- Run Nx via `npx nx <target>` or `npm exec nx <target>` (the generic Nx guidance above shows a `pnpm` example — ignore that here).
- Use the root scripts where they exist: `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`, `npm run dev`, `npm run reset`.
- **Whole workspace vs. one project.** The root scripts above fan out to every project (`nx run-many`). To run a target on a single app/package after a change, scope it by the project's **full Nx name — the `@stxapps/*` scope, _not_ the folder name** (`@stxapps/brace-web`, never `brace-web`): `npx nx <target> <project>`, e.g. `npx nx typecheck @stxapps/brace-web`, `npx nx test @stxapps/brace-api`, `npx nx build @stxapps/brace-web`. Projects: `@stxapps/{shared,react,web-ui,web-crypto,web-react,expo-crypto,expo-react,brace-web,brace-extension,brace-api,brace-extractor,brace-expo}` (`npx nx show projects` lists them). To check only what a change affected across the graph, use `npx nx affected -t <target>`.
- **After making changes, autofix before checking.** Run the fixer first so `lint`/`typecheck` only report what needs real attention: whole-workspace `npm run fix` (ESLint `--fix` + prettier), or scoped `npx nx lint @stxapps/<project> --fix` for a single project. Then run `npm run lint` and `npm run typecheck` (or their scoped forms).
