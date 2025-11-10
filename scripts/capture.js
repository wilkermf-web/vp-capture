// scripts/capture.js
import { chromium } from 'playwright';
import fs from 'fs/promises';
import path from 'path';
import { ymdCompact, safeStamp, ensureDir, writeFile, toCSV } from './utils.js';

// Entradas
const ORIGIN = (process.env.ORIGIN || 'GYN').toUpperCase();
const DEST   = (process.env.DEST   || 'CAC').toUpperCase();
const DATE   = process.env.DATE;

if (!DATE || !/^\d{4}-\d{2}-\d{2}$/.test(DATE)) {
  console.error('DATE inválida. Use YYYY-MM-DD.');
  process.exit(1);
}

// URL direta (uso autorizado)
const ymd = ymdCompact(DATE);
const SEARCH_URL = `https://www.vaidepromo.com.br/passagens-aereas/pesquisa/${ORIGIN}${DEST}${ymd}/1/0/0/Y/`;

// Pastas de saída
const routeSlug = `${DATE}_${ORIGIN}-${DEST}`;
const stamp = safeStamp();
const outDir = path.join('data', routeSlug, stamp);
const out = (name) => path.join(outDir, name);

// Leitor do HTML para extrair preços “Preço por adulto”
function parseOffersFromHTML(html) {
  const chunks = html.split(/Preço por adulto/i);
  const offers = [];
  for (let i = 0; i < chunks.length - 1; i++) {
    const left = chunks[i].slice(-1200);
    const right = chunks[i + 1].slice(0, 1200);
    const around = left + ' ' + right;

    // Preço
    const mPrice = right.match(/R\$\s*\d{1,3}(?:\.\d{3})*,\d{2}/);
    if (!mPrice) continue;
    const priceNum = Number(
      mPrice[0].replace(/[^\d,]/g, '').replace(/\./g, '').replace(',', '.')
    );

    // Companhia (heurística simples)
    let airline = null, iata = null;
    if (/(Azul)/i.test(around))  { airline = 'Azul';  iata = 'AD'; }
    if (/(GOL)/i.test(around))   { airline = 'GOL';   iata = 'G3'; }
    if (/(LATAM)/i.test(around)) { airline = 'LATAM'; iata = 'LA'; }

    // Horários (pega os dois primeiros)
    const times = around.match(/\b\d{2}:\d{2}\b/g) || [];
    const dep = times[0] || '';
    const arr = times[1] || '';

    // Paradas
    let stops = '';
    if (/Direto/i.test(around)) stops = 'Direto';
    const mStops = around.match(/(\d+)\s+parad[ao]s?/i);
    if (mStops) stops = `${mStops[1]} parada${mStops[1] === '1' ? '' : 's'}`;

    offers.push({ airline, iata, price_brl: priceNum, stops, departure: dep, arrival: arr });
  }

  // Dedupe + ordena por preço
  const seen = new Set();
  return offers.filter(o => {
    const k = `${o.airline}|${o.iata}|${o.price_brl}|${o.stops}|${o.departure}|${o.arrival}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).sort((a,b) => a.price_brl - b.price_brl);
}

(async () => {
  await ensureDir(outDir);

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });

  const ctx = await browser.newContext({
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    viewport: { width: 1280, height: 1600 },
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'
  });

  const page = await ctx.newPage();

  const net = [];
  page.on('response', r => {
    try { net.push({ url: r.url(), status: r.status() }); } catch {}
  });

  // Abre a busca
  await page.goto(SEARCH_URL, { waitUntil: 'domcontentloaded', timeout: 90_000 });

  // Rola para forçar carregamento dos cards
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press('PageDown');
    await page.waitForTimeout(350);
  }
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(()=>{});

  // Salva brutos
  await writeFile(out('page.html'), await page.content());
  await page.screenshot({ path: out('screenshot.png'), fullPage: true });
  await writeFile(out('network.json'), JSON.stringify(net, null, 2));

  // Extrai um CSV simples (opcional, mas útil)
  const html = await fs.readFile(out('page.html'), 'utf8');
  const offers = parseOffersFromHTML(html);
  const header = ['company','iata','price_brl','stops','departure','arrival'];
  const rows = [header, ...offers.map(o => [
    o.airline||'', o.iata||'', o.price_brl?.toFixed(2)||'',
    o.stops||'', o.departure||'', o.arrival||''
  ])];
  await writeFile(out('results.csv'), toCSV(rows));
  await writeFile(out('results.json'), JSON.stringify(offers, null, 2));

  // Metadados
  await writeFile(out('meta.json'), JSON.stringify({
    origin: ORIGIN, dest: DEST, date: DATE, url: SEARCH_URL, stamp, count: offers.length
  }, null, 2));

  await browser.close();
  console.log(`OK: ${offers.length} ofertas → ${outDir}`);
})();
