import type { DayData } from './types';

/**
 * Pure helpers for live sync (no runtime imports, so they run under `bun test`).
 * The client in sync.svelte.ts keeps, per date, the JSON last confirmed by the server; a day
 * whose JSON differs from that has local changes to send.
 */

/** A day nobody has touched: never generated, not edited, every teacher and class available,
 *  default rows. Not worth uploading. */
export const isPristine = (d: DayData) =>
  d.rules === undefined && !d.edited && !d.layout && d.unavailable.length === 0 && !d.classesOff?.length && !Object.keys(d.events ?? {}).length;

/**
 * The days to send now, as [date, json]. Skips days with a put still awaiting its answer (one
 * at a time per day, so each put is based on the latest version), days that match the server,
 * and pristine days the server doesn't have yet.
 */
export function datesToPush(
  days: Record<string, DayData>,
  synced: ReadonlyMap<string, string>,
  versions: ReadonlyMap<string, number>,
  inflight: ReadonlySet<string>,
): [string, string][] {
  const out: [string, string][] = [];
  for (const [date, day] of Object.entries(days)) {
    if (inflight.has(date)) continue;
    const json = JSON.stringify(day);
    if (json === synced.get(date)) continue;
    if (!versions.has(date) && isPristine(day)) continue;
    out.push([date, json]);
  }
  return out;
}
