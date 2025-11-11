// scripts/utils.js (ESM)
import fs from 'fs';
import path from 'path';

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function writeJSON(fp, data) {
  fs.writeFileSync(fp, JSON.stringify(data, null, 2), 'utf8');
}

export function writeText(fp, text) {
  fs.writeFileSync(fp, text, 'utf8');
}

export function parseBRL(text) {
  if (!text) return null;
  const t = String(text)
    .replace(/\s+/g, ' ')
    .replace(/R\$\s*/i, '')
    .replace(/\./g, '')
    .replace(',', '.');
  const n = Number.parseFloat(t);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : null;
}

export async function autoScroll(page, { step = 800, idleMs = 600, max = 30 } = {}) {
  let lastY = -1;
  for (let i = 0; i < max; i++) {
    const y = await page.evaluate(s => { window.scrollBy(0, s); return window.scrollY; }, step);
    if (y === lastY) break;
    lastY = y;
    await page.waitForTimeout(idleMs);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
}

export function toCSV(rows, headers) {
  const esc = v => String(v ?? '').replace(/"/g, '""');
  const head = headers.map(h => `"${esc(h)}"`).join(';');
  const body = rows.map(r => headers.map(h => `"${esc(r[h])}"`).join(';')).join('\n');
  return head + '\n' + body + '\n';
}
