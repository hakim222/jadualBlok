import type { ClassId, DayData, DayEvent, SetBlock, TeacherId, Timetable } from './types';

/**
 * Pure timetable logic (no runtime imports, so it runs under `bun test` and plain Node).
 * Slot index s in 0..3 maps to set = s >> 1 (0 before recess, 1 after) and pos = s & 1.
 */

export const SLOT_COUNT = 4;

/** Per slot: whether an event takes it for every class (so nobody teaches then). */
export type Blocked = boolean[];
export const NONE_BLOCKED: Blocked = [false, false, false, false];

export function eventSlots(events?: Record<number, DayEvent>): Blocked {
  const blocked = [...NONE_BLOCKED];
  for (const [k, e] of Object.entries(events ?? {})) {
    blocked[+k] = true;
    if (e.span === 2) blocked[+k + 1] = true;
  }
  return blocked;
}

/** The event covering slot s, with the slot it starts in. */
export function eventAt(events: Record<number, DayEvent> | undefined, s: number): { start: number; event: DayEvent } | null {
  for (const [k, event] of Object.entries(events ?? {})) {
    const start = +k;
    if (s === start || (event.span === 2 && s === start + 1)) return { start, event };
  }
  return null;
}

/** Early test builds stored an event as its name alone. Returns whether anything changed. */
export function migrateEvents(d: DayData): boolean {
  let changed = false;
  for (const [k, e] of Object.entries(d.events ?? {}) as [string, DayEvent | string][]) {
    if (typeof e !== 'string') continue;
    d.events![+k] = { name: e };
    changed = true;
  }
  return changed;
}

/** Whether a side of recess has an event in one of its slots (so its 2 slots can't merge). */
export const setBlocked = (blocked: Blocked, set: number) => blocked[set * 2] || blocked[set * 2 + 1];

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export const emptyBlock = (): SetBlock => ({ merged: false, t: [null, null] });

/** One row per group of classes (a group of several is a combined row). */
export function emptyTimetable(groups: ClassId[][]): Timetable {
  return groups.map((classes) => ({ classes: [...classes], sets: [emptyBlock(), emptyBlock()] }));
}

export const slotTeacher = (tt: Timetable, c: number, s: number) => tt[c].sets[s >> 1].t[s & 1];

function setSlot(tt: Timetable, c: number, s: number, id: TeacherId | null) {
  tt[c].sets[s >> 1].t[s & 1] = id;
}

/** Most names a cell may hold: one slot, or a merged block (both slots). */
export const MAX_SLOT_NAMES = 2;
export const MAX_MERGED_NAMES = 3;

export const maxNames = (b: SetBlock) => (b.merged ? MAX_MERGED_NAMES : MAX_SLOT_NAMES);

/** The names in one slot of a split pair (first name in `t`, the rest in `more`). */
export function slotNames(b: SetBlock, pos: number): TeacherId[] {
  const names = [b.t[pos], ...(b.more?.[pos] ?? [])];
  return names.filter((id): id is TeacherId => !!id);
}

/** Set the names of one slot of a split pair. */
function setSlotNames(b: SetBlock, pos: number, names: TeacherId[]) {
  b.t[pos] = names[0] ?? null;
  const more: [TeacherId[], TeacherId[]] = b.more ?? [[], []];
  more[pos] = names.slice(1);
  b.more = more;
}

/** The names of a cell: one slot of a split pair, or the whole merged block. */
export const cellNames = (b: SetBlock, pos: number) => (b.merged ? blockNames(b) : slotNames(b, pos));

/** Everyone in a block: every name in both cells of a split pair, or every name of a merged block. */
export function blockNames(b: SetBlock): TeacherId[] {
  if (!b.merged) return [...slotNames(b, 0), ...slotNames(b, 1)];
  return [b.t[0], ...(b.extra ?? [])].filter((id): id is TeacherId => !!id);
}

/** Set the names of a merged block (first name fills both slots, the rest go in `extra`). */
function setBlockNames(b: SetBlock, names: TeacherId[]) {
  b.t = [names[0] ?? null, names[0] ?? null];
  b.extra = names.slice(1);
}

/** The class where `id` teaches in slot s (including as an extra name in a cell), or -1. */
export function findClassInSlot(tt: Timetable, s: number, id: TeacherId): number {
  return tt.findIndex((row) => cellNames(row.sets[s >> 1], s & 1).includes(id));
}

