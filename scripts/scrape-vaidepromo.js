// Coletor Vaidepromo — lê SOMENTE "Preço por adulto" de cada card
// Execução local/Actions: ORIGIN=GYN DEST=CAC DATE=2025-11-30 node scripts/scrape-vaidepromo.js
import fs from "fs";
import path from "path";
import { chromium } from "playwright";

const ORIGIN = (process.env.ORIGIN || "GYN").toUpperCase();
const DEST   = (process.env.DEST  || "CAC").toUpperCase();
const DATE   = process.env.DATE || "2025-11-30"; // AAAA-MM-DD
const DEBUG  = process.env.DEBUG === "1";

function yymmdd(iso) { const [Y,M,D]=iso.split("-"); return `${Y.slice(2)}${M}${D}`; }
function tidy(s) { return (s||"").replace(/\s+/g," ").trim(); }
function parseBRL(txt){
  // "R$ 1.016,27" -> 1016.27
  const s = txt.replace(/\s/g,"").replace(/[^\d,.-]/g,"").replace(/\./g,"").replace(",",".");
  return Number(s);
}

async function clickShowMore(page, tries=6){
  for (let i=0;i<tries;i++){
    const btn = page.locator('button:has-text("Mostrar mais"), button:has-text("Ver mais")').first();
    if (await btn.isVisible().catch(()=>false)) {
      await btn.click().catch(()=>{});
      await page.waitForTimeout(1200);
    } else break;
  }
}

async function autoScroll(page, steps=20){
  for (let i=0;i<steps;i++){
    await page.evaluate(()=>window.scrollBy(0, window.innerHeight));
    await page.waitForTimeout(350);
  }
}

async function main(){
  const url = `https://www.vaidepromo.com.br/passagens-aereas/pesquisa/${ORIGIN}${DEST}${yymmdd(DATE)}/1/0/0/Y/`;
  const stamp = new Date().toISOString().replace(/[:.]/g,"-");
  const outDir = path.join("data", `${DATE}_${ORIGIN}-${DEST}`, stamp);
  fs.mkdirSync(outDir, { recursive:true });

  const browser = await chromium.launch({ headless:true });
  const ctx = await browser.newContext({
    locale: "pt-BR",
    viewport: { width: 1366, height: 900 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36"
  });
  const page = await ctx.newPage();

  if (DEBUG) console.log("URL:", url);
  await page.goto(url, { waitUntil:"domcontentloaded", timeout: 90_000 });

  // Garante render do rótulo
  await page.waitForSelector('span:has-text("Preço por adulto")', { timeout: 60_000 });

  await clickShowMore(page, 8);
  await autoScroll(page, 20);

  // Auditoria
  fs.writeFileSync(path.join(outDir,"page.html"), await page.content(), "utf8");
  await page.screenshot({ path: path.join(outDir,"screenshot.png"), fullPage:true });

  // Cada CARD: tem "Preço por adulto" e botão "Comprar"
  const cards = page.locator(
    'xpath=//div[.//span[normalize-space()="Preço por adulto"] and .//button[contains(normalize-space(.),"Comprar")]]'
  );
  const cardCount = await cards.count();
  if (DEBUG) console.log("Cards:", cardCount);

  const items = [];
  for (let i=0;i<cardCount;i++){
    const card = cards.nth(i);

    // Valor logo após o rótulo "Preço por adulto"
    const priceSpan = card.locator(
      'xpath=.//span[normalize-space()="Preço por adulto"]/following::span[contains(@class,"pricePerAdultValueSectionMoney")][1]'
    );
    const priceText = tidy(await priceSpan.innerText().catch(()=>"" ));
    const price = parseBRL(priceText);

    // Ignora se não bateu um número válido
    if (!Number.isFinite(price) || price <= 0) continue;

    // Companhia
    let airline = await card.locator('img[alt]').first().getAttribute("alt").catch(()=>null);
    if (!airline) {
      const txt = tidy(await card.innerText().catch(()=>"" ));
      const m = txt.match(/\b(Gol|LATAM|Azul)\b/i);
      airline = m ? m[0] : "";
    }

    // Horários: primeiros 2 HH:MM no card
    const ctext = await card.innerText().catch(()=>"" );
    const times = (ctext.match(/\b([01]\d|2[0-3]):[0-5]\d\b/g) || []).slice(0,2);
    const dep = times[0] || "";
    const arr = times[1] || "";

    // Paradas
    let stops = "";
    const sm = ctext.match(/\b(Sem paradas|\d+\s+parad[ao]s?)\b/i);
    if (sm) stops = tidy(sm[0]);

    items.push({
      airline: tidy(airline || ""),
      price_brl: price,
      price_label: priceText,
      dep_time: dep,
      arr_time: arr,
      stops
    });
  }

  // Ordena por menor preço e salva
  const clean = items
    .filter(x => Number.isFinite(x.price_brl) && x.price_brl > 0)
    .sort((a,b)=>a.price_brl - b.price_brl);

  const json = { date: DATE, route: `${ORIGIN}-${DEST}`, stamp, url, items: clean };
  fs.writeFileSync(path.join(outDir,"results.json"), JSON.stringify(json, null, 2));

  const header = ["airline","price_brl","dep_time","arr_time","stops"].join(";");
  const lines  = clean.map(r => [r.airline, r.price_brl.toFixed(2), r.dep_time, r.arr_time, r.stops].join(";"));
  fs.writeFileSync(path.join(outDir,"results.csv"), [header, ...lines].join("\n"), "utf8");

  // Agregados
  fs.writeFileSync(path.join(outDir,"meta.json"), JSON.stringify({
    date: DATE,
    route: `${ORIGIN}-${DEST}`,
    stamp, url,
    count: clean.length,
    min_price_brl: clean.length ? clean[0].price_brl : null,
    all_prices_brl: clean.map(x=>x.price_brl)
  }, null, 2));

  if (DEBUG) console.log("Itens válidos:", clean.length);
  await browser.close();
}

main().catch(err => { console.error(err); process.exit(1); });
