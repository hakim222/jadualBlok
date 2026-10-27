import { blockNames, emptyBlock } from './scheduler';
import type { ClassId, DayData, Named, Row, TeacherId, Timetable } from './types';

/**
 * Pure helpers for the classes of a day (no runtime imports, so they run under `bun test`).
 * Each taught class sits in exactly one row; a row with several classes is combined ("K1/K2").
 * Classes not taught that day are in `classesOff` and in no row. Rows keep the class-list order.
 */

/** Default layout for a new day: `combined` groups (by name) share a row when all their classes are taught. */
export function defaultGroups(classes: Named[], combined: string[][], off: ReadonlySet<ClassId> = new Set()): ClassId[][] {
  const taught = classes.filter((c) => !off.has(c.id));
  const byName = new Map(taught.map((c) => [c.name.toUpperCase(), c.id]));
  const groupOf = new Map<ClassId, ClassId[]>();
  for (const names of combined) {
    const ids = names.map((n) => byName.get(n.toUpperCase()));
    if (ids.length < 2 || ids.some((id) => !id || groupOf.has(id))) continue;
    for (const id of ids as ClassId[]) groupOf.set(id, ids as ClassId[]);
  }
  const groups: ClassId[][] = [];
  const done = new Set<ClassId>();
  for (const c of taught) {
    if (done.has(c.id)) continue;
    const g = groupOf.get(c.id) ?? [c.id];
    g.forEach((id) => done.add(id));
    groups.push(g);
  }
  return groups;
}

/**
 * Converts a day saved before classes could change: its rows get the classes they always stood
 * for (row i → legacy[i]). Returns whether anything changed.
 */
export function migrateDay(d: DayData, legacy: ClassId[][]): boolean {
  let changed = false;
  d.tt.forEach((row, i) => {
    if (!Array.isArray(row.classes)) {
      row.classes = [...(legacy[i] ?? [])];
      changed = true;
    }
  });
  // Rows beyond the legacy layout had no class: drop them.
  const before = d.tt.length;
  d.tt = d.tt.filter((row) => row.classes.length);
  return changed || d.tt.length !== before;
}

const order = (classes: Named[]) => new Map(classes.map((c, i) => [c.id, i]));

/** Puts a one-class row (no teachers) where the class list says it goes. */
export function insertClassRow(tt: Timetable, id: ClassId, classes: Named[]) {
  const pos = order(classes);
  const at = pos.get(id) ?? Infinity;
  const i = tt.findIndex((row) => (pos.get(row.classes[0]) ?? Infinity) > at);
  const row: Row = { classes: [id], sets: [emptyBlock(), emptyBlock()] };
  if (i < 0) tt.push(row);
  else tt.splice(i, 0, row);
}

/**
 * Takes a class out of its row; a row left with no class goes, with its teachers.
 * Returns the teachers who lost their cells (empty when the row stays).
 */
export function removeClass(tt: Timetable, id: ClassId): TeacherId[] {
  const i = tt.findIndex((row) => row.classes.includes(id));
  if (i < 0) return [];
  const row = tt[i];
  row.classes = row.classes.filter((x) => x !== id);
  if (row.classes.length) return [];
  tt.splice(i, 1);
  return [...new Set(row.sets.flatMap(blockNames))];
}

/**
 * Brings a day in line with the class list: classes that no longer exist leave their rows (and
 * `classesOff`), and classes in neither get their own row. Returns whether anything changed.
 */
export function reconcileClasses(d: DayData, classes: Named[]): boolean {
  const known = new Set(classes.map((c) => c.id));
  let changed = false;
  const off = (d.classesOff ?? []).filter((id) => known.has(id));
  if (off.length !== (d.classesOff ?? []).length) {
    d.classesOff = off;
    changed = true;
  }
  for (const row of [...d.tt]) {
    for (const id of row.classes) {
      if (known.has(id)) continue;
      removeClass(d.tt, id);
      changed = true;
    }
  }
  const placed = new Set([...d.tt.flatMap((row) => row.classes), ...off]);
  for (const c of classes) {
    if (placed.has(c.id)) continue;
    insertClassRow(d.tt, c.id, classes);
    changed = true;
  }
  return changed;
}

/**
 * Combines the initially selected row (c1) with row c2 (by default c1 + 1) into one row.
 * On each side of recess the initial selected row's (c1) teachers stay; the other row's (c2)
 * are used only where the initial row has none. Classes are kept in class-list order
 * when `classes` is provided. Returns the teachers who lost their cells.
 */
export function combineRows(tt: Timetable, c1: number, c2 = c1 + 1, classes?: Named[]): TeacherId[] {
  if (c1 === c2 || !tt[c1] || !tt[c2]) return [];
  const target = tt[c1];
  const other = tt[c2];
  const dropped: TeacherId[] = [];
  for (const set of [0, 1] as const) {
    if (blockNames(target.sets[set]).length) dropped.push(...blockNames(other.sets[set]));
    else target.sets[set] = other.sets[set];
  }
  target.classes = [...new Set([...target.classes, ...other.classes])];
  if (classes) {
    const pos = order(classes);
    target.classes.sort((x, y) => (pos.get(x) ?? Infinity) - (pos.get(y) ?? Infinity));
  }
  const upper = Math.min(c1, c2);
  const lower = Math.max(c1, c2);
  tt[upper] = target;
  tt.splice(lower, 1);
  const kept = new Set(target.sets.flatMap(blockNames));
  return [...new Set(dropped)].filter((id) => !kept.has(id));
}

/** Splits a combined row into one row per class. The first class keeps the teachers; the others start empty. */
export function splitRow(tt: Timetable, c: number, classes?: Named[]) {
  const row = tt[c];
  if (!row || row.classes.length < 2) return;
  const [first, ...rest] = row.classes;
  row.classes = [first];
  if (classes) {
    for (const id of rest) {
      insertClassRow(tt, id, classes);
    }
  } else {
    tt.splice(c + 1, 0, ...rest.map((id): Row => ({ classes: [id], sets: [emptyBlock(), emptyBlock()] })));
  }
}

/** Separates one class from a combined row into its own row (no teachers). */
export function separateClass(tt: Timetable, c: number, id: ClassId, classes?: Named[]) {
  const row = tt[c];
  if (!row || row.classes.length < 2 || !row.classes.includes(id)) return;
  row.classes = row.classes.filter((x) => x !== id);
  if (classes) {
    insertClassRow(tt, id, classes);
  } else {
    tt.splice(c + 1, 0, { classes: [id], sets: [emptyBlock(), emptyBlock()] });
  }
}
