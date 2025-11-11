// scripts/range.js (ESM) — chama scripts/capture.js 1 dia por vez

import { spawn } from 'node:child_process';

const ORIGIN = (process.env.ORIGIN || 'GYN').trim();
const DEST   = (process.env.DEST   || 'CAC').trim();
const DAYS   = Number(process.env.DAYS || '90');           // quantos dias pra frente
const START  = (process.env.START_DATE || '').trim();      // opcional: YYYY-MM-DD
const DELAY  = Number(process.env.DELAY_MS || '3500');     // pausa entre dias (ms)
const DEBUG  = process.env.DEBUG || '0';

function pad(n){ return String(n).padStart(2,'0'); }
function toDateStr(d){ return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function isoStamp(){ return new Date().toISOString().replace(/[:.]/g,'-'); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

function addDays(dateStr, k){
  // dateStr: YYYY-MM-DD
  const [y,m,d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m-1, d));
  dt.setUTCDate(dt.getUTCDate() + k);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth()+1)}-${pad(dt.getUTCDate())}`;
}

async function runDay(dateStr){
  console.log(`[range] ${ORIGIN}->${DEST} | ${dateStr}`);
  await new Promise((resolve, reject) => {
    const child = spawn('node', ['scripts/capture.js'], {
      stdio: 'inherit',
      env: {
        ...process.env,
        ORIGIN,
        DEST,
        DATE: dateStr,       // o capture.js lê daqui
        STAMP: isoStamp(),
        DEBUG
      }
    });
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`capture exit ${code}`)));
    child.on('error', reject);
  }).catch(err => {
    console.error('[range] Falha nesse dia:', err.message);
  });
}

(async () => {
  // ponto de partida
  let startDateStr;
  if (START) {
    startDateStr = START;                    // usa a data que veio do input
  } else {
    const base = new Date();                 // hoje (do runner)
    startDateStr = toDateStr(base);
  }

  for (let i = 0; i < DAYS; i++) {
    const dateStr = START ? addDays(START, i) : addDays(startDateStr, i);
    await runDay(dateStr);
    if (i < DAYS - 1) await sleep(DELAY);
  }

  console.log('\n[range] Varredura concluída.');
})();
