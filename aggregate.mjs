// aggregate.mjs
import { promises as fs } from 'fs';
import path from 'path';

const DATA_DIR = 'data';
const PUBLIC_DIR = path.join(DATA_DIR, 'public');
const OUT_CSV  = path.join(PUBLIC_DIR, 'results.csv');

// Colunas canônicas para o CSV final (podem vir vazias se não existirem na origem)
const CANON = [
  'date','route','stamp',
  'airline','iata','stops','dep','arr',
  'price_brl','all_prices_brl',
  'source','screenshot'
];

// Descobre separador e converte linha → objeto
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return [];
  const sep = lines[0].includes(';') ? ';' : ',';
  const head = lines[0].split(sep).map(h => h.trim().replace(/^"|"$/g,''));
  return lines.slice(1).map(l => {
    const cols = l.split(sep).map(c => c.trim().replace(/^"|"$/g,''));
    const o = {};
    head.forEach((h,i)=> o[h] = cols[i] ?? '');
    return o;
  });
}

// Normaliza um registro para as colunas canônicas
function normalize(row, ctx) {
  // ctx = {dateFromFolder, routeFromFolder, stampFromFolder, dir}
  const get = (...keys) => keys.map(k => row[k]).find(v => v !== undefined && v !== '');
  const n = {};
  n.date  = get('date','data') || ctx.dateFromFolder || '';
  n.route = get('route','rota') || ctx.routeFromFolder || '';
  n.stamp = get('stamp','stamp_id','run','capture','timestamp') || ctx.stampFromFolder || '';
  n.airline = get('airline','companhia','cia') || '';
  n.iata    = get('iata','cia_iata') || '';
  n.stops   = get('stops','paradas','escala','escalas') || '';
  n.dep     = get('dep','saida','from_time') || '';
  n.arr     = get('arr','chegada','to_time') || '';
  n.price_brl = get('price_brl','min_price_brl','preco_brl','preco','price');
  n.all_prices_brl = get('all_prices_brl','precos_brl','prices_brl') || '';
  n.source  = get('url','source','href') || '';
  n.screenshot = get('screenshot','print') || '';

  // Limpeza de números (R$ 1.234,56 → 1234.56)
  if (n.price_brl !== undefined && n.price_brl !== '') {
    const s = String(n.price_brl)
      .replace(/[^\d.,-]/g,'')
      .replace(/\.(?=\d{3}\b)/g,'') // remove separador de milhar
      .replace(',', '.');
    const f = parseFloat(s);
    n.price_brl = Number.isFinite(f) ? f.toFixed(2) : '';
  } else {
    n.price_brl = '';
  }
  return n;
}

async function findAllResultsCsv() {
  const acc = [];
  async function walk(dir) {
    const items = await fs.readdir(dir, { withFileTypes: true });
    for (const it of items) {
      const full = path.join(dir, it.name);
      if (it.isDirectory()) {
        // pular /data/public
        if (full.replace(/\\/g,'/').startsWith(`${DATA_DIR}/public`)) continue;
        await walk(full);
      } else if (it.isFile() && it.name === 'results.csv') {
        acc.push(full);
      }
    }
  }
  await walk(DATA_DIR);
  return acc;
}

function parseFolderInfo(filePath) {
  // data/YYYY-MM-DD_ROUTE/STAMP/results.csv
  const parts = filePath.replace(/\\/g,'/').split('/');
  const dateRoute = parts[1]; // YYYY-MM-DD_ROUTE
  const stamp = parts[2];     // STAMP
  let dateFromFolder = '', routeFromFolder = '';
  if (dateRoute && dateRoute.includes('_')) {
    const [date, route] = dateRoute.split('_');
    dateFromFolder = date;
    routeFromFolder = route || '';
  }
  return { dateFromFolder, routeFromFolder, stampFromFolder: stamp || '' };
}

function toCSV(rows, headers) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
  };
  const head = headers.join(',');
  const body = rows.map(r => headers.map(h => esc(r[h] ?? '')).join(','));
  return [head, ...body].join('\n') + '\n';
}

(async () => {
  // garantir pasta public
  await fs.mkdir(PUBLIC_DIR, { recursive: true });

  const files = await findAllResultsCsv();
  const out = [];

  for (const f of files) {
    try {
      const txt = await fs.readFile(f, 'utf8');
      const rows = parseCSV(txt);
      const ctx = parseFolderInfo(f);
      rows.forEach(r => out.push(normalize(r, ctx)));
    } catch (e) {
      console.error('Falha lendo', f, e);
    }
  }

  // ordena por data ASC, depois preço ASC (vazio vai pro fim)
  out.sort((a,b) => {
    const d = (a.date||'').localeCompare(b.date||'');
    if (d !== 0) return d;
    const pa = a.price_brl === '' ? Infinity : parseFloat(a.price_brl);
    const pb = b.price_brl === '' ? Infinity : parseFloat(b.price_brl);
    return pa - pb;
  });

  const csv = toCSV(out, CANON);
  await fs.writeFile(OUT_CSV, csv, 'utf8');

  console.log(`OK: ${out.length} linhas → ${OUT_CSV}`);
})();
