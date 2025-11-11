// ===== topo do scrape-vaidepromo.js (CJS) =====
const fs = require('node:fs');
const path = require('node:path');

function getArg(flag, def = null) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const FROM = getArg('--from', process.env.FROM_IATA || 'GYN');
const TO = getArg('--to', process.env.TO_IATA || 'CAC');
const DATE = getArg('--date', process.env.DEPART_DATE); // formato yyyy-mm-dd

let OUT = getArg('--out', process.env.OUTPUT_DIR);
if (!OUT) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  OUT = path.join('data', `${DATE}_${FROM}-${TO}`, stamp);
}
fs.mkdirSync(OUT, { recursive: true });

// Helpers para salvar:
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

// ===== depois que você extrair os voos do Vaidepromo =====
// Suponha que você já tenha um array "flights" com resultados do dia:
//
// const flights = [{
//   price: 420.99, airline: 'AZUL', flight: 'AD1234',
//   depart: '06:10', arrive: '09:45', duration: '3h35', stops: '1',
//   source: 'vaidepromo', baggage: 'sem bagagem'
// }, ...]
//
// Pegue o mais barato e salve:

function onFinished(flights) {
  // 1) salvar o bruto do dia
  saveJSON('results.json', { date: DATE, from: FROM, to: TO, count: flights.length, flights });

  // 2) linha resumida para o CSV geral
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
