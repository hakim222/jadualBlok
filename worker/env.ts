import type { Schedule } from './schedule';

export interface Env {
  DB: D1Database;
  SCHEDULE: DurableObjectNamespace<Schedule>;
  ADMIN_PIN: string;
}
