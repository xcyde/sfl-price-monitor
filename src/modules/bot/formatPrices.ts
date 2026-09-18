const TELEGRAM_MAX = 4096;
const PRE_OPEN = '<pre>';
const PRE_CLOSE = '</pre>';
const BLOCK_OVERHEAD = PRE_OPEN.length + PRE_CLOSE.length;

export interface PriceRecord {
  itemName: string;
  price: number;
  fetchedAt: Date;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function formatPrices(prices: PriceRecord[]): string[] {
  if (prices.length === 0) {
    return ['No prices available yet.'];
  }

  const sorted = [...prices].sort((a, b) => a.itemName.localeCompare(b.itemName));
  const lines = sorted.map((p) => `${escapeHtml(p.itemName)}: ${p.price}`);

  const chunks: string[] = [];
  let current = '';

  for (const line of lines) {
    const sep = current.length > 0 ? '\n' : '';
    const candidate = current + sep + line;
    if (candidate.length + BLOCK_OVERHEAD > TELEGRAM_MAX) {
      chunks.push(current);
      current = line;
    } else {
      current = candidate;
    }
  }

  if (current.length > 0) chunks.push(current);

  return chunks.map((c) => `${PRE_OPEN}${c}${PRE_CLOSE}`);
}
