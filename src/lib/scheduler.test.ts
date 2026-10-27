import { describe, expect, test } from 'bun:test';
import {
  addName,
  assignCell,
  blockNames,
  clearSlot,
  countEmpty,
  eventAt,
  eventSlots,
  countRepeats,
  generate,
  mergeSet,
  mergesNeeded,
  migrateEvents,
  removeName,
  sanitize,
  slotNames,
  slotTeacher,
  splitSet,
  teacherLoads,
} from './scheduler';
import type { DayData, Timetable } from './types';
import { LEGACY_ROWS } from './config';

const MON_THU = [45, 45, 90, 90];
const FRI = [45, 45, 75, 75];
const ids = (n: number) => Array.from({ length: n }, (_, i) => `t${i}`);
/** The eight rows the school used before classes could change. */
const G8 = LEGACY_ROWS;

function noDoubleBooking(tt: Timetable) {
  for (let s = 0; s < 4; s++) {
    const seen = tt.map((_, c) => slotTeacher(tt, c, s)).filter(Boolean);
    expect(new Set(seen).size).toBe(seen.length);
  }
}

/** The school rule: at most one class per teacher before recess and one after (a merged block is one class). */
function oneClassPerSide(tt: Timetable) {
  for (const set of [0, 1]) {
    const seen = tt.flatMap((row) => blockNames(row.sets[set]));
    expect(new Set(seen).size).toBe(seen.length);
  }
}

/** A merged block holds one teacher, and the same teacher never sits in both slots of an unmerged pair. */
function mergedConsistent(tt: Timetable) {
  for (const row of tt)
    for (const b of row.sets) {
      if (b.merged) expect(b.t[0]).toBe(b.t[1]);
      else if (b.t[0]) expect(b.t[0]).not.toBe(b.t[1]);
    }
}

const mergedPerSide = (tt: Timetable, set: number) => tt.filter((row) => row.sets[set].merged && row.sets[set].t[0]).length;

describe('generate', () => {
  for (const minutes of [MON_THU, FRI]) {
    for (const n of [3, 7, 8, 12, 15, 16, 20, 25, 30]) {
      test(`${n} teachers, ${minutes.join('/')}: rules hold, merges only when needed`, () => {
        for (let seed = 1; seed < 60; seed++) {
          const tt = generate(ids(n), G8, minutes, seed);
          noDoubleBooking(tt);
          oneClassPerSide(tt);
          mergedConsistent(tt);
          // 16 or more: no merges. 8–15: exactly 16 − n merged blocks per side. Fewer than 8: every teacher in a block.
          const expectedMerges = n >= 16 ? 0 : n >= 8 ? 16 - n : n;
          for (const set of [0, 1]) expect(mergedPerSide(tt, set)).toBe(expectedMerges);
          // With 8+ teachers every cell is filled; below that, each teacher covers one 2-slot block per side.
          expect(countEmpty(tt)).toBe(n >= 8 ? 0 : 4 * (8 - n));
        }
      });
    }
  }

  test('mergesNeeded', () => {
    expect(mergesNeeded(25, 8)).toBe(0);
    expect(mergesNeeded(16, 8)).toBe(0);
    expect(mergesNeeded(12, 8)).toBe(4);
    expect(mergesNeeded(8, 8)).toBe(8);
    expect(mergesNeeded(5, 8)).toBe(8);
  });

  test('no teacher repeats a class after recess when there are enough teachers', () => {
    for (const n of [12, 16, 20, 25])
      for (let seed = 1; seed < 60; seed++) expect(countRepeats(generate(ids(n), G8, MON_THU, seed))).toBe(0);
  });

  test('same seed gives same result', () => {
    expect(generate(ids(25), G8, MON_THU, 42)).toEqual(generate(ids(25), G8, MON_THU, 42));
  });
});

