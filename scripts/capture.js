// scripts/capture.js (ESM) — abre Vaidepromo, extrai "Preço por adulto", salva arquivos
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}
function writeJSON(fp, data) {
  fs.writeFileSync(fp, JSON.stringify(data, null, 2), 'utf8');
}
function writeText(fp, text) {
  fs.writeFileSync(fp, text, 'utf8');
}
function toCSV(rows, headers) {
  const esc = v => String(v ?? '').replace(/"/g, '""');
  const head = headers.map(h => `"${esc(h)}"`).join(';');
  const body = rows.map(r => headers.map(h => `"${esc(r[h])}"`).join(';')).join('\n');
  return head + '\n' + body + '\n';
}
function parseBRL(text) {
  if (!text) return null;
  const t = String(text)
    .replace(/\s+/g, ' ')
    .replace(/R\$\s*/i, '')
    .replace(/\./g, '')     // milhar
    .replace(',', '.');     // vírgula -> ponto
  const n = Number.parseFloat(t);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : null;
}
async function autoScroll(page, { step = 900, idleMs = 700, max = 40 } = {}) {
  let lastY = -1;
  for (let i = 0; i < max; i++) {
    const y = await page.evaluate(s => {
      window.scrollBy(0, s);
      return window.scrollY;
    }, step);
    if (y === lastY) break;
    lastY = y;
    await page.waitForTimeout(idleMs);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
}

function buildUrl({ origin, dest, date }) {
  // date: YYYY-MM-DD -> YYYYMMDD
  const yyyymmdd = date.replaceAll('-', '');
  // 1 adulto / 0 crianças / 0 bebês / Y (econômica)
  return `https://www.vaidepromo.com.br/passagens-aereas/pesquisa/${origin}${dest}${yyyymmdd}/1/0/0/Y/`;
}
function outBase({ date, route, stamp }) {
  return path.join('data', `${date}_${route}`, stamp);
}
function nowStamp() {
  return new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
}

async function extractPricesFromDOM(page) {
  // Espera aparecer qualquer card que contenha o rótulo:
  await page.locator('span:has-text("Preço por adulto")').first().waitFor({ timeout: 60000 }).catch(() => {});
  // Garante lazy-load/render:
  await autoScroll(page);

  // Cada card que contem o rótulo
  const cards = page.locator('div:has(span:has-text("Preço por adulto"))');
  const count = await cards.count();
  const prices = [];

  for (let i = 0; i < count; i++) {
    const card = cards.nth(i);

    // alvo preferido: class*="pricePerAdultValueSectionMoney"
    let priceText = null;
    const moneySpan = card.locator('[class*="pricePerAdultValueSectionMoney"]').first();
    if (await moneySpan.count()) {
      priceText = (await moneySpan.innerText()).trim();
    } else {
      // fallback: primeiro span com "R$"
      const anyMoney = card.locator('span:has-text("R$")').first();
      if (await anyMoney.count()) {
        priceText = (await anyMoney.innerText()).trim();
      }
    }

    const value = parseBRL(priceText);
    if (value != null) prices.push(value);
  }

  // ordena e remove duplicados ocasionais
  return Array.from(new Set(prices)).sort((a, b) => a - b);
}

async function main() {
  // Inputs (podem vir de env ou ficam nos defaults)
  const ORIGIN = process.env.ORIGIN?.trim() || 'GYN';
  const DEST   = process.env.DEST?.trim()   || 'CAC';
  const DATE   = process.env.DATE?.trim()   || '2025-11-30'; // YYYY-MM-DD
  const ROUTE  = `${ORIGIN}-${DEST}`;
  const STAMP  = process.env.STAMP?.trim()  || nowStamp();
  const DEBUG  = process.env.DEBUG === '1';

  const url = buildUrl({ origin: ORIGIN, dest: DEST, date: DATE });
  const base = outBase({ date: DATE, route: ROUTE, stamp: STAMP });
  ensureDir(base);

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });
  const ctx = await browser.newContext({
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    viewport: { width: 1440, height: 900 }
  });
  const page = await ctx.newPage();

  if (DEBUG) console.log('Abrindo URL:', url);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });

  // respira um pouco para requests extras/animações
  await page.waitForTimeout(2500);
  try { await page.waitForLoadState('networkidle', { timeout: 15000 }); } catch {}

  // Extrai do DOM
  const prices = await extractPricesFromDOM(page);

  // Auditoria
  writeText(path.join(base, 'page.html'), await page.content());
  await page.screenshot({ path: path.join(base, 'screenshot.png'), fullPage: true });

  await browser.close();

  // Resumo do dia
  const data = {
    date: DATE,
    route: ROUTE,
    stamp: STAMP,
    url,
    min_price_brl: prices.length ? prices[0] : null,
    all_prices_brl: prices
  };

  // Salva JSON
  writeJSON(path.join(base, 'results.json'), data);

  // Salva CSV por dia (um preço por linha)
  const rows = prices.map(p => ({ date: DATE, route: ROUTE, stamp: STAMP, price_brl: p }));
  writeText(path.join(base, 'results.csv'), toCSV(rows, ['date', 'route', 'stamp', 'price_brl']));

  if (DEBUG) console.log(JSON.stringify(data, null, 2));
}

main().catch(err => {
  console.error('ERRO no capture.js:', err);
  process.exit(1);
});
