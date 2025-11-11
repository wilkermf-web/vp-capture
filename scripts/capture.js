// scripts/capture.js (ESM) — abre Vaidepromo, extrai "Preço por adulto" e salva arquivos
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

/* ------------------------ helpers de arquivo/CSV ------------------------ */
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

/* --------------------------- parsing/scroll ----------------------------- */
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

async function autoScroll(page, { step = 1000, idleMs = 700, max = 50 } = {}) {
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

/* ----------------------------- caminhos -------------------------------- */
function buildUrl({ origin, dest, date }) {
  // date "YYYY-MM-DD" -> "YYMMDD"
  const toYYMMDD = (dateStr) => {
    const [y, m, d] = dateStr.split('-').map(Number);
    const yy = String(y).slice(-2);
    return yy + String(m).padStart(2, '0') + String(d).padStart(2, '0');
  };
  const yymmdd = toYYMMDD(date);
  const ORI = String(origin).toUpperCase().trim();
  const DES = String(dest).toUpperCase().trim();
  // Ex.: https://www.vaidepromo.com.br/passagens-aereas/pesquisa/GYNCAC251130/1/0/0/Y/
  return `https://www.vaidepromo.com.br/passagens-aereas/pesquisa/${ORI}${DES}${yymmdd}/1/0/0/Y/`;
}

function outBase({ date, route, stamp }) {
  return path.join('data', `${date}_${route}`, stamp);
}

function nowStamp() {
  return new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
}

/* -------------------------- extração de preços -------------------------- */
async function extractPricesFromDOM(page) {
  // 1) Espera aparecer pelo menos um rótulo "Preço por adulto"
  await page.locator('span:has-text("Preço por adulto")').first().waitFor({ timeout: 60000 }).catch(() => {});
  // 2) Rola para forçar o lazy-load de todos os cards
  await autoScroll(page);

  // 3) Coleta APENAS spans com class*="pricePerAdultValueSectionMoney" nos cards
  let rawTexts = await page.$$eval(
    'div:has(span:has-text("Preço por adulto")) [class*="pricePerAdultValueSectionMoney"]',
    (els) => els
      .filter(el => {
        const s = getComputedStyle(el);
        return s.display !== 'none' && s.visibility !== 'hidden' && el.offsetParent !== null;
      })
      .map(el => el.textContent?.trim() || '')
  );

  // 4) Fallback (caso a classe mude): pega spans com "R$" dentro do card
  if (!rawTexts.length) {
    rawTexts = await page.$$eval(
      'div:has(span:has-text("Preço por adulto")) span:has-text("R$")',
      (els) => els
        .filter(el => {
          const s = getComputedStyle(el);
          return s.display !== 'none' && s.visibility !== 'hidden' && el.offsetParent !== null;
        })
        .map(el => el.textContent?.trim() || '')
    );
  }

  // 5) Normaliza para número BRL (ex.: "R$ 926,41" -> 926.41)
  const nums = rawTexts.map(parseBRL).filter(n => n != null);

  // 6) Remove duplicados ocasionais e ordena
  const uniqueSorted = Array.from(new Set(nums)).sort((a, b) => a - b);
  return uniqueSorted;
}

/* -------------------------------- main ---------------------------------- */
async function main() {
  // Variáveis de entrada (env) com defaults
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
  await page.waitForTimeout(2500); // respira p/ requests/anim.
  try { await page.waitForLoadState('networkidle', { timeout: 15000 }); } catch {}

  // Extrai do DOM
  const prices = await extractPricesFromDOM(page);

  // Auditoria (sempre salva)
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
