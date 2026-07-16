import { RALLY_BATCH } from '../../content/rts';
import type { UnitId } from '../../content/schema';
import { UNITS } from '../../content/units';
import { totalUnits } from '../combat';
import type { SimEvent } from '../events';
import { resolveStat } from '../modifiers';
import type { GameState, SimSettlement } from '../state';
import { spawnArmyUnits } from '../unitStore';
import { routePath } from './armies';

/**
 * Advances the head of each settlement's training queue (one unit at a time).
 * Costs and population were paid at queue time; completions join the garrison —
 * or, with a rally set (M13), reinforce a field army / muster toward the flag.
 */
export function trainingSystem(state: GameState, out: SimEvent[]): void {
  for (const s of state.settlements) {
    const job = s.trainQueue[0];
    if (job) {
      const def = UNITS[job.unit];
      if (!def) {
        s.trainQueue.shift();
        continue;
      }
      job.progress += resolveStat({ state, realm: s.ownerRealm, settlement: s.id }, 1, {
        stat: 'trainSpeed',
        unitTag: def.tags[0],
      });
      if (job.progress >= def.trainTime) {
        deliver(state, s, def.id);
        job.remaining -= 1;
        job.progress = 0;
        out.push({ kind: 'unitsTrained', settlement: s.id, unit: def.id, count: 1 });
        if (job.remaining <= 0) s.trainQueue.shift();
      }
    }

    // rally flag (M13): a full band in the garrison marches for the flag
    if (s.rally?.kind === 'point' && totalUnits(s.garrison) >= RALLY_BATCH) {
      const site = state.world.settlements[s.id];
      const units = { ...s.garrison };
      s.garrison = {};
      const band = {
        id: state.nextArmyId,
        ownerRealm: s.ownerRealm,
        home: s.id,
        units,
        x: site.x,
        z: site.z,
        prevX: site.x,
        prevZ: site.z,
        path: [[site.i, site.j]] as [number, number][],
        pathIdx: 0,
        cellProgress: 0,
        objective: { kind: 'moveTo' as const, i: s.rally.i, j: s.rally.j },
        phase: 'marching' as const,
        stance: 'defensive' as const,
        battleStartStrength: 0,
      };
      state.armies.push(band);
      spawnArmyUnits(state, band, units);
      routePath(state, band, s.rally.i, s.rally.j);
      out.push({ kind: 'armyFormed', army: band.id, settlement: s.id, strength: totalUnits(units) });
      state.nextArmyId += 1;
    }
  }
}

/**
 * Where a finished recruit goes: a rally-to-army sends the soldier straight to
 * the field (the unit store's reconciler fields the body at the army's anchor
 * this same tick — armies run after training); a dead or foreign rally target
 * clears itself and the recruit falls back to the garrison.
 */
function deliver(state: GameState, s: SimSettlement, unit: UnitId): void {
  if (s.rally?.kind === 'army') {
    const target = state.armies.find((a) => a.id === (s.rally as { army: number }).army);
    if (target && target.ownerRealm === s.ownerRealm && !target.defending && totalUnits(target.units) > 0) {
      target.units[unit] = (target.units[unit] ?? 0) + 1;
      return;
    }
    delete s.rally; // the host it fed is gone
  }
  s.garrison[unit] = (s.garrison[unit] ?? 0) + 1;
}
