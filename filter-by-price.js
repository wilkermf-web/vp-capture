// filter-by-price.cjs
const fs = require('fs');
const path = require('path');

if (process.argv.length < 4) {
  console.error('Uso: node filter-by-price.cjs <arquivo.csv> <preco_maximo>');
  process.exit(1);
}

const inputPath = process.argv[2];
const maxPrice = parseFloat(process.argv[3]);

if (isNaN(maxPrice)) {
  console.error('Preço máximo inválido:', process.argv[3]);
  process.exit(1);
}

// Garante que o arquivo existe
if (!fs.existsSync(inputPath)) {
  console.error('Arquivo não encontrado:', inputPath);
  process.exit(1);
}

const csv = fs.readFileSync(inputPath, 'utf8');

// Detecta separador , ou ;
const sep = csv.includes(';') ? ';' : ',';

// Quebra em linhas
const lines = csv.trim().split(/\r?\n/);
if (lines.length === 0) {
  console.error('Arquivo CSV vazio.');
  process.exit(1);
}

// Cabeçalho
const header = lines[0].split(sep).map(h => h.replace(/"/g, '').trim());

// Tenta achar as colunas "date" e "price_brl"
const dateIdx = header.findIndex(h => h.toLowerCase() === 'date');
const priceIdx = header.findIndex(h => h.toLowerCase() === 'price_brl');

if (dateIdx === -1 || priceIdx === -1) {
  console.error('CSV precisa ter colunas "date" e "price_brl". Cabeçalho encontrado:', header);
  process.exit(1);
}

// Filtra linhas
const outLines = [lines[0]]; // mantém o cabeçalho

for (let i = 1; i < lines.length; i++) {
  const line = lines[i].trim();
  if (!line) continue;

  const cols = line.split(sep);
  const rawPrice = cols[priceIdx].replace(/"/g, '').trim();

  if (!rawPrice) continue;

  const price = parseFloat(rawPrice.replace(',', '.'));
  if (isNaN(price)) continue;

  if (price <= maxPrice) {
    outLines.push(line);
  }
}

// Garante pasta resumo/
const resumoDir = path.join('resumo');
if (!fs.existsSync(resumoDir)) {
  fs.mkdirSync(resumoDir, { recursive: true });
}

// Gera nome de saída: mesmo nome do arquivo original dentro de resumo/
const baseName = path.basename(inputPath);
const outputPath = path.join(resumoDir, baseName);

fs.writeFileSync(outputPath, outLines.join('\n'), 'utf8');

console.log(`Arquivo filtrado salvo em: ${outputPath}`);
