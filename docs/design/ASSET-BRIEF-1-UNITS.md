# Design brief 1: Unit assets for REALMS

> **How to use this document**: paste it, whole, into a fresh Claude session.
> It is self-contained — no repository access is needed. The deliverable is
> described at the end.

## The game, in one paragraph

REALMS is a browser RTS in the Age of Empires tradition, rendered in three.js:
a 6 km procedurally generated lowpoly world, three rival medieval-fantasy
realms, villagers hauling baskets, armies of hundreds of individual soldiers,
caravans on the roads, sieges, a dragon. The tone is a medieval chronicle come
to life — warm parchment, banner gold, ink and iron; the in-game narrator
writes lines like *"the line broke and the survivors fled for home, harried
and ashamed."* Today every soldier on screen is a literal plain box, identical
regardless of whether it is a militiaman or a knight. **Your commission:
design the unit models** — as procedural three.js geometry code — so that
every unit type is recognizable at a glance, from a war camera, in armies of
hundreds.

## Your deliverable

One TypeScript module, `unitKit.ts`, with this exact public API:

```ts
export type UnitKind =
  | 'militia' | 'spearman' | 'swordsman'          // infantry
  | 'archer' | 'skirmisher'                        // ranged
  | 'lightCavalry' | 'knight'                      // cavalry
  | 'paladin' | 'huscarl' | 'camelRider'           // culture uniques
  | 'ram'                                          // siege
  | 'dragon'                                       // monster (wild only)
  | 'villager' | 'caravan';                        // civilians

/** One merged, vertex-colored BufferGeometry per kind. Deterministic. */
export function unitGeo(kind: UnitKind): THREE.BufferGeometry;
```

Plus a **self-contained `preview.html`** (inline script, three.js from a CDN
import map is fine *for the preview only*) that renders all 14 models in a
lineup with the game's exact lighting, so the result can be eyeballed in one
open-file. The preview is throwaway; `unitKit.ts` is the product.

## The hard technical contract (non-negotiable)

The game has **no asset pipeline** — no textures, no model loaders, no files.
Everything is composed from three.js primitives, painted with per-vertex
colors, and merged into ONE `BufferGeometry` per model, which is then drawn
via `InstancedMesh` (hundreds of instances). Your code must follow the
codebase's established pattern exactly:

```ts
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Flood a geometry's vertices with one color (the game's house pattern). */
function paint(g: THREE.BufferGeometry, col: number): THREE.BufferGeometry {
  const c = new THREE.Color(col);
  const n = g.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    a[i * 3] = c.r;
    a[i * 3 + 1] = c.g;
    a[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

// compose → paint → merge → ONE geometry:
const parts: THREE.BufferGeometry[] = [];
const body = new THREE.BoxGeometry(2.4, 4, 1.6);
body.translate(0, 4.5, 0);
parts.push(paint(body, 0x8a8a8a));
// ...more parts...
const geo = mergeGeometries(parts, false);
geo.computeVertexNormals();
```

Rules:

- **three `^0.180.0`**, and the ONLY addon available is
  `BufferGeometryUtils.mergeGeometries`. No other imports, no dependencies,
  no textures, no shaders, no `Sprite`, no skinning/bones, no animation —
  these are static geometries (motion comes from the game moving instances).
- Primitives available: `BoxGeometry`, `ConeGeometry`, `CylinderGeometry`,
  `SphereGeometry` (use spheres sparingly — segment counts are triangles).
- **Deterministic**: no `Math.random()` anywhere. Same call, same geometry,
  every time.
- **Y-up, ground at y = 0**: every model stands ON the origin plane (feet,
  wheels, hooves at y = 0), centered at x = z = 0, facing **+Z**.
- Material at runtime is `MeshLambertMaterial({ vertexColors: true })` under a
  warm directional light (`0xfff2dd`, intensity 2.6) + hemisphere light (sky
  `0xbfd4ee`, ground `0x8a7a5f`, 1.1). **No shadows.** Model your value
  contrast into the vertex colors — the renderer will not add drama for you.

### Owner tint: the two-zone rule

The game tints every instance by its owning realm via
`InstancedMesh.setColorAt(i, ownerColor)` — and in three.js that instance
color **multiplies** the vertex colors. Owner colors are:
player `0xd8c88f` (parchment gold), rival `0x9a3a30` (dried-blood red),
wild `0x2a2622` (near-black). So paint each model in **two zones**:

- **Tint zone** (cloth, shield faces, banners, caparisons): paint these
  near-white / light warm gray (`0xd8d8d8`–`0xffffff`) so the owner color
  reads at full strength there.
- **Fixed zone** (skin, steel, wood, leather): paint these in their true
  material colors, mid-value, so the multiply darkens them only slightly and
  they stay recognizable under all three owner tints. Suggested material
  palette (yours to refine): steel `0xb8bcc4`, iron `0x7a7e86`, wood
  `0x8a6a3f`, leather `0x6b4f35`, skin `0xd8a97e`, dark cloth `0x4a4640`.

Every soldier must read as friend-or-foe from the tint zone alone, and as a
unit TYPE from silhouette alone. Test both in the preview: render each model
three times, tinted with the three owner colors.

## Scale and readability — the numbers that rule everything

World units ≈ meters. Today's placeholder boxes and the required envelopes:

| Model | Envelope (w × h × d, wu) | Rule |
|---|---|---|
| Infantry / ranged | ~3.2 × **9** × 3.2 | Humanoids are stylized TALL (~9 wu) — keep this exaggeration; realism reads as ants |
| Cavalry / camel | ~4.5 × 10 × 7 | Mount + rider; noticeably more massive than infantry |
| Ram | ~6 × 6 × 10 | Long, low, wheeled |
| Dragon | ~4× soldier scale is applied BY THE GAME to your 1× model | Build at soldier scale; wingspan may reach ±8 wu |
| Villager | 2.2 × 5 × 2.2 | Visibly smaller and humbler than any soldier |
| Caravan | 5 × 3.5 × 3 | A cart; drawn separately from villagers |

**The camera is far**: default view is ~1,340 wu out at ~40° pitch with a 50°
FOV — a 9-wu soldier is **about 8 pixels tall** on a 1080p screen. Players
will zoom in (min orbit distance 60 wu), and models must reward that — but
the war is fought at 8 px. Therefore:

1. **Silhouette first.** Each type's ONE distinguishing feature must survive
   at 8 px: a pike is a tall thin line above the head; a bow is a side-arc; a
   horse is a horizontal mass. If a detail doesn't change the outline or add
   a ≥1.5-wu color block, delete it.
2. **Exaggerate the tell.** Weapons oversized ~1.5–2× realistic proportion.
3. **Triangle budgets** (hard, per merged model): humanoids ≤ **150**,
   cavalry ≤ **250**, ram ≤ **200**, caravan ≤ **200**, villager ≤ **100**,
   dragon ≤ **1200** (it is the one showpiece — there is only ever one).
   State the actual count per model in a comment. Segment counts on
   cylinders/cones of 5–6 are plenty; spheres 6×4.

## The roster — required silhouette tells

| Kind | Family | The 8-px tell | Notes |
|---|---|---|---|
| `militia` | infantry | a stick and no armor | The rabble baseline: tunic (tint), club/hatchet, bare head. Everything else is measured against this |
| `spearman` | infantry | **pike, 1.5× body height, vertical** | Small round shield (tint). The anti-cavalry line — the pike IS the unit |
| `swordsman` | infantry | wide stance + kite shield slab | Sword short but broad; shield a big tintable rectangle. The armored brawler |
| `archer` | ranged | **bow arc held sideways** + quiver spike over shoulder | Slighter build than melee; hood not helmet |
| `skirmisher` | ranged | raised throwing javelin + a bundle of spares | Distinct from archer: arm UP, no bow arc |
| `lightCavalry` | cavalry | slim horse, rider leaning forward, no lance | Fast and light — less mass than knight |
| `knight` | cavalry | **massive horse + caparison (tint) + couched lance** | The heavy: biggest non-siege mass on the field |
| `paladin` (valen unique) | cavalry | knight + full head-to-tail caparison + banner pennant off the lance | Accent fixed-color `0xc9a227` (valen gold) on crest/pennant edge |
| `huscarl` (norvik unique) | infantry | **two-handed axe held high** + round shield on the BACK | Broad, squat, bearded mass; accent `0x3a3a3a` (norvik iron) |
| `camelRider` (ashari unique) | cavalry | **camel hump + long neck** — instantly not-a-horse | Rider high, robes (tint); accent `0x5a7a9a` (ashari blue) on saddle cloth |
| `ram` | siege | gabled log roof on four wheels, swinging log head poking out front | Mostly fixed-zone wood; a small tint pennant so ownership reads |
| `dragon` | monster | **wings + serpent neck** — nothing else on the field flies | Never tinted in practice (wild-owned): paint in its true colors — deep red `0xd84418` scales, dark wing membranes, pale belly. The terror of the late game; spend the budget here |
| `villager` | civilian | basket on the back, stooped posture | Tint zone = tunic. The game additionally lerps loaded villagers toward cargo colors — keep the back/basket area light so that reads |
| `caravan` | civilian | covered wagon: canvas hoop top (tint) + solid wheels + ox/donkey | Replaces a plain box cart; the game tints it amber-ish and lightens it when laden |

Family resemblance matters: the three infantry share a body construction, the
cavalry share a mount construction (except the camel), so the field reads as
an ARMY, not a toy bin. Culture uniques are the exception — they get one
extra flourish each, in their culture's accent color listed above.

## Acceptance checklist (the commission is done when…)

1. `unitKit.ts` compiles standalone with `tsc --strict` against
   `three@^0.180.0` and `@types/three` — the ONLY imports are `three` and
   `three/addons/utils/BufferGeometryUtils.js`.
2. `unitGeo(kind)` returns a merged, vertex-colored, normal-computed
   `BufferGeometry` for **all 14 kinds**; feet at y = 0; facing +Z; within
   envelope; deterministic.
3. A comment above each builder states its triangle count; every budget holds.
4. In the preview lineup at ~64 px tall: all 14 silhouettes distinguishable;
   at ~8 px: the seven battlefield families (militia-ish, pike, bow, javelin,
   horse, camel, ram) still distinguishable.
5. Each model shown under all three owner tints: friend/foe reads from the
   tint zone; materials stay recognizable in the fixed zone.
6. No `Math.random`, no textures, no extra dependencies, no animation, no
   bones, nothing baked in that the game owns (no health bars, no selection
   rings, no ground shadows — those are separate layers).

## Art direction, in one line

A medieval chronicle's margin illustrations, standing up: warm, worn, a
little austere — banner gold against dried blood and iron; bold shapes,
honest materials, zero gloss, zero cartoon rubber.
