import { describe, expect, test } from 'bun:test';
import { combineRows, defaultGroups, insertClassRow, migrateDay, reconcileClasses, removeClass, separateClass, splitRow } from './classes';
import { DEFAULT_CLASSES, DEFAULT_COMBINED, LEGACY_ROWS } from './config';
import { blockNames, emptyTimetable } from './scheduler';
import type { DayData, Timetable } from './types';

const groupsOf = (tt: Timetable) => tt.map((row) => row.classes);
const day = (tt: Timetable): DayData => ({ unavailable: [], seed: 1, tt });

/** Fills one cell per side so rows can be told apart: row r has teacher `a<r>` before recess, `b<r>` after. */
function filled(groups: string[][]): Timetable {
  const tt = emptyTimetable(groups);
  tt.forEach((row, r) => {
    row.sets[0].t = [`a${r}`, null];
    row.sets[1].t = [`b${r}`, null];
  });
  return tt;
}

describe('defaultGroups', () => {
  test('a new day has the school pairs, K5 alone', () => {
    expect(defaultGroups(DEFAULT_CLASSES, DEFAULT_COMBINED)).toEqual(LEGACY_ROWS);
  });

  test('a pair with a class missing leaves the other alone; new classes go last', () => {
    const classes = [...DEFAULT_CLASSES.filter((c) => c.name !== 'K2'), { id: 'x', name: 'K16' }];
    const g = defaultGroups(classes, DEFAULT_COMBINED);
    expect(g[0]).toEqual(['k1']);
    expect(g[1]).toEqual(['k3', 'k4']);
    expect(g.at(-1)).toEqual(['x']);
  });

  test('names match regardless of case; classes off that day are left out', () => {
    const classes = [{ id: 'a', name: 'k1' }, { id: 'b', name: 'K2' }, { id: 'c', name: 'K3' }, { id: 'd', name: 'K4' }];
    expect(defaultGroups(classes, DEFAULT_COMBINED, new Set(['c']))).toEqual([['a', 'b'], ['d']]);
  });
});

describe('migrateDay', () => {
  test('old rows get the classes they stood for, teachers kept', () => {
    const tt = filled(LEGACY_ROWS).map((row) => ({ sets: row.sets })) as unknown as Timetable;
    const d = day(tt);
    expect(migrateDay(d, LEGACY_ROWS)).toBe(true);
    expect(groupsOf(d.tt)).toEqual(LEGACY_ROWS);
    expect(d.tt[2].sets[0].t[0]).toBe('a2');
    expect(migrateDay(d, LEGACY_ROWS)).toBe(false); // already converted
  });
});

