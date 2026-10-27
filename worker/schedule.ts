import { DurableObject } from 'cloudflare:workers';
import type { Env } from './env';

/**
 * Every school day's timetable, shared live with every open copy of the app.
 *
 * One instance (named "school") keeps each day as a JSON row with a version number. Clients
 * connect over a WebSocket: they get a snapshot of all days, send whole-day `put`s, and every
 * accepted change is broadcast to all sockets (the sender included, as its ack). A put only
 * applies to the version it was based on; otherwise the sender gets the current copy back.
 * Writing needs the admin PIN, sent in the first message (never in the URL).
 *
 * Messages are documented in src/lib/sync.svelte.ts, which is the only client.
 */

const KEEP_DAYS = 120;
const MAX_MESSAGE = 64 * 1024;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

interface Attachment {
  canEdit: boolean;
}

/** Just enough of DayData to reject garbage; the client owns the full shape. */
function looksLikeDay(day: unknown): boolean {
  const d = day as { unavailable?: unknown; tt?: unknown; seed?: unknown } | null;
  return !!d && typeof d === 'object' && Array.isArray(d.unavailable) && Array.isArray(d.tt) && typeof d.seed === 'number';
}

export class Schedule extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    // Keep-alive pings are answered without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    this.sql.exec(`CREATE TABLE IF NOT EXISTS days (
      date       TEXT PRIMARY KEY,
      json       TEXT NOT NULL,
      version    INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
  }

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected a WebSocket', { status: 426 });
    }
    const { 0: client, 1: server } = new WebSocketPair();
    // Hibernation API: idle sockets don't keep the object in memory.
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ canEdit: false } satisfies Attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== 'string' || raw.length > MAX_MESSAGE) return this.send(ws, { type: 'error', error: 'Message too large' });
    let msg: { type?: unknown; pin?: unknown; date?: unknown; day?: unknown; baseVersion?: unknown; client?: unknown };
    try {
      msg = JSON.parse(raw);
    } catch {
      return this.send(ws, { type: 'error', error: 'Bad JSON' });
    }

    if (msg.type === 'hello') {
      // Fails closed if the secret isn't set.
      const canEdit = !!this.env.ADMIN_PIN && msg.pin === this.env.ADMIN_PIN;
      ws.serializeAttachment({ canEdit } satisfies Attachment);
      return this.send(ws, { type: 'snapshot', days: this.allDays(), canEdit, pinRejected: typeof msg.pin === 'string' && !canEdit });
    }

    if (msg.type === 'put') {
      const { date, day, baseVersion, client } = msg;
      if (typeof date !== 'string' || !DATE.test(date) || !looksLikeDay(day) || typeof baseVersion !== 'number') {
        return this.send(ws, { type: 'error', error: 'Bad put' });
      }
      if (!(ws.deserializeAttachment() as Attachment | null)?.canEdit) return this.send(ws, { type: 'denied', date });

      const row = this.sql.exec<{ json: string; version: number }>('SELECT json, version FROM days WHERE date = ?', date).toArray()[0];
      const current = row?.version ?? 0;
      if (baseVersion !== current) {
        return this.send(ws, { type: 'conflict', date, day: row ? JSON.parse(row.json) : null, version: current });
      }
      const version = current + 1;
      this.sql.exec(
        'INSERT INTO days (date, json, version, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(date) DO UPDATE SET json = excluded.json, version = excluded.version, updated_at = excluded.updated_at',
        date,
        JSON.stringify(day),
        version,
        Date.now(),
      );
      this.prune();
      // `client` lets the sender recognise its own write as the ack.
      return this.broadcast({ type: 'day', date, day, version, client: typeof client === 'string' ? client : null });
    }

    this.send(ws, { type: 'error', error: 'Unknown message' });
  }

  async webSocketClose(ws: WebSocket, code: number) {
    try {
      ws.close(code === 1005 ? 1000 : code, 'closing');
    } catch {
      /* already closed */
    }
  }

  /** Called by the Worker after the teacher or class list changes, so every device refetches them. */
  async broadcastLists() {
    this.broadcast({ type: 'lists' });
  }

  private allDays(): Record<string, { day: unknown; version: number }> {
    const out: Record<string, { day: unknown; version: number }> = {};
    for (const r of this.sql.exec<{ date: string; json: string; version: number }>('SELECT date, json, version FROM days')) {
      out[r.date] = { day: JSON.parse(r.json), version: r.version };
    }
    return out;
  }

  /** Same retention as the browser copy (src/lib/storage.ts). */
  private prune() {
    const cutoff = new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
    this.sql.exec('DELETE FROM days WHERE date < ?', cutoff);
  }

  private send(ws: WebSocket, msg: unknown) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* socket closed meanwhile */
    }
  }

  private broadcast(msg: unknown) {
    const text = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(text);
      } catch {
        /* socket closed meanwhile */
      }
    }
  }
}
