import { Pool, QueryResult } from 'pg';
import { ENV } from '../config/env';

export const pool = new Pool({ connectionString: ENV.databaseUrl });

// Mirrors the Python app's dict-row convenience: every query returns plain
// objects (rows[i].column_name) instead of positional arrays.
export async function query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const result: QueryResult = await pool.query(sql, params);
  return result.rows as T[];
}

export async function queryOne<T = any>(sql: string, params: any[] = []): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

export function nowIso(): string {
  return new Date().toISOString();
}
