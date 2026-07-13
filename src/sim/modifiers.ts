import { BUILDINGS } from '../content/buildings';
import { CULTURES } from '../content/cultures';
import type { BuildingId, Modifier, ResourceId, Stat, UnitTag } from '../content/schema';
import { TECHS } from '../content/techs';
import type { GameState, RealmId } from './state';

/**
 * The effects engine. Every rate/cap lookup in the sim routes through
 * resolveStat: (base + Σ adds) × Π muls over all modifier sources, filtered
 * by the query's scope. Sources today: researched techs and building
 * PRESENCE (once per building type per scope — ten universities are no
 * better than one). M5 adds culture bonuses as a third source, one line.
 */
export interface ModifierContext {
  state: GameState;
  realm: RealmId;
  settlement?: number;
}

export interface StatQuery {
  stat: Stat;
  resource?: ResourceId;
  unitTag?: UnitTag;
  buildingId?: BuildingId;
}

/** Building types in scope: one settlement's, or the realm-wide union. */
function buildingTypesInScope(ctx: ModifierContext): Set<string> {
  const types = new Set<string>();
  const collect = (s: { buildings: Partial<Record<string, number>> }) => {
    for (const [id, n] of Object.entries(s.buildings)) if ((n ?? 0) > 0) types.add(id);
  };
  if (ctx.settlement !== undefined) {
    const s = ctx.state.settlements[ctx.settlement];
    if (s) collect(s);
  } else {
    for (const s of ctx.state.settlements) {
      if (s.ownerRealm === ctx.realm) collect(s);
    }
  }
  return types;
}

export function resolveStat(ctx: ModifierContext, base: number, q: StatQuery): number {
  let add = 0;
  let mul = 1;
  const apply = (mods: readonly Modifier[] | undefined) => {
    if (!mods) return;
    for (const m of mods) {
      if (m.stat !== q.stat) continue;
      if (m.resource !== undefined && m.resource !== q.resource) continue;
      if (m.unitTag !== undefined && m.unitTag !== q.unitTag) continue;
      if (m.buildingId !== undefined && m.buildingId !== q.buildingId) continue;
      if (m.op === 'add') add += m.value;
      else mul *= m.value;
    }
  };

  const realm = ctx.state.realms[ctx.realm];
  if (realm) {
    for (const t of realm.researchedTechs) apply(TECHS[t]?.effects);
    for (const b of buildingTypesInScope(ctx)) apply(BUILDINGS[b]?.effects);
    if (realm.culture) apply(CULTURES[realm.culture]?.bonuses); // the M5 source, as designed
  }
  return (base + add) * mul;
}
