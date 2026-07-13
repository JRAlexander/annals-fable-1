import type { AgeId, BuildingId, ResourceId, TechId, UnitId } from '../content/schema';
import type { RealmId } from './state';

/**
 * Raw events are the machine-readable channel (UI badges, future AI triggers);
 * `chronicle` events are the prose channel rendered in the log panel.
 */
export type SimEvent =
  | { kind: 'realmFounded'; realm: RealmId; tick: number }
  | { kind: 'dayEnd'; tick: number; day: number; year: number }
  | { kind: 'starvation'; settlement: number; deaths: number }
  | { kind: 'popMilestone'; settlement: number; milestone: number }
  | { kind: 'storageFull'; realm: RealmId; resource: ResourceId }
  | { kind: 'buildingQueued'; settlement: number; building: BuildingId }
  | { kind: 'buildingCompleted'; settlement: number; building: BuildingId }
  | { kind: 'researchStarted'; realm: RealmId; tech: TechId }
  | { kind: 'researchCompleted'; realm: RealmId; tech: TechId }
  | { kind: 'ageAdvanceStarted'; realm: RealmId; age: AgeId }
  | { kind: 'ageAdvanced'; realm: RealmId; age: AgeId }
  | { kind: 'unitsTrained'; settlement: number; unit: UnitId; count: number }
  | { kind: 'armyFormed'; army: number; settlement: number; strength: number }
  | { kind: 'armyDeparted'; army: number; camp: number }
  | { kind: 'battleStarted'; army: number; camp: number }
  | { kind: 'campCleared'; army: number; camp: number; loot: number }
  | { kind: 'battleLost'; army: number; camp: number }
  | { kind: 'armyRouted'; army: number; camp: number }
  | { kind: 'armyReturned'; army: number; settlement: number }
  | { kind: 'armyDestroyed'; army: number; realm: RealmId }
  | { kind: 'warDeclared'; realm: RealmId; target: RealmId }
  | { kind: 'armyMarchedOnSettlement'; army: number; settlement: number }
  | { kind: 'siegeStarted'; army: number; settlement: number }
  | { kind: 'levyRaised'; settlement: number; count: number }
  | { kind: 'settlementCaptured'; settlement: number; by: RealmId; from: RealmId }
  | { kind: 'siegeRepelled'; army: number; settlement: number }
  | { kind: 'commandRejected'; realm: RealmId; reason: string }
  // M7a: field battles
  | { kind: 'armiesEngaged'; a: number; b: number }
  | { kind: 'fieldBattleWon'; winner: number; loser: number }
  // M6: threats and endings
  | { kind: 'raidSpawned'; camp: number; settlement: number; strength: number }
  | { kind: 'settlementRaided'; settlement: number; plunder: number }
  | { kind: 'dragonAwakened'; settlement: number }
  | { kind: 'dragonSlain'; realm: RealmId; hoard: number }
  | { kind: 'wonderCompleted'; realm: RealmId; settlement: number }
  | { kind: 'gameWon'; how: 'conquest' | 'wonder' }
  | { kind: 'gameLost' }
  | { kind: 'chronicle'; tick: number; text: string; tone: 'neutral' | 'good' | 'grim' };
