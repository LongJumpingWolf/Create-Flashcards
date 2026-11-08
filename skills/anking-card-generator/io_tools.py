#!/usr/bin/env python3
"""io_tools.py - precise figure crops and image-occlusion masks from a PDF (offline, needs: pip install pymupdf pillow).

The AI decides WHAT to hide; this script measures WHERE it is (exact text-layer boxes, no guessed pixel coordinates).

  python io_tools.py figures  book.pdf  OUT_DIR
        Finds every embedded figure image, its "Fig. N.M" caption and caption text, crops it (JPEG) and writes
        OUT_DIR/figures.json  {"6.2": {"file": "...", "page": 2, "caption": "Fig. 6.2 Atypical lymphocyte...", "b64": "..."}}

  python io_tools.py labels   book.pdf  PAGE  x0,y0,x1,y1  OUT_DIR
        Lists every text phrase inside that rectangle (PDF points, 1-based PAGE) as numbered candidates and writes
        OUT_DIR/overlay.png (numbered boxes, LOOK AT IT), OUT_DIR/crop.png and OUT_DIR/candidates.json.
        Tip: run `figures` first or `python io_tools.py page book.pdf PAGE OUT.png` to see the page and choose the rectangle.

  python io_tools.py build    spec.json  OUT.json
        spec = {"pdf": "...", "page": 1, "rect": [x0,y0,x1,y1], "candidates": "OUT_DIR/candidates.json",
                "tags": [...], "extra": "<Book> Fig. 6.1 - Hematopoiesis",
                "header": "Hematopoiesis",
                "cards": [{"mode": "hide-one", "hide": [3, 7, [9, 10]], "hints": ["Which stem cell?", "Which blast?", "The 2 mature T-cell types"]},
                          {"mode": "sequential", "hide": [3, 8, 14, 17], "header": "Name the B-cell lineage in order"}]}
        "hide" = candidate numbers from the overlay. mode: hide-all | hide-one | sequential | random.
        One card object per spec card; the app makes one note per hidden group (hide-one / hide-all) or one
        reveal-in-order / random note (sequential / random).
        A group can join several numbers: "hide": [[3, 4], 7].  "hints" (optional, one per group) is shown above the
        picture on that note - ALWAYS give one: it tells the learner WHAT is expected in the hidden area (a name? how many?
        which category?) without giving the answer.  "header" = text above the picture for the whole card.  Output is the app's Import JSON (normalised 0-1 masks).

  python io_tools.py check    OUT.json  OUT_DIR
        Renders every IO card with its masks drawn so you can LOOK at the result before delivering.
  python io_tools.py page     book.pdf PAGE OUT.png      (preview a page with a point ruler to pick rectangles)
"""
import sys, json, io, re, base64, os


def _fitz():
    try:
        import pymupdf
        return pymupdf
    except ImportError:
        sys.exit('pip install pymupdf pillow')


def _jpeg(pix, quality=84, max_w=1100):
    from PIL import Image
    im = Image.frombytes('RGB', (pix.width, pix.height), pix.samples)
    if im.width > max_w:
        im = im.resize((max_w, round(im.height * max_w / im.width)))
    buf = io.BytesIO(); im.save(buf, 'JPEG', quality=quality, optimize=True)
    return im, buf.getvalue()


