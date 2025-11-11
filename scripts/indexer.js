// índice simples: gera data/public/index.json e data/public/index.md
import fs from "fs";
import path from "path";

const DATA_DIR = "data";
const PUB_DIR  = path.join("data", "public");

function ensureDir(p){ fs.mkdirSync(p, { recursive: true }); }

function listRuns() {
  if (!fs.existsSync(DATA_DIR)) return [];
  const entries = fs.readdirSync(DATA_DIR).filter(n => /\d{4}-\d{2}-\d{2}_.+-.+/.test(n));
  const items = [];
  for (const group of entries) {
    const groupDir = path.join(DATA_DIR, group);
    if (!fs.statSync(groupDir).isDirectory()) continue;

    const [date, route] = group.split("_");
    const stamps = fs.readdirSync(groupDir).filter(s => fs.statSync(path.join(groupDir, s)).isDirectory());
    stamps.sort(); // ISO => ordem cronológica
    for (const stamp of stamps) {
      const base = path.join(groupDir, stamp);
      const rec = {
        date, route,
        stamp,
        files: {}
      };
      for (const name of ["results.csv","results.json","page.html","screenshot.png","meta.json","network.json"]) {
        const p = path.join(base, name);
        if (fs.existsSync(p)) rec.files[name] = p;
      }
      items.push(rec);
    }
  }
  return items;
}

function buildIndexFiles(items) {
  ensureDir(PUB_DIR);
  // JSON
  fs.writeFileSync(path.join(PUB_DIR, "index.json"), JSON.stringify({
    generated_at: new Date().toISOString(),
    items
  }, null, 2));
  // Markdown
  let md = `# Índice público de capturas\n\nGerado em ${new Date().toISOString()}\n\n`;
  const byKey = {};
  for (const it of items) {
    const key = `${it.date} (${it.route})`;
    byKey[key] = byKey[key] || [];
    byKey[key].push(it);
  }
  const keys = Object.keys(byKey).sort();
  for (const key of keys) {
    md += `## ${key}\n\n`;
    for (const r of byKey[key]) {
      md += `- stamp: \`${r.stamp}\`\n`;
      for (const [name, p] of Object.entries(r.files)) {
        md += `  - [${name}](${p})\n`;
      }
      md += `\n`;
    }
  }
  fs.writeFileSync(path.join(PUB_DIR, "index.md"), md);
}

const items = listRuns();
buildIndexFiles(items);
console.log(`OK: index com ${items.length} execuções.`);
