# Design brief 2: Building & terrain assets for REALMS

> **How to use this document**: paste it, whole, into a fresh Claude session.
> It is self-contained — no repository access is needed. Run this commission
> AFTER Brief 1 (units), and keep its material palette consistent with what
> Brief 1 delivered.

## The game, in one paragraph

REALMS is a browser RTS in the Age of Empires tradition, rendered in three.js:
a 6 km procedural lowpoly world, three rival medieval-fantasy realms, four
ages of progress from Founding to Golden, sieges, wonders, caravans. The tone
is a medieval chronicle come to life — warm parchment, banner gold, ink and
iron. Today all eighteen building types are drawn from a dozen generic
box-and-cone shells, the three cultures are visually IDENTICAL except for a
trim tint, and the terrain is flat vertex-colored HSL. **Your commission, in
two parts: (A) design the building kit** — every building type, in three
culture styles — **and (B) design the terrain dressing**: a cohesive biome
palette, tree kit, water, and roads. All as procedural three.js geometry code.

## Your deliverables

**Part A** — one TypeScript module, `buildingKit.ts`:

```ts
export type BuildingKind =
  | 'townCenter' | 'house' | 'farm' | 'lumberCamp' | 'quarry' | 'market'
  | 'storehouse' | 'temple' | 'granary' | 'university' | 'guildhall'
  | 'keep' | 'palisade' | 'stoneWall' | 'barracks' | 'archeryRange'
  | 'stable' | 'wonder'
  | 'wallSegment' | 'wallTower'   // the town-ring pieces (see Walls below)
  | 'tent';                        // bandit camps
export type Culture = 'valen' | 'norvik' | 'ashari';

/** One merged, vertex-colored BufferGeometry. Deterministic. */
export function buildingGeo(kind: BuildingKind, culture: Culture): THREE.BufferGeometry;
```

**Part B** — one TypeScript module, `terrainPalette.ts`:

```ts
/** Per-biome vertex color, given normalized height h (0..1). */
export function biomeColor(biome: Biome, h: number): THREE.Color;
export type Biome = 'Meadow' | 'Farmland' | 'Deciduous' | 'Pine' | 'Rock' | 'Marsh' | 'Water';
export const WATER = { sea: 0x______, river: 0x______, opacity: 0.__ };
export const ROAD = { color: 0x______, width: 0. };
export function treeGeo(kind: 'deciduous' | 'pine'): THREE.BufferGeometry;   // ≤ 80 tris
export function rockGeo(): THREE.BufferGeometry;                            // ≤ 60 tris, Rock-biome outcrop
```

Plus a **self-contained `preview.html`** rendering: the 21-building grid ×3
cultures, the biome swatch strip at three heights each, and the tree/rock kit
— under the game's exact lighting. Preview is throwaway; the two modules are
the product.

## The hard technical contract (non-negotiable)

Identical to Brief 1 — read this even if you did that commission:

- **No asset pipeline**: no textures, loaders, files, shaders, sprites,
  bones, or animation. Compose `BoxGeometry` / `ConeGeometry` /
  `CylinderGeometry` / (sparingly) `SphereGeometry`, flood each part with one
  vertex color via a `paint()` helper, `mergeGeometries(parts, false)`,
  `computeVertexNormals()` → ONE `BufferGeometry`. three `^0.180.0`; the only
  addon is `BufferGeometryUtils.mergeGeometries`.

```ts
function paint(g: THREE.BufferGeometry, col: number): THREE.BufferGeometry {
  const c = new THREE.Color(col);
  const n = g.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
```

- **Deterministic** — no `Math.random()`. If a building wants irregularity
  (stone coursing, lean), derive it from a hash of `(kind, culture)`.
- **Y-up, ground plane y = 0**, centered on origin, entrance facing **+Z**.
- Runtime material: `MeshLambertMaterial({ vertexColors: true })`; warm
  directional light `0xfff2dd` @ 2.6 + hemisphere `0xbfd4ee`/`0x8a7a5f` @ 1.1;
  **no shadows** — bake value contrast into the colors (darker under eaves,
  lighter roof ridges).
- **Owner tint**: buildings are instanced and tinted per-instance with the
  owner's culture trim, lerped 45% toward white — a gentle wash, not a
  repaint. Paint buildings in their TRUE culture colors (below); reserve one
  small, light-painted banner/trim element per building where the wash can
  read (door banner, roof pennant, gate cloth).

## Scale ground truth

