# Plan: REALMS — playable AoE-style successor to ANNALS (new repo)

## Context

ANNALS today is a single 2,354-line HTML file (`annals.html`, vanilla JS + Three.js r128): a seeded, watch-only fantasy-kingdom sim with terrain/river worldgen, a 7-good economy, great houses, ages, threats, and an annalist chronicle. The user wants a **new version in a new repo** adding AoE-style **cultures, tech trees, player-constructed buildings, and unit types**, and wants it **playable** — starting as an indirect "ruler mode" but explicitly aiming to reach **full RTS control** eventually.

Decisions confirmed with the user:
- **Stack:** Vite + TypeScript + current Three.js. **Single-file no longer makes sense** — a tech tree, culture data, and gameplay systems need typed data modules, separation, and tests.
- **Rendering:** keep the 3D Three.js look.
- **Gameplay:** hybrid, ruler-first, with architecture that grows into full RTS without a rewrite.
- **Engine:** fresh gameplay-first architecture; **port the pure deterministic pieces** from ANNALS (verified self-contained in `annals.html:176-540`): sfc32 RNG, value-noise fBm, terrain/hydrology/biome worldgen, settlement siting, road MST routing, name banks, heraldry, arch-kit building geometry, chronicle voice.

## Step 0 — New repo bootstrap

1. Create GitHub repo (proposed name: **`realms`** under `JRAlexander` — rename at will) via the GitHub MCP tools, add it to this session with `add_repo`, and clone it.
2. Scaffold: Vite (vanilla-ts), TypeScript `strict`, Three.js current (^0.17x), **Vitest** for headless sim tests, **Biome** for lint/format, **dependency-cruiser** with one CI-enforced rule: *nothing under `src/{core,content,worldgen,sim}/` may import `three` or touch `window`/`document`* — this keeps the sim headless-testable and worker-portable.
3. GitHub Actions: `check` (tsc + biome + depcruise) + `test` + deploy to GitHub Pages (`base: '/realms/'`). Seed in URL hash like ANNALS.
4. Scripts: `dev`, `build`, `test`, `check`, `sim:bench` (headless N-tick benchmark, perf regression guard).
5. Also commit this plan as `docs/PLAN.md` in the new repo (mirroring how ANNALS keeps its spec).

## Directory layout

```
realms/
  src/
    core/            # pure utils: rng.ts [PORT], noise.ts [PORT], math.ts, grid.ts
    content/         # DATA ONLY (typed defs)
      schema.ts      # Modifier + CultureDef/AgeDef/TechDef/BuildingDef/UnitDef
      resources.ts  ages.ts  techs.ts  buildings.ts  units.ts
      cultures/      # valen.ts  norvik.ts  ashari.ts
      names.ts       # [PORT, split per culture]
      validate.ts    # CI: dangling ids, prereq cycles
    worldgen/        # pure, runs once: terrain.ts hydrology.ts biomes.ts
                     # sites.ts roads.ts [ALL PORT] + navgrid.ts (new) + world.ts
    sim/             # deterministic, fixed-tick, headless
      state.ts  tick.ts  commands.ts  events.ts  modifiers.ts
      combat.ts  pathfind.ts  chronicle.ts [PORT, emits events not DOM]
      systems/       # construction production population research training
                     # military ai diplomacy threats victory
    render/          # three.js only, reads state, never writes it
      scene.ts terrainMesh.ts waterSky.ts buildingsMesh.ts [PORT arch kit]
      unitsMesh.ts heraldry.ts [PORT] overlays.ts camera.ts picking.ts
    ui/              # hud, build menu, tech menu, chronicle log, toasts
    app/             # main.ts, loop.ts (fixed timestep), input.ts (→ Commands), save.ts
  tests/             # determinism, economy, research, combat, worldgen, content
```

## Architecture (one decision each)

- **Sim/render split:** `GameState` is plain data (POJOs + typed arrays, structured-clone-safe). Renderer gets `readonly GameState` + drained `SimEvent[]`. Worker-portable later if profiling demands.
- **Tick model:** fixed tick; 10 ticks = 1 game day. Macro systems (economy, politics, AI) run on daily schedules; movement/combat run every tick. When RTS lands, ticks already carry per-tick movement — only the visual meaning of a tick shrinks. Speed = ticks/sec (0/5/20/60); render interpolates between ticks.
- **Not full ECS:** macro entities (Realm/Settlement/Building/Army) as plain objects in id-keyed arrays; systems as functions run in fixed order in `tick.ts` (ANNALS proved this shape). Units get a **struct-of-arrays store** (Float32Array pos/hp, Uint16Array type/owner) from their first appearance (M4) — the only place ECS layout pays off; keeps 5–10k units cheap.
- **Command pattern — the hybrid→RTS hinge.** Every player *and AI* mutation flows through one queue; `advanceTick(state, issued: IssuedCommand[])` is the entire sim API:

