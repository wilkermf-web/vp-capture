// ===== topo do scrape-vaidepromo.js (ESM) =====
import fs from 'node:fs';
import path from 'node:path';

function getArg(flag, def = null) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const FROM = getArg('--from', process.env.FROM_IATA || 'GYN');
const TO = getArg('--to', process.env.TO_IATA || 'CAC');
const DATE = getArg('--date', process.env.DEPART_DATE);

let OUT = getArg('--out', process.env.OUTPUT_DIR);
if (!OUT) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  OUT = path.join('data', `${DATE}_${FROM}-${TO}`, stamp);
}
fs.mkdirSync(OUT, { recursive: true });

function saveJSON(fileName, obj) {
  fs.writeFileSync(path.join(OUT, fileName), JSON.stringify(obj, null, 2));
}
function appendCSVRow(rowObj) {
  const csvPath = path.join('public', 'results.csv');
  const header = [
    'date','from','to','best_price','airline','flight','depart','arrive',
    'duration','stops','source','baggage','scraped_at'
  ];
  const toRow = (o) => header.map(k => (o[k] ?? '')).join(',');
  if (!fs.existsSync('public')) fs.mkdirSync('public', { recursive: true });
  if (!fs.existsSync(csvPath)) {
    fs.writeFileSync(csvPath, header.join(',') + '\n');
  }
  fs.appendFileSync(csvPath, toRow(rowObj) + '\n');
}

console.log('[scraper] OUT =', OUT);

// Chame isto no final com o array de voos
export function onFinished(flights) {
  saveJSON('results.json', { date: DATE, from: FROM, to: TO, count: flights.length, flights });
  const best = flights.slice().sort((a,b)=>a.price-b.price)[0];
  if (best) {
    appendCSVRow({
      date: DATE, from: FROM, to: TO,
      best_price: best.price,
      airline: best.airline, flight: best.flight,
      depart: best.depart, arrive: best.arrive,
      duration: best.duration, stops: best.stops,
      source: best.source || 'vaidepromo', baggage: best.baggage || '',
      scraped_at: new Date().toISOString()
    });
  }
}
// ===== fim do bloco auxiliares =====
