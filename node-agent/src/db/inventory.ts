import { v4 as uuidv4 } from 'uuid';
import ExcelJS from 'exceljs';
import { query, nowIso } from './index';

export interface InventoryItemInput {
  name: string;
  category?: string;
  quantity: number;
  unit?: string;
  lowStockThreshold?: number;
  notes?: string;
}

export async function createInventoryItem(input: InventoryItemInput) {
  const id = uuidv4();
  const now = nowIso();
  await query(
    `INSERT INTO inventory_items (id, name, category, quantity, unit, low_stock_threshold, notes, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
    [id, input.name, input.category ?? '', input.quantity, input.unit ?? '', input.lowStockThreshold ?? 0, input.notes ?? '', now],
  );
  return { id, created_at: now, updated_at: now, ...input };
}

export async function bulkCreateInventoryItems(rows: InventoryItemInput[]): Promise<number> {
  for (const row of rows) await createInventoryItem(row);
  return rows.length;
}

interface ParsedInventoryResult { rows: InventoryItemInput[]; skipped: number; total: number }

const HEADER_ALIASES: Record<keyof Required<Pick<InventoryItemInput, 'name' | 'category' | 'quantity' | 'unit' | 'lowStockThreshold' | 'notes'>>, string[]> = {
  name: ['name', 'item', 'item name'],
  category: ['category'],
  quantity: ['quantity', 'qty'],
  unit: ['unit'],
  lowStockThreshold: ['low_stock_threshold', 'threshold', 'low stock threshold'],
  notes: ['notes', 'note'],
};

function rowFromCells(cells: (string | number | null | undefined)[], cols: Record<string, number>): InventoryItemInput | null {
  const get = (key: string) => (cols[key] !== undefined ? cells[cols[key]] : undefined);
  const name = get('name');
  if (!name || !String(name).trim()) return null;
  return {
    name: String(name).trim(),
    category: get('category') ? String(get('category')).trim() : '',
    quantity: parseFloat(String(get('quantity') ?? '')) || 0,
    unit: get('unit') ? String(get('unit')).trim() : '',
    lowStockThreshold: parseFloat(String(get('lowStockThreshold') ?? '')) || 0,
    notes: get('notes') ? String(get('notes')).trim() : '',
  };
}

function resolveColumns(headerCells: string[]): Record<string, number> | null {
  const lowered = headerCells.map((c) => (c ?? '').toString().toLowerCase().trim());
  const cols: Record<string, number> = {};
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    const idx = lowered.findIndex((c) => aliases.includes(c));
    if (idx !== -1) cols[key] = idx;
  }
  return cols.name !== undefined ? cols : null;
}

// Handles a real .xlsx workbook (via ExcelJS - the "xlsx" npm package has an
// unpatched high-severity prototype-pollution advisory, so this app deliberately
// doesn't depend on it) or a plain CSV/TSV export, since "exported from Excel" as
// often means a .csv file as a true .xlsx one.
export async function parseInventoryFile(buffer: Buffer, filename: string): Promise<ParsedInventoryResult> {
  const isCsv = /\.(csv|tsv|txt)$/i.test(filename);
  if (isCsv) return parseInventoryCsv(buffer.toString('utf-8'));

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);
  const worksheet = workbook.worksheets[0];
  if (!worksheet || worksheet.rowCount === 0) return { rows: [], skipped: 0, total: 0 };

  const headerCells = (worksheet.getRow(1).values as any[]).map((v) => (v ?? '').toString());
  const namedCols = resolveColumns(headerCells);
  // Fallback fixed order (name, category, quantity, unit, threshold, notes) if no
  // recognizable header row was found - values[] is 1-indexed (index 0 is blank).
  const cols = namedCols ?? { name: 1, category: 2, quantity: 3, unit: 4, lowStockThreshold: 5, notes: 6 };
  const startRow = namedCols ? 2 : 1;

  const rows: InventoryItemInput[] = [];
  let skipped = 0;
  let total = 0;
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber < startRow) return;
    const cells = row.values as any[];
    if (cells.every((c) => c === null || c === undefined || c === '')) return;
    total++;
    const parsed = rowFromCells(cells, cols);
    if (!parsed) { skipped++; return; }
    rows.push(parsed);
  });

  return { rows, skipped, total };
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else { inQuotes = false; }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      cells.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

function parseInventoryCsv(text: string): ParsedInventoryResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { rows: [], skipped: 0, total: 0 };

  const headerCells = parseCsvLine(lines[0]);
  // resolveColumns/rowFromCells expect 1-indexed lookups (to share code with the
  // xlsx path's values[] convention) - pad CSV's 0-indexed cells with a leading blank.
  const namedCols = resolveColumns(['', ...headerCells]);
  const cols = namedCols ?? { name: 1, category: 2, quantity: 3, unit: 4, lowStockThreshold: 5, notes: 6 };
  const dataLines = namedCols ? lines.slice(1) : lines;

  const rows: InventoryItemInput[] = [];
  let skipped = 0;
  for (const line of dataLines) {
    const cells = ['', ...parseCsvLine(line)];
    const parsed = rowFromCells(cells, cols);
    if (!parsed) { skipped++; continue; }
    rows.push(parsed);
  }
  return { rows, skipped, total: dataLines.length };
}

export async function listInventoryItems(limit = 2000) {
  return query('SELECT * FROM inventory_items ORDER BY name ASC LIMIT $1', [limit]);
}

export async function updateInventoryQuantity(id: string, quantity: number) {
  const now = nowIso();
  await query('UPDATE inventory_items SET quantity = $1, updated_at = $2 WHERE id = $3', [quantity, now, id]);
  return { id, quantity, updated_at: now };
}

export async function deleteInventoryItem(id: string) {
  await query('DELETE FROM inventory_items WHERE id = $1', [id]);
  return { id, deleted: true };
}
