// indexer.js — Gera um índice público com múltiplos espelhos (RAW, CDN, PAGES)
// Saídas:
//   - data/public/index.json
//   - data/public/index.md
//
// Requisitos: nenhuma key extra. GitHub Pages será publicado pelo workflow.

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
function cdnUrl(repo, branch, relPath){
  const [owner, name] = repo.split('/');
  return `https://cdn.jsdelivr.net/gh/${owner}/${name}@${branch}/${relPath}`;
}
function pagesUrl(repo, relPath){
  const [owner, name] = repo.split('/');
  // Vamos publicar data/public/ no gh-pages mantendo o mesmo caminho
  return `https://${owner}.github.io/${name}/${relPath}`;
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

      const candidates = [
        'results.csv', 'results.json', 'page.html',
        'network.json', 'meta.json', 'screenshot.png'
      ];
      const extra = (await list(path.join(root, d.name, s.name)))
        .filter(x => x.isFile() && /^screenshot.*\.png$/i.test(x.name))
        .map(x => x.name);

      const files = [...new Set([...candidates, ...extra])];

      const entry = { date, route, stamp: s.name, files: [] };

      for (const f of files){
        const rel = `${base}/${f}`;
        try{
          await fs.access(path.resolve(rel));
          entry.files.push({
            name: f,
            raw:   rawUrl(repo, branch, rel),
            cdn:   cdnUrl(repo, branch, rel),
            pages: pagesUrl(repo, rel)
          });
        } catch {}
      }

      const find = n => entry.files.find(x => x.name === n);
      const findRe = re => entry.files.find(x => re.test(x.name));

      entry.main = {
        results_csv:      find('results.csv')?.raw   || null,
        results_csv_cdn:  find('results.csv')?.cdn   || null,
        results_csv_pages:find('results.csv')?.pages || null,

        results_json:      find('results.json')?.raw   || null,
        results_json_cdn:  find('results.json')?.cdn   || null,
        results_json_pages:find('results.json')?.pages || null,

        screenshot:      findRe(/^screenshot.*\.png$/i)?.raw   || null,
        screenshot_cdn:  findRe(/^screenshot.*\.png$/i)?.cdn   || null,
        screenshot_pages:findRe(/^screenshot.*\.png$/i)?.pages || null,

        html:      find('page.html')?.raw   || null,
        html_cdn:  find('page.html')?.cdn   || null,
        html_pages:find('page.html')?.pages || null,

        meta:      find('meta.json')?.raw   || null,
        meta_cdn:  find('meta.json')?.cdn   || null,
        meta_pages:find('meta.json')?.pages || null
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

  // Também gera um index legível
  let md = `# Índice público de capturas\n\nGerado em ${indexJson.generated_at}\n\n`;
  let key = '';
  for (const it of items){
    const title = `${it.date} (${it.route})`;
    if (title !== key){
      key = title;
      md += `\n## ${title}\n\n`;
    }
    md += `- stamp: \`${it.stamp}\`\n`;
    const m = it.main;
    if (m.results_csv_pages) md += `  - [results.csv • Pages](${m.results_csv_pages})\n`;
    if (m.results_csv_cdn)   md += `  - [results.csv • CDN](${m.results_csv_cdn})\n`;
    if (m.results_csv)       md += `  - [results.csv • RAW](${m.results_csv})\n`;
    if (m.results_json_pages)md += `  - [results.json • Pages](${m.results_json_pages})\n`;
    if (m.results_json_cdn)  md += `  - [results.json • CDN](${m.results_json_cdn})\n`;
    if (m.results_json)      md += `  - [results.json • RAW](${m.results_json})\n`;
    if (m.screenshot_pages)  md += `  - [screenshot • Pages](${m.screenshot_pages})\n`;
    if (m.html_pages)        md += `  - [page.html • Pages](${m.html_pages})\n`;
    if (m.meta_pages)        md += `  - [meta.json • Pages](${m.meta_pages})\n`;
  }
  await fs.writeFile(path.join(outDir, 'index.md'), md, 'utf8');

  console.log(`OK: ${items.length} execuções indexadas → data/public/index.{json,md} (RAW/CDN/Pages)`);
}

main().catch(e => { console.error(e); process.exit(1); });