describe('edits', () => {
  test('assigning a busy teacher swaps cells and keeps the rule', () => {
    const tt = generate(ids(25), G8, MON_THU, 3);
    const other = slotTeacher(tt, 5, 0)!;
    const mine = slotTeacher(tt, 0, 0);
    assignCell(tt, 0, 0, 0, other);
    expect(slotTeacher(tt, 0, 0)).toBe(other);
    expect(slotTeacher(tt, 5, 0)).toBe(mine);
    noDoubleBooking(tt);
    oneClassPerSide(tt);
  });

  test('picking the teacher from the other slot (another class) swaps them across slots', () => {
    const tt = generate(ids(25), G8, MON_THU, 4);
    const mine = slotTeacher(tt, 0, 0)!; // K1/K2 7.30–8.15
    const theirs = slotTeacher(tt, 4, 1)!; // K8/K9 8.15–9.00
    assignCell(tt, 0, 0, 0, theirs);
    expect(slotTeacher(tt, 0, 0)).toBe(theirs);
    expect(slotTeacher(tt, 4, 1)).toBe(mine);
    noDoubleBooking(tt);
    oneClassPerSide(tt);
  });

  test('after recess too: 9.30 and 10.45/11.00 swap', () => {
    const tt = generate(ids(25), G8, FRI, 4);
    const mine = slotTeacher(tt, 2, 2)!;
    const theirs = slotTeacher(tt, 6, 3)!;
    assignCell(tt, 2, 1, 0, theirs);
    expect(slotTeacher(tt, 2, 2)).toBe(theirs);
    expect(slotTeacher(tt, 6, 3)).toBe(mine);
    oneClassPerSide(tt);
  });

  test('same class, other slot: the two swap order (no merge)', () => {
    const tt = generate(ids(25), G8, MON_THU, 4);
    const [a, b] = tt[2].sets[0].t;
    assignCell(tt, 2, 0, 1, a!);
    expect(tt[2].sets[0].t).toEqual([b, a]);
    expect(tt[2].sets[0].merged).toBe(false);
  });

  test('into an empty cell the teacher moves; from a merged cell the current teacher takes her place', () => {
    const tt = generate(ids(25), G8, MON_THU, 4);
    const mover = slotTeacher(tt, 5, 1)!;
    assignCell(tt, 1, 0, 0, null);
    assignCell(tt, 1, 0, 0, mover);
    expect(slotTeacher(tt, 1, 0)).toBe(mover);
    expect(slotTeacher(tt, 5, 1)).toBeNull();

    mergeSet(tt, 3, 0); // K6/K7 before recess: two names
    const [x, y] = blockNames(tt[3].sets[0]);
    const mine = slotTeacher(tt, 0, 1)!;
    assignCell(tt, 0, 0, 1, y);
    expect(slotTeacher(tt, 0, 1)).toBe(y);
    expect(blockNames(tt[3].sets[0])).toEqual([x, mine]);
    noDoubleBooking(tt);
    oneClassPerSide(tt);
  });

  test('manual merge then split keeps the rule', () => {
    const t = ids(25);
    const tt = generate(t, G8, MON_THU, 9);
    for (let c = 0; c < 8; c++) for (const set of [0, 1]) {
      mergeSet(tt, c, set);
      expect(tt[c].sets[set].merged).toBe(true);
      noDoubleBooking(tt);
      oneClassPerSide(tt);
    }
    for (let c = 0; c < 8; c++) for (const set of [0, 1]) {
      splitSet(tt, c, set, t, MON_THU);
      expect(tt[c].sets[set].merged).toBe(false);
      noDoubleBooking(tt);
      oneClassPerSide(tt);
    }
  });

  test('split leaves the right slot empty when nobody is free', () => {
    const t = ids(8);
    const tt = generate(t, G8, MON_THU, 5); // 8 teachers: every class is one merged block
    splitSet(tt, 0, 0, t, MON_THU);
    expect(tt[0].sets[0].merged).toBe(false);
    expect(tt[0].sets[0].t[1]).toBeNull();
    oneClassPerSide(tt);
  });
});

