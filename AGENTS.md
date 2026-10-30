# AGENTS.md — tiny-crow

Tiny Crow is a coding agent written in TypeScript. Node.js 24 or newer
executes the sources directly with type stripping — there is no build
step to run first.

When working on tiny-crow:

- Never claim a change works without running `npm test` and
  `npm run typecheck` (`tsc --noEmit`) first.
- Run `npm test` to check all unit tests.
- Run `npm start` (or `node src/main.ts`) to run the agent; use
  `npm run dev` for watch mode during development.

Important notes:

- Always write tests when writing new non-TUI code.
- Always update docs/ files when needed.
- If adding or editing slash commands, edit the slash commands `/`
  picker in the TUI.
