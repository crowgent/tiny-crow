# Repository guide: tiny-crow

Tiny Crow is a TypeScript coding agent. Node.js 24 or later runs the source directly through type stripping, so edits can be run without an intervening build step.

## Essential commands

- `npm test` — run the complete unit test suite.
- `npm run typecheck` — run strict type checking with `tsc --noEmit`.
- `npm start` or `node src/main.ts` — start the agent.
- `npm run dev` — start the agent in watch mode during development.

## Verification requirement

Do not describe a change as working until both `npm test` and `npm run typecheck` (`tsc --noEmit`) have passed. Passing only one check is not sufficient.

## Contribution practices

- Add tests alongside new non-TUI code.
- Update files in `docs/` when a change affects documented behaviour.
- When adding or editing slash commands, update the slash-command `/` picker in the TUI as well.
