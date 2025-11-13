const fs = require('fs');
const path = require('path');

// Uso: node filter-by-price.js NOME_DO_ARQUIVO.csv 400
const [, , inputFileName, thresholdStr] = process.argv;

if (!inputFileName || !thresholdStr) {
  console.error('Uso: node filter-by-price.js NOME_ARQUIVO.csv VALOR_LIMITE');
  console.error('Exemplo: node filter-by-price.js aggregate.csv 400');
  process.exit(1);
}

// Converte "400" ou "400,00" para número
const threshold = parseFloat(
  thresholdStr.toString().replace('.', '').replace(',', '.')
);

if (isNaN(threshold)) {
  console.error('Valor de limite inválido:', thresholdStr);
  process.exit(1);
}

const publicDir = path.join(__dirname, 'public');
const resumoDir = path.join(__dirname, 'resumo');

const inputPath = path.join(publicDir, inputFileName);
const outputPath = path.join(resumoDir, inputFileName); // mesmo nome do arquivo

if (!fs.existsSync(inputPath)) {
  console.error('Arquivo não encontrado na pasta public:', inputPath);
  process.exit(1);
}

// Garante que a pasta resumo existe
if (!fs.existsSync(resumoDir)) {
  fs.mkdirSync(resumoDir, { recursive: true });
}

const raw = fs.readFileSync(inputPath, 'utf8').trim();
if (!raw) {
  console.error('Arquivo está vazio:', inputPath);
  process.exit(1);
}

const lines = raw.split(/\r?\n/);
const header = lines[0];

// Detecta separador: ; ou ,
let sep = ',';
const countSemicolon = (header.match(/;/g) || []).length;
const countComma = (header.match(/,/g) || []).length;
if (countSemicolon > countComma) sep = ';';

function cleanColName(col) {
  return col.replace(/"/g, '').trim().toLowerCase();
}

const headerCols = header.split(sep);
const priceIndex = headerCols.findIndex(col =>
  cleanColName(col).includes('price')
);

if (priceIndex === -1) {
  console.error('Não encontrei coluna de preço (ex: "price_brl") no header.');
  process.exit(1);
}

const outputLines = [header];
let kept = 0;
let skipped = 0;

for (let i = 1; i < lines.length; i++) {
  const line = lines[i];
  if (!line.trim()) continue;

  const cols = line.split(sep);
  let priceRaw = (cols[priceIndex] || '').toString();

  priceRaw = priceRaw.replace(/"/g, '').trim();
  // troca vírgula decimal por ponto, remove separador de milhar
  priceRaw = priceRaw.replace(/\./g, '').replace(',', '.');

  const price = parseFloat(priceRaw);

  if (!isNaN(price) && price <= threshold) {
    outputLines.push(line);
    kept++;
  } else {
    skipped++;
  }
}

fs.writeFileSync(outputPath, outputLines.join('\n'), 'utf8');

console.log('Arquivo de entrada :', inputPath);
console.log('Arquivo de saída   :', outputPath);
console.log('Limite de preço    :', threshold);
console.log('Linhas mantidas    :', kept);
console.log('Linhas descartadas :', skipped);