describe('class rows', () => {
  test('removing one class of a combined row keeps the row and its teachers', () => {
    const tt = filled([['k1', 'k2'], ['k3']]);
    expect(removeClass(tt, 'k1')).toEqual([]);
    expect(groupsOf(tt)).toEqual([['k2'], ['k3']]);
    expect(tt[0].sets[0].t[0]).toBe('a0');
  });

  test('removing the last class of a row drops the row and returns its teachers', () => {
    const tt = filled([['k1'], ['k5'], ['k6']]);
    expect(removeClass(tt, 'k5').sort()).toEqual(['a1', 'b1']);
    expect(groupsOf(tt)).toEqual([['k1'], ['k6']]);
  });

  test('a class put back goes where the class list says', () => {
    const tt = filled([['k1', 'k2'], ['k6', 'k7']]);
    insertClassRow(tt, 'k5', DEFAULT_CLASSES);
    insertClassRow(tt, 'k15', DEFAULT_CLASSES);
    expect(groupsOf(tt)).toEqual([['k1', 'k2'], ['k5'], ['k6', 'k7'], ['k15']]);
    expect(blockNames(tt[1].sets[0])).toEqual([]);
  });

  test('combining keeps the upper teachers and fills empty sides from below', () => {
    const tt = filled([['k1'], ['k2'], ['k3']]);
    tt[0].sets[1].t = [null, null]; // upper row has nobody after recess
    const dropped = combineRows(tt, 0);
    expect(groupsOf(tt)).toEqual([['k1', 'k2'], ['k3']]);
    expect(tt[0].sets[0].t[0]).toBe('a0');
    expect(tt[0].sets[1].t[0]).toBe('b1');
    expect(dropped).toEqual(['a1']);
  });

  test('a teacher in both rows is not reported as dropped', () => {
    const tt = filled([['k1'], ['k2']]);
    tt[1].sets[0].t = [null, 'a0'];
    expect(combineRows(tt, 0)).toEqual(['b1']); // only the lower row's after-recess teacher loses a cell
  });

  test('initial selected class teacher stays, e.g. selecting K2 then K1 takes K2 teachers', () => {
    const tt = filled([['k1'], ['k2'], ['k3']]);
    // K1 has a0 and b0; K2 has a1 and b1.
    // Initial selected class is K2 (row 1), combined with K1 (row 0):
    const dropped = combineRows(tt, 1, 0, DEFAULT_CLASSES);
    expect(groupsOf(tt)).toEqual([['k1', 'k2'], ['k3']]);
    expect(tt[0].sets[0].t[0]).toBe('a1'); // K2's teacher stays
    expect(tt[0].sets[1].t[0]).toBe('b1'); // K2's teacher stays
    expect(dropped.sort()).toEqual(['a0', 'b0']); // K1's teachers replaced
  });

  test('combining any pair of rows, e.g. K1 and K12', () => {
    const tt = filled([['k1'], ['k2'], ['k3'], ['k4'], ['k5'], ['k12']]);
    combineRows(tt, 0, 5, DEFAULT_CLASSES);
    expect(groupsOf(tt)).toEqual([['k1', 'k12'], ['k2'], ['k3'], ['k4'], ['k5']]);
    expect(tt[0].sets[0].t[0]).toBe('a0'); // initial selected row keeps teacher
  });

  test('limitless combinations: combining multiple classes into one row', () => {
    const tt = filled([['k1'], ['k2'], ['k5'], ['k12']]);
    // Combine K1 (row 0) and K12 (row 3)
    combineRows(tt, 0, 3, DEFAULT_CLASSES);
    expect(groupsOf(tt)).toEqual([['k1', 'k12'], ['k2'], ['k5']]);
    // Now combine K1/K12 (row 0) with K5 (row 2)
    combineRows(tt, 0, 2, DEFAULT_CLASSES);
    expect(groupsOf(tt)).toEqual([['k1', 'k5', 'k12'], ['k2']]);
  });

  test('splitting with canonical class list order', () => {
    const tt = filled([['k1', 'k5', 'k12'], ['k2'], ['k3']]);
    splitRow(tt, 0, DEFAULT_CLASSES);
    expect(groupsOf(tt)).toEqual([['k1'], ['k2'], ['k3'], ['k5'], ['k12']]);
    expect(tt[0].sets[0].t[0]).toBe('a0');
    expect(blockNames(tt[3].sets[0])).toEqual([]);
    expect(blockNames(tt[4].sets[0])).toEqual([]);
  });

  test('separating a single class from a 3-class combination', () => {
    const tt = filled([['k1', 'k5', 'k12'], ['k2'], ['k3']]);
    separateClass(tt, 0, 'k5', DEFAULT_CLASSES);
    expect(groupsOf(tt)).toEqual([['k1', 'k12'], ['k2'], ['k3'], ['k5']]);
    expect(tt[0].sets[0].t[0]).toBe('a0'); // remaining combined classes keep teachers
    expect(blockNames(tt[3].sets[0])).toEqual([]); // separated class starts empty
  });
});

describe('reconcileClasses', () => {
  test('deleted classes leave; new ones get a row; classes off stay off', () => {
    const d = day(filled([['k1', 'k2'], ['k3']]));
    d.classesOff = ['k4', 'gone'];
    const classes = [...DEFAULT_CLASSES.slice(0, 4).filter((c) => c.id !== 'k2'), { id: 'new', name: 'K16' }];
    expect(reconcileClasses(d, classes)).toBe(true);
    expect(groupsOf(d.tt)).toEqual([['k1'], ['k3'], ['new']]);
    expect(d.classesOff).toEqual(['k4']);
    expect(reconcileClasses(d, classes)).toBe(false);
  });
});
