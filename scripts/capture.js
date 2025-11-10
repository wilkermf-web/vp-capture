// scripts/capture.js
import fs from 'fs/promises';
import path from 'path';
import { chromium } from 'playwright';

function yymmdd(isoDate) {
  // isoDate: "AAAA-MM-DD"
  const [Y, M, D] = isoDate.split('-');
  const YY = (Number(Y) % 100).toString().padStart(2, '0');
  return `${YY}${M}${D}`; // ex: 2025-11-30 -> "251130"
}

function buildVaidepromoUrl(origin, dest, isoDate) {
  const route = `${origin}${dest}${yymmdd(isoDate)}`;
  return `https://www.vaidepromo.com.br/passagens-aereas/pesquisa/${route}/1/0/0/Y/`;
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function main() {
  // Lê parâmetros das variáveis de ambiente (definidas no GitHub Actions)
  const ORIGIN = (process.env.ORIGIN || 'GYN').toUpperCase();
  const DEST   = (process.env.DEST   || 'CAC').toUpperCase();
  const DATE   = process.env.DATE || '2025-11-30'; // AAAA-MM-DD

  const url = buildVaidepromoUrl(ORIGIN, DEST, DATE);
  const outDir = path.join('data', `${DATE}_${ORIGIN}-${DEST}`, stamp());

  console.log('[INFO] URL:', url);
  console.log('[INFO] Pasta de saída:', outDir);
  await ensureDir(outDir);

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari/537.36'
  });
  const page = await context.newPage();

  try {
    // Abre a página e espera ficar "parada" (sem novas requisições)
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });

    // Aceita cookies se existir (não falha se não existir)
    try {
      const cookieButton = page.locator('button:has-text("Aceitar")');
      if (await cookieButton.first().isVisible({ timeout: 3000 })) {
        await cookieButton.first().click({ timeout: 3000 });
      }
    } catch {}

    // Espera elementos típicos da lista carregarem (ajuste se mudar)
    // Aqui usamos uma espera “elástica”: se não achar, seguimos só com o print.
    try {
      await page.waitForLoadState('networkidle', { timeout: 60000 });
    } catch {}

    // Dá scroll até o fim para garantir cards renderizados
    try {
      await page.evaluate(async () => {
        await new Promise(r => {
          let y = 0;
          const step = () => {
            const max = document.body.scrollHeight;
            window.scrollTo(0, y);
            y += 800;
            if (y < max) requestAnimationFrame(step);
            else setTimeout(r, 800);
          };
          step();
        });
      });
    } catch {}

    // Salva HTML bruto
    const html = await page.content();
    await fs.writeFile(path.join(outDir, 'page.html'), html, 'utf8');

    // Screenshot full page
    await page.screenshot({ path: path.join(outDir, 'screenshot.png'), fullPage: true });

    // Metadados
    const meta = {
      origin: ORIGIN,
      destination: DEST,
      date: DATE,
      url,
      captured_at: new Date().toISOString()
    };
    await fs.writeFile(path.join(outDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');

    console.log('[OK] Captura finalizada.');
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch(err => {
  console.error('[ERRO] Capture falhou:', err);
  process.exit(1);
});