def cmd_figures(pdf, out):
    pm = _fitz(); os.makedirs(out, exist_ok=True)
    doc = pm.open(pdf); res = {}
    for pno, page in enumerate(doc, 1):
        W, H = page.rect.width, page.rect.height
        imgs = [pm.Rect(i['bbox']) for i in page.get_image_info() if pm.Rect(i['bbox']).get_area() < 0.6 * W * H and pm.Rect(i['bbox']).width > 60]
        words = page.get_text('words')
        caps = [w for w in words if w[4] == 'Fig.' or (w[4].startswith('Fig.') and len(w[4]) > 4)]
        # group images into rows (a row = one picture band); one band often holds several figures side by side
        rows = []
        for r in sorted(imgs, key=lambda r: r.y0):
            for row in rows:
                if abs(row['y0'] - r.y0) < 18:
                    row['y0'] = min(row['y0'], r.y0); row['y1'] = max(row['y1'], r.y1); row['x0'] = min(row['x0'], r.x0); row['x1'] = max(row['x1'], r.x1); break
            else:
                rows.append({'y0': r.y0, 'y1': r.y1, 'x0': r.x0, 'x1': r.x1})
        regions = []
        for row in rows:
            rc = sorted([w for w in caps if 0 <= w[1] - row['y1'] < 40 and row['x0'] - 15 <= w[0] <= row['x1'] + 5], key=lambda w: w[0])
            for i, c in enumerate(rc):
                x1 = rc[i + 1][0] - 3 if i + 1 < len(rc) else row['x1']
                regions.append((pm.Rect(max(c[0] - 2, row['x0'] - 2) if i else row['x0'], row['y0'], x1, row['y1']), c, x1))
        for r, c, x1 in regions:
            cap = page.get_text('text', clip=pm.Rect(c[0] - 2, c[1] - 2, x1, c[1] + 38)).replace('\n', ' ').strip()
            cap = re.sub(r'\s+', ' ', cap)
            m = re.match(r'Fig\.?\s*(\d+\.\d+)', cap)
            if not m:
                continue
            key = m.group(1)
            pix = page.get_pixmap(matrix=pm.Matrix(3.2, 3.2), clip=r, alpha=False)
            im, data = _jpeg(pix)
            fn = os.path.join(out, f'fig_{key}.jpg'); open(fn, 'wb').write(data)
            res[key] = {'file': fn, 'page': pno, 'rect': [round(v, 1) for v in r], 'caption': cap, 'b64': base64.b64encode(data).decode()}
    json.dump(res, open(os.path.join(out, 'figures.json'), 'w', encoding='utf-8'), ensure_ascii=False)
    for k, v in res.items():
        print(k, 'p%d' % v['page'], v['rect'], v['caption'][:90])
    print(len(res), 'figures ->', out)


def _phrases(page, rect, pm):
    words = [w for w in page.get_text('words') if rect.contains(pm.Point((w[0] + w[2]) / 2, (w[1] + w[3]) / 2))]
    lines = {}
    for w in words:
        lines.setdefault((w[5], w[6]), []).append(w)
    out = []
    for ws in lines.values():
        ws.sort(key=lambda w: w[0]); cur = [ws[0]]
        for w in ws[1:]:
            if w[0] - cur[-1][2] > 7:  # a wide gap = a different label on the same row
                out.append(cur); cur = [w]
            else:
                cur.append(w)
        out.append(cur)
    res = []
    for g in out:
        res.append({'text': ' '.join(w[4] for w in g), 'box': [min(w[0] for w in g), min(w[1] for w in g), max(w[2] for w in g), max(w[3] for w in g)]})
    res = [c for c in res if len(re.sub(r'[^A-Za-z0-9]', '', c['text'])) >= 2]  # drop connector glyphs (| r l T ...)
    res.sort(key=lambda c: (round(c['box'][1] / 6), c['box'][0]))
    return res