/** Minutes taught per teacher for the day. Every name in a cell counts the whole cell. */
export function teacherLoads(tt: Timetable, minutes: number[]): Map<TeacherId, number> {
  const load = new Map<TeacherId, number>();
  const add = (id: TeacherId, m: number) => load.set(id, (load.get(id) ?? 0) + m);
  for (const row of tt) {
    row.sets.forEach((b, set) => {
      if (b.merged) for (const id of blockNames(b)) add(id, minutes[set * 2] + minutes[set * 2 + 1]);
      else for (const pos of [0, 1]) for (const id of slotNames(b, pos)) add(id, minutes[set * 2 + pos]);
    });
  }
  return load;
}

export function countEmpty(tt: Timetable, blocked: Blocked = NONE_BLOCKED): number {
  let n = 0;
  tt.forEach((_, c) => {
    for (let s = 0; s < SLOT_COUNT; s++) if (!blocked[s] && !slotTeacher(tt, c, s)) n++;
  });
  return n;
}

/** The class a teacher has on the other side of recess, or -1. */
export function classInOtherSet(tt: Timetable, set: number, id: TeacherId): number {
  const other = 1 - set;
  for (const s of [other * 2, other * 2 + 1]) {
    const c = findClassInSlot(tt, s, id);
    if (c >= 0) return c;
  }
  return -1;
}

/**
 * One class on one side of recess: a single slot, or both slots of a merged block
 * (one teacher staying in the same class for 2 slots).
 */
interface Unit {
  c: number;
  set: number;
  slots: number[];
  m: number;
}

/** Event slots have no units: nobody is placed there. */
function unitsOf(tt: Timetable, minutes: number[], blocked: Blocked): Unit[] {
  const units: Unit[] = [];
  tt.forEach((row, c) =>
    row.sets.forEach((b, set) => {
      const groups = b.merged ? [[set * 2, set * 2 + 1]] : [[set * 2], [set * 2 + 1]];
      for (const slots of groups) if (!slots.some((s) => blocked[s])) units.push({ c, set, slots, m: slots.reduce((n, s) => n + minutes[s], 0) });
    }),
  );
  return units;
}

const unitTeacher = (tt: Timetable, u: Unit) => slotTeacher(tt, u.c, u.slots[0]);
const fillUnit = (tt: Timetable, u: Unit, id: TeacherId | null) => u.slots.forEach((s) => setSlot(tt, u.c, s, id));

/** Rule: each teacher has at most one class on each side of recess (a merged block counts once). */
function teacherOk(tt: Timetable, id: TeacherId): boolean {
  for (let set = 0; set < 2; set++) {
    let n = 0;
    for (const row of tt) {
      const b = row.sets[set];
      n += b.merged ? +blockNames(b).includes(id) : +slotNames(b, 0).includes(id) + +slotNames(b, 1).includes(id);
    }
    if (n > 1) return false;
  }
  return true;
}

/** Number of teachers who teach the same class before and after recess. */
export function countRepeats(tt: Timetable): number {
  let n = 0;
  for (const row of tt) {
    const before = new Set(blockNames(row.sets[0]));
    for (const id of new Set(blockNames(row.sets[1]))) if (before.has(id)) n++;
  }
  return n;
}

/**
 * How many classes per side of recess need a merged block so that every cell gets a teacher.
 * Each side has 2 × classCount cells and each teacher may cover one class there, so merging is
 * only needed with fewer than 2 × classCount teachers.
 */
export function mergesNeeded(teachers: number, classCount: number): number {
  if (teachers >= 2 * classCount) return 0;
  if (teachers >= classCount) return 2 * classCount - teachers;
  return classCount;
}

/**
 * Workload-balanced fill of one row per group (a combined row is one class here) under the school's rules:
 *  - each teacher teaches at most one class before recess and one after. Normally that's a
 *    single slot; a teacher stays in the same class for both slots (merged block) only when
 *    there aren't enough teachers to fill every cell otherwise;
 *  - a teacher should get a different class after recess than before.
 * Units (single slots / merged blocks) are filled longest first, each taking the eligible
 * teacher with the fewest minutes so far (ties: avoid repeating a class, then a seeded random
 * choice). A hill-climb then evens out minutes, and swaps between same-shaped units (which don't
 * change anyone's minutes) remove class repeats. Cells stay null when there aren't enough teachers.
 * Slots in `blocked` (events) stay empty, and a side of recess with one can't merge.
 */
