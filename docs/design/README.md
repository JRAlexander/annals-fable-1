# Design briefs — the REALMS visual overhaul

The game plays well and looks like a programmer built it: every soldier is the
same 8-pixel box, all eighteen buildings share a dozen generic box-and-cone
shells, and the three cultures are visually identical except for a tint. These
briefs commission real assets.

**How this works:**

1. Each brief below is a complete, self-contained prompt. Paste one into a
   fresh Claude session ("Claude Design") — no repo access is needed; every
   technical fact, dimension, palette, and constraint is embedded.
2. Run them **in order**: units first (Brief 1), then buildings & terrain
   (Brief 2). Units are the highest-value fix — they are the things you watch.
3. Each brief's output is a single TypeScript module (plus a throwaway preview
   page). It comes home as a normal PR against `src/render/` in a follow-up
   integration milestone, where it is wired into the instanced-mesh sync
   loops, verified in the browser, and screenshot for review.

| Brief | Commission | Output module |
|---|---|---|
| [ASSET-BRIEF-1-UNITS.md](ASSET-BRIEF-1-UNITS.md) | 12 unit models + villager + trade cart | `unitKit.ts` |
| [ASSET-BRIEF-2-BUILDINGS-TERRAIN.md](ASSET-BRIEF-2-BUILDINGS-TERRAIN.md) | 18 buildings × 3 cultures, terrain palette, trees, water, roads | `buildingKit.ts` + `terrainPalette.ts` |

These briefs are the single source of truth for asset specs. If an integration
milestone needs to deviate (budgets, dimensions, API), update the brief in the
same PR.
