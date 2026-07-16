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
share the link to share the world. Seed 7 is a good coastal starter kingdom.
Your culture choice joins the hash too (`#seed=7&culture=norvik`), so a full
game setup is one shareable link.

**Saving**: the game **saves itself every game-day** (it's just your seed plus
every order you ever gave — the whole world replays from those in seconds).
Reloading the page continues your reign; the culture picker offers **⟳ Continue**
when a save exists for the seed. Picking a culture card starts that culture over.

## Choosing a people

At boot you pick one of three cultures — bonuses, a unique unit, and two unique
technologies each:

| Culture | Character | Bonuses | Unique |
|---|---|---|---|
| **Valen** | agrarian | +15% food, +10% growth | Paladin · Stewardship, Chivalry |
| **Norvik** | raiders | +1 infantry attack, +15% infantry speed, +10% wood | Huscarl · Shieldwall, Longships |
| **Ashari** | scholars | +25% research speed, +10% gold | Camel Rider · Astronomy, Spice Routes |

Two rival realms hold the other cultures and the far settlements. They build,
research, and train by exactly your rules — and they will not stay peaceful.

## Winning and losing

- **Win by conquest** — take **every rival capital** (each realm's seat of power).
- **Win by Wonder** — in the Golden Age, raise the **Wonder** (1000 🪵, 2000 ⛰, 1500 🪙,
  120 days of labor) and **hold it for 60 days**. The top bar counts down.
- **Lose** — your **capital falls**. That's the whole rule. Garrison it.

The HUD's goal line keeps the objectives in view for your first year.

## Threats

- **Raids**: uncleared bandit camps send raiding bands every season (from about
  day 45). Raiders don't take towns — they plunder your stores and carry off folk,
  then melt away. **Clearing camps is prevention.** Raids scale with the ages.
- **The dragon**: the first realm to reach the Golden Age wakes something in the
  deep wilds. It burns the largest town, then the next. It *can* be slain —
  a walled town with a keep and a full garrison will end it, and claim its hoard.
- **Rival realms**: after an early grace period, expect war. Watch the Diplomacy
  panel; the levy defends your towns, but a standing garrison defends them better.

## The screen

| Where | What |
|---|---|
| **Top bar** | Resources (🌾 food, 🪵 wood, ⛰ stone, 🪙 gold) with per-day rates, 👥 population, current **age**, date, the **⚗ Tech** button, and speed controls |
| **Right panel** | **Construct** — queue buildings in the selected settlement; **Workers** — allocation sliders |
| **Second right panel** | **War ministry** — train troops, view the garrison, form and command armies |
| **Bottom left** | The **chronicle** — your realm's history, written as it happens |
| **Center toasts** | Completions and rejections (a red toast tells you *why* an order failed) |

## Building on the map (free placement)

Click a card in the **Construct** panel, then click the ground: a ghost of the
building follows your cursor — **green** where it may stand, **red** where it
may not (water, another realm's land, too far from your settlements, on top of
something, or inside the town core). Left-click places it; **Esc** or
right-click cancels. Placed buildings rise exactly where you put them.

## Fog of war

You see what your realm sees: the land around your settlements and armies.
Everything else is dark until explored, and once-seen ground dims when your
sight leaves — enemy armies move unseen out there. March armies to scout,
garrison the frontier, and remember: the raiders you cannot see are still
coming. (The chronicle's annalist, as ever, knows all — read it.)

## Commanding on the map (RTS controls)

- **Left click** an army banner to select the whole army; **left-drag a box over
  soldiers to select them individually** — the chip at the bottom shows what you
  hold. **Shift-click** adds armies; **Esc** or clicking empty ground clears.
- **Split and command (per-unit micro)**: with soldiers box-selected, right-click
  anywhere — the chosen soldiers **detach into a new army** under their own banner
  and march to the point (or at the enemy/camp/town you clicked). Peel your archers
  away from the line, send half the host home, screen a raid with a picket — every
  soldier is a real entity with its own place in the column.
- **Right click** with an army selected: open ground → **march there and hold**; an enemy army → **attack it**; a bandit camp → **assault it**; an enemy town (at war) → **besiege it**.
- **Middle-drag** orbits the camera, **scroll** zooms, **WASD** (or pushing the
  pointer to a screen edge) pans.
- The **minimap** (bottom right) shows the world through your fog: gold squares
  are your towns, ember ones everyone else's, dots are armies. **Click or drag
  it to jump the camera.** When trouble starts — a raid, a siege, your army
  ambushed — a red **alert** appears up top and a ping pulses on the minimap;
  **click the alert to jump straight to the fighting**.
- **Control groups**: select armies, press `Ctrl+1`…`9` to bank them, a bare
  digit to recall, and double-tap the digit to center the camera on them.
  (Groups hold armies, not box-selected soldiers, and reset on reload.)
- Hostile armies that meet in the open **fight a field battle** — you can intercept raiders and invading armies before they reach your towns (and your token forces can be cut down on the road, so escort matters).
- The panel dropdown still works for everything if you prefer menus.

| Key | Action |
|---|---|
| `Space` | pause / resume |
| `Z` / `X` / `C` | speed 1× / 4× / 12× |
| `W` `A` `S` `D` | pan camera (screen edges scroll too) |
| `1`–`9` | recall control group (double-tap centers camera) |
| `Ctrl+1`–`9` | assign selected armies to a group |
| `T` | tech tree |
| `Esc` | cancel placement / clear selection |

## Your first hour, step by step

1. **Feed the realm.** Watch the 🌾 rate in the top bar. Your workers auto-assign
   proportionally to what the land offers; drag the **Workers** sliders to override.
   Setting a slider to zero means *nobody* works that job.
2. **Build the economy — it doesn't exist until you build it.** Every settlement
   starts as little more than a **Town Center** and a few houses; the land alone
   offers only a handful of worker slots. **Farms, Lumber Camps, Quarries, and
   Markets add slots**; **Houses raise the population cap** (your towns literally
   cannot grow without them); Storehouses raise how much you can stockpile (watch
   for "stores overflow" in the chronicle — that's waste). **Palisades**, and later
   Stone Walls and a Keep, are what stand between a siege and your streets.
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

v0.1 is complete: cultures, rival realms, war, threats, win/lose, and saves.
Next is the **RTS layer** (M7+) — direct unit selection and control, free
building placement, fog of war — see [docs/PLAN.md](PLAN.md) for the roadmap.
