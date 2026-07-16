import { AGE_ORDER, AGES, ageIndex } from './ages';
import { BUILDINGS } from './buildings';
import { CULTURES } from './cultures';
import { SEED_BUILDINGS } from './economy';
import type { Cost, ResourceId } from './schema';
import { TECHS } from './techs';
import { UNITS } from './units';

const RESOURCES: readonly ResourceId[] = ['food', 'wood', 'stone', 'gold'];

function badCost(cost: Cost, where: string, out: string[]): void {
  for (const [res, amt] of Object.entries(cost)) {
    if (!RESOURCES.includes(res as ResourceId)) out.push(`${where}: unknown resource '${res}'`);
    if (!Number.isFinite(amt) || (amt as number) < 0) out.push(`${where}: invalid amount for ${res}`);
  }
}

/**
 * Content integrity checks, run in CI (tests/content.test.ts). Returns a list
 * of human-readable errors; empty means the content is consistent. Guards the
 * data-not-code contract: dangling ids and cycles fail the build, not the game.
 */
export function validateContent(): string[] {
  const errors: string[] = [];

  // ages: contiguous indices in declared order
  AGE_ORDER.forEach((id, i) => {
    if (AGES[id].index !== i) errors.push(`age ${id}: index ${AGES[id].index} !== position ${i}`);
    badCost(AGES[id].advanceCost, `age ${id}`, errors);
  });

  for (const [key, def] of Object.entries(BUILDINGS)) {
    if (def.id !== key) errors.push(`building ${key}: id '${def.id}' mismatch`);
    badCost(def.cost, `building ${key}`, errors);
    for (const t of def.requiresTechs ?? []) {
      const tech = TECHS[t];
      if (!tech) errors.push(`building ${key}: requiresTechs '${t}' does not exist`);
      else if (ageIndex(tech.age) > ageIndex(def.requiresAge))
        errors.push(`building ${key}: gated on tech '${t}' from a later age than the building`);
    }
    for (const m of def.effects ?? []) {
      if (m.op === 'mul' && (!Number.isFinite(m.value) || m.value <= 0))
        errors.push(`building ${key}: mul modifier must be finite and > 0`);
    }
    for (const fn of def.functions) {
      if (fn.kind === 'fort' && fn.hp <= 0) errors.push(`building ${key}: fort hp must be positive`);
      if (fn.kind === 'workplace' && fn.slots <= 0)
        errors.push(`building ${key}: workplace slots must be positive`);
      if (fn.kind === 'dropoff' && fn.resources.length === 0)
        errors.push(`building ${key}: dropoff must accept at least one resource`);
    }
    if (def.seedOnly && Object.keys(def.cost).length > 0)
      errors.push(`building ${key}: seedOnly buildings must be free (never paid for)`);
  }
  // the town center must take every resource — villagers always have a home dropoff
  {
    const tc = BUILDINGS.townCenter;
    const drop = tc?.functions.find((f) => f.kind === 'dropoff');
    if (!drop || drop.kind !== 'dropoff' || drop.resources.length < 4)
      errors.push('townCenter: must be a universal dropoff');
  }

  // settlement seeds: real buildings, exactly one town center per tier
  for (const [tier, seeds] of Object.entries(SEED_BUILDINGS)) {
    for (const id of Object.keys(seeds)) {
      if (!BUILDINGS[id]) errors.push(`seed ${tier}: building '${id}' does not exist`);
    }
    if ((seeds.townCenter ?? 0) !== 1) errors.push(`seed ${tier}: must seed exactly one townCenter`);
  }

  for (const [key, def] of Object.entries(TECHS)) {
    if (def.id !== key) errors.push(`tech ${key}: id '${def.id}' mismatch`);
    badCost(def.cost, `tech ${key}`, errors);
    const at = BUILDINGS[def.researchedAt];
    if (!at) errors.push(`tech ${key}: researchedAt '${def.researchedAt}' does not exist`);
    else if (ageIndex(at.requiresAge) > ageIndex(def.age))
      errors.push(`tech ${key}: researchedAt building arrives after the tech's age`);
    for (const p of def.prereqs) {
      const pre = TECHS[p];
      if (!pre) errors.push(`tech ${key}: prereq '${p}' does not exist`);
      else if (ageIndex(pre.age) > ageIndex(def.age))
        errors.push(`tech ${key}: prereq '${p}' is from a later age`);
    }
    for (const b of def.unlocks?.buildings ?? []) {
      const building = BUILDINGS[b];
      if (!building) errors.push(`tech ${key}: unlocks building '${b}' which does not exist`);
      else if (!(building.requiresTechs ?? []).includes(key))
        errors.push(`tech ${key}: unlocks '${b}' but that building does not require it`);
    }
    for (const u of def.unlocks?.units ?? []) {
      if (!UNITS[u]) errors.push(`tech ${key}: unlocks unit '${u}' which does not exist`);
    }
    for (const m of def.effects) {
      if (m.op === 'mul' && (!Number.isFinite(m.value) || m.value <= 0))
        errors.push(`tech ${key}: mul modifier must be finite and > 0`);
    }
  }

  // prereq cycles (DFS)
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (id: string, path: string[]): void => {
    if (state.get(id) === 'done') return;
    if (state.get(id) === 'visiting') {
      errors.push(`tech prereq cycle: ${[...path, id].join(' → ')}`);
      return;
    }
    state.set(id, 'visiting');
    for (const p of TECHS[id]?.prereqs ?? []) visit(p, [...path, id]);
    state.set(id, 'done');
  };
  for (const id of Object.keys(TECHS)) visit(id, []);

  // units: id keys, costs, trainable somewhere no later than their own age, tech refs
  const trainedAt = new Map<string, string[]>(); // unitId → building ids that train it
  for (const [bKey, b] of Object.entries(BUILDINGS)) {
    for (const fn of b.functions) {
      if (fn.kind === 'training') {
        for (const u of fn.units) {
          if (!UNITS[u]) errors.push(`building ${bKey}: trains unknown unit '${u}'`);
          else trainedAt.set(u, [...(trainedAt.get(u) ?? []), bKey]);
        }
      }
    }
  }
  for (const [key, def] of Object.entries(UNITS)) {
    if (def.id !== key) errors.push(`unit ${key}: id '${def.id}' mismatch`);
    badCost(def.cost, `unit ${key}`, errors);
    const wild = def.tags.includes('monster'); // monsters are spawned, never trained
    const homes = trainedAt.get(key) ?? [];
    if (homes.length === 0 && !wild) errors.push(`unit ${key}: no building trains it`);
    else if (homes.length > 0 && wild) errors.push(`unit ${key}: monsters must not be trainable`);
    else if (!wild && !homes.some((b) => ageIndex(BUILDINGS[b].requiresAge) <= ageIndex(def.requiresAge)))
      errors.push(`unit ${key}: every training building arrives after the unit's own age`);
    for (const t of def.requiresTechs ?? []) {
      if (!TECHS[t]) errors.push(`unit ${key}: requiresTechs '${t}' does not exist`);
    }
    if (def.hp <= 0 || def.speed <= 0 || (def.popCost <= 0 && !wild))
      errors.push(`unit ${key}: non-positive vitals`);
  }

  // cultures: unique units/techs exist and are locked to the right culture
  for (const [key, def] of Object.entries(CULTURES)) {
    if (def.id !== key) errors.push(`culture ${key}: id '${def.id}' mismatch`);
    const uu = UNITS[def.uniqueUnit];
    if (!uu) errors.push(`culture ${key}: uniqueUnit '${def.uniqueUnit}' does not exist`);
    else if (uu.culture !== key)
      errors.push(`culture ${key}: uniqueUnit '${def.uniqueUnit}' not locked to it`);
    for (const t of def.uniqueTechs) {
      const tech = TECHS[t];
      if (!tech) errors.push(`culture ${key}: uniqueTech '${t}' does not exist`);
      else if (tech.culture !== key) errors.push(`culture ${key}: uniqueTech '${t}' not locked to it`);
    }
    for (const v of Object.values(def.architecture.palette)) {
      if (!Number.isFinite(v)) errors.push(`culture ${key}: palette value not finite`);
    }
    for (const m of def.bonuses) {
      if (m.op === 'mul' && (!Number.isFinite(m.value) || m.value <= 0))
        errors.push(`culture ${key}: mul bonus must be finite and > 0`);
    }
  }
  // reverse: culture-locked content must be claimed by its culture
  for (const [key, def] of Object.entries(UNITS)) {
    if (def.culture && CULTURES[def.culture]?.uniqueUnit !== key)
      errors.push(`unit ${key}: locked to '${def.culture}' but not its uniqueUnit`);
  }
  for (const [key, def] of Object.entries(TECHS)) {
    if (def.culture && !CULTURES[def.culture]?.uniqueTechs.includes(key))
      errors.push(`tech ${key}: locked to '${def.culture}' but not in its uniqueTechs`);
  }

  // every advancement is satisfiable: each non-terminal age offers enough building types
  for (let i = 0; i < AGE_ORDER.length - 1; i++) {
    const age = AGE_ORDER[i];
    const next = AGES[AGE_ORDER[i + 1]];
    // seedOnly buildings never count toward advancement (they're free at init)
    const types = Object.values(BUILDINGS).filter((b) => b.requiresAge === age && !b.seedOnly).length;
    if (types < next.requires.buildingsFromCurrentAge)
      errors.push(
        `age ${age}: only ${types} building types but advancing needs ${next.requires.buildingsFromCurrentAge}`,
      );
  }

  return errors;
}
