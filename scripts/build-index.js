// scripts/build-index.js
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { ensureDir, listDirsSafe, copyDir } from './utils.js';

const ROOT = 'data';
const PUB  = path.join('data', 'public');

function parseRouteDirName(name) {
  const m = name.match(/^(\d{4}-\d{2}-\d{2})_([A-Z]{3})-([A-Z]{3})$/);
  if (!m) return null;
  return { date: m[1], route: `${m[2]}-${m[3]}` };
}

function rawURL(rel) {
  return `https://raw.githubusercontent.com/wilkermf-web/vp-capture/main/${rel}`;
}

async function run() {
  const out = {
    generated_at: new Date().toISOString(),
    repository: 'wilkermf-web/vp-capture',
    branch: 'main',
    total_runs: 0,
    items: []
  };

  const routeDirs = listDirsSafe(ROOT).filter(n => /^\d{4}-\d{2}-\d{2}_[A-Z]{3}-[A-Z]{3}$/.test(n));
  const byRoute = {};

  for (const rdir of routeDirs) {
    const meta = parseRouteDirName(rdir);
    if (!meta) continue;

    const stamps = listDirsSafe(path.join(ROOT, rdir)).sort();
    for (const stamp of stamps) {
      const base = path.join(ROOT, rdir, stamp);
      const mk = (f) => path.posix.join(ROOT, rdir, stamp, f);
      const files = ['results.csv','results.json','page.html','network.json','meta.json','screenshot.png']
        .filter(f => fs.existsSync(path.join(base, f)))
        .map(name => ({ name, raw: rawURL(mk(name)) }));

      out.items.push({
        date: meta.date,
        route: meta.route,
        stamp,
        files,
        main: {
          results_csv: rawURL(mk('results.csv')),
          results_json: rawURL(mk('results.json')),
          screenshot:   rawURL(mk('screenshot.png')),
          html:         rawURL(mk('page.html')),
          meta:         rawURL(mk('meta.json'))
        }
      });
      out.total_runs++;

      byRoute[meta.route] ??= [];
      byRoute[meta.route].push({ stamp, base });
    }
  }

  // Atualiza "latest" por rota
  for (const [route, arr] of Object.entries(byRoute)) {
    arr.sort((a,b) => a.stamp.localeCompare(b.stamp));
    const last = arr.at(-1);
    if (last) {
      await copyDir(last.base, path.join(PUB, route, 'latest'));
    }
  }

  // Grava index.json e index.md
  await ensureDir(PUB);
  await fsp.writeFile(path.join(PUB, 'index.json'), JSON.stringify(out, null, 2));

  const lines = ['# Índice público de capturas', '', `Gerado em ${out.generated_at}`, ''];
  for (const it of out.items.sort((a,b)=>(a.date+a.stamp).localeCompare(b.date+b.stamp))) {
    lines.push(`## ${it.date} (${it.route})`, '');
    lines.push(`- stamp: \`${it.stamp}\``);
    for (const f of it.files) lines.push(`  - [${f.name}](${f.raw})`);
    lines.push('');
  }
  await fsp.writeFile(path.join(PUB, 'index.md'), lines.join('\n'));

  console.log('index público atualizado.');
}

run().catch(e => { console.error(e); process.exit(1); });
