// captura direto do DOM: "Preço por adulto"
import fs from "fs";
import path from "path";
import { chromium } from "playwright";

// ====== ENTRADAS por ENV ======
const ORIGIN = process.env.ORIGIN || "GYN";
const DEST   = process.env.DEST   || "CAC";
const DATE   = process.env.DATE   || "2025-11-30";    // AAAA-MM-DD
const DEBUG  = /^1|true$/i.test(process.env.DEBUG || "1");

// ====== HELPERS ======
function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}
function stampNow() {
  const z = new Date().toISOString().replace(/:/g, "-").replace(".", "-");
  return z; // ex: 2025-11-10T23-41-25-411Z
}
function parseBRL(str) {
  if (!str) return NaN;
  const clean = str.replace(/[^\d,.\-]/g, "");
  const norm = clean.replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", ".");
  return Number(norm);
}
function buildUrl(origin, dest, ymd) {
  // https://www.vaidepromo.com.br/passagens-aereas/pesquisa/GYNCACYYMMDD/1/0/0/Y/
  const [y, m, d] = ymd.split("-");
  const ddmmyy = `${d}${m}${String(y).slice(-2)}`;
  return `https://www.vaidepromo.com.br/passagens-aereas/pesquisa/${origin}${dest}${ddmmyy}/1/0/0/Y/`;
}
function outFolder(base, date, route) {
  const stamp = stampNow();
  const folder = path.join(base, `${date}_${route}`, stamp);
  ensureDir(folder);
  return { folder, stamp };
}
function writeCSV(csvPath, rows) {
  const csv = rows
    .map(r => r.map(v => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(","))
    .join("\n") + "\n";
  fs.writeFileSync(csvPath, csv);
}

// ====== CAPTURA ======
const ROUTE = `${ORIGIN}-${DEST}`;
const URL = buildUrl(ORIGIN, DEST, DATE);
const BASE = "data";

if (DEBUG) console.log({ ORIGIN, DEST, DATE, URL });

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  locale: "pt-BR",
  timezoneId: "America/Sao_Paulo",
});
const page = await ctx.newPage();

try {
  const { folder, stamp } = outFolder(BASE, DATE, ROUTE);

  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");

  // scroll até o fim para carregar todos os cards
  let lastH = 0;
  for (let i = 0; i < 20; i++) {
    const h = await page.evaluate(() => document.body.scrollHeight);
    if (h === lastH) break;
    lastH = h;
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(600);
  }

  // salva auditoria
  fs.writeFileSync(path.join(folder, "page.html"), await page.content());
  await page.screenshot({ path: path.join(folder, "screenshot.png"), fullPage: true });

  // todos os "cards" que contêm "Preço por adulto"
  const cards = page.locator('div:has(span:has-text("Preço por adulto"))');
  const n = await cards.count();

  const results = [];
  for (let i = 0; i < n; i++) {
    const card = cards.nth(i);

    // --- preço por adulto ---
    let priceText = "";
    const money = card.locator('span[class*="pricePerAdultValueSectionMoney"]').first();
    if (await money.count()) {
      priceText = (await money.innerText()).trim();
    } else {
      // fallback: qualquer span com "R$"
      const alt = card.locator('xpath=.//span[contains(normalize-space(.),"R$")]').first();
      if (await alt.count()) priceText = (await alt.innerText()).trim();
    }
    const price = parseBRL(priceText);
    if (!Number.isFinite(price)) continue;

    // --- cia ---
    let airline = "";
    const logo = card.locator("img[alt]").first();
    if (await logo.count()) {
      airline = (await logo.getAttribute("alt")) || "";
    }
    if (!airline) {
      const txt = (await card.innerText()).toLowerCase();
      if (txt.includes("latam")) airline = "LATAM";
      else if (txt.includes("gol")) airline = "GOL";
      else if (txt.includes("azul")) airline = "AZUL";
    }

    // --- horários (pega os 2 primeiros HH:MM) ---
    const times = await card.locator('text=/\\b\\d{2}:\\d{2}\\b/').allInnerTexts();
    const uniqTimes = [...new Set(times.map(t => t.match(/\b\d{2}:\d{2}\b/)?.[0]).filter(Boolean))];
    const dep = uniqTimes[0] || "";
    const arr = uniqTimes[1] || "";

    // --- paradas ---
    let stops = "";
    const blockText = (await card.innerText()).toLowerCase();
    if (blockText.includes("direto")) stops = "0";
    const mPar = blockText.match(/(\d+)\s+parad[ao]s?/);
    if (mPar) stops = mPar[1];

    results.push({
      price_brl: price,
      airline,
      dep_time: dep,
      arr_time: arr,
      stops
    });
  }

  // ordena por preço
  results.sort((a, b) => a.price_brl - b.price_brl);

  // salva JSON
  const outJson = {
    date: DATE,
    route: ROUTE,
    stamp,
    url: URL,
    count: results.length,
    flights: results
  };
  fs.writeFileSync(path.join(folder, "results.json"), JSON.stringify(outJson, null, 2));

  // salva CSV (vírgula como separador)
  const rows = [["date", "route", "stamp", "airline", "price_brl", "dep_time", "arr_time", "stops"]];
  for (const f of results) {
    rows.push([DATE, ROUTE, stamp, f.airline || "", f.price_brl, f.dep_time, f.arr_time, f.stops]);
  }
  writeCSV(path.join(folder, "results.csv"), rows);

  console.log(`OK: ${results.length} voos. Pasta: ${path.join(BASE, `${DATE}_${ROUTE}`, stamp)}`);
} catch (err) {
  console.error("Capture error:", err);
  throw err;
} finally {
  await browser.close();
}