describe('merged cells with several names', () => {
  const t = ids(25);
  const fresh = () => generate(t, G8, MON_THU, 11); // 25 teachers: no merges, every cell filled

  test('merging two cells keeps both names', () => {
    const tt = fresh();
    const [a, b] = tt[0].sets[0].t;
    mergeSet(tt, 0, 0);
    expect(tt[0].sets[0].merged).toBe(true);
    expect(blockNames(tt[0].sets[0])).toEqual([a!, b!]);
    oneClassPerSide(tt);
  });

  test('a merged cell holds at most 3 names on either side of recess', () => {
    const tt = fresh();
    for (const [c, set] of [[0, 0], [1, 1]]) {
      mergeSet(tt, c, set);
      addName(tt, c, set, 0, slotTeacher(tt, 4, set * 2)!);
      expect(blockNames(tt[c].sets[set])).toHaveLength(3);
      addName(tt, c, set, 0, slotTeacher(tt, 5, set * 2)!);
      expect(blockNames(tt[c].sets[set])).toHaveLength(3); // already full
    }
    oneClassPerSide(tt);
    noDoubleBooking(tt);
  });

  test('adding a name moves that teacher out of her other cell on the same side', () => {
    const tt = fresh();
    mergeSet(tt, 1, 1);
    const mover = slotTeacher(tt, 4, 3)!;
    addName(tt, 1, 1, 0, mover);
    expect(blockNames(tt[1].sets[1])).toContain(mover);
    expect(slotTeacher(tt, 4, 3)).toBeNull();
    oneClassPerSide(tt);
  });

  test('every name counts the whole block in the workload', () => {
    const tt = fresh();
    mergeSet(tt, 2, 1);
    const [a, b] = blockNames(tt[2].sets[1]);
    const before = teacherLoads(tt, MON_THU);
    // Each had one 90-minute slot; now each covers 9.30–12.30.
    expect(before.get(a)).toBeGreaterThanOrEqual(180);
    expect(before.get(b)).toBeGreaterThanOrEqual(180);
  });

  test('remove a name, split with 3 names, and deleted teachers', () => {
    const tt = fresh();
    mergeSet(tt, 1, 1);
    const extra = slotTeacher(tt, 6, 2)!;
    addName(tt, 1, 1, 0, extra);
    const [first, second] = blockNames(tt[1].sets[1]);

    removeName(tt, 1, 1, 0, first);
    expect(blockNames(tt[1].sets[1])).toEqual([second, extra]);

    addName(tt, 1, 1, 0, first);
    sanitize(tt, new Set(t.filter((id) => id !== second))); // second teacher deleted
    expect(blockNames(tt[1].sets[1])).toEqual([extra, first]);

    splitSet(tt, 1, 1, t, MON_THU);
    expect(tt[1].sets[1].merged).toBe(false);
    expect(tt[1].sets[1].t).toEqual([extra, first]);
    oneClassPerSide(tt);
  });

  test('leave empty clears every name', () => {
    const tt = fresh();
    mergeSet(tt, 0, 1);
    assignCell(tt, 0, 1, 0, null);
    expect(blockNames(tt[0].sets[1])).toEqual([]);
    expect(tt[0].sets[1].merged).toBe(true);
  });

  test('splitting 3 names keeps all of them: the third joins the first slot', () => {
    const tt = fresh();
    mergeSet(tt, 1, 1);
    addName(tt, 1, 1, 0, slotTeacher(tt, 6, 2)!);
    const [a, b, c] = blockNames(tt[1].sets[1]);
    splitSet(tt, 1, 1, t, MON_THU);
    expect(slotNames(tt[1].sets[1], 0)).toEqual([a, c]);
    expect(slotNames(tt[1].sets[1], 1)).toEqual([b]);
    oneClassPerSide(tt);
  });
});

describe('single cells with several names', () => {
  const t = ids(25);
  const fresh = () => generate(t, G8, MON_THU, 11);

  test('a single slot holds at most 2 names, and each counts the slot', () => {
    const tt = fresh();
    const [first] = slotNames(tt[0].sets[0], 0);
    const mover = slotTeacher(tt, 3, 1)!;
    addName(tt, 0, 0, 0, mover);
    expect(slotNames(tt[0].sets[0], 0)).toEqual([first, mover]);
    expect(slotTeacher(tt, 3, 1)).toBeNull(); // moved out of her other cell on this side
    expect(tt[0].sets[0].merged).toBe(false);

    addName(tt, 0, 0, 0, slotTeacher(tt, 4, 0)!);
    expect(slotNames(tt[0].sets[0], 0)).toHaveLength(2); // already full

    const load = teacherLoads(tt, MON_THU);
    expect(load.get(mover)).toBeGreaterThanOrEqual(45);
    oneClassPerSide(tt);
    noDoubleBooking(tt);
  });

  test('remove a name, deleted teachers, and leave empty', () => {
    const tt = fresh();
    const [first] = slotNames(tt[2].sets[1], 1);
    const extra = slotTeacher(tt, 5, 3)!;
    addName(tt, 2, 1, 1, extra);
    removeName(tt, 2, 1, 1, first);
    expect(slotNames(tt[2].sets[1], 1)).toEqual([extra]);
    expect(slotTeacher(tt, 2, 3)).toBe(extra); // the remaining name becomes the first

    addName(tt, 2, 1, 1, first);
    sanitize(tt, new Set(t.filter((id) => id !== extra)));
    expect(slotNames(tt[2].sets[1], 1)).toEqual([first]);

    addName(tt, 2, 1, 1, extra);
    assignCell(tt, 2, 1, 1, null);
    expect(slotNames(tt[2].sets[1], 1)).toEqual([]);
  });

  test('picking a teacher replaces only the first name and swaps her with it', () => {
    const tt = fresh();
    const [first] = slotNames(tt[0].sets[0], 0);
    const extra = slotTeacher(tt, 3, 0)!;
    addName(tt, 0, 0, 0, extra);
    const other = slotTeacher(tt, 5, 0)!;
    assignCell(tt, 0, 0, 0, other);
    expect(slotNames(tt[0].sets[0], 0)).toEqual([other, extra]);
    expect(slotTeacher(tt, 5, 0)).toBe(first);
    assignCell(tt, 0, 0, 0, extra); // already in the cell: no change, nobody lost
    expect(slotNames(tt[0].sets[0], 0)).toEqual([other, extra]);
    oneClassPerSide(tt);
  });

  test('merging keeps every name, but not more than 3', () => {
    const tt = fresh();
    const [a, b] = tt[0].sets[0].t;
    const c = slotTeacher(tt, 4, 0)!;
    addName(tt, 0, 0, 0, c);
    mergeSet(tt, 0, 0);
    expect(tt[0].sets[0].merged).toBe(true);
    expect(blockNames(tt[0].sets[0])).toEqual([a!, c, b!]);

    const [x, y] = tt[1].sets[0].t;
    addName(tt, 1, 0, 0, slotTeacher(tt, 5, 0)!);
    addName(tt, 1, 0, 1, slotTeacher(tt, 6, 1)!);
    mergeSet(tt, 1, 0); // 4 names: refused
    expect(tt[1].sets[0].merged).toBe(false);
    expect(slotTeacher(tt, 1, 0)).toBe(x);
    expect(slotTeacher(tt, 1, 1)).toBe(y);
    oneClassPerSide(tt);
  });
});

