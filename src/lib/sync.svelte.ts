import { pinGate } from './pin.svelte';
import { datesToPush } from './sync-core';
import type { DayData } from './types';

/**
 * Live timetable sync with the Durable Object behind /api/live (worker/schedule.ts).
 *
 * Messages, client → server:
 *   {type:'hello', pin?}                          → snapshot of every day; the PIN decides canEdit
 *   {type:'put', date, day, baseVersion, client}   → whole-day write, only if baseVersion is current
 * Server → client:
 *   {type:'snapshot', days:{date:{day,version}}, canEdit, pinRejected}
 *   {type:'day', date, day, version, client}       → an accepted write, sent to every socket
 *   {type:'conflict', date, day, version}          → our put was based on an old version
 *   {type:'denied', date}                          → our put needs the PIN
 *   {type:'lists'}                                 → the teacher or class list changed on the server
 *
 * Changes go out from one effect that compares each day with the copy the server last
 * confirmed, so every way of changing a day is covered. The server copy always wins:
 * the snapshot on (re)connect, writes from other devices, and conflicts replace local days.
 * Editing is only allowed while connected with the PIN (see Store.editable).
 */

export type LiveStatus = 'connecting' | 'live' | 'offline';

export interface SyncHost {
  days(): Record<string, DayData>;
  /** Replace a day with the server's copy (null: drop it). */
  setDay(date: string, day: DayData | null): void;
  /** The teacher or class list changed on the server. */
  listsChanged(): void;
  notify(msg: string): void;
}

const PING_EVERY = 25_000;
const PONG_WITHIN = 10_000;

class Sync {
  status = $state<LiveStatus>('connecting');
  canEdit = $state(false);

  private host: SyncHost | null = null;
  private ws: WebSocket | null = null;
  private readonly client = crypto.randomUUID();
  /** Per date: the JSON and version the server last confirmed, and puts awaiting an answer. */
  private synced = new Map<string, string>();
  private versions = new Map<string, number>();
  private inflight = new Map<string, string>();
  private retry = 1000;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private pongTimer: ReturnType<typeof setTimeout> | undefined;

  start(host: SyncHost) {
    this.host = host;
    this.connect();
    $effect.root(() => {
      // Send local changes whenever a day changes (stringify inside tracks every field).
      $effect(() => this.flush());
      // Unlocking or locking (PIN entered or forgotten) re-introduces this device to the server.
      $effect(() => {
        pinGate.unlocked;
        if (this.status === 'live') this.hello();
      });
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !this.ws) this.connect();
    });
  }

  /** Ask for the PIN, then reconnect as an editor. */
  async unlock() {
    if (await pinGate.get()) this.hello();
  }

  private connect() {
    clearTimeout(this.retryTimer);
    const url = new URL('api/live', location.href);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      return this.lost();
    }
    this.ws = ws;
    // Retries after a lost connection keep showing "offline" until the snapshot arrives.
    if (this.status !== 'offline') this.status = 'connecting';
    ws.onopen = () => {
      this.retry = 1000;
      this.hello();
      this.pingTimer = setInterval(() => this.ping(), PING_EVERY);
    };
    ws.onmessage = (e) => this.receive(e.data);
    ws.onclose = () => {
      if (this.ws === ws) this.lost();
    };
  }

  /** Connection gone: editing pauses, and we retry with backoff (sooner when the tab comes back). */
  private lost() {
    clearInterval(this.pingTimer);
    clearTimeout(this.pongTimer);
    this.ws = null;
    this.status = 'offline';
    this.canEdit = false;
    this.inflight.clear();
    this.retryTimer = setTimeout(() => this.connect(), this.retry);
    this.retry = Math.min(this.retry * 2, 30_000);
  }

  /** The server answers "ping" with "pong" without waking up; no answer means a dead connection. */
  private ping() {
    this.ws?.send('ping');
    clearTimeout(this.pongTimer);
    this.pongTimer = setTimeout(() => this.ws?.close(), PONG_WITHIN);
  }

  private hello() {
    this.send({ type: 'hello', pin: pinGate.current() ?? undefined });
  }

  private send(msg: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private flush() {
    const days = this.host!.days();
    const pending = datesToPush(days, this.synced, this.versions, new Set(this.inflight.keys()));
    if (this.status !== 'live' || !this.canEdit) return;
    for (const [date, json] of pending) {
      this.inflight.set(date, json);
      this.send({ type: 'put', date, day: JSON.parse(json), baseVersion: this.versions.get(date) ?? 0, client: this.client });
    }
  }

  /** Take the server's copy of a day as both the local day and the confirmed copy. */
  private adopt(date: string, day: DayData | null, version: number) {
    this.versions.set(date, version);
    if (day) this.synced.set(date, JSON.stringify(day));
    else this.synced.delete(date);
    this.host!.setDay(date, day);
  }

  private receive(raw: unknown) {
    if (raw === 'pong') return clearTimeout(this.pongTimer);
    let msg: any;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    switch (msg.type) {
      case 'snapshot':
        if (msg.pinRejected) {
          pinGate.forget();
          this.host!.notify('Wrong PIN. The timetable is read-only on this device.');
        }
        this.inflight.clear();
        for (const [date, { day, version }] of Object.entries(msg.days as Record<string, { day: DayData; version: number }>)) {
          this.adopt(date, day, version);
        }
        this.canEdit = !!msg.canEdit;
        this.status = 'live';
        this.flush(); // days only this device has (e.g. from before sync) go up now
        break;
      case 'day':
        if (msg.client === this.client && this.inflight.has(msg.date)) {
          // Our own write, confirmed. Local edits made meanwhile go out next.
          this.versions.set(msg.date, msg.version);
          this.synced.set(msg.date, this.inflight.get(msg.date)!);
          this.inflight.delete(msg.date);
          this.flush();
        } else {
          // Another device's write wins; a put of ours based on the old version will conflict anyway.
          this.inflight.delete(msg.date);
          this.adopt(msg.date, msg.day, msg.version);
        }
        break;
      case 'error':
        // A put the server couldn't read gets no other answer: stop waiting, so later changes still go out.
        this.inflight.clear();
        this.host!.notify(`Couldn't save to the server: ${msg.error ?? 'unknown error'}`);
        break;
      case 'conflict': {
        // Another device got there first. Same content (e.g. both marked the day out of date): no news.
        const same = this.inflight.get(msg.date) === JSON.stringify(msg.day);
        this.inflight.delete(msg.date);
        this.adopt(msg.date, msg.day, msg.version);
        if (!same) this.host!.notify('This day was changed on another device. Showing the latest version.');
        break;
      }
      case 'denied': {
        this.inflight.delete(msg.date);
        this.canEdit = false;
        const json = this.synced.get(msg.date);
        this.host!.setDay(msg.date, json ? JSON.parse(json) : null);
        this.host!.notify('Enter the admin PIN to edit the timetable.');
        break;
      }
      case 'lists':
      case 'teachers': // sent by Workers deployed before classes could be edited
        this.host!.listsChanged();
        break;
    }
  }
}

export const sync = new Sync();
