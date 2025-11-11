// scripts/indexer.js (ESM) — varre data/**/results.json e gera resumo em public/
import fs from 'fs';
import path from 'path';

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function writeJSON(fp, data) { fs.writeFileSync(fp, JSON.stringify(data, null, 2), 'utf8'); }
function writeText(fp, text) { fs.writeFileSync(fp, text, 'utf8'); }

function listResultsJSON(base = 'data') {
  const out = [];
  if (!fs.existsSync(base)) return out;

  // Percorre data/<date>_<route>/<stamp>/results.json
  for (const dayDir of fs.readdirSync(base)) {
    const dayPath = path.join(base, dayDir);
    if (!fs.statSync(dayPath).isDirectory()) continue;

    for (const runDir of fs.readdirSync(dayPath)) {
      const runPath = path.join(dayPath, runDir);
      const file = path.join(runPath, 'results.json');
      if (fs.existsSync(file)) out.push(file);
    }
  }
  return out;
}

function csvJoin(rows, headers) {
  const esc = v => String(v ?? '').replace(/"/g, '""');
  const head = headers.map(h => `"${esc(h)}"`).join(';');
  const body = rows.map(r => headers.map(h => `"${esc(r[h])}"`).join(';')).join('\n');
  return head + '\n' + body + '\n';
}

function buildIndex() {
  const files = listResultsJSON('data');
  const items = [];

  for (const fp of files) {
    try {
      const raw = fs.readFileSync(fp, 'utf8');
      const o = JSON.parse(raw); // {date, route, stamp, url, min_price_brl, all_prices_brl}

      items.push({
        date: o.date,
        route: o.route,
        stamp: o.stamp,
        url: o.url,
        min_price_brl: o.min_price_brl,
        count_prices: Array.isArray(o.all_prices_brl) ? o.all_prices_brl.length : 0,
        file: fp
      });
    } catch (e) {
      console.error('Falha lendo', fp, e.message);
    }
  }

  // Ordena por data e stamp (mais recentes por último)
  items.sort((a, b) => (a.date + a.stamp).localeCompare(b.date + b.stamp));

  // Gera saídas
  ensureDir('public');

  // JSON “bruto”
  writeJSON(path.join('public', 'index.json'), {
    generated_at: new Date().toISOString(),
    total_runs: items.length,
    items
  });

  // CSV resumido
  writeText(
    path.join('public', 'index.csv'),
    csvJoin(items, ['date', 'route', 'stamp', 'min_price_brl', 'count_prices', 'url', 'file'])
  );

  // HTML simples pra navegar (opcional)
  const html = `<!doctype html>
<html lang="pt-br"><head>
<meta charset="utf-8" />
<title>Resumo Captações</title>
<style>
body{font-family:system-ui,Arial,sans-serif;padding:24px;}
table{border-collapse:collapse;width:100%;}
th,td{border:1px solid #ddd;padding:6px 8px;font-size:14px}
th{background:#f3f3f3;text-align:left}
code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px}
.small{color:#666;font-size:12px}
</style>
</head><body>
<h1>Resumo das captações</h1>
<p class="small">Gerado em ${new Date().toLocaleString('pt-BR')}</p>
<table>
<thead><tr>
  <th>Data</th><th>Rota</th><th>Stamp</th>
  <th>Menor preço (R$)</th><th># preços</th><th>URL</th><th>Arquivo</th>
</tr></thead>
<tbody>
${items.map(it => `
<tr>
  <td>${it.date}</td>
  <td>${it.route}</td>
  <td><code>${it.stamp}</code></td>
  <td>${it.min_price_brl ?? ''}</td>
  <td>${it.count_prices}</td>
  <td><a href="${it.url}" target="_blank">abrir</a></td>
  <td><code>${it.file}</code></td>
</tr>
`).join('')}
</tbody></table>
</body></html>`;
  writeText(path.join('public', 'index.html'), html);

  console.log(`[indexer] OK — ${items.length} capturas indexadas.`);
}

buildIndex();
