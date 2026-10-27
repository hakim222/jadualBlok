import { DEFAULT_CLASSES, DEFAULT_COMBINED, LEGACY_ROWS, slotMinutes, slotsFor } from './config';
import { defaultSchoolDay, fromISO, isWeekend } from './dates';
import { addName, assignCell, blockNames, clearSlot, emptyTimetable, eventSlots, generate, hashString, mergeSet, migrateEvents, removeName, sanitize, setBlocked, splitSet } from './scheduler';
import { combineRows, defaultGroups, insertClassRow, migrateDay, reconcileClasses, removeClass, separateClass, splitRow } from './classes';
import { loadSaved } from './storage';
import { ApiError, api } from './api';
import { sync as live } from './sync.svelte';
import type { ClassId, DayData, DayEvent, Named, SchoolClass, Teacher, TeacherId } from './types';

/** online = list came from the server; offline = showing the copy saved in this browser. */
export type SyncStatus = 'loading' | 'online' | 'offline';

/** The two server lists of names. */
export type ListKind = 'teachers' | 'classes';

/** Toast pointing at Undo after a change that loses work (hand edits replaced, cells emptied). `id` changes each time so the toast timer restarts. */
export interface UndoOffer {
  id: number;
  message: string;
}

const cleanName = (raw: string) => raw.trim().replace(/\s+/g, ' ');

