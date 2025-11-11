// scripts/capture.js (ESM) — Playwright com seletor estável "Preço por adulto"
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { ensureDir, writeJSON, writeText, autoScroll, parseBRL, toCSV } from './utils.js';

function buildUrl({ origin, dest, date }) {
  // date: YYYY-MM-DD → precisa virar YYYYMMDD
  const yyyymmdd = date.replaceAll('-', '');
  // 1 adulto / 0 crianças / 0 bebês / Y (econômica)
  return `https://www.vaidepromo.com.br/passagens-aereas/pesquisa/${origin}${dest}${yyyymmdd}/1/0/0/Y/`;
}

function outBase({ date, route, stamp }) {
  return path.join('data', `${date}_${route}`, stamp);
}

function nowStamp() {
  const d = new Date();
  return d.toISOString().replaceAll(':', '-').replaceAll('.', '-');
}

async function extractPricesFromDOM(page) {
  // Aguarda aparecer o rótulo "Preço por adulto"
  await page.locator('span:has-text("Preço por adulto")').first().waitFor({ timeout: 60000 }).catch(() => {});
  // Faz scroll pra carregar todos os cards
  await autoScroll(page, { step: 900, idleMs: 700, max: 40 });

  // Card que contém o rótulo
  const cards = page.locator('div:has(span:has-text("Preço por adulto"))');
  const count = await cards.count();
  const prices = [];

  for (let i = 0; i < count; i++) {
    const card = cards.nth(i);

    // alvo preferido: class*="pricePerAdultValueSectionMoney" (hash muda, então usamos "contains")
    let priceText = null;
    const moneySpan = card.locator('[class*="pricePerAdultValueSectionMoney"]').first();
    if (await moneySpan.count()) {
      priceText = (await moneySpan.innerText()).trim();
    } else {
      // fallback: pega primeiro span com "R$"
      const anyMoney = card.locator('span:has-text("R$")').first();
      if (await anyMoney.count()) {
        priceText = (await anyMoney.innerText()).trim();
      }
    }

    const value = parseBRL(priceText);
    if (value != null) prices.push(value);
  }

  // ordena e remove duplicados
  const uniqueSorted = Array.from(new Set(prices)).sort((a, b) => a - b);
  return uniqueSorted;
}

async function main() {
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
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  const ctx = await browser.newContext({
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    viewport: { width: 1440, height: 900 },
  });
  const page = await ctx.newPage();

  if (DEBUG) console.log('Abrindo URL:', url);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });

  // dá um respiro pra animações/fetches
  await page.waitForTimeout(2500);
  try { await page.waitForLoadState('networkidle', { timeout: 15000 }); } catch {}

  // Extrai preços do DOM
  const prices = await extractPricesFromDOM(page);

  // Auditoria
  const html = await page.content();
  writeText(path.join(base, 'page.html'), html);
  await page.screenshot({ path: path.join(base, 'screenshot.png'), fullPage: true });

  await browser.close();

  // Resumo
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

  // Salva CSV (um preço por linha)
  const rows = prices.map(p => ({ date: DATE, route: ROUTE, stamp: STAMP, price_brl: p }));
  const csv = toCSV(rows, ['date', 'route', 'stamp', 'price_brl']);
  writeText(path.join(base, 'results.csv'), csv);

  if (DEBUG) console.log(JSON.stringify(data, null, 2));
}

main().catch(err => {
  console.error('ERRO no capture.js:', err);
  process.exit(1);
});
