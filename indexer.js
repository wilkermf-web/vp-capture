// indexer.js — Gera um índice público com links RAW de tudo em data/*/*
// Saídas:
//   - data/public/index.json
//   - data/public/index.md

import fs from 'fs/promises';
import path from 'path';

function nowISO(){ return new Date().toISOString(); }
async function list(dir){ try{ return await fs.readdir(dir, { withFileTypes:true }); } catch { return []; } }

function isDayDir(name){
  // Ex.: 2025-11-30_GYN-CAC
  return /^\d{4}-\d{2}-\d{2}_[A-Z]{3}-[A-Z]{3}$/.test(name);
}

function rawUrl(repo, branch, relPath){
  return `https://raw.githubusercontent.com/${repo}/${branch}/${relPath}`;
}

async function main(){
  const repo = process.env.GITHUB_REPOSITORY || 'wilkermf-web/vp-capture';
  const branch = process.env.GITHUB_REF_NAME || 'main';

  const root = path.resolve('data');
  const outDir = path.resolve('data/public');
  await fs.mkdir(outDir, { recursive: true });

  const dayDirs = (await list(root)).filter(d => d.isDirectory() && isDayDir(d.name));

  const items = [];
  for (const d of dayDirs){
    const [date, route] = d.name.split('_'); // route = ORG-DST
    const dayPath = path.join('data', d.name);

    const stamps = (await list(path.join(root, d.name))).filter(s => s.isDirectory());
    for (const s of stamps){
      const base = `${dayPath}/${s.name}`;

      // Arquivos comuns gerados pelo capture
      const candidates = [
        'results.csv',
        'results.json',
        'page.html',
        'network.json',
        'meta.json',
        'screenshot.png'
      ];

      // Inclui também qualquer "screenshot*.png" adicional
      const extra = (await list(path.join(root, d.name, s.name)))
        .filter(x => x.isFile() && /^screenshot.*\.png$/i.test(x.name))
        .map(x => x.name);

      const files = [...new Set([...candidates, ...extra])];

      const entry = { date, route, stamp: s.name, files: [] };

      for (const f of files){
        const rel = `${base}/${f}`;
        try{
          await fs.access(path.resolve(rel));
          entry.files.push({ name: f, raw: rawUrl(repo, branch, rel) });
        } catch {}
      }

      // Destaques principais, se existirem
      entry.main = {
        results_csv: entry.files.find(x => x.name === 'results.csv')?.raw || null,
        results_json: entry.files.find(x => x.name === 'results.json')?.raw || null,
        screenshot: entry.files.find(x => /^screenshot.*\.png$/i.test(x.name))?.raw || null,
        html: entry.files.find(x => x.name === 'page.html')?.raw || null,
        meta: entry.files.find(x => x.name === 'meta.json')?.raw || null
      };

      items.push(entry);
    }
  }

  // Ordena por data e timestamp
  items.sort((a,b)=> a.date.localeCompare(b.date) || a.stamp.localeCompare(b.stamp));

  const indexJson = {
    generated_at: nowISO(),
    repository: repo,
    branch,
    total_runs: items.length,
    items
  };

  await fs.writeFile(path.join(outDir, 'index.json'), JSON.stringify(indexJson, null, 2), 'utf8');

  // Também gera um index legível em Markdown
  let md = `# Índice público de capturas\n\nGerado em ${indexJson.generated_at}\n\n`;
  let currentKey = '';
  for (const it of items){
    const key = `${it.date} (${it.route})`;
    if (key !== currentKey){
      currentKey = key;
      md += `\n## ${key}\n\n`;
    }
    md += `- stamp: \`${it.stamp}\`\n`;
    if (it.main.results_csv) md += `  - [results.csv](${it.main.results_csv})\n`;
    if (it.main.results_json) md += `  - [results.json](${it.main.results_json})\n`;
    if (it.main.screenshot)  md += `  - [screenshot](${it.main.screenshot})\n`;
    if (it.main.html)        md += `  - [page.html](${it.main.html})\n`;
    if (it.main.meta)        md += `  - [meta.json](${it.main.meta})\n`;
  }
  await fs.writeFile(path.join(outDir, 'index.md'), md, 'utf8');

  console.log(`OK: ${items.length} execuções indexadas → data/public/index.json & index.md`);
}

main().catch(e => { console.error(e); process.exit(1); });
