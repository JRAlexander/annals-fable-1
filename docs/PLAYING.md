# How to Play REALMS

## Running the game

**Play online** (updates automatically about a minute after every PR merges to `main`):

> https://jralexander.github.io/annals-fable-1/

Hard-refresh after a new release (**Ctrl/Cmd+Shift+R**) — browsers cache the old build.

**Run locally** (any branch, including unmerged PRs):

```sh
git checkout main && git pull   # or: git checkout claude/<branch> to preview a PR
npm install
npm run dev                     # opens the dev server; changes hot-reload
```

**Seeds**: the URL hash is the world. `#seed=7` always produces the same realm —
share the link to share the world, click **new world** in the top bar to roll another.
Seed 7 is a good coastal starter kingdom.

## The screen

| Where | What |
|---|---|
| **Top bar** | Resources (🌾 food, 🪵 wood, ⛰ stone, 🪙 gold) with per-day rates, 👥 population, current **age**, date, the **⚗ Tech** button, and speed controls |
| **Right panel** | **Construct** — queue buildings in the selected settlement; **Workers** — allocation sliders |
| **Second right panel** | **War ministry** — train troops, view the garrison, form and command armies |
| **Bottom left** | The **chronicle** — your realm's history, written as it happens |
| **Center toasts** | Completions and rejections (a red toast tells you *why* an order failed) |

**Camera**: drag to orbit, scroll to zoom. **Keys**: `Space` pause, `1`/`2`/`3` speeds, `T` tech tree.

## Your first hour, step by step

1. **Feed the realm.** Watch the 🌾 rate in the top bar. Your workers auto-assign
   proportionally to what the land offers; drag the **Workers** sliders to override.
   Setting a slider to zero means *nobody* works that job.
2. **Build the economy.** The land's worker slots run out fast (that's by design) —
   **Farms, Lumber Camps, Quarries, and Markets add slots**. Houses raise the
   population cap; Storehouses raise how much you can stockpile (watch for
   "stores overflow" in the chronicle — that's waste).
3. **Climb the ages.** Press `T`. Research needs the matching building (farm techs
   at a Farm, and from the High Kingdom onward, a **University**). To **Advance**
   you need the listed cost plus **two different building types from your current
   age** — and the advance occupies your research slot, so time it well.
4. **Raise an army.** Build a **Barracks**, train Militia and Spearmen (training
   costs resources **and villagers**). Units land in the settlement's garrison;
   **Form army from garrison**, pick a bandit camp from the dropdown, **March**.
5. **Pick fights you can win.** The camp dropdown shows defender counts. Bring
   clearly more than they have — a routed army flees home in shame (the chronicle
   will not let you forget it). Victory burns the camp and loots its gold.

## Know your units (counters matter, cost-for-cost)

| Unit | Age | Beats | Loses to |
|---|---|---|---|
| Militia | Founding | nothing in particular | everything — cheap filler |
| **Spearman** | Founding | **cavalry** (×3) | swordsmen, archers |
| Swordsman | Flowering | infantry generally | archers, knights |
| **Archer** | Flowering | **infantry** (×2) | skirmishers, cavalry |
| **Skirmisher** | Flowering | **archers** (×3) | melee of any kind |
| Light Cavalry | Flowering | **ranged** (×2), raids | spearmen |
| Knight | High Kingdom | most things | **spearmen**, cost-for-cost |
| Battering Ram | High Kingdom | **fortifications** (×25) | everything else |

A **mixed force beats a mono force** of equal cost. Camps are fortified: their
palisade halves your kills until rams bring it down. Blacksmith-line techs
(Forging, Fletching, Scale Armor…) add flat attack/armor — they visibly tip
otherwise-even fights.

## Reading the chronicle

Everything that matters is written there in the annalist's voice: founding,
growth milestones, famine, new buildings, mastered technologies, the golden
line when the realm enters a new age — and war: *"With drums and hard bread
the levies set out…"*, *"Victory! The bandit camp is burned and 447 gold
recovered."*, or, if you under-committed, *"The line broke and the survivors
fled for home, harried and ashamed."*

## What's next on the roadmap

Rival AI realms and playable cultures (Valen / Norvik / Ashari) arrive in M5,
win/lose conditions in M6, and direct RTS unit control in M7+ — see
[docs/PLAN.md](PLAN.md) for the full roadmap.
