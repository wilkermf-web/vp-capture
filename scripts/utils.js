// scripts/utils.js
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';

export function ymdCompact(iso) {
  return iso.replaceAll('-', '');
}

export async function ensureDir(p) {
  await fsp.mkdir(p, { recursive: true });
}

export async function writeFile(p, data) {
  await ensureDir(path.dirname(p));
  await fsp.writeFile(p, data);
}

export function safeStamp(d = new Date()) {
  return d.toISOString().replace(/[:.]/g, '-');
}

export function toCSV(rows) {
  return rows.map(r => r.map(v => {
    const s = String(v ?? '');
    return /[",\n;]/.test(s) ? `"${s.replaceAll('"','""')}"` : s;
  }).join(',')).join('\n');
}

export function listDirsSafe(root) {
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
  } catch {
    return [];
  }
}

export async function copyDir(src, dst) {
  await ensureDir(dst);
  await fsp.cp(src, dst, { recursive: true, force: true });
}
