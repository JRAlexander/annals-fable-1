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

## Unit autonomy (let the realm run itself)

Armies and villagers now act sensibly on their own — every knob below lives in
the two right panels, and **a direct order from you always overrides autonomy**.

- **Stances** (dropdown on each army row in the War ministry):

  | Stance | An idle army will… |
  |---|---|
  | 🛡 **Defensive** *(default)* | march out to intercept **raiders bound for your towns** (up to 30 cells), then walk back to the post it left |
  | ⚔ **Aggressive** | hunt **anything hostile in sight** (about as far as it can see through the fog) |
  | ⚓ **Stand ground** | nothing — it moves only on your orders |

- **Rally** (dropdown under the Garrison): choose where fresh troops go the
  moment training finishes. **Reinforce Army N** trickles every recruit
  straight onto the field — the army grows where it stands. **📍 Place rally
  flag** lets you click the map; the garrison then marches for the flag in
  bands of 10. Garrison (the default) keeps troops home.
- **🏛 Governor** (checkbox in the Villagers panel): hands that town's
  villager training and job assignments to the same book the rival realms
  play by — food first, then wood. Your manual −/+ buttons grey out while
  the governor holds the ledger; untick to take it back.
- **Villagers flee on their own**: when a hostile army comes within sight of
  a town, its workers drop what they're doing and carry their baskets home,
  holding at the Town Center until the danger passes. Fewer raid deaths, no
  clicks required.
- **⌖ Explore** (button on each army row): the army becomes a scout — every
  time it goes idle it marches for the nearest unexplored ground, over and
  over, until the map is known (or you toggle it off). It still fights back
  as normal if caught, and it resumes scouting after.

### Full autopilot (the realm runs itself)

Two more offices complete the picture — with them all on, you set strategy
and the realm does the rest:

- **⚖ Steward** (checkbox in the Villagers panel, per town): the town queues
  its own buildings by the same book the rival realms use — farms first,
  houses next, then the working buildings — and the realm picks its own
  research whenever the slot is idle (cheapest first, then the age advance).
  The Construct cards stay live: anything **you** queue pre-empts the steward
  for the day. The steward will never start a **Wonder** — that gamble is
  yours alone.
- **⚜ Marshal** (checkbox at the head of the Armies list, realm-wide): a
  military autopilot. Every day it trains garrisons toward a rising target at
  each barracks town (never below 300 food, never at towns where you've set a
  rally — your plans win), forms its own armies (marked **⚜**, shown as
  `troops/muster`), pulls badly bled ones home to refill, **clears bandit
  camps it can beat** — it does the same power arithmetic behind the **✓**
  marks in the camp dropdown — and stations the rest at your most exposed
  towns, where their defensive stance intercepts raiders. The marshal **never
  declares war and never attacks another realm's towns**: conquest stays in
  your hands. Marshal armies still obey your direct orders.
- In battle, ranged soldiers now **kite** — backing away from melee while
  still firing — and every soldier picks out the enemy it counters when one
  is in reach. Bring the counter units all the same; kiters are slower
  backing up than their hunters are closing in.

## Diplomacy (wars end now)

The Diplomacy list (bottom of the War ministry) runs the realm's statecraft:

- **Sue for peace**: while at war, pick your terms — 🕊 **White peace**,
  🎁 **Offer tribute** (a quarter of your stock), or 💰 **Demand tribute**
  (a quarter of theirs) — and the button tells you up front whether **they
  will accept or refuse**, judged by the same arithmetic the rival itself
  uses: *the beaten accept anything reasonable, equals take white peace, and
  the strong want paying*. A realm whose armies have collapsed will concede
  up to a quarter of its treasury.
- **Peace ends the fighting everywhere, at once**: battles break off, sieges
  and pursuits turn for home, defenders stand down. (Bandits sign nothing —
  the wilds fight on.)
- **The truce**: every peace holds for **120 days** — shown as 🤝 with a
  countdown — and neither side can declare again until it lifts. Mind your
  storehouses: a full treasury wastes incoming tribute.
- **The AI sues too**: a rival losing its war will offer you a quarter of its
  stock for peace — it lands automatically (you never pay a demand you didn't
  choose), with a toast and a chronicle line. But **never while your armies
  are at their gates** — a conqueror mid-campaign cannot be bought off; if
  you want their gold instead of their towns, call your armies home first.
- **Coalitions**: hold a strict **majority of the world's towns** — you or
  anyone else — and the other realms take counsel: they declare war on the
  leader together and settle their own quarrels. The world holds a grudge
  against the mighty; expect the pact when your borders swell. But grievance
  needs time to gather: **no pact forms before day 90**, so a strong start
  isn't punished with a war on day one.

