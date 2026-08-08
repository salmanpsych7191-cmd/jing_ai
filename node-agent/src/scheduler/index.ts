// A persisted (Postgres-backed) job scheduler, mirroring the Python app's APScheduler +
// SQLAlchemyJobStore setup. That persistence was a real production fix earlier this
// session (in-memory job loss on restart silently dropped booking reminders) - a plain
// setTimeout-based scheduler here would reintroduce exactly that bug, since Node
// timers don't survive a process restart/redeploy either.

import cron from 'node-cron';
import { v4 as uuidv4 } from 'uuid';
import { pool, query } from '../db';

export type JobType =
  | 'send_whatsapp_message'
  | 'award_points_notification';

interface JobPayload {
  [key: string]: any;
}

type JobHandler = (payload: JobPayload) => Promise<void>;

const handlers: Partial<Record<JobType, JobHandler>> = {};

export function registerJobHandler(type: JobType, handler: JobHandler): void {
  handlers[type] = handler;
}

export async function initSchedulerTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS scheduled_jobs (
      id TEXT PRIMARY KEY,
      job_type TEXT NOT NULL,
      run_at TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      executed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )
  `);
}

// id is used as an idempotency key, matching APScheduler's replace_existing=True -
// re-scheduling the same id (e.g. re-confirming a booking) replaces the prior job
// instead of creating a duplicate reminder.
export async function scheduleJob(id: string, jobType: JobType, runAt: Date, payload: JobPayload): Promise<void> {
  await query(
    `INSERT INTO scheduled_jobs (id, job_type, run_at, payload_json, executed, created_at)
     VALUES ($1, $2, $3, $4, 0, $5)
     ON CONFLICT (id) DO UPDATE SET
       job_type = excluded.job_type, run_at = excluded.run_at,
       payload_json = excluded.payload_json, executed = 0`,
    [id, jobType, runAt.toISOString(), JSON.stringify(payload), new Date().toISOString()],
  );
}

async function runDueJobs(): Promise<void> {
  const due = await query<{ id: string; job_type: JobType; payload_json: string }>(
    `SELECT id, job_type, payload_json FROM scheduled_jobs WHERE executed = 0 AND run_at <= $1 ORDER BY run_at ASC LIMIT 50`,
    [new Date().toISOString()],
  );
  for (const job of due) {
    const handler = handlers[job.job_type];
    // Mark executed BEFORE running so a handler that throws can't loop-retry forever
    // and spam the same WhatsApp message every minute.
    await query('UPDATE scheduled_jobs SET executed = 1 WHERE id = $1', [job.id]);
    if (!handler) {
      console.warn(`[Scheduler] No handler registered for job type "${job.job_type}" (job ${job.id})`);
      continue;
    }
    try {
      await handler(JSON.parse(job.payload_json));
    } catch (err) {
      console.error(`[Scheduler] Job ${job.id} (${job.job_type}) failed:`, err);
    }
  }
}

export function startScheduler(): void {
  // Every minute - matches the granularity of the Python app's reminder scheduling
  // (24h/2h-before reminders don't need finer resolution than this).
  cron.schedule('* * * * *', () => {
    runDueJobs().catch((err) => console.error('[Scheduler] Poll failed:', err));
  });
}

export function newJobId(prefix: string): string {
  return `${prefix}-${uuidv4()}`;
}
