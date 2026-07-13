# REALMS

A playable, AoE-style successor to [ANNALS](https://github.com/JRAlexander/annals-test): a procedurally
generated 3D kingdom with **cultures, technology trees, buildings, and unit types** — starting as an
indirect "ruler mode" and growing into full RTS control.

The seed is the save: `#seed=1234` in the URL fully determines the world.

**▶ Play it:** https://jralexander.github.io/annals-fable-1/ — and read **[the player guide](docs/PLAYING.md)** for controls, the age climb, and how to raise an army.

## Status

**M0** — deterministic worldgen (terrain, rivers, biomes, settlements, roads) ported from ANNALS to
typed modules, rendered in Three.js with an orbit camera. See [docs/PLAN.md](docs/PLAN.md) for the
full architecture and milestone roadmap (M1 headless sim → M6 playable ruler mode → M7+ RTS layer).

## Development

```sh
npm install
npm run dev        # dev server
npm test           # vitest (headless sim + worldgen tests)
npm run check      # typecheck + biome lint + dependency rules + purity check
npm run build      # static build to dist/
npm run sim:bench  # perf regression benchmark
```

## Architecture in one paragraph

`src/core`, `src/content`, `src/worldgen`, and `src/sim` are **headless and deterministic** — they may
not import three.js or touch the DOM/clock/`Math.random` (enforced by dependency-cruiser and
`scripts/purity-check.sh`). All randomness comes from named sfc32 streams. Every player and AI action
flows through a single command queue into `advanceTick(state, commands)`, which makes save files
(seed + command log), replays, and the eventual ruler-mode → RTS evolution possible. `src/render` reads
game state and draws it; it never writes it.
