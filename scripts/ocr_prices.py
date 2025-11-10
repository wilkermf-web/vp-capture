# scripts/ocr_prices.py
# Lê todos os data/**/screenshot.png, roda OCR e salva ocr.json e ocr.csv

import os, re, json, csv, glob
from PIL import Image, ImageOps, ImageFilter
import pytesseract

# Regex robusto p/ "preço por adulto" e valores BR
RE_ADULTO = re.compile(r'pre(?:ç|c)o\s+por\s+adulto', re.IGNORECASE)
RE_PRECO  = re.compile(r'(?:R?\$?\s*)?(\d{1,3}(?:\.\d{3})*,\d{2})')

def br_to_float(s):
    s = s.replace('.', '').replace(',', '.')
    try:
        return float(s)
    except:
        return None

def parse_path(png_path):
    # data/2025-11-30_GYN-CAC/2025-11-09T22-42-20-068Z/screenshot.png
    m = re.search(r'data/(\d{4}-\d{2}-\d{2})_([A-Z]{3}-[A-Z]{3})/([^/]+)/screenshot\.png$', png_path)
    if not m: 
        return None
    return {
        'date':  m.group(1),
        'route': m.group(2),
        'stamp': m.group(3)
    }

def ocr_text(img):
    # pré-processamento simples melhora muito o Tesseract
    g = ImageOps.grayscale(img)
    w, h = g.size
    if max(w, h) < 3000:  # dá um upsample em prints pequenos
        g = g.resize((int(w*1.5), int(h*1.5)))
    g = ImageOps.autocontrast(g)
    g = g.filter(ImageFilter.SHARPEN)
    txt = pytesseract.image_to_string(g, lang='por')  # usa idioma PT
    return txt

def extract_prices_from_text(txt, want_debug=False):
    lines = [re.sub(r'\s+', ' ', L).strip() for L in txt.splitlines() if L.strip()]
    joined = '\n'.join(lines)

    hits = []
    # 1) Procura blocos onde aparece "preço por adulto" e puxa o preço logo depois
    for m in RE_ADULTO.finditer(joined):
        start = max(0, m.start()-80)
        end   = min(len(joined), m.end()+120)
        window = joined[start:end]
        for p in RE_PRECO.finditer(window):
            hits.append(p.group(1))

    # 2) Se não achou, tenta todos os preços da página (fallback)
    if not hits:
        for p in RE_PRECO.finditer(joined):
            hits.append(p.group(1))

    # normaliza, filtra e ordena
    vals = []
    for h in hits:
        v = br_to_float(h)
        if v is None: 
            continue
        if 50 <= v <= 5000:  # faixa plausível
            vals.append(round(v, 2))
    vals = sorted(set(vals))

    out = {
        'all_prices_brl': vals,
        'min_price_brl': min(vals) if vals else None,
    }
    if want_debug:
        out['debug_sample'] = lines[:80]  # primeiras linhas p/ checar
    return out

def main():
    runs = []
    for png_path in glob.glob('data/*_*/*/screenshot.png'):
        info = parse_path(png_path)
        if not info: 
            continue
        entry = {**info, 'screenshot': png_path}

        # OCR
        try:
            img = Image.open(png_path)
            text = ocr_text(img)
            ocr = extract_prices_from_text(text)
        except Exception as e:
            ocr = {'error': str(e), 'all_prices_brl': [], 'min_price_brl': None}

        entry.update(ocr)
        runs.append(entry)

        # salva por pasta
        base_dir = os.path.dirname(png_path)
        # JSON
        with open(os.path.join(base_dir, 'ocr.json'), 'w', encoding='utf-8') as f:
            json.dump(entry, f, ensure_ascii=False, indent=2)
        # CSV
        with open(os.path.join(base_dir, 'ocr.csv'), 'w', encoding='utf-8', newline='') as f:
            w = csv.writer(f, delimiter=';')
            w.writerow(['date','route','stamp','min_price_brl','all_prices_brl'])
            w.writerow([entry['date'], entry['route'], entry['stamp'], entry.get('min_price_brl'), ','.join(map(str, entry.get('all_prices_brl',[])))])

    # Também gera um agregado em data/public/<ROTA>/latest/ocr.csv (uma linha por run)
    by_route = {}
    for r in runs:
        by_route.setdefault(r['route'], []).append(r)
    for route, arr in by_route.items():
        arr.sort(key=lambda x: (x['date'], x['stamp']))
        pub_dir = os.path.join('data','public',route,'latest')
        os.makedirs(pub_dir, exist_ok=True)
        csv_path = os.path.join(pub_dir,'ocr.csv')
        with open(csv_path, 'w', encoding='utf-8', newline='') as f:
            w = csv.writer(f, delimiter=';')
            w.writerow(['date','route','stamp','min_price_brl','all_prices_brl'])
            for r in arr:
                w.writerow([r['date'], r['route'], r['stamp'], r.get('min_price_brl'), ','.join(map(str, r.get('all_prices_brl',[])))])

if __name__ == '__main__':
    main()
