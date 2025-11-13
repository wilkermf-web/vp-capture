// filter-by-price.cjs
const fs = require('fs');
const path = require('path');

// Uso: node filter-by-price.cjs "public/ARQUIVO.csv" "400"
const [, , inputPath, maxPriceArg] = process.argv;

if (!inputPath || !maxPriceArg) {
  console.error('Uso: node filter-by-price.cjs "public/ARQUIVO.csv" "400"');
  process.exit(1);
}

const maxPrice = parseFloat(
  String(maxPriceArg).replace('R$', '').replace('.', '').replace(',', '.')
);

if (Number.isNaN(maxPrice)) {
  console.error('Preço máximo inválido:', maxPriceArg);
  process.exit(1);
}

// Lê o arquivo de entrada
const csvText = fs.readFileSync(inputPath, 'utf8').trim();

// Descobre o delimitador a partir do cabeçalho
const [headerLine, ...dataLines] = csvText.split('\n');
const delimiter = headerLine.includes(';') ? ';' : ',';

// Normaliza cabeçalho e acha a coluna "price_brl"
const headerCols = headerLine.split(delimiter).map(c => c.replace(/"/g, '').trim());
const priceIndex = headerCols.findIndex(c => c.toLowerCase() === 'price_brl');

if (priceIndex === -1) {
  console.error('Coluna "price_brl" não encontrada no cabeçalho.');
  process.exit(1);
}

// Filtra linhas pelo preço
const filteredLines = [headerLine];

for (const line of dataLines) {
  if (!line.trim()) continue;

  const cols = line.split(delimiter);
  const rawPrice = cols[priceIndex].replace(/"/g, '').trim();

  const price = parseFloat(
    rawPrice.replace('R$', '').replace('.', '').replace(',', '.')
  );

  if (!Number.isNaN(price) && price <= maxPrice) {
    filteredLines.push(line);
  }
}

// Garante pasta resumo/ e salva com MESMO NOME do arquivo original
const baseName = path.basename(inputPath);          // ex: 2025-11-13_BSB-IGU.csv
const resumoDir = path.join(process.cwd(), 'resumo');

if (!fs.existsSync(resumoDir)) {
  fs.mkdirSync(resumoDir, { recursive: true });
}

const outputPath = path.join(resumoDir, baseName);
fs.writeFileSync(outputPath, filteredLines.join('\n') + '\n', 'utf8');

console.log('Arquivo filtrado criado em:', outputPath);
