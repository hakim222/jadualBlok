import { pinGate } from './pin.svelte';
import type { Named } from './types';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/** status 0 = the user closed the PIN dialog. */
export const isCancelled = (e: unknown) => e instanceof ApiError && e.status === 0;

const MAX_PIN_TRIES = 3;

async function call<T>(base: string, method: string, path = '', body?: unknown, auth = false): Promise<T> {
  for (let attempt = 0; attempt < MAX_PIN_TRIES; attempt++) {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (auth) {
      const pin = attempt === 0 ? await pinGate.get() : await pinGate.ask('Wrong PIN. Try again.');
      if (!pin) throw new ApiError('Cancelled', 0);
      headers['x-admin-pin'] = pin;
    }

    const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (res.status === 401 && auth) {
      pinGate.forget();
      continue;
    }
    if (res.status === 204) return undefined as T;
    // Anything that isn't JSON (e.g. the SPA's index.html) means the API isn't reachable here.
    if (!res.headers.get('content-type')?.includes('application/json')) {
      throw new ApiError('Server is not reachable', res.status);
    }
    const data = await res.json();
    if (!res.ok) throw new ApiError(data?.error ?? `Request failed (${res.status})`, res.status);
    return data as T;
  }
  throw new ApiError('Wrong PIN', 401);
}

/** One server list of names (teachers or classes). Changes need the admin PIN. */
const names = (base: string) => ({
  list: () => call<Named[]>(base, 'GET'),
  add: (name: string) => call<Named>(base, 'POST', '', { name }, true),
  rename: (id: string, name: string) => call<Named>(base, 'PATCH', `/${encodeURIComponent(id)}`, { name }, true),
  remove: (id: string) => call<void>(base, 'DELETE', `/${encodeURIComponent(id)}`, undefined, true),
});

export const api = {
  teachers: names('api/teachers'),
  classes: names('api/classes'),
};
