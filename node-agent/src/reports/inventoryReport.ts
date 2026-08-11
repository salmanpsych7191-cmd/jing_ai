import cron from 'node-cron';
import { ENV } from '../config/env';
import { listInventoryItems } from '../db/inventory';
import { sendEmail } from '../email/mailer';

function isLow(item: any): boolean {
  const threshold = Number(item.low_stock_threshold) || 0;
  const qty = Number(item.quantity) || 0;
  return threshold > 0 && qty <= threshold;
}

function esc(text: string): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function buildInventoryReportHtml(): Promise<{ subject: string; html: string }> {
  const items: any[] = await listInventoryItems(2000);
  const today = new Intl.DateTimeFormat('en-SG', { timeZone: ENV.bookingTimezone, dateStyle: 'full' }).format(new Date());

  const total = items.length;
  const lowItems = items.filter(isLow);
  const categories = new Map<string, { count: number; low: number }>();
  for (const item of items) {
    const cat = item.category || 'Uncategorized';
    const entry = categories.get(cat) ?? { count: 0, low: 0 };
    entry.count += 1;
    if (isLow(item)) entry.low += 1;
    categories.set(cat, entry);
  }

  const lowRows = lowItems
    .sort((a, b) => (a.category || '').localeCompare(b.category || '') || a.name.localeCompare(b.name))
    .map((item) => `
      <tr>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;">${esc(item.name)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;">${esc(item.category || 'Uncategorized')}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;">${item.quantity} ${esc(item.unit || '')}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;">${item.low_stock_threshold}</td>
      </tr>
    `).join('');

  const categoryRows = [...categories.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([cat, info]) => `
      <tr>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;">${esc(cat)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;">${info.count}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;color:${info.low ? '#a3564a' : '#888'};">${info.low || '-'}</td>
      </tr>
    `).join('');

  const html = `
    <div style="font-family:Arial,sans-serif;color:#241f19;max-width:640px;">
      <h2 style="margin-bottom:0;">${esc(ENV.restaurantName)} — Inventory Report</h2>
      <p style="color:#7c7263;margin-top:4px;">${today}</p>

      <div style="display:flex;gap:16px;margin:20px 0;">
        <div style="background:#f6f2ea;border-radius:10px;padding:12px 18px;">
          <div style="font-size:1.4rem;font-weight:700;">${total}</div>
          <div style="font-size:0.85rem;color:#7c7263;">Total items</div>
        </div>
        <div style="background:#f6f2ea;border-radius:10px;padding:12px 18px;">
          <div style="font-size:1.4rem;font-weight:700;color:${lowItems.length ? '#a3564a' : '#241f19'};">${lowItems.length}</div>
          <div style="font-size:0.85rem;color:#7c7263;">Low stock</div>
        </div>
        <div style="background:#f6f2ea;border-radius:10px;padding:12px 18px;">
          <div style="font-size:1.4rem;font-weight:700;">${categories.size}</div>
          <div style="font-size:0.85rem;color:#7c7263;">Categories</div>
        </div>
      </div>

      ${lowItems.length ? `
        <h3 style="margin-bottom:8px;">Low stock (needs restocking)</h3>
        <table style="border-collapse:collapse;width:100%;font-size:0.9rem;">
          <thead>
            <tr style="text-align:left;color:#7c7263;">
              <th style="padding:6px 10px;">Item</th>
              <th style="padding:6px 10px;">Category</th>
              <th style="padding:6px 10px;text-align:right;">Quantity</th>
              <th style="padding:6px 10px;text-align:right;">Threshold</th>
            </tr>
          </thead>
          <tbody>${lowRows}</tbody>
        </table>
      ` : `<p>No items are below their low-stock threshold right now.</p>`}

      <h3 style="margin:24px 0 8px;">By category</h3>
      <table style="border-collapse:collapse;width:100%;font-size:0.9rem;">
        <thead>
          <tr style="text-align:left;color:#7c7263;">
            <th style="padding:6px 10px;">Category</th>
            <th style="padding:6px 10px;text-align:right;">Items</th>
            <th style="padding:6px 10px;text-align:right;">Low stock</th>
          </tr>
        </thead>
        <tbody>${categoryRows}</tbody>
      </table>

      <p style="color:#7c7263;font-size:0.8rem;margin-top:24px;">
        Automated daily report from the ${esc(ENV.restaurantName)} operations dashboard.
      </p>
    </div>
  `;

  const subject = lowItems.length
    ? `JING Inventory: ${lowItems.length} item(s) low stock — ${today}`
    : `JING Inventory: all stocked — ${today}`;

  return { subject, html };
}

export async function sendDailyInventoryReport(): Promise<{ sent: boolean; note: string }> {
  const { subject, html } = await buildInventoryReportHtml();
  const result = await sendEmail(subject, html);
  console.log(`[InventoryReport] ${result.sent ? 'Sent' : 'Skipped'}: ${result.note}`);
  return result;
}

// Requested send time: 11pm restaurant-local time, end-of-day summary right after
// closing. A plain node-cron schedule (not the persisted one-off job queue used for
// booking reminders) since this genuinely recurs daily rather than firing once.
export function startInventoryReportSchedule(): void {
  cron.schedule('0 23 * * *', () => {
    sendDailyInventoryReport().catch((err) => console.error('[InventoryReport] Scheduled send failed:', err));
  }, { timezone: ENV.bookingTimezone });
  console.log(`[InventoryReport] Scheduled daily at 23:00 (${ENV.bookingTimezone})`);
}