export function generate(
  teacherIds: TeacherId[],
  groups: ClassId[][],
  minutes: number[],
  seed: number,
  blocked: Blocked = NONE_BLOCKED,
): Timetable {
  const rng = mulberry32(seed);
  const tt = emptyTimetable(groups);
  const classCount = groups.length;
  const load = new Map<TeacherId, number>(teacherIds.map((id) => [id, 0]));

  const merges = mergesNeeded(teacherIds.length, classCount);
  for (const set of [0, 1]) {
    if (setBlocked(blocked, set)) continue;
    for (const c of shuffle([...Array(classCount).keys()], rng).slice(0, merges)) tt[c].sets[set].merged = true;
  }

  const usedInSet = [new Set<TeacherId>(), new Set<TeacherId>()];
  const units = shuffle(unitsOf(tt, minutes, blocked), rng).sort((a, b) => b.m - a.m);
  for (const u of units) {
    let best: TeacherId | null = null;
    let bestKey: [number, number, number] | null = null;
    for (const id of teacherIds) {
      if (usedInSet[u.set].has(id)) continue;
      const key: [number, number, number] = [load.get(id)!, classInOtherSet(tt, u.set, id) === u.c ? 1 : 0, rng()];
      if (!bestKey || key[0] < bestKey[0] || (key[0] === bestKey[0] && (key[1] < bestKey[1] || (key[1] === bestKey[1] && key[2] < bestKey[2])))) {
        best = id;
        bestKey = key;
      }
    }
    if (best) {
      usedInSet[u.set].add(best);
      load.set(best, load.get(best)! + u.m);
      fillUnit(tt, u, best);
    }
  }

  rebalance(tt, teacherIds, minutes, load, blocked);
  removeRepeats(tt, minutes, blocked);
  return tt;
}

/**
 * The greedy pass can't look ahead, so hill-climb on the sum of squared minutes:
 *  - give a unit to another teacher who may take it;
 *  - swap two units between their teachers.
 * Moving d minutes from a to b only happens when L(b) + d < L(a), which strictly lowers the
 * sum of squares, so the loop terminates. Moves that break the rule are undone.
 */
function rebalance(tt: Timetable, teacherIds: TeacherId[], minutes: number[], load: Map<TeacherId, number>, blocked: Blocked) {
  const L = (id: TeacherId) => load.get(id)!;
  const shift = (from: TeacherId, to: TeacherId, d: number) => {
    load.set(from, L(from) - d);
    load.set(to, L(to) + d);
  };

  for (let guard = 0; guard < 500; guard++) {
    const units = unitsOf(tt, minutes, blocked).filter((u) => unitTeacher(tt, u));

    let moved = false;
    for (const u of units) {
      const a = unitTeacher(tt, u)!;
      const candidates = teacherIds.filter((id) => id !== a && L(id) + u.m < L(a)).sort((x, y) => L(x) - L(y));
      for (const b of candidates) {
        fillUnit(tt, u, b);
        if (teacherOk(tt, b)) {
          shift(a, b, u.m);
          moved = true;
          break;
        }
        fillUnit(tt, u, a);
      }
    }
    if (moved) continue;

    outer: for (const u of units) {
      for (const v of units) {
        const d = u.m - v.m;
        if (d <= 0) continue;
        const a = unitTeacher(tt, u)!;
        const b = unitTeacher(tt, v)!;
        if (a === b || L(b) + d >= L(a)) continue;
        fillUnit(tt, u, b);
        fillUnit(tt, v, a);
        if (teacherOk(tt, a) && teacherOk(tt, b)) {
          shift(a, b, d);
          moved = true;
          break outer;
        }
        fillUnit(tt, u, a);
        fillUnit(tt, v, b);
      }
    }
    if (!moved) return;
  }
}

/**
 * Swap teachers between two same-shaped units on the same side of recess (same slot, or both
 * merged blocks) whenever that lowers the number of teachers who get the same class before and
 * after recess. Such swaps keep everyone's minutes and the rule intact.
 */
function removeRepeats(tt: Timetable, minutes: number[], blocked: Blocked) {
  let repeats = countRepeats(tt);
  const units = unitsOf(tt, minutes, blocked);
  const sameShape = (u: Unit, v: Unit) => u.set === v.set && u.slots.join() === v.slots.join();
  for (let guard = 0; repeats > 0 && guard < 200; guard++) {
    let improved = false;
    for (let i = 0; i < units.length && !improved; i++) {
      for (let j = i + 1; j < units.length && !improved; j++) {
        const u = units[i];
        const v = units[j];
        if (!sameShape(u, v)) continue;
        const a = unitTeacher(tt, u);
        const b = unitTeacher(tt, v);
        if (a === b) continue;
        fillUnit(tt, u, b);
        fillUnit(tt, v, a);
        const next = countRepeats(tt);
        if (next < repeats) {
          repeats = next;
          improved = true;
        } else {
          fillUnit(tt, u, a);
          fillUnit(tt, v, b);
        }
      }
    }
    if (!improved) return;
  }
}

