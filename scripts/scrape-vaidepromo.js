// --- no topo do scrape-vaidepromo.js ---
const fs = require('node:fs');
const path = require('node:path');

function getArg(flag, def = null) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const FROM = getArg('--from', process.env.FROM_IATA);
const TO = getArg('--to', process.env.TO_IATA);
const DATE = getArg('--date', process.env.DEPART_DATE); // yyyy-mm-dd

// Diretório onde salvar (screenshots, json, csv do dia)
let OUT = getArg('--out', process.env.OUTPUT_DIR);
if (!OUT) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  OUT = path.join('data', `${DATE}_${FROM}-${TO}`, stamp);
}
fs.mkdirSync(OUT, { recursive: true });

// Agora, sempre que salvar arquivo, use `OUT`:
// ex.: fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(data));



// scripts/scrape-vaidepromo.js
// Captura preços "Preço por adulto" direto do DOM do Vaidepromo (Playwright)

import { chromium } from 'playwright';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';

function yymmdd(dateStr) {
  // dateStr: "2025-11-30" -> "251130"
  const d = new Date(dateStr + 'T00:00:00Z');
  const y = String(d.getUTCFullYear()).slice(-2);
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${dd}`;
}
function brlToNumber(text) {
  // "R$ 1.234,56" -> 1234.56
  const m = (text || '').match(/(\d{1,3}(\.\d{3})*|\d+),\d{2}/);
  if (!m) return null;
  return parseFloat(m[0].replace(/\./g, '').replace(',', '.'));
}
function firstMatch(re, s, def = null) {
  const m = s.match(re);
  return m ? m[0] : def;
}
function detectAirline(blockText) {
  const t = blockText.toLowerCase();
  if (t.includes('latam')) return 'LATAM';
  if (t.includes('gol')) return 'GOL';
  if (t.includes('azul')) return 'AZUL';
  return '';
}
function detectStops(blockText) {
  // procura "sem paradas" | "0 parada" | "1 parada" | "2 paradas" etc.
  const t = blockText.toLowerCase();
  if (t.includes('sem paradas') || t.includes('direto')) return 0;
  const m = t.match(/(\d+)\s*parad(a|as)/);
  return m ? parseInt(m[1], 10) : null;
}
async function autoScroll(page, { maxSteps = 30, step = 1200, pause = 400 } = {}) {
  let last = 0;
  for (let i = 0; i < maxSteps; i++) {
    const h1 = await page.evaluate(() => document.scrollingElement.scrollHeight);
    await page.evaluate((dy) => window.scrollBy(0, dy), step);
    await page.waitForTimeout(pause);
    const h2 = await page.evaluate(() => document.scrollingElement.scrollHeight);
    if (h2 <= last) break;
    last = h2;
  }
  // volta ao topo (para layout previsível)
  await page.evaluate(() => window.scrollTo(0, 0));
}

async function main() {
  // --- Parâmetros via env ou argv
  const ORIGIN = process.env.ORIGIN || process.argv[2] || 'GYN';
  const DEST   = process.env.DEST   || process.argv[3] || 'CAC';
  const DATE   = process.env.DATE   || process.argv[4] || '2025-11-30'; // AAAA-MM-DD
  const ADT    = parseInt(process.env.ADT || '1', 10);  // adultos
  const CHD    = parseInt(process.env.CHD || '0', 10);  // crianças
  const INF    = parseInt(process.env.INF || '0', 10);  // bebês
  const CABIN  = process.env.CABIN || 'Y';              // Y=Economy
  const HEADLESS = process.env.HEADLESS !== 'false';

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const ym = yymmdd(DATE);
  const routeTag = `${ORIGIN}-${DEST}`;

  const baseUrl = `https://www.vaidepromo.com.br/passagens-aereas/pesquisa/${ORIGIN}${DEST}${ym}/${ADT}/${CHD}/${INF}/${CABIN}/`;

  console.log(`[i] Acessando: ${baseUrl}`);

  const browser = await chromium.launch({
    headless: HEADLESS,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 1200 },
    locale: 'pt-BR',
  });
  const page = await ctx.newPage();

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });

  // Aguarda aparecer algum "Preço por adulto"
  await page.waitForSelector('text=Preço por adulto', { timeout: 120000 });

  // Garante carregar mais resultados (scroll)
  await autoScroll(page, { maxSteps: 40 });

  // Tira screenshot e salva HTML bruto (útil para auditoria)
  const outDir = path.join(
    'data',
    `${DATE}_${routeTag}`,
    `${stamp}`
  );
  await fsp.mkdir(outDir, { recursive: true });
  await page.screenshot({ path: path.join(outDir, 'screenshot.png'), fullPage: true });
  const html = await page.content();
  await fsp.writeFile(path.join(outDir, 'page.html'), html, 'utf8');

  // Coleta todos os spans do preço por adulto (classes ofuscadas, mas com prefixo fixo)
  const priceLoc = page.locator('span[class*="pricePerAdultValueSection"]'); // ex.: _pricePerAdultValueSectionMoney_...
  const n = await priceLoc.count();
  console.log(`[i] Cards com preço localizados: ${n}`);

  const rows = [];
  for (let i = 0; i < n; i++) {
    const span = priceLoc.nth(i);

    // Texto do preço (ex.: "R$ 926,41")
    const priceText = (await span.textContent())?.trim() || '';

    // Sobe para um contêiner maior que contenha também "Preço por adulto"
    const handle = await span.evaluateHandle((el) => {
      let p = el.parentElement;
      for (let k = 0; k < 8 && p; k++) {
        try {
          if (p.innerText && p.innerText.includes('Preço por adulto')) return p;
        } catch {}
        p = p.parentElement;
      }
      return el.parentElement || el;
    });

    const blockText = await handle.evaluate((node) => node.innerText || '');
    const price = brlToNumber(priceText);

    // Heurísticas simples para demais campos
    const times = (blockText.match(/\b([01]?\d|2[0-3]):[0-5]\d\b/g) || []).slice(0, 2);
    const dep = times[0] || '';
    const arr = times[1] || '';
    const airline = detectAirline(blockText);
    const stops = detectStops(blockText);

    // Evita duplicatas simples (mesmo preço e mesmos horários)
    const key = `${airline}|${dep}|${arr}|${price}`;
    if (!rows.some(r => r._k === key)) {
      rows.push({
        airline,
        iata: airline === 'GOL' ? 'G3' : airline === 'LATAM' ? 'LA' : airline === 'AZUL' ? 'AD' : '',
        price_brl: price,
        raw_price: priceText,
        stops,
        depart: dep,
        arrive: arr,
        _k: key
      });
    }
  }

  // Ordena pelo menor preço
  rows.sort((a, b) => (a.price_brl ?? 9e9) - (b.price_brl ?? 9e9));

  // Salva JSON
  const resultJson = {
    date: DATE,
    route: routeTag,
    stamp,
    url: baseUrl,
    count: rows.length,
    min_price_brl: rows.length ? rows[0].price_brl : null,
    results: rows.map(({ _k, ...r }) => r),
  };
  await fsp.writeFile(path.join(outDir, 'results.json'), JSON.stringify(resultJson, null, 2), 'utf8');

  // Salva CSV
  const csv = [
    'airline,iata,price_brl,raw_price,stops,depart,arrive'
  ].concat(
    rows.map(r => [
      r.airline,
      r.iata,
      r.price_brl ?? '',
      (r.raw_price || '').replace(/,/g, ''),
      r.stops ?? '',
      r.depart,
      r.arrive
    ].join(','))
  ).join('\n');

  await fsp.writeFile(path.join(outDir, 'results.csv'), csv, 'utf8');

  console.log(`[✓] Salvo em: ${outDir}`);
  console.log(`[✓] Itens: ${rows.length} | Min BRL: ${resultJson.min_price_brl}`);

  await browser.close();
}

main().catch(async (err) => {
  console.error('[ERR]', err);
  process.exit(1);
});
