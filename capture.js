// capture.js — Captura Vaidepromo (print+HTML+XHR) + parse inicial “Preço por adulto”
import { chromium } from 'playwright';
import fs from 'fs/promises';
import fse from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --------- Parâmetros (via env ou defaults) ---------
const ORIGIN = (process.env.ORIGIN || 'GYN').toUpperCase();
const DEST   = (process.env.DEST   || 'CAC').toUpperCase();
const DATE   = (process.env.DATE   || '2025-11-30');  // AAAA-MM-DD
const ADULTS = Number(process.env.ADULTS || 1);
const CHILD  = Number(process.env.CHILD  || 0);
const INF    = Number(process.env.INF    || 0);
const CABIN  = (process.env.CABIN || 'Y').toUpperCase();
const OUTPUT_DIR = process.env.OUTPUT_DIR || 'data';
const BASE = process.env.SITE_URL || 'https://www.vaidepromo.com.br';
const DEBUG = process.env.DEBUG === '1';

function buildSearchUrl({ origin, destination, date, adults=1, children=0, infants=0, cabin='Y' }){
  const [yyyy,mm,dd] = date.split('-'); const yy = String(yyyy).slice(-2);
  const pathPart = `${origin}${destination}${yy}${mm}${dd}/${adults}/${children}/${infants}/${cabin}/`;
  return `${BASE}/passagens-aereas/pesquisa/${pathPart}`;
}
const URL = buildSearchUrl({ origin: ORIGIN, destination: DEST, date: DATE, adults: ADULTS, children: CHILD, infants: INF, cabin: CABIN });

// --------- Pasta de saída ---------
const stamp = new Date().toISOString().replace(/[:.]/g,'-');
const runDir = path.join(__dirname, OUTPUT_DIR, `${DATE}_${ORIGIN}-${DEST}`, stamp);

const parseBRL = s => s ? (n => Number.isFinite(n)?n:null)(
  Number(String(s).replace(/[^\d,.-]/g,'').replace(/\./g,'').replace(',','.'))
) : null;

async function main(){
  await fse.ensureDir(runDir);

  // coleta XHR JSON
  const network = [];
  const maxBody = 1.5 * 1024 * 1024; // 1.5MB por resposta

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--disable-setuid-sandbox','--disable-blink-features=AutomationControlled']
  });
  const ctx = await browser.newContext({
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    viewport: { width: 1280, height: 900 },
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'
  });
  await ctx.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });
  await ctx.route('**/*', route => {
    const t = route.request().resourceType();
    if (t === 'font') return route.abort();
    route.continue();
  });

  const page = await ctx.newPage();
  page.on('response', async (resp) => {
    try {
      const url = resp.url();
      const ct = String(resp.headers()['content-type']||'').toLowerCase();
      if (!/json|javascript/.test(ct)) return;
      if (!/api|search|result|voo|flight|fare|price/i.test(url)) return;
      const buf = await resp.body().catch(()=>null);
      if (!buf) return;
      const body = buf.slice(0, maxBody).toString();
      network.push({ url, status: resp.status(), headers: resp.headers(), body });
    } catch {}
  });

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });

  // espera pelo texto “Preço por adulto” ou preços renderizados
  try {
    await page.waitForSelector('text=/Preço\\s+por\\s+adulto/i', { timeout: 60000 });
  } catch {
    await page.waitForLoadState('networkidle', { timeout: 45000 }).catch(()=>{});
  }

  // scroll para forçar lazy-load
  for (let i=0;i<4;i++){ await page.evaluate(y=>window.scrollTo(0,y),(i+1)*1500); await page.waitForTimeout(600); }

  // salva artefatos
  const html = await page.content();
  await fs.writeFile(path.join(runDir, 'page.html'), html, 'utf8');
  await page.screenshot({ path: path.join(runDir, 'screenshot.png'), fullPage: true });
  await fs.writeFile(path.join(runDir, 'network.json'), JSON.stringify(network, null, 2), 'utf8');

  // parse inicial (ancorado em “Preço por adulto”) para já gerar uma planilha
  const rawRows = await page.evaluate(() => {
    const out = [];
    const priceRe = /R\$\s*([\d\.]{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})/;
    const timeRe  = /\b([01]?\d|2[0-3]):[0-5]\d\b/g;
    const names   = ['Azul','GOL','LATAM','TAM','AD','G3','LA'];

    const anchors = Array.from(document.querySelectorAll('body *'))
      .filter(el => /Preço\s+por\s+adulto/i.test(el.textContent||''));

    const nearestCard = (el) => {
      let p=el, steps=0;
      while(p && steps<10){
        if (p.matches?.('article, section, li, .card, [class*="resultado"], [class*="flight"], [data-testid*="card"]')) return p;
        p=p.parentElement; steps++;
      }
      return el;
    };

    for (const a of anchors) {
      const card = nearestCard(a);
      const text = (card.innerText||'').replace(/\s+/g,' ').trim();
      const around = a.closest('*')?.innerText || '';
      const px = around.match(priceRe) || text.match(priceRe);
      if (!px) continue;
      const priceLabel = 'R$ ' + px[1];

      let airline = '';
      for (const nm of names) { if (new RegExp(`\\b${nm}\\b`, 'i').test(text)) { airline = nm; break; } }

      const times = Array.from(text.matchAll(timeRe)).map(m=>m[0]);
      const saida = times[0] || '';
      const chegada = times[1] || '';

      out.push({ airline, priceLabel, saida, chegada });
    }

    const seen = new Set();
    return out.filter(r => { const k=[r.airline,r.priceLabel,r.saida,r.chegada].join('|'); if(seen.has(k)) return false; seen.add(k); return true; });
  });

  const results = rawRows
    .map(r => ({
      airline: r.airline || '',
      price_brl: parseBRL(r.priceLabel),
      price_label: r.priceLabel,
      departure: r.saida || '',
      arrival: r.chegada || ''
    }))
    .filter(x => x.price_brl != null && x.price_brl >= 100 && x.price_brl <= 20000)
    .sort((a,b)=>a.price_brl-b.price_brl);

  await fs.writeFile(path.join(runDir, 'results.json'), JSON.stringify({ url: URL, origin: ORIGIN, destination: DEST, date: DATE, results }, null, 2), 'utf8');

  // CSV simples
  const csv = ['airline,price_brl,price_label,departure,arrival']
    .concat(results.map(r => [r.airline, r.price_brl, r.price_label, r.departure, r.arrival].map(v=>`"${String(v||'').replace(/"/g,'""')}"`).join(',')))
    .join('\n');
  await fs.writeFile(path.join(runDir, 'results.csv'), csv, 'utf8');

  // meta
  await fs.writeFile(path.join(runDir, 'meta.json'), JSON.stringify({
    captured_at: new Date().toISOString(),
    url: URL, params: { ORIGIN, DEST, DATE, ADULTS, CHILD, INF, CABIN }
  }, null, 2), 'utf8');

  if (DEBUG) console.log('Saved to', runDir);
  await ctx.close(); await browser.close();
}

main().catch(async (e)=>{
  await fse.ensureDir(runDir);
  await fs.writeFile(path.join(runDir, 'error.txt'), String(e), 'utf8');
  process.exitCode = 1;
});
