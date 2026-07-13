import type { BuildingId, ResourceId } from '../content/schema';
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
  | { kind: 'commandRejected'; realm: RealmId; reason: string }
  | { kind: 'chronicle'; tick: number; text: string; tone: 'neutral' | 'good' | 'grim' };