| Key | Action |
|---|---|
| `Space` | pause / resume |
| `Z` / `X` / `C` | speed 1× / 4× / 12× |
| `W` `A` `S` `D` | pan camera (screen edges scroll too) |
| `1`–`9` | recall control group (double-tap centers camera) |
| `Ctrl+1`–`9` | assign selected armies to a group |
| `T` | tech tree |
| `Esc` | cancel placement or rally-flag pick / clear selection |

## Espionage (the quiet service)

Every rival's row in the Diplomacy list carries a spy line — four missions,
paid in gold, in war or in peace (spying breaks no truce):

| Mission | Cost | What your agent does |
|---|---|---|
| 🗺 **Scout** | 75 gold | Maps the country around their **capital** — the fog there turns to explored ground |
| 📜 **Intel** | 100 gold | Smuggles out a ledger: their gold, war strength vs yours, wars, and whether **a Wonder rises** — shown under their row |
| 🔥 **Sabotage** | 250 gold | Sets their most precious construction back **60 ticks** — a rising Wonder is always the first target |
| 💰 **Steal** | 200 gold | Lifts **15%** of their treasury into yours |

The tradecraft:

- **Travel**: an agent needs **3 days** on the road before the mission
  resolves — the toast tells you when they're dispatched, and again when word
  comes back.
- **Cooldown**: after any mission against a realm, your agents **lie low for
  20 days** before another can be sent there (other rivals remain fair game).
- **Counter-espionage**: the spy line shows your odds. The base is **75%**,
  and every **Keep** the target holds cuts it by **20 points** (never below
  15%). A caught agent is simply lost — the fee is sunk, the chronicle names
  the shame, and the target's court reads about it too. Build Keeps at home:
  **the AI runs saboteurs against rising Wonders**, including yours.
- **The ledger fades**: intel is a snapshot, kept until you reload the game —
  the chronicle keeps the prose record for posterity.

## Trade (the market earns its name)

Once your realm owns a **Market** (or Guildhall), the **Trade** section
appears at the bottom of the build panel:

- **The exchange**: sell 100 food, wood, or stone for gold — or spend 100
  gold the other way — at the realm's standing rates (gold 1 : stone ½ :
  wood ¼ : food ¼), **less the market's 25% cut**. Selling and buying back
  loses the cut twice: the exchange is for emergencies and windfalls, not
  arbitrage.
- **Caravan routes**: pick a destination town from the route list and carts
  roll automatically — out along the roads, sold at the far market, and home
  with the gold. **Pay scales with distance** (~40 + 8 per road cell, half
  paid at each end), and **foreign towns pay half again more** than your own.
  Each Market or Guildhall at the home town supports one cart.
- **The risks**: war closes the road — carts turn for home empty and the
  route is struck. Lose the home town and its caravans are lost with it.
  Storehouses matter: a fat payout over your gold cap is simply wasted.
- **The techs finally pay**: Coinage, Caravans, Banking — and the cultural
  gold techs — all scale real caravan income now, not just market stalls.
- **Everyone trades**: rival realms run caravans too (a **Steward**ed town
  of yours will keep its own route running). Their carts on your roads are
  their gold, not yours.

## Your first hour, step by step

1. **Your villagers ARE the economy.** Every scrap in your stockpile is carried
   there by a villager: they walk to a farm or a forest, fill a basket, and haul
   it to the nearest dropoff. Watch them stream between the fields and the Town
   Center — **the length of that walk IS your gather rate**. The **Villagers**
   panel (right) sets how many work each job with −/+ buttons; 🧺 in the top bar
   counts idle hands. Train more at the Town Center (40 food + 1 pop each).
2. **Build a Farm first — your people starve without one.** Wood and stone come
   from the land (forest and rock cells), but food and gold need **Farms** and
   **Markets** to work at (5 villagers each). Then play the placement game:
   a **Lumber Camp at the treeline** or a **Quarry by the rock** receives loads
   on the spot and can more than double that job's income vs hauling home.
   **Houses raise the population cap**; Storehouses raise how much you can
   stockpile (watch for "stores overflow" — that's waste). **Palisades**, and
   later Stone Walls and a Keep, are what stand between a siege and your streets.
   Raids kill villagers, and conquest converts them — protect the hands that feed you.
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

v0.2 is a full game: the RTS layer (unit selection and control, free building
placement, fog of war), true per-soldier combat with counters and micro, the
villager economy where walk distance IS the gather rate, unit autonomy
through full autopilot (governor, steward, marshal), diplomacy with peace,
tribute, truces and coalitions, espionage with scouts, ledgers, saboteurs and
counter-spy Keeps, and — newest — real trade: a market exchange and caravan
routes that make gold ride the roads.

Plausible nexts, in no particular order: a **naval layer** (today water is
scenery), **sound and a proper menu** (the game is silent and settings-free),
and **deeper content** — more cultures, siege engines beyond the ram, and
branching techs. See [docs/PLAN.md](PLAN.md) for history.
