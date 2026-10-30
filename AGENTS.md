# Working in this repository — tiny-crow

This repo holds a coding agent in TypeScript. Node.js 24 or newer runs
the sources directly through type stripping, so there is no build step
standing between an edit and a run.

## Commands that matter here

- `npm test` — runs the whole unit test suite.
- `npm run typecheck` — runs `tsc --noEmit` for strict type checking.
- `npm start` (or `node src/main.ts`) — starts the agent.
- `npm run dev` — starts the agent in watch mode while developing.

## The verification rule

Do not describe a change as working until both checks have passed:
`npm test` and `npm run typecheck` (`tsc --noEmit`). A green run of
only one of them is not enough.

## Habits to keep

- New non-TUI code comes with tests written alongside it.
- When a change touches behaviour that is documented, the `docs/`
  files get updated to match.
- When slash commands are added or edited, the slash-command `/`
  picker in the TUI gets the same treatment.
