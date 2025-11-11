// run-range.js
// Node 18+
// Uso: node run-range.js --from GYN --to CAC --days 90

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { from: null, to: null, days: 90, delayMs: 4000 };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--from') out.from = args[++i];
    else if (a === '--to') out.to = args[++i];
    else if (a === '--days') out.days = Number(args[++i]);
    else if (a === '--delay-ms') out.delayMs = Number(args[++i]);
  }
  if (!out.from || !out.to) {
    console.error('Erro: use --from IATA e --to IATA. Ex: --from GYN --to CAC');
    process.exit(1);
  }
  if (!Number.isFinite(out.days) || out.days < 1) out.days = 90;
  return out;
}

function fmtDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function ts() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

async function sleep(ms) {
  await new Promise(r => setTimeout(r, ms));
}

/**
 * Remove tudo dentro de data/ com mtime > 60 min (TTL).
 * Roda no início de cada execução, garantindo retenção ~1h.
 */
function cleanupTTL(baseDir = 'data', ttlMin = 60) {
  if (!fs.existsSync(baseDir)) return;
  const now = Date.now();
  const ttlMs = ttlMin * 60 * 1000;

  for (const entry of fs.readdirSync(baseDir)) {
    const full = path.join(baseDir, entry);
    try {
      const st = fs.statSync(full);
      const age = now - st.mtimeMs;
      if (age > ttlMs) {
        fs.rmSync(full, { recursive: true, force: true });
        console.log(`[cleanup] Removido: ${full}`);
      }
    } catch (e) {
      console.warn(`[cleanup] Falha ao verificar ${full}:`, e.message);
    }
  }
}

/**
 * Executa o seu script single-day passando data, from/to e um OUTPUT_DIR
 * O seu `scrape-vaidepromo.js` deve ignorar OUTPUT_DIR se não usar, então é seguro.
 */
function runSingleDay({ dateStr, from, to, dayRunDir }) {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      FROM_IATA: from,
      TO_IATA: to,
      DEPART_DATE: dateStr,
      OUTPUT_DIR: dayRunDir, // use isto dentro do seu script se puder
    };

    // Tentativa padrão: passar flags comuns; se o seu script não usa, ele ignora
    const args = [
      'scrape-vaidepromo.js',
      '--from', from,
      '--to', to,
      '--date', dateStr,
      '--out', dayRunDir,
      '--headless'
    ];

    console.log(`\n[run] ${from}->${to} | ${dateStr}`);
    const child = spawn('node', args, {
      env,
      stdio: 'inherit',
    });

    child.on('exit', (code) => {
      if (code === 0) return resolve();
      reject(new Error(`scrape-vaidepromo.js saiu com código ${code}`));
    });
    child.on('error', reject);
  });
}

(async () => {
  const { from, to, days, delayMs } = parseArgs();

  // 1) Limpeza TTL (~1h) no início de cada execução
  cleanupTTL('data', 60);

  // 2) Gera datas a partir de hoje
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = 0; i < days; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const dateStr = fmtDate(d);

    // Ex: data/2025-11-24_GYN-CAC/2025-11-11T02-29-04-123Z/
    const dayDir = path.join('data', `${dateStr}_${from}-${to}`);
    const runDir = path.join(dayDir, ts());
    ensureDir(runDir);

    try {
      await runSingleDay({ dateStr, from, to, dayRunDir: runDir });
    } catch (err) {
      console.error(`[run] Falha em ${dateStr}: ${err.message}`);
      // Continua para o próximo dia
    }

    // Pequena pausa entre dias para ser "gentil" com o site
    if (i < days - 1) await sleep(delayMs);
  }

  console.log('\n[FIM] Varredura concluída.');
})();