def cmd_labels(pdf, page_no, rect, out):
    pm = _fitz(); from PIL import Image, ImageDraw
    os.makedirs(out, exist_ok=True)
    page = pm.open(pdf)[int(page_no) - 1]
    rect = pm.Rect(*[float(v) for v in rect.split(',')])
    cands = _phrases(page, rect, pm)
    Z = 3.0
    pix = page.get_pixmap(matrix=pm.Matrix(Z, Z), clip=rect, alpha=False)
    im = Image.frombytes('RGB', (pix.width, pix.height), pix.samples); im.save(os.path.join(out, 'crop.png'))
    ov = im.copy(); d = ImageDraw.Draw(ov)
    for i, c in enumerate(cands, 1):
        x0, y0, x1, y1 = [(c['box'][0] - rect.x0) * Z, (c['box'][1] - rect.y0) * Z, (c['box'][2] - rect.x0) * Z, (c['box'][3] - rect.y0) * Z]
        d.rectangle([x0 - 2, y0 - 2, x1 + 2, y1 + 2], outline=(220, 30, 30), width=2)
        d.rectangle([x0 - 2, y0 - 16, x0 + 8 * len(str(i)) + 6, y0 - 2], fill=(220, 30, 30)); d.text((x0, y0 - 15), str(i), fill='white')
        c['n'] = i
    ov.save(os.path.join(out, 'overlay.png'))
    json.dump({'rect': [rect.x0, rect.y0, rect.x1, rect.y1], 'page': int(page_no), 'candidates': cands}, open(os.path.join(out, 'candidates.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    for c in cands:
        print(c['n'], c['text'])
    print(len(cands), 'candidates; view', os.path.join(out, 'overlay.png'))


def cmd_build(spec_path, out_path):
    pm = _fitz(); spec = json.load(open(spec_path, encoding='utf-8'))
    cj = json.load(open(spec['candidates'], encoding='utf-8')); cands = {c['n']: c for c in cj['candidates']}
    x0, y0, x1, y1 = cj['rect']; W, H = x1 - x0, y1 - y0
    page = pm.open(spec['pdf'])[cj['page'] - 1]
    pix = page.get_pixmap(matrix=pm.Matrix(3.0, 3.0), clip=pm.Rect(*cj['rect']), alpha=False)
    im, data = _jpeg(pix, quality=86, max_w=1100)
    image_data = 'data:image/jpeg;base64,' + base64.b64encode(data).decode()

    def mask(n, mid, group, hint=''):
        b = cands[n]['box']; pad = 1.2
        bx0, by0, bx1, by1 = max(b[0] - pad, x0), max(b[1] - pad, y0), min(b[2] + pad, x1), min(b[3] + pad, y1)
        return {'id': mid, 'shape': 'rect', 'x': round((bx0 - x0) / W, 5), 'y': round((by0 - y0) / H, 5), 'width': round((bx1 - bx0) / W, 5), 'height': round((by1 - by0) / H, 5), 'label': cands[n]['text'], 'group': group, **({'hint': hint} if hint else {})}

    cards = []
    for spec_card in spec['cards']:
        groups = [g if isinstance(g, list) else [g] for g in spec_card['hide']]
        hints = spec_card.get('hints', [])
        masks = []
        for gi, g in enumerate(groups, 1):
            for n in g:
                masks.append(mask(n, f'm{gi}-{n}', f'g{gi}', hints[gi - 1] if gi - 1 < len(hints) else ''))
        extra = spec_card.get('extra', spec.get('extra', ''))
        mode = spec_card.get('mode', 'hide-one')
        base = {'type': 'Image Occlusion', 'answer': extra, 'tags': spec_card.get('tags', spec.get('tags', [])), 'image_data': image_data, 'image_width': 720, 'occlusion_mode': mode, 'header': spec_card.get('header', spec.get('header', ''))}
        # ONE card object with all masks: the app/exporter turns each mask group into its own note
        # (hide-all / hide-one) or into one reveal-in-order / random note (sequential / random).
        cards.append(dict(base, masks=masks))
    json.dump({'deck_name': spec.get('deck_name', 'Image occlusion'), 'cards': cards}, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False)
    print(len(cards), 'image-occlusion cards ->', out_path)


def cmd_check(path, out):
    from PIL import Image, ImageDraw
    os.makedirs(out, exist_ok=True)
    d = json.load(open(path, encoding='utf-8'))
    for i, c in enumerate([c for c in d['cards'] if c.get('type') == 'Image Occlusion'], 1):
        im = Image.open(io.BytesIO(base64.b64decode(c['image_data'].split(',', 1)[1]))).convert('RGB'); dr = ImageDraw.Draw(im, 'RGBA')
        for m in c['masks']:
            box = [m['x'] * im.width, m['y'] * im.height, (m['x'] + m['width']) * im.width, (m['y'] + m['height']) * im.height]
            dr.rectangle(box, fill=(255, 235, 162, 235), outline=(200, 120, 0)); dr.text((box[0] + 2, box[1] + 1), '?', fill='black')
        im.save(os.path.join(out, f'check_{i:02d}.png'))
    print('rendered to', out)


def cmd_page(pdf, page_no, out):
    pm = _fitz(); from PIL import ImageDraw, Image
    page = pm.open(pdf)[int(page_no) - 1]
    pix = page.get_pixmap(matrix=pm.Matrix(1.5, 1.5), alpha=False)
    im = Image.frombytes('RGB', (pix.width, pix.height), pix.samples); d = ImageDraw.Draw(im)
    for v in range(0, int(page.rect.width), 50):
        d.line([v * 1.5, 0, v * 1.5, 8], fill=(255, 0, 0)); d.text((v * 1.5 + 2, 8), str(v), fill=(255, 0, 0))
    for v in range(0, int(page.rect.height), 50):
        d.line([0, v * 1.5, 8, v * 1.5], fill=(255, 0, 0)); d.text((10, v * 1.5 - 5), str(v), fill=(255, 0, 0))
    im.save(out); print('saved', out)


if __name__ == '__main__':
    a = sys.argv[1:]
    cmds = {'figures': (cmd_figures, 2), 'labels': (cmd_labels, 4), 'build': (cmd_build, 2), 'check': (cmd_check, 2), 'page': (cmd_page, 3)}
    if not a or a[0] not in cmds or len(a) - 1 != cmds[a[0]][1]:
        sys.exit(__doc__)
    cmds[a[0]][0](*a[1:])