```ts
type Command =
  // Ruler mode (M2–M6)
  | { kind: 'queueBuilding'; settlement: Id; building: BuildingId }
  | { kind: 'setResearch'; tech: TechId }
  | { kind: 'trainUnits'; settlement: Id; unit: UnitId; count: number }
  | { kind: 'declareWar'; target: RealmId }
  | { kind: 'orderArmy'; army: Id; objective: Objective }     // strategic
  // RTS mode (M7+), same envelope, typed now:
  | { kind: 'moveUnits'; units: Id[]; to: Vec2 }
  | { kind: 'attackTarget'; units: Id[]; target: Id }
  | { kind: 'placeBuilding'; building: BuildingId; at: Vec2 };
```
  Free consequences: **save = seed + command log**, replay = re-run, deterministic AI (AI emits the same commands), lockstep multiplayer stays possible.
- **Determinism rules (CI-enforced):** all randomness from named sfc32 streams (`world`, `history`, `combat`, `ai`); no `Math.random`/`Date.now`/`performance.now` under `src/sim|worldgen` (grep-lint); determinism test = same seed + command log → 2,000 ticks twice → equal state hash, plus committed golden hash.

## Content model

Core trick: **effects are data, not code** — one `Modifier` record resolved by `sim/modifiers.ts`:

```ts
interface Modifier {
  stat: Stat;                        // gatherRate|buildSpeed|researchSpeed|trainSpeed|
                                     // unitHp|unitAttack|unitArmor|unitSpeed|housingCap|
                                     // wallHp|tradeIncome|popGrowth|unrest
  op: 'add' | 'mul'; value: number;
  resource?: ResourceId; unitTag?: UnitTag; buildingId?: BuildingId;  // optional scope
}
```

- **CultureDef**: `bonuses: Modifier[]`, `uniqueUnit`, `uniqueBuilding?`, `uniqueTechs`, `architecture` (palette + roofStyle, consumed by render only), per-culture `nameBank`.
- **TechDef**: age gate, cost, research time+building, `prereqs`, `effects: Modifier[]`, `unlocks` (units/buildings).
- **BuildingDef**: cost, buildTime, hp, age/tech prereqs, `functions[]` (housing | production | training | research | storage | defense), `footprint` (needed the moment RTS placement lands).
- **UnitDef**: tags (infantry/cavalry/ranged/siege), cost, popCost, hp/attack/range, armor {melee, pierce}, speed, `attackBonuses: {tag, mult}[]` — AoE counters as data.