World units ≈ meters; one map grid cell ≈ **47.24 wu**. The game currently
renders buildings at a uniform ×1.6 instance scale from base geometries like
`house` = 7×6×8 wu — the result reads small and same-y. **You set the real
proportions**: build every model at FINAL world size (the game will drop its
×1.6), sized to its gameplay footprint below, with height as a free dramatic
variable. The camera: 50° FOV, default ~1,340 wu out at ~40° pitch (a 48-wu
tower ≈ 42 px), zooming to 60 wu min distance. Villagers (5 wu) and soldiers
(9 wu) from Brief 1 will stand next to these — doors should look plausibly
human-sized, and NOTHING may read smaller than a soldier.

**Triangle budgets** (hard): ordinary buildings ≤ **600**; townCenter, keep
≤ **900**; wonder ≤ **2000** (the victory monument — the one showpiece);
wallSegment ≤ 120; wallTower ≤ 250; tent ≤ 150; trees ≤ 80; rock ≤ 60.
State actual counts in comments. There are at most a few dozen building
instances per settlement and nine settlements.

## Part A — the building roster

Footprints are gameplay data (1 cell ≈ 47 wu). Target ground coverage ≈ 70–85%
of the footprint square so buildings breathe.

| Kind | Footprint (cells) | ≈ wu | The read it must give |
|---|---|---|---|
| `townCenter` | 3×3 | 142 | THE seat of power — every town has exactly one; a hall with presence, banner mast (light-painted, tintable) |
| `house` | 1×1 | 47 | Humble, repeatable — appears in dozens; keep it quiet |
| `farm` | 2×2 | 94 | Mostly FIELD: low furrow rows + a shed; villagers stand on it |
| `lumberCamp` | 2×1 | 94×47 | Log pile + saw frame, open-sided |
| `quarry` | 2×2 | 94 | Cut stone blocks, ramp, hoist arm |
| `market` | 2×2 | 94 | Stalls + awnings — the trade heart; awnings are a color moment |
| `storehouse` | 2×2 | 94 | Fat, windowless, barrels outside |
| `granary` | 2×2 | 94 | Raised on staddle stones, ladder |
| `temple` | 2×3 | 94×142 | Vertical aspiration: spire/dome per culture |
| `university` | 3×3 | 142 | Cloister/courtyard suggestion, tall windows |
| `guildhall` | 2×2 | 94 | A rich merchant hall — market's big sibling |
| `keep` | 3×3 | 142 | Military mass: thick, crenellated, unfriendly |
| `barracks` | 3×3 | 142 | Drill yard + hall; weapon racks |
| `archeryRange` | 3×2 | 142×94 | Open lane + two butts (targets) |
| `stable` | 3×2 | 142×94 | Long low roof, stall openings, hay |
| `wonder` | 4×4 | 189 | The victory monument — culture-defining landmark, tallest thing a realm builds; spend the budget |
| `palisade` | 2×1 | — | See Walls |
| `stoneWall` | 2×1 | — | See Walls |
| `wallSegment` / `wallTower` | — | seg ≈ 9–12 wu long | See Walls |
| `tent` | — | ≈ 12 wu | Bandit camps: rough hide tents, off-palette (dirty umber `0x554433` family) — the wilds are nobody's culture |

**Walls**: the game draws town defenses as a RING of repeated segments around
the settlement (segment length ~9–12 wu, count = radius/9), with the built
`palisade`/`stoneWall` spot marked by a tower. Deliver `wallSegment` +
`wallTower` in two material treatments driven by culture + a
palisade/stone flag if you wish — at minimum: palisade = sharpened timber,
stoneWall = coursed masonry with walk and crenellation. Segments must tile
seamlessly end-to-end along ±X.

**Construction**: the game shows scaffolding separately and grows buildings
vertically while under construction — deliver finished states only; no
scaffold geometry.

### The three cultures — finally distinct

The single most important outcome of Part A: **you can tell whose town you
are looking at from silhouette alone**. Fixed culture palettes (these hex
values are the game's data — consume them; the roofStyle field has NEVER been
honored by the renderer until your kit):

