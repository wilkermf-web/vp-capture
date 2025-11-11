// run-range.js — Varre 1 dia de cada vez por N dias e limpa data/ com +1h

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function parseArgs() {
  const a = process.argv.slice(2);
  const out = { from: null, to: null, days: 90, delayMs: 4000 };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--from') out.from = a[++i];
    else if (a[i] === '--to') out.to = a[++i];
    else if (a[i] === '--days') out.days = Number(a[++i]);
    else if (a[i] === '--delay-ms') out.delayMs = Number(a[++i]);
  }
  if (!out.from || !out.to) {
    console.error('Use: --from GYN --to CAC [--days 90] [--delay-ms 4000]');
    process.exit(1);
  }
  return out;
}

const fmtDate = d =>
  `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const ts = () => new Date().toISOString().replace(/[:.]/g, '-');
const ensureDir = p => fs.mkdirSync(p, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Faxineiro: apaga o que tem +1h em data/
function cleanupTTL(baseDir = 'data', ttlMin = 60) {
  if (!fs.existsSync(baseDir)) return;
  const now = Date.now(), ttlMs = ttlMin * 60 * 1000;
  for (const entry of fs.readdirSync(baseDir)) {
    const full = path.join(baseDir, entry);
    try {
      const st = fs.statSync(full);
      if (now - st.mtimeMs > ttlMs) {
        fs.rmSync(full, { recursive: true, force: true });
        console.log('[cleanup] Apagado:', full);
      }
    } catch {}
  }
}

// Seu scraper está na RAIZ:
const SCRAPER = path.join('scrape-vaidepromo.js');

function runSingleDay({ dateStr, from, to, dayRunDir }) {
  return new Promise((resolve, reject) => {
    const args = [
      SCRAPER,
      '--from', from,
      '--to', to,
      '--date', dateStr,
      '--out', dayRunDir,
      '--headless'
    ];
    console.log(`\n[run] ${from} -> ${to} | ${dateStr}`);
    const child = spawn('node', args, {
      stdio: 'inherit',
      env: { ...process.env, FROM_IATA: from, TO_IATA: to, DEPART_DATE: dateStr, OUTPUT_DIR: dayRunDir }
    });
    child.on('exit', code => code === 0 ? resolve() : reject(new Error('exit '+code)));
    child.on('error', reject);
  });
}

(async () => {
  const { from, to, days, delayMs } = parseArgs();
  cleanupTTL('data', 60); // faxina antes de começar
  const start = new Date(); start.setHours(0,0,0,0);
  for (let i = 0; i < days; i++) {
    const d = new Date(start); d.setDate(d.getDate() + i);
    const dateStr = fmtDate(d);
    const dayDir = path.join('data', `${dateStr}_${from}-${to}`);
    const runDir = path.join(dayDir, ts());
    ensureDir(runDir);
    try { await runSingleDay({ dateStr, from, to, dayRunDir: runDir }); }
    catch (e) { console.error('[run] Falha em', dateStr, e.message); }
    if (i < days - 1) await sleep(delayMs);
  }
  console.log('\n[FIM] Varredura concluída.');
})();
