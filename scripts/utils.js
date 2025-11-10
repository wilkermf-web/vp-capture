import fs from "fs";
import path from "path";

export function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

export function parseBRL(str) {
  if (!str) return NaN;
  // remove tudo que não for dígito, vírgula, ponto ou sinal
  const clean = str.replace(/[^\d,.\-]/g, "");
  // remove separador de milhar (ponto) e troca vírgula por ponto
  const norm = clean.replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", ".");
  return Number(norm);
}

export function writeCSV(csvPath, rows) {
  const csv = rows
    .map((r) =>
      r
        .map((v) => {
          const s = v === null || v === undefined ? "" : String(v);
          // escapa campos com vírgula, aspas ou quebra de linha
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(","),
    )
    .join("\n") + "\n";
  fs.writeFileSync(csvPath, csv);
}

export function stampNow() {
  const d = new Date();
  // 2025-11-10T23-41-25-411Z
  return d.toISOString().replace(/:/g, "-").replace(/\./, "-");
}

export function outPaths(baseDataDir, date, route) {
  const stamp = stampNow();
  const folder = path.join(baseDataDir, `${date}_${route}`, stamp);
  ensureDir(folder);
  return { folder, stamp };
}
