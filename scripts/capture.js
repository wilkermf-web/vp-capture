import fs from "fs";
import path from "path";
import { chromium } from "playwright";
import { ensureDir, parseBRL, writeCSV, outPaths } from "./utils.js";

const ORIGIN = process.env.ORIGIN || "GYN";
const DEST   = process.env.DEST   || "CAC";
const DATE   = process.env.DATE   || "2025-11-30"; // AAAA-MM-DD
const DEBUG  = /^1|true$/i.test(process.env.DEBUG || "1");

const ROUTE = `${ORIGIN}-${DEST}`;
const BASE = "data";

function vaidepromoUrl(origin, dest, ymd) {
  // monta o link direto no formato que você definiu
  // ex.: https://www.vaidepromo.com.br/passagens-aereas/pesquisa/GYNCAC251130/1/0/0/Y/
  const [y, m, d] = ymd.split("-");
  const ddmmyy = `${d}${m}${String(y).slice(-2)}`;
  return `https://www.vaidepromo.com.br/passagens-aereas/pesquisa/${origin}${dest}${ddmmyy}/1/0/0/Y/`;
}

async function run() {
  const url = vaidepromoUrl(ORIGIN, DEST, DATE);
  const { folder, stamp } = outPaths(BASE, DATE, ROUTE);

  if (DEBUG) console.log({ ORIGIN, DEST, DATE, url, folder, stamp });

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
  });
  const page = await ctx.newPage();

  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    // espera a página terminar de hidratar e carregar cards
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2500);

    // salva HTML bruto e screenshot (para auditoria)
    await page.screenshot({ path: path.join(folder, "screenshot.png"), fullPage: true });
    const html = await page.content();
    fs.writeFileSync(path.join(folder, "page.html"), html);

    // ---- EXTRAÇÃO ROBUSTA: "Preço por adulto" ----
    // 1) pega todos os blocos que contenham o rótulo "Preço por adulto"
    const cards = page.locator('div:has(span:has-text("Preço por adulto"))');

    const count = await cards.count();
    const priceTexts = [];
    for (let i = 0; i < count; i++) {
      const card = cards.nth(i);

      // seletor principal (classe tem sufixos variáveis, por isso usamos contains)
      const moneyEl = card.locator('span[class*="pricePerAdultValueSectionMoney"]').first();

      let text = "";
      if (await moneyEl.count()) {
        text = (await moneyEl.innerText()).trim();
      } else {
        // fallback: procura um "R$" próximo
        const alt = card.locator('xpath=.//span[contains(normalize-space(.),"R$")]').first();
        if (await alt.count()) text = (await alt.innerText()).trim();
      }

      if (text) priceTexts.push(text);
    }

    if (DEBUG) console.log("Texts:", priceTexts);

    // 2) normaliza para número
    const prices = priceTexts
      .map(parseBRL)
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);

    // 3) salva JSON
    const outJson = {
      date: DATE,
      route: ROUTE,
      stamp,
      url,
      count: prices.length,
      prices_brl: prices,
      min_price_brl: prices[0] ?? null,
    };
    fs.writeFileSync(path.join(folder, "results.json"), JSON.stringify(outJson, null, 2));

    // 4) salva CSV (com vírgulas!)
    // se quiser todas as tarifas numa coluna, uso pipe (|) dentro de aspas
    writeCSV(path.join(folder, "results.csv"), [
      ["date", "route", "stamp", "min_price_brl", "all_prices_brl"],
      [
        DATE,
        ROUTE,
        stamp,
        prices[0] ?? "",
        prices.length ? prices.join("|") : "",
      ],
    ]);

    console.log(`OK: ${prices.length} preço(s) capturado(s). Pasta: ${folder}`);
  } catch (err) {
    console.error("Capture error:", err);
    // registra erro num arquivo para debug
    fs.writeFileSync(path.join(folder, "error.txt"), String(err.stack || err));
    throw err;
  } finally {
    await browser.close();
  }
}

run();