**v1 content scope (frozen until M6 ships):**
- **Resources (4):** food, wood, stone, gold (ANNALS' 7-good trade matrix collapses to a `tradeIncome` stat in v1).
- **Ages (4):** Founding → Flowering → High Kingdom → Golden; advance = pay cost + N current-age buildings (AoE-style). Wonder returns as Golden Age win condition.
- **Buildings (13):** hall (TC), house, farm, lumber camp, quarry, market, barracks, archery range, stable, temple, university, walls+gate, keep.
- **Units (9):** villager, militia, spearman (anti-cav), swordsman, archer, skirmisher (anti-archer), light cavalry, knight, ram (anti-building). Ships deferred (harbors marked in worldgen only).
- **Techs (~24):** economy lines per resource, blacksmith-style attack/armor triads per age, 2 uniques per culture. All expressible as `Modifier[]` — any tech needing bespoke code is rejected in v1 by definition.
- **Cultures (3):** **Valen** (agrarian: +farm rate, unique knight, gable roofs), **Norvik** (raiders: cheap fast infantry, unique axeman, flat sod roofs), **Ashari** (scholars: −20% research cost, unique camel rider, domes).

## Ported from ANNALS vs rewritten

**Port (mechanical TS translation of pure functions in `annals.html`):** sfc32/RNG helpers (183-197, refactored to explicit stream params, not globals); fBm noise (200-215); worldgen pipeline — terrain/domain-warp, hydrology, biomes, `buildable`, `siteSettlements`, road MST+routing (288-500, heightmap bumped 96²→128-192²); name banks (223-245, split per culture); heraldry (249-285); arch-kit building geometry + instancing approach (~681-760, parameterized by culture architecture); sky/water/seasonal-palette rendering concepts (553-680, re-authored for modern Three color management — treat r128 code as pseudocode); chronicle prose voice (1727ff, emitting events not DOM).

**Rewrite:** all sim systems, state shape, UI, camera/picking, save format — ANNALS' sim has no player and its data is tangled with rendering; it's reference reading only.

## Milestones

- **M0 — Scaffold + world on screen.** Repo, CI, ported core/worldgen with tests (same seed → same heightmap hash), terrain/water/sky/settlements/roads rendering, orbit camera. *Done: `#seed=N` renders a deterministic world on GitHub Pages; tests green.*
- **M1 — Headless sim core.** GameState, `advanceTick`, command queue, fixed-timestep loop + speed control; production/population/storage systems; chronicle log panel. *Done: determinism test over 2k ticks; resources accumulate in HUD; sim runs in vitest with zero DOM.*
- **M2 — Construction.** `queueBuilding` command → cost check → build time → building appears via arch kit; build menu; villager-allocation sliders (ruler mode's economy game). *Done: queue a farm, watch it built, food rate rises; illegal commands rejected with feedback.*
- **M3 — Tech tree + ages.** Research system, modifier resolution (with stacking-math tests), age advancement, tech menu with prereq graph, content validation in CI. *Done: full 4-age climb by hand; every tech measurably changes a rate.*
- **M4 — Units + auto-resolved combat.** Unit SoA store, `trainUnits`, armies marching the road graph (port ANNALS movement approach), deterministic auto-resolve using per-unit stats + counters (composition matters before RTS exists), sieges vs walls. *Done: train a mixed force, send it at a bandit camp, outcome depends on composition.* **Fun checkpoint: validate ruler mode here before polishing M5–M6.**
- **M5 — Cultures + rival realms + AI.** Culture select at start; 2–3 AI realms sited by worldgen; AI emits the same commands via priority-scripted personalities; minimal diplomacy (war/peace/tribute). *Done: AI realms develop and attack; culture changes bonuses, uniques, and building look.*
- **M6 — Playable ruler loop (ship v0.1).** Win = conquest (all capitals) or Wonder defended; lose = capital falls. Light threats (bandits, fire; dragon late-game). Onboarding, save (seed + command log → localStorage/URL), balance pass. *Done: a stranger can start, understand, and win/lose in 30–60 min.*
- **M7+ — RTS layer (incremental).** Selection + picking, `moveUnits`/`attackTarget` (already typed since M1), A* on navgrid (roads = low-cost cells) then flow fields for groups, free building placement with footprints, fog of war, sim → Web Worker if profiling demands. Ruler-mode automation remains as the idle layer; RTS commands override agent autonomy per unit — the payoff of the single command queue.

## Risks

- **Pathfinding scale:** armies-on-roads until M7; `navgrid.ts` exists from M0 as a derived artifact; flow fields only past ~200 simultaneous pathers.
- **Sim perf:** SoA units, preallocated scratch buffers, spatial hash for combat queries; `sim:bench` budget in CI (<2ms/tick @ 1k units).
- **Determinism erosion:** depcruise wall + grep-lint + golden-hash test. Cross-engine float determinism only matters for lockstep MP — defer.
- **Content creep:** schema makes content cheap, which is the risk — per-milestone content freeze.
- **Three r128→current migration:** geometry renames, color management, lighting changes — re-author render code against current docs, don't diff.
- **Ruler mode must be fun without unit control:** villager allocation (M2) + composition-driven combat (M4) are the levers; check fun at M4.

## Verification

- Per milestone: `npm run check` (tsc/biome/depcruise) + `npm test` (vitest: determinism, worldgen hash, modifier math, content validation, combat resolution) green in CI.
- End-to-end at each milestone: run `npm run dev`, exercise the milestone's "Done" criterion in the browser (e.g. M2: queue a farm and observe the food-rate change).
- `sim:bench` tracked against the ms/tick budget from M4 on.
- Deployed GitHub Pages build after each milestone so it's playable from anywhere.

## Immediate first work item (after approval)

Create the new repo, scaffold M0, commit this plan as `docs/PLAN.md`, and push. (Per session rules, the new repo gets added via `add_repo`; nothing further lands in `annals-test` unless requested — the existing designated branch there stays available if the user wants this plan doc mirrored there.)
