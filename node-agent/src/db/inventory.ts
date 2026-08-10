import { v4 as uuidv4 } from 'uuid';
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

export async function listInventoryItems() {
  return query('SELECT * FROM inventory_items ORDER BY name ASC');
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
