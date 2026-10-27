export type TeacherId = string;
export type ClassId = string;

/** An entry in a server list (teachers or classes): renaming keeps the id. */
export interface Named {
  id: string;
  name: string;
}

export type Teacher = Named;
export type SchoolClass = Named;

/** Two consecutive teaching slots on one side of recess. */
export interface SetBlock {
  merged: boolean;
  /** Merged block: t[0] === t[1] is the first name. */
  t: [TeacherId | null, TeacherId | null];
  /** Merged block only: further names shown with the first (e.g. "Ainol / Sakinah"). Each name covers the whole block. */
  extra?: TeacherId[];
  /** Split pair only: further names per slot, shown with t[pos] (e.g. "Ainol / Sakinah"). Each name covers the whole slot. */
  more?: [TeacherId[], TeacherId[]];
}

/** One timetable row: set 0 = before recess, set 1 = after recess. Several classes in one row
 *  (shown "K1/K2") are combined: they share the row's teachers. */
export interface Row {
  classes: ClassId[];
  sets: [SetBlock, SetBlock];
}

export type Timetable = Row[];

export interface DayData {
  unavailable: TeacherId[];
  /** Classes not taught that day: they have no row. */
  classesOff?: ClassId[];
  seed: number;
  tt: Timetable;
  /** Scheduling-rules version the timetable was generated with. */
  rules?: number;
  /** Changed by hand since it was last generated (so a rebuild would lose work). */
  edited?: boolean;
  /** Availability or the teacher list changed since it was last generated; only Regenerate rebuilds it. */
  stale?: boolean;
  /** Rows combined or split by hand (so the day differs from the default layout). */
  layout?: boolean;
  /** Events by first slot index (0..3), e.g. { 0: { name: "Perhimpunan" } }. Like recess, an
   *  event takes its slot(s) for every class: nobody teaches then. */
  events?: Record<number, DayEvent>;
}

/** An event for every class. `span: 2` also takes the next slot (same side of recess; the key is then even). */
export interface DayEvent {
  name: string;
  span?: 2;
}

/** A timetable cell the user is editing. */
export interface PickTarget {
  c: number;
  set: number;
  pos: number;
}
