export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Local-date ISO string (no UTC shift). */
export function toISO(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function fromISO(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

export const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6;

/** The first school day on or after d (weekends roll to Monday). */
function schoolDayFrom(d: Date): string {
  let r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  while (isWeekend(r)) r = addDays(r, 1);
  return toISO(r);
}

/** Today if it's a school day, otherwise the next Monday. */
export const todaySchoolDay = (now = new Date()) => schoolDayFrom(now);

/** Default when the app opens: the next school day after today (Fri, Sat and Sun all give Monday). */
export const defaultSchoolDay = (now = new Date()) => schoolDayFrom(addDays(now, 1));

/** Monday of the week containing d. */
export function mondayOf(d: Date): Date {
  const offset = (d.getDay() + 6) % 7;
  return addDays(new Date(d.getFullYear(), d.getMonth(), d.getDate()), -offset);
}

export function longDate(iso: string): string {
  const d = fromISO(iso);
  return `${DAY_NAMES[d.getDay()]}, ${d.getDate()} ${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}

/** Malay names for the exported timetable image (the app UI stays English). */
const DAY_NAMES_MS = ['Ahad', 'Isnin', 'Selasa', 'Rabu', 'Khamis', 'Jumaat', 'Sabtu'];
const MONTH_NAMES_MS = [
  'Januari', 'Februari', 'Mac', 'April', 'Mei', 'Jun',
  'Julai', 'Ogos', 'September', 'Oktober', 'November', 'Disember',
];

/** "2026-10-12" -> "Isnin, 12 Oktober 2026" */
export function longDateMs(iso: string): string {
  const d = fromISO(iso);
  return `${DAY_NAMES_MS[d.getDay()]}, ${d.getDate()} ${MONTH_NAMES_MS[d.getMonth()]} ${d.getFullYear()}`;
}
