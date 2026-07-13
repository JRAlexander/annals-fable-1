# REALMS — project guide

A playable AoE-style kingdom game. Full architecture and milestone roadmap: `docs/PLAN.md`.

## Development workflow (required)

- **All development happens on a feature branch** (e.g. `claude/m1-sim-core`), never directly on `main`.
- **Every change reaches `main` via a pull request** — no direct pushes to `main`.
- CI (`check` + `test` + `build`) must be green before merge.

## Commands

- `npm run dev` — dev server
- `npm test` — vitest (headless worldgen/sim tests)
- `npm run check` — tsc + Biome + dependency-cruiser + purity check; run before every commit
- `npm run build` — production build
- `npm run sim:bench` — perf regression benchmark

## Architecture rules (CI-enforced)

- `src/core`, `src/content`, `src/worldgen`, `src/sim` are headless and deterministic:
  no three.js imports, no DOM, no `Math.random`/`Date.now`/`performance.now`.
- All randomness comes from named sfc32 streams (`src/core/rng.ts`).
- Every player/AI mutation flows through the command queue into `advanceTick(state, commands)`.
- Game content (cultures/techs/buildings/units) is data conforming to `src/content/schema.ts`;
  effects are `Modifier` records, never bespoke code.
- `src/render` reads game state; it never writes it.
