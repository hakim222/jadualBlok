import { describe, expect, test } from 'bun:test';
import { datesToPush, isPristine } from './sync-core';
import { emptyTimetable, generate } from './scheduler';
import type { DayData } from './types';
import { LEGACY_ROWS } from './config';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `t${i}`);
const pristine = (): DayData => ({ unavailable: [], seed: 1, tt: emptyTimetable(LEGACY_ROWS) });
const generated = (): DayData => ({ unavailable: [], seed: 1, tt: generate(ids(20), LEGACY_ROWS, [45, 45, 90, 90], 1), rules: 4 });

describe('isPristine', () => {
  test('only an untouched, never-generated day', () => {
    expect(isPristine(pristine())).toBe(true);
    expect(isPristine(generated())).toBe(false);
    expect(isPristine({ ...pristine(), unavailable: ['t1'] })).toBe(false);
    expect(isPristine({ ...pristine(), edited: true })).toBe(false);
  });
});

describe('datesToPush', () => {
  const none = new Map<string, string>();

  test('first connect: uploads local days the server lacks, but not untouched empty ones', () => {
    const days = { '2026-10-14': generated(), '2026-10-15': pristine() };
    expect(datesToPush(days, none, new Map(), new Set()).map(([d]) => d)).toEqual(['2026-10-14']);
  });

  test('a day matching the server copy is not sent again (no echo)', () => {
    const day = generated();
    const synced = new Map([['2026-10-14', JSON.stringify(day)]]);
    const versions = new Map([['2026-10-14', 3]]);
    expect(datesToPush({ '2026-10-14': day }, synced, versions, new Set())).toEqual([]);

    day.stale = true; // a local change
    expect(datesToPush({ '2026-10-14': day }, synced, versions, new Set())).toEqual([['2026-10-14', JSON.stringify(day)]]);
  });

  test('a day with a put awaiting its answer waits', () => {
    const day = { ...generated(), edited: true };
    expect(datesToPush({ '2026-10-14': day }, none, new Map(), new Set(['2026-10-14']))).toEqual([]);
  });

  test('a pristine day the server already has is still sent when it differs (e.g. emptied)', () => {
    const day = pristine();
    const versions = new Map([['2026-10-14', 2]]);
    const synced = new Map([['2026-10-14', JSON.stringify(generated())]]);
    expect(datesToPush({ '2026-10-14': day }, synced, versions, new Set())).toHaveLength(1);
  });
});
