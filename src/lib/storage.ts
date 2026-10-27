import type { DayData, SchoolClass, Teacher } from './types';

const KEY = 'jadualblok:v1';
const KEEP_DAYS = 120;

export interface Saved {
  teachers: Teacher[];
  /** Missing in copies saved before classes could be edited. */
  classes?: SchoolClass[];
  days: Record<string, DayData>;
}

export function loadSaved(todayISO: string): Saved | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Saved;
    if (!Array.isArray(data.teachers) || typeof data.days !== 'object') return null;
    // Drop old days so storage stays small.
    const cutoff = new Date(todayISO);
    cutoff.setDate(cutoff.getDate() - KEEP_DAYS);
    for (const iso of Object.keys(data.days)) if (new Date(iso) < cutoff) delete data.days[iso];
    return data;
  } catch {
    return null;
  }
}

export function save(data: Saved) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* storage unavailable (private mode / quota) — app still works for this session */
  }
}