describe('events', () => {
  test('generate leaves event slots empty and never merges their side', () => {
    for (const n of [5, 8, 12, 25]) {
      for (let seed = 1; seed < 30; seed++) {
        const blocked = [true, false, false, false]; // e.g. assembly at 7.30
        const tt = generate(ids(n), G8, MON_THU, seed, blocked);
        oneClassPerSide(tt);
        for (const row of tt) {
          expect(row.sets[0].merged).toBe(false);
          expect(slotNames(row.sets[0], 0)).toEqual([]);
        }
        // The open slot before recess is filled when there are enough teachers.
        if (n >= 8) expect(tt.every((row) => row.sets[0].t[1])).toBe(true);
        // Before recess: one open cell per row. After: merges fill every cell from 8 teachers; below that, n blocks.
        expect(countEmpty(tt, blocked)).toBe(8 - Math.min(n, 8) + (n >= 8 ? 0 : 16 - 2 * n));
      }
    }
  });

  test('a two-slot event blocks both slots on its side of recess', () => {
    const events = { 0: { name: 'Perhimpunan' }, 2: { name: 'Sukan', span: 2 as const } };
    expect(eventSlots(events)).toEqual([true, false, true, true]);
    expect(eventAt(events, 3)).toEqual({ start: 2, event: events[2] });
    expect(eventAt(events, 1)).toBeNull();
  });

  test('old days with an event stored as a name are converted', () => {
    const d = { unavailable: [], seed: 1, tt: [], events: { 1: 'Perhimpunan' } } as unknown as DayData;
    expect(migrateEvents(d)).toBe(true);
    expect(d.events).toEqual({ 1: { name: 'Perhimpunan' } });
    expect(migrateEvents(d)).toBe(false);
  });

  test('a fully blocked side gets nobody', () => {
    const tt = generate(ids(25), G8, MON_THU, 7, [false, false, true, true]);
    expect(tt.every((row) => blockNames(row.sets[1]).length === 0)).toBe(true);
    expect(countEmpty(tt, [false, false, true, true])).toBe(0);
  });

  test('clearSlot empties one slot in every row; a merged block keeps the other slot', () => {
    const tt = generate(ids(12), G8, MON_THU, 3); // 12 teachers: 4 merged blocks per side
    const merged = tt.findIndex((row) => row.sets[0].merged);
    const keeper = tt[merged].sets[0].t[0];
    const single = tt.findIndex((row) => !row.sets[0].merged);
    const leaver = tt[single].sets[0].t[1]!;
    const gone = clearSlot(tt, 1);
    expect(gone).toContain(leaver);
    expect(gone).not.toContain(keeper);
    for (const row of tt) expect(slotNames(row.sets[0], 1)).toEqual([]);
    expect(tt[merged].sets[0].merged).toBe(false);
    expect(tt[merged].sets[0].t[0]).toBe(keeper);
  });
});