/**
 * Keep the merged flag in step with the cells: a block holding two different teachers is split,
 * and the same teacher in both slots of a class (a manual continuation) becomes a merged block
 * holding every name of both slots. Merged blocks keep extra names in `extra`, split pairs in `more`.
 */
function normalize(tt: Timetable) {
  for (const row of tt)
    for (const b of row.sets) {
      if (b.merged && b.t[0] !== b.t[1]) {
        b.merged = false;
        b.extra = [];
      } else if (!b.merged && b.t[0] !== null && b.t[0] === b.t[1]) {
        const names = [...new Set(blockNames(b))];
        b.merged = true;
        b.more = [[], []];
        setBlockNames(b, names);
      }
      if (b.merged && (b.more?.[0].length || b.more?.[1].length)) b.more = [[], []];
      if (!b.merged && b.extra?.length) b.extra = [];
    }
}

/** Take `id` out of every cell on one side of recess (a cell keeps its other names). */
function removeFromSide(tt: Timetable, set: number, id: TeacherId) {
  for (const row of tt) {
    const b = row.sets[set];
    if (b.merged) {
      const names = blockNames(b);
      if (names.includes(id)) setBlockNames(b, names.filter((x) => x !== id));
    } else {
      for (const pos of [0, 1]) {
        const names = slotNames(b, pos);
        if (names.includes(id)) setSlotNames(b, pos, names.filter((x) => x !== id));
      }
    }
  }
}

/**
 * Put `id` in (c, s). If that teacher is already elsewhere in the slot, the two cells swap,
 * except from a multi-name cell, where she just leaves it (its other names stay).
 */
function placeTeacher(tt: Timetable, c: number, s: number, id: TeacherId | null) {
  const cur = slotTeacher(tt, c, s);
  if (id === cur) return;
  if (id !== null) {
    const other = findClassInSlot(tt, s, id);
    const ob = other >= 0 ? tt[other].sets[s >> 1] : null;
    const names = ob ? cellNames(ob, s & 1) : [];
    if (ob && names.length > 1) {
      if (ob.merged) setBlockNames(ob, names.filter((x) => x !== id));
      else setSlotNames(ob, s & 1, names.filter((x) => x !== id));
    } else if (other >= 0) setSlot(tt, other, s, cur);
  }
  setSlot(tt, c, s, id);
}

/** Where a teacher sits on one side of recess: a single slot, or a merged block (both slots). */
export type SideSpot = { c: number; merged: false; s: number } | { c: number; merged: true };

export function locateOnSide(tt: Timetable, set: number, id: TeacherId): SideSpot | null {
  for (let c = 0; c < tt.length; c++) {
    const b = tt[c].sets[set];
    if (b.merged) {
      if (blockNames(b).includes(id)) return { c, merged: true };
    } else {
      for (const pos of [0, 1]) if (slotNames(b, pos).includes(id)) return { c, merged: false, s: set * 2 + pos };
    }
  }
  return null;
}

/**
 * Put `id` in the single cell (c, s) in place of its first name, by swapping with wherever she is
 * on this side of recess: the same slot or the other slot (any class, including this one), or a
 * merged cell, where the replaced teacher takes her place. If the cell was empty she simply moves.
 * Both teachers keep exactly one class on this side, so the rule holds.
 */
function swapIntoCell(tt: Timetable, c: number, s: number, id: TeacherId) {
  const set = s >> 1;
  const cur = slotTeacher(tt, c, s);
  if (slotNames(tt[c].sets[set], s & 1).includes(id)) return; // already in this cell
  const spot = locateOnSide(tt, set, id);
  if (spot) {
    const b = tt[spot.c].sets[set];
    const pos = spot.merged ? 0 : spot.s & 1;
    const names = [...new Set(cellNames(b, pos).map((x) => (x === id ? cur : x)).filter((x): x is TeacherId => !!x))];
    if (spot.merged) setBlockNames(b, names);
    else setSlotNames(b, pos, names);
  }
  const here = tt[c].sets[set];
  setSlotNames(here, s & 1, [id, ...slotNames(here, s & 1).filter((x) => x !== cur && x !== id)]);
}

