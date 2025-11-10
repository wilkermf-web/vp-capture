# scripts/ocr_prices.py
# Lê todos os data/**/screenshot.png, faz OCR "ancorado"
# nas áreas de "Preço por adulto" / "Comprar" e extrai preços reais (R$).

import os, re, json, csv, glob
from PIL import Image, ImageOps, ImageFilter
import pytesseract

# ---- Configs de filtro (ajuste se quiser) ----
MIN_PRICE_BRL = 250.0     # evita confundir "12:34" com 12.34; ajuste se você espera promoções < R$250
MAX_PRICE_BRL = 20000.0
ROI_LEFT_OF_COMPRAR = 480  # quantos pixels à esquerda do botão "Comprar" vamos olhar
ROI_PAD_Y = 80             # margem vertical extra ao redor do botão
LANGS = "por+eng"
TESS_CFG_DATA = r'--oem 1 --psm 6'    # para image_to_data (TSV)
TESS_CFG_TEXT = r'--oem 1 --psm 6'    # para image_to_string

# Regex
RE_CURRENCY = re.compile(r'R?\$')  # aceita "R$" ou "$" (OCR às vezes perde o R)
RE_PRICE = re.compile(r'(?:R?\$?\s*)?(\d{1,3}(?:\.\d{3})*,\d{2})')  # 1.234,56 / 123,45
RE_ADULTO = re.compile(r'pre(?:ç|c)o\s+por\s+adulto', re.IGNORECASE)

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
    return {'date': m.group(1), 'route': m.group(2), 'stamp': m.group(3)}

def preprocess(img: Image.Image) -> Image.Image:
    g = ImageOps.grayscale(img)
    w, h = g.size
    if max(w, h) < 2600:
        scale = 2600 / max(w, h)
        g = g.resize((int(w*scale), int(h*scale)))
    g = ImageOps.autocontrast(g)
    g = g.filter(ImageFilter.SHARPEN)
    return g

def ocr_data(img: Image.Image):
    # Retorna tokens TSV com bboxes
    ts = pytesseract.image_to_data(img, lang=LANGS, config=TESS_CFG_DATA, output_type=pytesseract.Output.DICT)
    n = len(ts['text'])
    toks = []
    for i in range(n):
        text = (ts['text'][i] or '').strip()
        if not text:
            continue
        x, y, w, h = ts['left'][i], ts['top'][i], ts['width'][i], ts['height'][i]
        toks.append({'text': text, 'x': x, 'y': y, 'w': w, 'h': h})
    return toks

def crop(img, x0, y0, x1, y1):
    x0 = max(0, x0); y0 = max(0, y0)
    x1 = min(img.size[0], x1); y1 = min(img.size[1], y1)
    if x1 <= x0 or y1 <= y0:
        return None
    return img.crop((x0, y0, x1, y1))

def extract_prices_from_text_block(text, require_currency=False):
    lines = [re.sub(r'\s+', ' ', L).strip() for L in text.splitlines() if L.strip()]
    found = []
    for line in lines:
        # se exigimos "R$" no contexto, a linha precisa ter R$ (ou $)
        if require_currency and not RE_CURRENCY.search(line):
            continue
        for m in RE_PRICE.finditer(line):
            found.append(m.group(1))

    vals = []
    for raw in found:
        v = br_to_float(raw)
        if v is None:
            continue
        # filtros de faixa plausível
        if MIN_PRICE_BRL <= v <= MAX_PRICE_BRL:
            vals.append(round(v, 2))
    return vals

def scan_by_anchor(img, toks, anchor_regex, roi_left=ROI_LEFT_OF_COMPRAR):
    vals = []
    # procura tokens que casam com o anchor (ex.: "Comprar" ou "adulto")
    for t in toks:
        txt = t['text']
        if anchor_regex.search(txt.lower()):
            x, y, w, h = t['x'], t['y'], t['w'], t['h']
            # ROI à esquerda do anchor, onde o preço costuma ficar
            roi = crop(img, x - roi_left, y - ROI_PAD_Y, x - 8, y + h + ROI_PAD_Y)
            if not roi:
                continue
            s = pytesseract.image_to_string(roi, lang=LANGS, config=TESS_CFG_TEXT)
            vals.extend(extract_prices_from_text_block(s, require_currency=True))
    return vals

def main():
    results = []
    for png_path in glob.glob('data/*_*/*/screenshot.png'):
        meta = parse_path(png_path)
        if not meta:
            continue

        entry = {**meta, 'screenshot': png_path}
        try:
            img0 = Image.open(png_path)
            img = preprocess(img0)
            toks = ocr_data(img)

            # 1) Preços perto do botão "Comprar"
            vals = scan_by_anchor(img, toks, anchor_regex=re.compile(r'comprar', re.IGNORECASE))

            # 2) Se ainda pouco, tenta perto de "Preço por adulto"
            if len(vals) < 3:
                vals += scan_by_anchor(img, toks, anchor_regex=RE_ADULTO)

            # 3) Fallback: pega linhas com R$ em toda a página (ainda exigindo R$)
            if len(vals) < 3:
                full_txt = pytesseract.image_to_string(img, lang=LANGS, config=TESS_CFG_TEXT)
                vals += extract_prices_from_text_block(full_txt, require_currency=True)

            # normaliza e ordena
            vals = sorted(set(v for v in vals if MIN_PRICE_BRL <= v <= MAX_PRICE_BRL))
            entry['all_prices_brl'] = vals
            entry['min_price_brl'] = min(vals) if vals else None

        except Exception as e:
            entry['error'] = str(e)
            entry['all_prices_brl'] = []
            entry['min_price_brl'] = None

        # salva por execução
        base = os.path.dirname(png_path)
        with open(os.path.join(base, 'ocr.json'), 'w', encoding='utf-8') as f:
            json.dump(entry, f, ensure_ascii=False, indent=2)
        with open(os.path.join(base, 'ocr.csv'), 'w', encoding='utf-8', newline='') as f:
            w = csv.writer(f, delimiter=';')
            w.writerow(['date','route','stamp','min_price_brl','all_prices_brl'])
            w.writerow([entry['date'], entry['route'], entry['stamp'], entry['min_price_brl'],
                        ','.join(map(lambda x: f'{x:.2f}', entry['all_prices_brl']))])

        results.append(entry)

    # Agregado por rota em data/public/<ROTA>/latest/ocr.csv
    by_route = {}
    for r in results:
        by_route.setdefault(r['route'], []).append(r)
    for route, arr in by_route.items():
        arr.sort(key=lambda x: (x['date'], x['stamp']))
        pub_dir = os.path.join('data','public',route,'latest')
        os.makedirs(pub_dir, exist_ok=True)
        out_csv = os.path.join(pub_dir, 'ocr.csv')
        with open(out_csv, 'w', encoding='utf-8', newline='') as f:
            w = csv.writer(f, delimiter=';')
            w.writerow(['date','route','stamp','min_price_brl','all_prices_brl'])
            for r in arr:
                w.writerow([r['date'], r['route'], r['stamp'], r['min_price_brl'],
                            ','.join(map(lambda x: f'{x:.2f}', r['all_prices_brl']))])

if __name__ == '__main__':
    main()
