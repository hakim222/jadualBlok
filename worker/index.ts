import type { Env } from './env';

export { Schedule } from './schedule';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

// /api/teachers, /api/classes, or either with /<id>
const ROUTE = /^\/api\/(teachers|classes)(?:\/([^/]+))?\/?$/;

/** The two name lists. Table names come only from here, never from the request. */
const LISTS = {
  teachers: { table: 'teachers', noun: 'Teacher', max: 40 },
  classes: { table: 'classes', noun: 'Class', max: 20 },
} as const;

type List = (typeof LISTS)[keyof typeof LISTS];

/** Reads {"name": "..."} and returns the cleaned name, or an error Response. */
async function readName(req: Request, max: number): Promise<string | Response> {
  let name: unknown;
  try {
    ({ name } = (await req.json()) as { name?: unknown });
  } catch {
    return json({ error: 'Body must be JSON: {"name": "..."}' }, 400);
  }
  const clean = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : '';
  if (!clean || clean.length > max) return json({ error: `Name must be 1–${max} characters` }, 400);
  return clean;
}

const isUniqueError = (e: unknown) => String(e).includes('UNIQUE');

/** The one shared timetable store (see worker/schedule.ts). */
const schedule = (env: Env) => env.SCHEDULE.get(env.SCHEDULE.idFromName('school'));

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const path = new URL(req.url).pathname;
    // Live timetable sync: a WebSocket handled by the Durable Object.
    if (path === '/api/live') return schedule(env).fetch(req);

    const match = path.match(ROUTE);
    if (!match) return json({ error: 'Not found' }, 404);
    const res = await names(req, env, LISTS[match[1] as keyof typeof LISTS], match[2] ? decodeURIComponent(match[2]) : null);
    // Tell every open app to refetch the lists after a successful change.
    if (req.method !== 'GET' && res.ok) ctx.waitUntil(schedule(env).broadcastLists());
    return res;
  },
};

async function names(req: Request, env: Env, list: List, id: string | null): Promise<Response> {
  const { table, noun, max } = list;

  // List: open to anyone (put it behind the PIN if names should be private)
  if (req.method === 'GET' && !id) {
    const { results } = await env.DB.prepare(`SELECT id, name FROM ${table} ORDER BY created_at, rowid`).all();
    return json(results);
  }

  // Adding, renaming and removing need the admin PIN. Fails closed if the secret isn't set.
  if (!env.ADMIN_PIN || req.headers.get('x-admin-pin') !== env.ADMIN_PIN) {
    return json({ error: 'Wrong PIN' }, 401);
  }

  if (req.method === 'POST' && !id) {
    const name = await readName(req, max);
    if (name instanceof Response) return name;
    const newId = crypto.randomUUID();
    try {
      await env.DB.prepare(`INSERT INTO ${table} (id, name) VALUES (?, ?)`).bind(newId, name).run();
    } catch (e) {
      if (isUniqueError(e)) return json({ error: 'Name already exists' }, 409);
      throw e;
    }
    return json({ id: newId, name }, 201);
  }

  if (req.method === 'PATCH' && id) {
    const name = await readName(req, max);
    if (name instanceof Response) return name;
    try {
      const { meta } = await env.DB.prepare(`UPDATE ${table} SET name = ? WHERE id = ?`).bind(name, id).run();
      return meta.changes ? json({ id, name }) : json({ error: `${noun} not found` }, 404);
    } catch (e) {
      if (isUniqueError(e)) return json({ error: 'Name already exists' }, 409);
      throw e;
    }
  }

  if (req.method === 'DELETE' && id) {
    const { meta } = await env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id).run();
    return meta.changes ? new Response(null, { status: 204 }) : json({ error: `${noun} not found` }, 404);
  }

  return json({ error: 'Method not allowed' }, 405);
}
