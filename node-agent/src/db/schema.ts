import { v4 as uuidv4 } from 'uuid';
import { pool, query } from './index';

export async function initDb(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      guest_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      guests INTEGER NOT NULL,
      special_requests TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      bill_amount REAL DEFAULT 0,
      created_at TEXT NOT NULL,
      confirmed_at TEXT,
      visited_at TEXT,
      reminder_24h_at TEXT,
      reminder_2h_at TEXT,
      review_requested_at TEXT,
      review_requested INTEGER NOT NULL DEFAULT 0,
      no_show INTEGER NOT NULL DEFAULT 0,
      table_id TEXT,
      table_name TEXT
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS loyalty (
      phone TEXT PRIMARY KEY,
      guest_name TEXT NOT NULL,
      total_points INTEGER NOT NULL DEFAULT 0,
      visit_count INTEGER NOT NULL DEFAULT 0,
      last_visit TEXT,
      vouchers_issued INTEGER NOT NULL DEFAULT 0,
      last_voucher_code TEXT,
      updated_at TEXT NOT NULL
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS message_log (
      id TEXT PRIMARY KEY,
      phone TEXT NOT NULL,
      direction TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      reviewer_name TEXT NOT NULL,
      phone TEXT,
      review_text TEXT NOT NULL,
      rating INTEGER NOT NULL,
      source TEXT NOT NULL DEFAULT 'Manual',
      created_at TEXT NOT NULL,
      responded_at TEXT,
      draft_response TEXT
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      phone TEXT NOT NULL,
      guest_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'sent',
      message TEXT NOT NULL,
      related_booking_id TEXT,
      sent_at TEXT NOT NULL
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS whatsapp_sessions (
      phone TEXT PRIMARY KEY,
      stage TEXT NOT NULL,
      guest_name TEXT,
      date TEXT,
      time TEXT,
      guests INTEGER,
      special_requests TEXT,
      updated_at TEXT NOT NULL
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS waitlist (
      id TEXT PRIMARY KEY,
      guest_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      date TEXT NOT NULL,
      session TEXT NOT NULL,
      guests INTEGER NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'waiting',
      created_at TEXT NOT NULL
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS restaurant_tables (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      capacity INTEGER NOT NULL,
      section TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    )
  `);
  await seedDefaultTables();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS call_analysis (
      id TEXT PRIMARY KEY,
      call_sid TEXT,
      phone TEXT NOT NULL,
      direction TEXT NOT NULL,
      extracted_json TEXT NOT NULL,
      transcript TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cold_call_queue (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL,
      company_name TEXT NOT NULL,
      contact_name TEXT,
      phone TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      call_sid TEXT,
      uploaded_at TEXT NOT NULL,
      called_at TEXT
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS inventory_items (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT '',
      quantity REAL NOT NULL DEFAULT 0,
      unit TEXT NOT NULL DEFAULT '',
      low_stock_threshold REAL NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS corporate_leads (
      id TEXT PRIMARY KEY,
      company_name TEXT NOT NULL,
      contact_name TEXT,
      phone TEXT NOT NULL,
      pax INTEGER,
      event_date TEXT,
      status TEXT NOT NULL,
      email TEXT,
      follow_up_note TEXT,
      summary TEXT,
      created_at TEXT NOT NULL
    )
  `);
}

// Seed a starter floor plan matching JING's verified 90-seat capacity (individual mini
// induction pots, up to 4 per table). Placeholders - edit in the dashboard to match the
// real floor plan; nothing here is confirmed restaurant layout data.
async function seedDefaultTables(): Promise<void> {
  const existing = await query<{ n: string }>('SELECT COUNT(*) AS n FROM restaurant_tables');
  if (parseInt(existing[0]?.n ?? '0', 10) > 0) return;

  const createdAt = new Date().toISOString();
  const layout: Array<[string, number, string]> = [
    ...Array.from({ length: 20 }, (_, i): [string, number, string] => [`T${i + 1}`, 4, 'Main Floor']),
    ...Array.from({ length: 2 }, (_, i): [string, number, string] => [`T${i + 21}`, 5, 'Main Floor']),
  ];
  for (const [name, capacity, section] of layout) {
    await query(
      'INSERT INTO restaurant_tables (id, name, capacity, section, active, created_at) VALUES ($1, $2, $3, $4, 1, $5)',
      [uuidv4(), name, capacity, section, createdAt],
    );
  }
}