/** Change the teacher of a cell; a merged block changes both of its slots. Mutates tt. */
export function assignCell(tt: Timetable, c: number, set: number, pos: number, id: TeacherId | null) {
  if (tt[c].sets[set].merged && id === null) {
    setBlockNames(tt[c].sets[set], []);
  } else if (tt[c].sets[set].merged) {
    placeTeacher(tt, c, set * 2, id);
    placeTeacher(tt, c, set * 2 + 1, id);
  } else if (id === null) {
    setSlotNames(tt[c].sets[set], pos, []);
  } else {
    swapIntoCell(tt, c, set * 2 + pos, id);
  }
  normalize(tt);
}

/** Whether both slots fit in one merged cell (at most MAX_MERGED_NAMES names between them). */
export const canMerge = (b: SetBlock) => b.merged || new Set(blockNames(b)).size <= MAX_MERGED_NAMES;

/** Merge both slots of a set into one cell, keeping every name (e.g. "Ainol / Sakinah"). */
export function mergeSet(tt: Timetable, c: number, set: number) {
  const b = tt[c].sets[set];
  if (b.merged || !canMerge(b)) return;
  const names = [...new Set(blockNames(b))];
  b.merged = true;
  b.more = [[], []];
  setBlockNames(b, names);
}

/**
 * Add a name to a cell, up to its limit (2 for one slot, 3 for a merged cell). The teacher moves
 * here: she is taken out of any other cell on this side of recess, which keeps the
 * one-class-per-side rule.
 */
export function addName(tt: Timetable, c: number, set: number, pos: number, id: TeacherId) {
  const b = tt[c].sets[set];
  const names = cellNames(b, pos);
  if (names.includes(id) || names.length >= maxNames(b)) return;
  removeFromSide(tt, set, id);
  if (b.merged) setBlockNames(b, [...blockNames(b), id]);
  else setSlotNames(b, pos, [...slotNames(b, pos), id]);
  normalize(tt);
}

export function removeName(tt: Timetable, c: number, set: number, pos: number, id: TeacherId) {
  const b = tt[c].sets[set];
  if (b.merged) setBlockNames(b, blockNames(b).filter((x) => x !== id));
  else setSlotNames(b, pos, slotNames(b, pos).filter((x) => x !== id));
}

/**
 * Split a merged set. The right slot goes to the least-loaded available teacher who has no class
 * yet on this side of recess (preferring one who doesn't teach this class on the other side);
 * if nobody qualifies it is left empty.
 */
export function splitSet(tt: Timetable, c: number, set: number, available: TeacherId[], minutes: number[]) {
  const b = tt[c].sets[set];
  const names = blockNames(b);
  b.merged = false;
  b.extra = [];
  // Two or more names: the first two take one slot each and a third joins the first slot.
  if (names.length >= 2) {
    b.t = [names[0], names[1]];
    b.more = [names.slice(2), []];
    return;
  }
  const load = teacherLoads(tt, minutes);
  const free = available
    .filter((id) => findClassInSlot(tt, set * 2, id) < 0 && findClassInSlot(tt, set * 2 + 1, id) < 0)
    .sort((x, y) => +(classInOtherSet(tt, set, x) === c) - +(classInOtherSet(tt, set, y) === c) || (load.get(x) ?? 0) - (load.get(y) ?? 0));
  b.t[1] = free[0] ?? null;
}

/**
 * Empties slot s in every row, for an event. A merged block on that side is split and its names
 * keep the other slot (up to its limit). Returns the teachers who lost a cell.
 */
export function clearSlot(tt: Timetable, s: number): TeacherId[] {
  const set = s >> 1;
  const pos = s & 1;
  const gone: TeacherId[] = [];
  for (const row of tt) {
    const b = row.sets[set];
    if (b.merged) {
      const names = blockNames(b);
      b.merged = false;
      b.extra = [];
      b.t = [null, null];
      setSlotNames(b, 1 - pos, names.slice(0, MAX_SLOT_NAMES));
      gone.push(...names.slice(MAX_SLOT_NAMES));
    } else gone.push(...slotNames(b, pos));
    setSlotNames(b, pos, []);
  }
  return [...new Set(gone)];
}

/** Replace teacher ids that no longer exist (deleted teachers) with empty cells. */
export function sanitize(tt: Timetable, known: Set<TeacherId>) {
  for (const row of tt)
    for (const b of row.sets) {
      if (b.merged) setBlockNames(b, blockNames(b).filter((id) => known.has(id)));
      else for (const pos of [0, 1]) setSlotNames(b, pos, slotNames(b, pos).filter((id) => known.has(id)));
    }
  normalize(tt);
}
