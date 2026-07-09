---
name: verify
description: How to build, launch, and drive this repo's apps to verify a change end-to-end (brace-web GUI via headless Chromium).
---

# Verifying changes in this repo

## Launch

- `npm run dev` (background) starts brace-web on :3000, brace-api (wrangler,
  local D1/R2 emulation) on :8787, and brace-extractor. Wait for
  `curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/` → 200 (~15s).
- Local state lives under `apps/brace-api/.wrangler/`; creating a throwaway
  account per run is cheap and avoids depending on existing state.

## Drive brace-web (GUI surface)

- No Playwright in the workspace, but browsers are cached at
  `~/Library/Caches/ms-playwright/`. In a scratch dir: `npm i playwright-core`,
  then `chromium.launch({ executablePath: '<cache>/chromium_headless_shell-*/chrome-headless-shell-mac-arm64/chrome-headless-shell' })`.
- Flows that worked headless: create account at `/create-account`
  (Username/Password labels, button /create/i — Argon2 makes this take a few
  seconds; wait for URL /links/), add links via the topbar `Add` popover
  (label `URL`, button `Save`), manage lists at `/settings/lists` (create field
  label `New list name`, Enter commits; rows are inputs — match
  `input[aria-label="List name"][value="<name>"]`, per-row kebab label
  `List actions`), sidebar rows are buttons named by list name.
- `playwright-core` has no Testing Library helpers (`getByDisplayValue` doesn't
  exist) — use attribute selectors for the uncontrolled inputs.
- Layouts render a link's title, falling back to the URL with a leading
  `https://` stripped (host + path, via `displayUrl`) when there's no title;
  the host also shows on a secondary line/column. So untitled links ARE
  distinguishable by path — asserting on distinct paths (or distinct hosts)
  both work.

## Gotchas

- Nx TUI is disabled on purpose (breaks wrangler dev under run-many) — keep
  `--output-style=stream` output; don't re-enable.
- Sign-out lands on `/`; sign-in is `/sign-in`. After sign-in, give the initial
  sync ~2s before asserting on content.