/** "A, B, C and 2 more" */
const listNames = (names: (string | undefined)[]) =>
  names.length > 3 ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more` : names.join(', ');

const sameList = (a: Named[], b: Named[]) => a.length === b.length && a.every((x, i) => x.id === b[i].id && x.name === b[i].name);

/** Bump when the generator's rules change so saved days are rebuilt under the new rules.
 *  2: one slot per teacher on each side of recess; avoid the same class after recess.
 *  3: a merged block (same class, both slots) counts as one class; used only when short of teachers.
 *  4: Mon–Thu last slot is 11.00–12.30 (was 13.30), which changes the minutes being balanced. */
const RULES_VERSION = 4;

class Store {
  teachers = $state<Teacher[]>([]);
  classes = $state<SchoolClass[]>(DEFAULT_CLASSES);
  days = $state<Record<string, DayData>>({});
  date = $state(defaultSchoolDay());
  sync = $state<SyncStatus>('loading');
  undo = $state<UndoOffer | null>(null);
  /** A short message for the toast (e.g. a change from another device); `id` changes each time. */
  notice = $state<{ id: number; text: string } | null>(null);
  /** One step of undo: the day as it was before its last change; restored by undoLast(). */
  private undoSnap = $state.raw<{ date: string; day: DayData } | null>(null);
  private undoCount = 0;
  /** The class list has come from the server this session, so days can be brought in line with it. */
  private classesLoaded = false;

  nameOf = $derived(new Map(this.teachers.map((t) => [t.id, t.name])));
  classNameOf = $derived(new Map(this.classes.map((c) => [c.id, c.name])));
  /** Golden-angle hues by list position keep neighbouring teachers visually distinct. */
  hue = $derived(new Map(this.teachers.map((t, i) => [t.id, Math.round((i * 137.508 + 10) % 360)])));
  weekday = $derived(fromISO(this.date).getDay());
  slots = $derived(slotsFor(this.weekday));
  minutes = $derived(this.slots.map(slotMinutes));
  day = $derived(this.days[this.date]);
  /** Row labels: one class ("K5") or a combined row ("K1/K2"). */
  rowLabels = $derived((this.day?.tt ?? []).map((row) => row.classes.map((id) => this.classNameOf.get(id) ?? '?').join('/')));
  /** Timetables are shared live: they can be changed only while connected, with the admin PIN. */
  editable = $derived(live.status === 'live' && live.canEdit);
  /** A day starts empty; it is only filled when the coordinator presses Generate. */
  notGenerated = $derived(this.day?.rules === undefined);
  canUndo = $derived(this.editable && this.undoSnap?.date === this.date);
  available = $derived.by(() => {
    const off = new Set(this.day?.unavailable ?? []);
    return this.teachers.filter((t) => !off.has(t.id));
  });
  classesOff = $derived(new Set(this.day?.classesOff ?? []));
  /** Per slot: taken by an event for every class. */
  blocked = $derived(eventSlots(this.day?.events));

  constructor() {
    const saved = loadSaved(this.date);
    if (saved) {
      this.teachers = saved.teachers;
      if (saved.classes) this.classes = saved.classes;
      const known = new Set(saved.teachers.map((t) => t.id));
      for (const d of Object.values(saved.days)) {
        migrateDay(d, LEGACY_ROWS);
        migrateEvents(d);
        sanitize(d.tt, known);
      }
      this.days = saved.days;
      // Days made under older rules are rebuilt; days never generated stay empty.
      for (const [iso, d] of Object.entries(this.days)) if (d.rules !== undefined && d.rules !== RULES_VERSION) this.rebuild(iso);
    }
    this.ensureDay(this.date);
    // The lists live on the server; the saved copy above shows instantly / offline.
    this.refresh();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.refresh();
    });
    // Timetables are shared with every device through the server; this browser keeps a copy.
    live.start({
      days: () => this.days,
      setDay: (iso, day) => this.receiveDay(iso, day),
      listsChanged: () => this.refresh(),
      notify: (text) => (this.notice = { id: (this.notice?.id ?? 0) + 1, text }),
    });
  }

  /** A day as the server has it (from another device, or the snapshot on connect). */
  private receiveDay(iso: string, day: DayData | null) {
    // Undo would overwrite a change made elsewhere; a reconnect resending the same day keeps it.
    if (iso === this.undoSnap?.date && JSON.stringify(this.days[iso] ?? null) !== JSON.stringify(day)) this.clearUndo();
    if (day) {
      // Days saved by older versions get their classes; the result goes back to the server.
      migrateDay(day, LEGACY_ROWS);
      migrateEvents(day);
      if (this.classesLoaded) this.reconcile(day);
      this.days[iso] = day;
    } else delete this.days[iso];
    if (iso === this.date) this.ensureDay(iso);
    // A teacher or class this device hasn't heard of yet (added elsewhere a moment ago): fetch the lists.
    const unknownTeacher = day?.tt.some((row) => row.sets.some((b) => blockNames(b).some((id) => !this.nameOf.has(id))));
    const unknownClass = day?.tt.some((row) => row.classes.some((id) => !this.classNameOf.has(id)));
    if (unknownTeacher || unknownClass) this.refresh();
  }

  async refresh() {
    const [teachers, classes] = await Promise.allSettled([api.teachers.list(), api.classes.list()]);
    if (teachers.status === 'fulfilled') {
      this.applyTeacherList(teachers.value);
      this.sync = 'online';
    } else this.sync = 'offline';
    // Without the class list (e.g. the server's table isn't set up yet) the last known one stays.
    if (classes.status === 'fulfilled') this.applyClassList(classes.value);
  }

  private applyTeacherList(list: Teacher[]) {
    if (sameList(list, this.teachers)) return;
    const sameIds = list.length === this.teachers.length && list.every((t) => this.nameOf.has(t.id));
    const removed = new Set(this.teachers.map((t) => t.id).filter((id) => !list.some((t) => t.id === id)));
    this.teachers = list;
    // A change in who exists only marks the timetables out of date; a rename doesn't.
    if (!sameIds) this.teachersChanged(removed);
  }

  /**
   * Every day is brought in line with the server's class list the first time it arrives and
   * whenever it changes: deleted classes leave their rows, new ones get their own row.
   */
  private applyClassList(list: SchoolClass[]) {
    const first = !this.classesLoaded;
    this.classesLoaded = true;
    if (!first && sameList(list, this.classes)) return;
    const sameIds = list.length === this.classes.length && list.every((c) => this.classNameOf.has(c.id));
    this.classes = list;
    if (first || !sameIds) this.classesChanged();
  }

  /** Brings every day in line with the class list (see reconcileClasses). */
  private classesChanged() {
    for (const d of Object.values(this.days)) this.reconcile(d);
    // An open Undo could bring back a deleted class.
    if (this.undoSnap?.day.tt.some((row) => row.classes.some((id) => !this.classNameOf.has(id)))) this.clearUndo();
  }

  /** A generated day whose rows changed is out of date until Regenerate. */
  private reconcile(d: DayData) {
    if (reconcileClasses(d, this.classes) && d.rules !== undefined) d.stale = true;
  }

  /**
   * The teacher list changed. Teachers known to be deleted leave the availability and timetables
   * (their cells empty). Only those: this device's list may not have caught up with a teacher
   * added on another device, and the timetables are shared. Nothing is rebuilt until Regenerate,
   * so generated days are marked out of date.
   */
  private teachersChanged(removed = new Set<TeacherId>()) {
    for (const d of Object.values(this.days)) {
      if (removed.size) {
        d.unavailable = d.unavailable.filter((x) => !removed.has(x));
        const keep = d.tt.flatMap((row) => row.sets.flatMap(blockNames)).filter((id) => !removed.has(id));
        sanitize(d.tt, new Set(keep));
      }
      if (d.rules !== undefined) d.stale = true;
    }
  }

  /** A new day: every class taught, in the default combined rows. */
  private ensureDay(iso: string) {
    if (this.days[iso]) return;
    this.days[iso] = { unavailable: [], seed: hashString(iso), tt: emptyTimetable(defaultGroups(this.classes, DEFAULT_COMBINED)) };
  }

  /** Refills the teachers; the rows (which classes, combined or not) stay. */
  private rebuild(iso = this.date) {
    const d = this.days[iso];
    const off = new Set(d.unavailable);
    const ids = this.teachers.filter((t) => !off.has(t.id)).map((t) => t.id);
    const mins = slotsFor(fromISO(iso).getDay()).map(slotMinutes);
    d.tt = generate(ids, d.tt.map((row) => row.classes), mins, d.seed, eventSlots(d.events));
    d.rules = RULES_VERSION;
    d.edited = false;
    d.stale = false;
  }

  /**
   * Runs `change` on the current day and, if the day actually changed, keeps a copy of it from
   * before as the one step Undo goes back to. Any toast about an earlier change is dismissed.
   */
  private record(change: () => void): boolean {
    const before = $state.snapshot(this.day);
    const json = JSON.stringify(before);
    change();
    if (JSON.stringify(this.day) === json) return false;
    this.undoSnap = { date: this.date, day: before };
    this.undo = null;
    return true;
  }

  /** Shows a toast pointing at Undo, for changes that lose work. */
  private offerUndo(message: string) {
    this.undo = { id: ++this.undoCount, message };
  }

  /** Puts the day back as it was before its last change. One step: there is no redo. */
  undoLast() {
    if (!this.canUndo) return;
    const snap = this.undoSnap!;
    this.clearUndo();
    const known = new Set(this.teachers.map((t) => t.id));
    // Teachers removed since the copy was taken are dropped; added ones are simply unassigned.
    snap.day.unavailable = snap.day.unavailable.filter((x) => known.has(x));
    sanitize(snap.day.tt, known);
    // Likewise classes: removed ones leave, added ones get their own row.
    reconcileClasses(snap.day, this.classes);
    this.days[snap.date] = snap.day;
  }

  /** Ends both the toast and the undo step. */
  clearUndo() {
    this.undo = null;
    this.undoSnap = null;
  }

  /** `id`: only hides that toast (a newer one may have replaced it). The undo step stays. */
  dismissOffer(id: number) {
    if (this.undo?.id === id) this.undo = null;
  }

  /** A hand edit to the timetable. */
  private edit(change: () => void): boolean {
    if (!this.editable) return false;
    return this.record(() => {
      const tt = JSON.stringify(this.day.tt);
      change();
      if (JSON.stringify(this.day.tt) !== tt) this.day.edited = true;
    });
  }

  setDate(iso: string) {
    if (isWeekend(fromISO(iso))) return;
    this.ensureDay(iso);
    // The undo step belongs to its day (Undo shows again on returning); the toast doesn't follow.
    if (iso !== this.date) this.undo = null;
    this.date = iso;
  }

  regenerate() {
    if (!this.editable) return;
    const hadEdits = !!this.day.edited;
    this.record(() => {
      this.day.seed = (Math.random() * 2 ** 32) >>> 0;
      this.rebuild();
    });
    if (hadEdits) this.offerUndo('New timetable made. Your manual changes were replaced.');
  }

  toggle(id: TeacherId) {
    if (!this.editable) return;
    this.changeAvailability(() => {
      const off = this.day.unavailable;
      const i = off.indexOf(id);
      if (i >= 0) off.splice(i, 1);
      else off.push(id);
    });
  }

  setAllAvailable(on: boolean) {
    if (!this.editable) return;
    this.changeAvailability(() => {
      this.day.unavailable = on ? [] : this.teachers.map((t) => t.id);
    });
  }

  /**
   * Applies an availability change without rebuilding (only Regenerate does that). Teachers who
   * are no longer available leave their cells, which can be undone.
   */
  private changeAvailability(change: () => void) {
    let gone: (string | undefined)[] = [];
    this.record(() => {
      const before = new Set(this.day.tt.flatMap((row) => row.sets.flatMap(blockNames)));
      change();
      sanitize(this.day.tt, new Set(this.available.map((t) => t.id)));
      const after = new Set(this.day.tt.flatMap((row) => row.sets.flatMap(blockNames)));
      gone = [...before].filter((id) => !after.has(id)).map((id) => this.nameOf.get(id));
      this.day.stale = true;
      if (gone.length) this.day.edited = true;
    });
    if (gone.length) this.offerUndo(`${listNames(gone)} taken out of the timetable.`);
  }

  /**
   * Changes which classes have rows today, or how they are combined. Rows are never rebuilt here
   * (only Regenerate does that), so a generated day is marked out of date. Teachers whose row
   * went lose their cells, which can be undone.
   */
  private changeRows(change: () => TeacherId[], message: (who: string) => string) {
    if (!this.editable) return;
    let gone: TeacherId[] = [];
    this.record(() => {
      gone = change();
      if (this.day.rules !== undefined) this.day.stale = true;
    });
    if (gone.length) this.offerUndo(message(listNames(gone.map((id) => this.nameOf.get(id)))));
  }

  /** Untick: the class leaves its row (a row left empty goes). Tick: it gets its own row back. */
  toggleClass(id: ClassId) {
    const name = this.classNameOf.get(id);
    this.changeRows(
      () => {
        const d = this.day;
        const off = d.classesOff ?? [];
        if (off.includes(id)) {
          d.classesOff = off.filter((x) => x !== id);
          insertClassRow(d.tt, id, this.classes);
          return [];
        }
        d.classesOff = [...off, id];
        return removeClass(d.tt, id);
      },
      (who) => `${name} taken out of the timetable, with ${who}.`,
    );
  }

  /** All: every class taught (back to the default rows if none were left). None: no rows. */
  setAllClasses(on: boolean) {
    this.changeRows(
      () => {
        const d = this.day;
        if (on) {
          const off = new Set(d.classesOff ?? []);
          d.classesOff = [];
          if (!d.tt.length) d.tt = emptyTimetable(defaultGroups(this.classes, DEFAULT_COMBINED));
          else for (const c of this.classes) if (off.has(c.id)) insertClassRow(d.tt, c.id, this.classes);
          return [];
        }
        const gone = [...new Set(d.tt.flatMap((row) => row.sets.flatMap(blockNames)))];
        d.classesOff = this.classes.map((c) => c.id);
        d.tt = [];
        return gone;
      },
      (who) => `Every class taken out of the timetable, with ${who}.`,
    );
  }

  /** Combines initial selected row c1 with row c2 (by default the row below it: c1 + 1). */
  combineRows(c1: number, c2 = c1 + 1) {
    if (c1 === c2 || !this.day.tt[c1] || !this.day.tt[c2]) return;
    const otherLabel = this.rowLabels[c2];
    this.changeRows(
      () => {
        this.day.layout = true;
        return combineRows(this.day.tt, c1, c2, this.classes);
      },
      (who) => `${who} taken out of ${otherLabel} when it was combined.`,
    );
  }

  /** Splits a combined row back into one row per class. */
  splitRow(c: number) {
    this.changeRows(
      () => {
        this.day.layout = true;
        splitRow(this.day.tt, c, this.classes);
        return [];
      },
      () => '',
    );
  }

  /** Separates one class from a combined row into its own row. */
  separateClass(c: number, classId: ClassId) {
    this.changeRows(
      () => {
        this.day.layout = true;
        separateClass(this.day.tt, c, classId, this.classes);
        return [];
      },
      () => '',
    );
  }

  /**
   * Accepts comma/newline separated names and saves each to the server list (asks for the PIN).
   * Returns names skipped as duplicates. Throws ApiError on other failures.
   */
  async addToList(kind: ListKind, input: string): Promise<string[]> {
    const existing = new Set(this[kind].map((t) => t.name.toLowerCase()));
    const skipped: string[] = [];
    const names: string[] = [];
    for (const raw of input.split(/[,\n]/)) {
      const name = cleanName(raw);
      if (!name) continue;
      if (existing.has(name.toLowerCase())) skipped.push(name);
      else names.push(name);
      existing.add(name.toLowerCase());
    }

    let added = 0;
    let serverDuplicate = false;
    try {
      for (const name of names) {
        try {
          this[kind].push(await api[kind].add(name));
          added++;
        } catch (e) {
          if (!(e instanceof ApiError && e.status === 409)) throw e;
          skipped.push(name);
          serverDuplicate = true;
        }
      }
    } finally {
      if (added) this.listChanged(kind);
      // Someone else added it from another device: pull the current lists.
      if (serverDuplicate) this.refresh();
    }
    return skipped;
  }

  /** Throws ApiError (e.g. 409 duplicate) if the server rejects the change. */
  async renameInList(kind: ListKind, id: string, name: string) {
    const clean = cleanName(name);
    if (!clean) throw new ApiError('Name cannot be empty', 400);
    if (this[kind].some((t) => t.id !== id && t.name.toLowerCase() === clean.toLowerCase())) {
      throw new ApiError('Name already exists', 409);
    }
    const saved = await api[kind].rename(id, clean);
    const t = this[kind].find((t) => t.id === id);
    if (t) t.name = saved.name;
  }

  async removeFromList(kind: ListKind, id: string) {
    try {
      await api[kind].remove(id);
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 404)) throw e; // already gone on the server
    }
    if (kind === 'teachers') this.teachers = this.teachers.filter((t) => t.id !== id);
    else this.classes = this.classes.filter((c) => c.id !== id);
    this.listChanged(kind, id);
    this.clearUndo(); // an open Undo could bring the removed name back into the timetable
  }

  private listChanged(kind: ListKind, removed?: string) {
    if (kind === 'teachers') this.teachersChanged(new Set(removed ? [removed] : []));
    else this.classesChanged();
  }

  /** "7.30–8.15"; with span 2, both slots of that side of recess ("7.30–9.00"). */
  slotTime(s: number, span = 1) {
    return `${this.slots[s].split('-')[0]}–${this.slots[s + span - 1].split('-')[1]}`;
  }

  /** The event starting in slot `start` (events are keyed by their first slot). */
  eventFrom(start: number): DayEvent | undefined {
    return this.day?.events?.[start];
  }

  /**
   * Changes the day's events. `freed` are slots given back (empty cells, until Regenerate or picked
   * by hand); `taken` are slots the events now cover, whose teachers leave (a merged block on that
   * side keeps the other slot when it's free). Both can be undone. Nothing is regenerated, so a
   * generated day is marked out of date. Returns the teachers who lost a cell.
   */
  private changeEvents(change: (events: Record<number, DayEvent>) => void, taken: number[]): TeacherId[] {
    if (!this.editable) return [];
    let gone: TeacherId[] = [];
    this.record(() => {
      const d = this.day;
      const events = { ...d.events };
      change(events);
      d.events = events;
      gone = [...new Set(taken.flatMap((s) => clearSlot(d.tt, s)))];
      if (d.rules !== undefined) d.stale = true;
    });
    return gone;
  }

  private goneMessage(gone: TeacherId[]) {
    return gone.length ? ` ${listNames(gone.map((id) => this.nameOf.get(id)))} taken out.` : '';
  }

  /**
   * Adds an event for every class, like recess, in slot s or (span 2, s even) both slots on that
   * side of recess. Never across recess, and never over another event.
   */
  addEvent(s: number, name: string, span: 1 | 2 = 1) {
    const clean = cleanName(name);
    const slots = span === 2 ? [s, s + 1] : [s];
    if (!clean || (span === 2 && s % 2) || slots.some((x) => this.blocked[x])) return;
    const gone = this.changeEvents((ev) => (ev[s] = span === 2 ? { name: clean, span: 2 } : { name: clean }), slots);
    if (gone.length) this.offerUndo(`${clean} added at ${this.slotTime(s, span)}.${this.goneMessage(gone)}`);
  }

  renameEvent(start: number, name: string) {
    const clean = cleanName(name);
    const e = this.eventFrom(start);
    if (!this.editable || !clean || !e) return;
    this.record(() => {
      this.day.events = { ...this.day.events, [start]: { ...e, name: clean } };
    });
  }

  /** Stretches a one-slot event over the other slot on its side of recess (if that has no event). */
  mergeEvent(start: number) {
    const e = this.eventFrom(start);
    const other = start ^ 1;
    if (!e || e.span === 2 || this.blocked[other]) return;
    const first = start & ~1;
    const gone = this.changeEvents((ev) => {
      delete ev[start];
      ev[first] = { name: e.name, span: 2 };
    }, [other]);
    if (gone.length) this.offerUndo(`${e.name} now takes ${this.slotTime(first, 2)}.${this.goneMessage(gone)}`);
  }

  /** A two-slot event keeps only slot `keep`; the other slot is given back, empty. */
  shortenEvent(start: number, keep: number) {
    const e = this.eventFrom(start);
    if (!e || e.span !== 2 || (keep !== start && keep !== start + 1)) return;
    this.changeEvents((ev) => {
      delete ev[start];
      ev[keep] = { name: e.name };
    }, []);
    this.offerUndo(`${e.name} now only at ${this.slotTime(keep)}. ${this.slotTime(keep ^ 1)} is empty until you Regenerate or pick teachers.`);
  }

  /** Its slots get their cells back, empty, until Regenerate (or filled by hand). */
  removeEvent(start: number) {
    const e = this.eventFrom(start);
    if (!e) return;
    this.changeEvents((ev) => delete ev[start], []);
    this.offerUndo(`${e.name} removed. ${this.slotTime(start, e.span ?? 1)} is empty until you Regenerate or pick teachers.`);
  }

  /** Empties a cell (it can hold several names) and points at Undo, since one tap loses them. */
  clearCell(c: number, set: number, pos: number, message: string) {
    if (this.edit(() => assignCell(this.day.tt, c, set, pos, null))) this.offerUndo(message);
  }

  assign(c: number, set: number, pos: number, id: TeacherId | null) {
    this.edit(() => assignCell(this.day.tt, c, set, pos, id));
  }

  addName(c: number, set: number, pos: number, id: TeacherId) {
    this.edit(() => addName(this.day.tt, c, set, pos, id));
  }

  removeName(c: number, set: number, pos: number, id: TeacherId) {
    this.edit(() => removeName(this.day.tt, c, set, pos, id));
  }

  toggleMerge(c: number, set: number) {
    if (setBlocked(this.blocked, set)) return; // an event takes one of the 2 slots
    this.edit(() => {
      if (this.day.tt[c].sets[set].merged) {
        splitSet(this.day.tt, c, set, this.available.map((t) => t.id), this.minutes);
      } else {
        mergeSet(this.day.tt, c, set);
      }
    });
  }
}

export const store = new Store();
