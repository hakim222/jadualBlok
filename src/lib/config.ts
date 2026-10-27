import type { SchoolClass } from './types';

/** The class list until the server's arrives; the server is seeded with the same ids (schema.sql). */
export const DEFAULT_CLASSES: SchoolClass[] = Array.from({ length: 15 }, (_, i) => ({ id: `k${i + 1}`, name: `K${i + 1}` }));

/** Classes sharing one row on a new day, by name (when both exist and are taught that day). */
export const DEFAULT_COMBINED = [['K1', 'K2'], ['K3', 'K4'], ['K6', 'K7'], ['K8', 'K9'], ['K10', 'K11'], ['K12', 'K13'], ['K14', 'K15']];

/** Days saved before classes could change had these 8 rows, in this order. */
export const LEGACY_ROWS = [['k1', 'k2'], ['k3', 'k4'], ['k5'], ['k6', 'k7'], ['k8', 'k9'], ['k10', 'k11'], ['k12', 'k13'], ['k14', 'k15']];

export const RECESS = '9.00-9.30';

/** Teaching slots in order: [set0 pos0, set0 pos1, set1 pos0, set1 pos1]. Recess sits between the two sets. */
const SLOTS_MON_THU = ['7.30-8.15', '8.15-9.00', '9.30-11.00', '11.00-12.30'];
const SLOTS_FRI = ['7.30-8.15', '8.15-9.00', '9.30-10.45', '10.45-12.00'];

export function slotsFor(weekday: number): string[] {
  return weekday === 5 ? SLOTS_FRI : SLOTS_MON_THU;
}

/** "9.30-11.00" -> 90 */
export function slotMinutes(label: string): number {
  const [a, b] = label.split('-').map((t) => {
    const [h, m] = t.split('.').map(Number);
    return h * 60 + (m || 0);
  });
  return b - a;
}

export function formatMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}