| Culture | Character | wall | roof | trim/accent | roofStyle |
|---|---|---|---|---|---|
| **Valen** | Prosperous heartland kingdom — chivalry, grain, gold | `0xd8c49a` warm limewash | `0x8a4a2f` terracotta | `0xc9a227` gold | **gable** — steep pitched roofs, half-timber hints |
| **Norvik** | Hard northern seafarers — timber, iron, weather | `0x8a7a5f` dark timber | `0x4a5a3a` turf/moss green | `0x3a3a3a` iron | **flat** — low shallow-pitch/shed roofs, heavy beams, carved gable ends |
| **Ashari** | Desert-edge scholars and traders — spice, astronomy | `0xe0d0a8` pale plaster | `0x5a7a9a` slate blue | `0x8a6a3a` bronze | **dome** — domes and barrel vaults, pointed arches, courtyard walls |

Implementation guidance: build each kind as a shared massing recipe with
culture-swapped roof construction + palette + one motif (Valen: timber cross-
bracing; Norvik: crossed gable-end beams; Ashari: a dome finial) — so 21
kinds × 3 cultures stays maintainable. The wonder is the exception: three
genuinely different landmarks (Valen: cathedral spire; Norvik: great carved
hall with prow beams; Ashari: grand observatory dome) — same 4×4 footprint.

## Part B — terrain & dressing

The ground is a 128×128-vertex heightmap mesh (6000×6000 wu, max elevation
520 wu, sea level at 156 wu) colored ONLY by per-vertex color — no textures.
Current palette, which reads muddy and undifferentiated, for reference
(HSL): Meadow (0.28, 0.45, 0.42) · Farmland (0.22, 0.5, 0.45) · Deciduous
(0.33, 0.5, 0.3) · Pine (0.42, 0.35, 0.26) · Rock (0.08, 0.12, 0.5) · Marsh
(0.18, 0.3, 0.35) · underwater (0.57, 0.5, 0.32), plus a linear lightness
lift of +0.12 max toward peaks.

Deliver in `terrainPalette.ts`:

1. **`biomeColor(biome, h)`** — a cohesive 7-swatch palette in the game's
   warm-chronicle key. Requirements: Meadow vs Farmland clearly distinct
   (Farmland reads tilled/golden); the two forest biomes dark enough that the
   tree kit pops against them; Rock cools and pales with altitude to snowcap
   near h = 1; Marsh murky, not neon; a shaped (non-linear) height-shading
   curve replacing the flat +0.12 lift. Adjacent vertices blend — design
   swatches that blend beautifully, and keep midtones distinct from the
   player-gold (`0xc9a227`) and rival-red (`0x9a3a30`) overlay colors used by
   rings and banners.
2. **`WATER`** — sea color/opacity (currently `0x2b5a72` @ 0.82, phong with
   specular) and river color (`0x35708c`); rivers are 6–13-wu ribbons. Aim:
   readable as water at a glance, not swimming-pool blue.
3. **`ROAD`** — ribbon color (currently `0x8a7355`, 3.2 wu wide, which
   disappears into Meadow) — roads are gameplay (caravans ride them); they
   must read subtly but reliably at the default zoom. Width may go up to ~5.
4. **`treeGeo('deciduous' | 'pine')`** — replaces cone-on-cylinder lollipops;
   ≤ 80 tris; a two-to-three-mass canopy for deciduous, layered pine skirts;
   colors that sit on your forest swatches. Same trunk-at-origin convention.
5. **`rockGeo()`** — an outcrop cluster for Rock cells, ≤ 60 tris, so
   mountains have texture between snow and grass.

## Acceptance checklist (the commission is done when…)

1. Both modules compile standalone with `tsc --strict` against
   `three@^0.180.0`; only imports: `three` +
   `three/addons/utils/BufferGeometryUtils.js`.
2. `buildingGeo` covers all 21 kinds × 3 cultures (tent may ignore culture);
   footprint coverage 70–85%; entrances +Z; y = 0 ground; budgets stated in
   comments and held; deterministic.
3. In the preview at default-camera distance: the three cultures
   distinguishable by silhouette with color OFF (grayscale toggle in the
   preview proves it); every kind identifiable in a labeled grid; wonder
   landmarks unmistakable; wall segments tile without gaps.
4. Terrain swatches: the 7 biomes distinct at a glance AND harmonious side by
   side; forest swatches darker than tree canopies; road visible on every
   land biome; water reads as water.
5. No `Math.random`, no textures, no new dependencies, nothing baked in that
   the game owns (no fog, no selection rings, no scaffolds).

## Art direction, in one line

A medieval chronicle's margin illustrations, standing up: warm, worn, a
little austere — banner gold against dried blood and iron; three peoples you
can tell apart across a valley; bold shapes, honest materials, zero gloss.
