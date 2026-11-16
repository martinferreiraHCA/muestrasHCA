#!/usr/bin/env python3
"""Convierte el volcado del DWG (ver extraer_dwg.mjs) en un JSON liviano por nivel.

Uso: python3 convertir_plano.py ents.ndjson blocks.json ../data [debug_dir]

Por cada nivel genera muros, aberturas y detalle como segmentos en centímetros
(origen arriba-izquierda, eje Y hacia abajo), las etiquetas de los locales y los
polígonos de los salones detectados automáticamente.
"""
import json, math, re, sys, os
import numpy as np, cv2

SRC, BLK, OUT = sys.argv[1:4]
DBG = sys.argv[4] if len(sys.argv) > 4 else None

# Recortes de la lámina 1 del plano (coordenadas del dibujo, en metros).
NIVELES = [
    ('ss', 'Subsuelo', (1100, 86.5, 1136, 122)),
    ('pb', 'Planta baja', (1138, 88, 1268, 160)),
    ('p1', 'Primer piso', (1270, 88, 1386.5, 160)),
    ('p2', 'Segundo piso', (1387, 88, 1500, 160)),
]
MUROS = {'00-0.25mm', '00-0.35mm', 'MUROS'}
ABERT = {'00-0.18mm', 'ABERTURAS', 'VANOS'}
DETALLE = {'00-0.15mm', '0', 'PROYECCIONES', 'PAVIMENTOS', 'ESCALERAS', 'EQUIPAMIENTO', 'ALBG', 'albag', '00_Demoler', 'LINEAS'}
TEXTOS = {'00_textos y símbolos', '00-0.15mm', '00-0.18mm', 'ALBG'}
X0, Y0, X1, Y1 = 1095, 80, 1505, 165

blocks = json.load(open(BLK))
segs = {'m': [], 'a': [], 'd': []}   # (x1,y1,x2,y2)
puertas = []                          # (cx,cy,r,a0,a1) arcos de puertas
textos = []                           # (x,y,h,texto)

def cat(layer):
    if layer in MUROS: return 'm'
    if layer in ABERT: return 'a'
    if layer in DETALLE: return 'd'
    return None

def mul(A, B):
    return (A[0]*B[0]+A[1]*B[3], A[0]*B[1]+A[1]*B[4], A[0]*B[2]+A[1]*B[5]+A[2],
            A[3]*B[0]+A[4]*B[3], A[3]*B[1]+A[4]*B[4], A[3]*B[2]+A[4]*B[5]+A[5])
def ap(T, x, y): return (T[0]*x+T[1]*y+T[2], T[3]*x+T[4]*y+T[5])
I = (1, 0, 0, 0, 1, 0)

def arc_pts(cx, cy, r, a0, a1, paso=0.2):
    if a1 <= a0: a1 += 2*math.pi
    n = max(2, int((a1-a0)/paso)+1)
    return [(cx+r*math.cos(a0+(a1-a0)*i/n), cy+r*math.sin(a0+(a1-a0)*i/n)) for i in range(n+1)]

def bulge_pts(p, q, b):
    (x1, y1), (x2, y2) = p, q
    d = math.hypot(x2-x1, y2-y1)
    if d < 1e-9 or abs(b) < 1e-6: return [q]
    ang = 4*math.atan(b); r = d/(2*math.sin(ang/2))
    mx, my = (x1+x2)/2, (y1+y2)/2
    h = r*math.cos(ang/2)
    cx, cy = mx-(y2-y1)/d*h, my+(x2-x1)/d*h
    a0 = math.atan2(y1-cy, x1-cx)
    n = max(2, int(abs(ang)/0.25)+1)
    return [(cx+abs(r)*math.cos(a0+ang*i/n), cy+abs(r)*math.sin(a0+ang*i/n)) for i in range(1, n+1)]

def limpio(t):
    t = re.sub(r'\\[fFHCQTWAp][^;]*;', '', t)
    t = t.replace('\\P', ' ').replace('%%%', '%').replace('{', '').replace('}', '')
    return re.sub(r'\s+', ' ', t).strip()

def emit(e, T, layer, depth=0):
    t = e['type']; L = e['layer'] if e['layer'] != '0' or layer is None else layer
    mx = -1 if e.get('ez') == -1 else 1
    if t == 'INSERT':
        b = blocks.get(e['name'])
        if not b or depth > 6: return
        p = e['insertionPoint']; a = e.get('rotation', 0); sx, sy = e.get('xScale', 1), e.get('yScale', 1)
        c, s = math.cos(a), math.sin(a)
        M = (c*sx, -s*sy, p['x']*mx, s*sx, c*sy, p['y'])
        if mx < 0: M = mul((-1, 0, 0, 0, 1, 0), (c*sx, -s*sy, p['x'], s*sx, c*sy, p['y']))
        bp = b.get('base') or {'x': 0, 'y': 0}
        M = mul(M, (1, 0, -bp['x'], 0, 1, -bp['y']))
        TT = mul(T, M)
        for c2 in b['entities']: emit(c2, TT, L, depth+1)
        return
    if t in ('TEXT', 'MTEXT'):
        if L not in TEXTOS: return
        p = e.get('startPoint') or e.get('insertionPoint')
        x, y = ap(T, p['x']*mx, p['y'])
        if t == 'MTEXT':  # el punto de inserción puede estar centrado
            w = e.get('extentsWidth', 0); at = e.get('attachmentPoint', 1)
            x += {1: w/2, 2: 0, 0: -w/2}[at % 3]
        else:
            x += len(e['text'])*e.get('textHeight', 0.2)*0.4
        textos.append((x, y, e.get('textHeight', 0.2), limpio(e['text'])))
        return
    k = cat(L)
    if not k: return
    pts = None
    if t == 'LINE':
        a, b = e['startPoint'], e['endPoint']; pts = [(a['x'], a['y']), (b['x'], b['y'])]
    elif t in ('LWPOLYLINE', 'POLYLINE2D'):
        v = e['vertices']
        if len(v) < 2: return
        pts = [(v[0]['x']*mx, v[0]['y'])]
        n = len(v); cerr = e.get('flag', 0) & 1
        for i in range(n if cerr else n-1):
            q = v[(i+1) % n]; pts += bulge_pts(pts[-1], (q['x']*mx, q['y']), v[i].get('bulge', 0)*mx)
    elif t in ('ARC', 'CIRCLE'):
        c = e['center']; r = e['radius']
        a0, a1 = e.get('startAngle', 0), e.get('endAngle', 2*math.pi)
        if mx < 0: a0, a1 = math.pi-a1, math.pi-a0
        pts = arc_pts(c['x']*mx, c['y'], r, a0, a1)
        if t == 'ARC' and k in ('a', 'm') and 0.55 <= r <= 1.3:
            sw = (a1-a0) % (2*math.pi)
            if 1.2 < sw < 1.9:
                h = ap(T, c['x']*mx, c['y']); puertas.append((h, ap(T, *pts[0]), ap(T, *pts[-1])))
    elif t == 'ELLIPSE':
        c = e['center']; m = e['majorAxisEndPoint']; ra = math.hypot(m['x'], m['y']); rb = ra*e['axisRatio']
        rot = math.atan2(m['y'], m['x']); a0, a1 = e['startAngle'], e['endAngle']
        if a1 <= a0: a1 += 2*math.pi
        pts = []
        for i in range(17):
            u = a0+(a1-a0)*i/16; px, py = ra*math.cos(u), rb*math.sin(u)
            pts.append((c['x']+px*math.cos(rot)-py*math.sin(rot), c['y']+px*math.sin(rot)+py*math.cos(rot)))
    elif t == 'SPLINE':
        v = e.get('fitPoints') or e.get('controlPoints') or []
        pts = [(p['x'], p['y']) for p in v]
    if not pts or len(pts) < 2: return
    pts = [ap(T, *p) for p in pts]
    out = segs[k]
    for i in range(len(pts)-1):
        out.append((pts[i][0], pts[i][1], pts[i+1][0], pts[i+1][1]))

for line in open(SRC):
    e = json.loads(line)
    p = e.get('startPoint') or e.get('center') or e.get('insertionPoint') or (e.get('vertices') or [None])[0] or (e.get('fitPoints') or e.get('controlPoints') or [None])[0]
    if not p or not (X0 < p['x'] < X1 and Y0 < p['y'] < Y1): continue
    emit(e, I, None)
print({k: len(v) for k, v in segs.items()}, 'puertas', len(puertas), 'textos', len(textos))

LOCAL = re.compile(r'^(AULA|SS\.?HH|OFICINA|HALL|LABORATORIO|ADMINISTRACI|COCINA|COMEDOR|SAL[OÓ]N|SALA|AUDITORIO|DEP[OÓ]SITO|RECEPCI|DIRECCI|VESTUARIO|PORTER|BIBLIOTECA|GALER|PATIO|AREA DEPORTIVA|CANCHA|AZOTEA|EXPLANADA|GIMNASIO|ENFERMER|SECRETAR|TALLER|CANTINA|CAPILLA|SUM\b)', re.I)
CONT = re.compile(r'^(DE USOS|M[UÚ]LTIPLES|MULTIUSO|BIBLIOTECA|DORMIR|TRANSITABLE|TECHADA|AUXILIAR|EXTERIOR EXISTENTE|DE F[UÚ]TBOL|DE PROFESORES|DE ARTE|DE M[UÚ]SICA|INFORM[AÁ]TICA)', re.I)

def nombre_lindo(s):
    s = s.strip(' /').lower()
    s = re.sub(r'ss\.?hh\.?', 'SS.HH.', s, flags=re.I)
    s = s[:1].upper()+s[1:]
    for a, b in (('Administracion', 'Administración'), ('Recepcion', 'Recepción'), ('Deposito', 'Depósito'), ('Porteria', 'Portería'), ('Galeria', 'Galería'), ('Area ', 'Área '), ('Salon', 'Salón'), ('hormigon', 'hormigón')):
        s = s.replace(a, b)
    return s

RES = 0.04  # m por píxel para la detección de locales
indice = []
for nid, nombre, (ax, ay, bx, by) in NIVELES:
    def dentro(s): return ax <= s[0] <= bx and ay <= s[1] <= by and ax <= s[2] <= bx and ay <= s[3] <= by
    S = {k: [s for s in v if dentro(s)] for k, v in segs.items()}
    # límites ajustados al dibujo (muros + aberturas + detalle)
    allp = np.array(S['m']+S['a']+S['d']).reshape(-1, 2)
    wm = np.array(S['m']).reshape(-1, 2)
    mnx, mny = np.percentile(allp[:, 0], 0.05)-1, np.percentile(allp[:, 1], 0.05)-1
    mxx, mxy = np.percentile(allp[:, 0], 99.95)+1, np.percentile(allp[:, 1], 99.95)+1
    mnx, mny = min(mnx, wm[:, 0].min()-2), min(mny, wm[:, 1].min()-2)
    mxx, mxy = max(mxx, wm[:, 0].max()+2), max(mxy, wm[:, 1].max()+2)
    W, H = mxx-mnx, mxy-mny
    tx = lambda x: x-mnx
    ty = lambda y: mxy-y
    def cm(v): return int(round(v*100))
    def pack(lst, minlen=0.0):
        out = []; visto = set()
        for x1, y1, x2, y2 in lst:
            if not (mnx <= x1 <= mxx and mny <= y1 <= mxy): continue
            if math.hypot(x2-x1, y2-y1) < minlen: continue
            q = (cm(tx(x1)), cm(ty(y1)), cm(tx(x2)), cm(ty(y2)))
            if q[:2] == q[2:]: continue
            key = q if q[:2] <= q[2:] else q[2:]+q[:2]
            if key in visto: continue
            visto.add(key); out += q
        return out
    # --- detección de locales ---
    # Imagen de barreras (4 cm por píxel): muros + aberturas pegadas a un muro + cierre de puertas.
    RES = 0.04
    iw, ih = int(W/RES)+1, int(H/RES)+1
    img = np.zeros((ih, iw), np.uint8)
    px = lambda x, y: (int(round(tx(x)/RES)), int(round(ty(y)/RES)))
    for x1, y1, x2, y2 in S['m']: cv2.line(img, px(x1, y1), px(x2, y2), 255, 2)
    ab = np.zeros_like(img)
    for x1, y1, x2, y2 in S['a']: cv2.line(ab, px(x1, y1), px(x2, y2), 255, 2)
    cerca = cv2.dilate(img, np.ones((9, 9), np.uint8))
    na, la, sa, _ = cv2.connectedComponentsWithStats(ab, connectivity=8)
    ok = np.zeros(na, bool)
    for i in np.unique(la[(cerca > 0) & (ab > 0)]):
        if i and max(sa[i, 2], sa[i, 3])*RES < 7.5: ok[i] = True
    ab_ok = ok[la]
    img |= (ab_ok*255).astype(np.uint8)
    pu = [(h, math.hypot(a[0]-h[0], a[1]-h[1]), a, b) for h, a, b in puertas if ax <= h[0] <= bx and ay <= h[1] <= by]
    for h, r, a, b in pu:
        cv2.line(img, px(*h), px(*a), 255, 2); cv2.line(img, px(*h), px(*b), 255, 2)
    # barreras para la simulación de circulación: ventanas sí, puertas no
    barreras = []
    for x1, y1, x2, y2 in S['a']:
        mxp, myp = px((x1+x2)/2, (y1+y2)/2)
        if not (0 <= mxp < iw and 0 <= myp < ih and ab_ok[myp, mxp]): continue
        if any(math.hypot(x1-h[0], y1-h[1]) <= r+0.08 and math.hypot(x2-h[0], y2-h[1]) <= r+0.08 for h, r, _, _ in pu): continue
        barreras.append((x1, y1, x2, y2))

    # etiquetas de locales
    T = [(tx(x), ty(y), h, t) for x, y, h, t in textos if ax <= x <= bx and ay <= y <= by and t]
    etiquetas = []
    for x, y, h, t in T:
        if not LOCAL.match(t) or len(t) > 40: continue
        nom = t; num = None
        for x2, y2, h2, t2 in T:
            dx, dy = x2-x, y2-y
            if abs(dx) < 2.2 and 0.15 < dy < 0.9 and CONT.match(t2) and len(nom) < 40: nom += ' '+t2; y += 0  # texto en dos renglones
        nl = nom.count(' ')  # el número va debajo del último renglón
        for x2, y2, h2, t2 in T:
            dx, dy = x2-x, y2-y
            if abs(dx) < 0.9 and 0.12 < dy < 0.75+0.35*min(nl, 2) and re.fullmatch(r'\d{1,2}', t2) and h2 >= 0.15:
                if num is None or dy < num[0]: num = (dy, t2)
        etiquetas.append([x, y, nombre_lindo(nom), num[1] if num else None])
    uniq = []
    for e in etiquetas:
        if not any(abs(e[0]-u[0]) < 0.6 and abs(e[1]-u[1]) < 0.6 for u in uniq): uniq.append(e)
    etiquetas = uniq

    # 1) Locales con etiqueta: desde el texto se buscan los cuatro muros que lo rodean
    #    (resistente a puertas abiertas) y se toma la forma real dentro de ese rectángulo.
    M = lambda m: int(round(m/RES))
    def ajustar(sx, sy):
        if not (5 < sx < iw-5 and 5 < sy < ih-5): return None
        if img[sy, sx]:
            v = np.argwhere(img[sy-12:sy+13, sx-12:sx+13] == 0)
            if not len(v): return None
            k = np.argmin(np.abs(v-12).sum(1)); sy, sx = sy-12+int(v[k][0]), sx-12+int(v[k][1])
        tope = M(45)
        def rayo(dx, dy):
            ds = []
            for o in range(-M(0.8), M(0.8)+1, 3):
                x, y = sx+(o if dy else 0), sy+(o if dx else 0); n = 0
                while 0 < x < iw-1 and 0 < y < ih-1 and not img[y, x] and n < tope: x += dx; y += dy; n += 1
                ds.append(n)
            return int(np.median(ds))
        iz, de, ar, ab_ = rayo(-1, 0), rayo(1, 0), rayo(0, -1), rayo(0, 1)
        if max(iz, de, ar, ab_) >= tope: return None
        x0, x1, y0, y1 = sx-iz, sx+de, sy-ar, sy+ab_
        mg, COB, ini = M(0.25), 0.42, M(0.35)
        for _ in range(4):        # se afina cada lado mirando el ancho completo del local
            def lado(fijo0, fijo1, desde, hasta, paso, horiz):
                a0, a1 = fijo0+mg, fijo1-mg
                if a1-a0 < 5: return None
                p = desde
                while (p < hasta) if paso > 0 else (p > hasta):
                    if not (1 < p < (iw if horiz else ih)-3): return None
                    t = img[a0:a1, p:p+3].any(1) if horiz else img[p:p+3, a0:a1].any(0)
                    if t.mean() >= COB: return p
                    p += paso
                return None
            nx1 = lado(y0, y1, sx+ini, x1+M(2.5), 1, True); nx0 = lado(y0, y1, sx-ini, x0-M(2.5), -1, True)
            ny1 = lado(x0, x1, sy+ini, y1+M(2.5), 1, False); ny0 = lado(x0, x1, sy-ini, y0-M(2.5), -1, False)
            x0, x1, y0, y1 = nx0 if nx0 is not None else x0, nx1 if nx1 is not None else x1, ny0 if ny0 is not None else y0, ny1 if ny1 is not None else y1
        if x0 < 2 or y0 < 2 or x1 > iw-4 or y1 > ih-4 or x1-x0 < M(1.0) or y1-y0 < M(1.0): return None
        # los cuatro lados tienen que ser muro de verdad; si no, es un exterior o una etiqueta suelta
        a0, a1, b0, b1 = y0+mg, y1-mg, x0+mg, x1-mg
        if a1-a0 < 5 or b1-b0 < 5: return None
        cob = [img[a0:a1, x0-1:x0+3].any(1).mean(), img[a0:a1, x1-1:x1+3].any(1).mean(), img[y0-1:y0+3, b0:b1].any(0).mean(), img[y1-1:y1+3, b0:b1].any(0).mean()]
        if min(cob) < 0.33: return None
        x0, y0 = x0+1, y0+1
        sub = (img[y0:y1, x0:x1] == 0).astype(np.uint8)
        if not sub[sy-y0, sx-x0]: return None
        n, lab = cv2.connectedComponents(sub, connectivity=4)
        reg = (lab == lab[sy-y0, sx-x0]).astype(np.uint8)
        reg = cv2.morphologyEx(reg, cv2.MORPH_OPEN, np.ones((9, 9), np.uint8))
        reg = cv2.dilate(reg, np.ones((3, 3), np.uint8))
        return x0, y0, reg
    def contorno(x0, y0, reg):
        cs, _ = cv2.findContours(reg, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not cs: return None
        c = max(cs, key=cv2.contourArea)
        c = cv2.approxPolyDP(c, 2.5, True).reshape(-1, 2)
        if len(c) < 3: return None
        return [[cm((p[0]+x0)*RES), cm((p[1]+y0)*RES)] for p in c]

    duenio = np.zeros((ih, iw), np.int32)
    locales = []
    usados = {}
    prioridad = lambda e: (e[2].startswith('SS.HH'), e[3] is None)
    for e in sorted(etiquetas, key=prioridad):
        r = ajustar(int(e[0]/RES), int(e[1]/RES))
        if not r: continue
        x0, y0, reg = r
        area = float(reg.sum())*RES*RES
        if area < 2.5 or area > 450 or area < 0.55*reg.shape[0]*reg.shape[1]*RES*RES: continue
        zona = duenio[y0:y0+reg.shape[0], x0:x0+reg.shape[1]]
        if ((zona > 0) & (reg > 0)).sum() > 0.4*reg.sum(): continue        # ya detectado con otra etiqueta
        poly = contorno(x0, y0, reg)
        if not poly: continue
        zona[(reg > 0) & (zona == 0)] = len(locales)+1
        usados[id(e)] = 1
        mo = cv2.moments(reg)
        locales.append({'nombre': e[2]+(' '+e[3] if e[3] else ''), 'area': round(area, 1), 'poly': poly,
                        'cx': cm((x0+mo['m10']/mo['m00'])*RES), 'cy': cm((y0+mo['m01']/mo['m00'])*RES)})

    # 2) Espacios sin etiqueta: zonas encerradas que no pertenecen a ningún local anterior.
    g = M(2.1)
    cerr = img | cv2.morphologyEx(img, cv2.MORPH_CLOSE, np.ones((1, g), np.uint8)) | cv2.morphologyEx(img, cv2.MORPH_CLOSE, np.ones((g, 1), np.uint8))
    libre = cv2.erode(255-cerr, np.ones((3, 3), np.uint8))
    n, lab, stats, cent = cv2.connectedComponentsWithStats(libre, connectivity=4)
    for i in range(1, n):
        area = stats[i, cv2.CC_STAT_AREA]*RES*RES
        x, y, w, h = stats[i, :4]
        if area < 12 or area > 1500 or x <= 1 or y <= 1 or x+w >= iw-1 or y+h >= ih-1: continue
        reg = (lab[y:y+h, x:x+w] == i).astype(np.uint8)
        if ((duenio[y:y+h, x:x+w] > 0) & (reg > 0)).sum() > 0.3*reg.sum(): continue
        reg = cv2.dilate(reg, np.ones((5, 5), np.uint8))
        cs, _ = cv2.findContours(reg, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        per = cv2.arcLength(max(cs, key=cv2.contourArea), True)*RES
        if 4*math.pi*area/(per*per) < 0.3: continue
        poly = contorno(x, y, reg)
        if poly: locales.append({'nombre': None, 'area': round(float(area), 1), 'poly': poly, 'cx': cm(cent[i][0]*RES), 'cy': cm(cent[i][1]*RES)})

    # nombres repetidos: se distinguen con una letra
    cuenta = {}
    for l in locales:
        if l['nombre']: cuenta[l['nombre']] = cuenta.get(l['nombre'], 0)+1
    visto = {}
    for l in sorted(locales, key=lambda l: (l['cy'], l['cx'])):
        n = l['nombre']
        if n and cuenta[n] > 1:
            visto[n] = visto.get(n, 0)+1; l['nombre'] = f"{n} ({'abcdefghijklmnop'[visto[n]-1]})"
    locales.sort(key=lambda l: (l['nombre'] is None, l['nombre'] or '', l['cy'], l['cx']))
    k = 0
    for j, l in enumerate(locales):
        l['id'] = f'{nid}-{j+1}'
        if not l['nombre']: k += 1; l['nombre'] = f'Espacio {k}'; l['auto'] = True
    # líneas larguísimas en la capa de muros son retiros/ejes, no paredes
    largo = lambda s: math.hypot(s[2]-s[0], s[3]-s[1])
    S['d'] += [s for s in S['m'] if largo(s) > 45]
    S['m'] = [s for s in S['m'] if largo(s) <= 45]
    data = {
        'id': nid, 'nombre': nombre, 'ancho': cm(W), 'alto': cm(H),
        'muros': pack(S['m']), 'aberturas': pack(S['a']), 'barreras': pack(barreras), 'detalle': pack(S['d'], 0.12),
        'etiquetas': [{'x': cm(e[0]), 'y': cm(e[1]), 't': e[2]+(' '+e[3] if e[3] else '')} for e in etiquetas],
        'locales': locales,
    }
    json.dump(data, open(os.path.join(OUT, nid+'.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
    indice.append({'id': nid, 'nombre': nombre, 'archivo': nid+'.json', 'ancho': cm(W), 'alto': cm(H)})
    print(nid, f'{W:.1f}x{H:.1f} m', 'muros', len(data['muros'])//4, 'abert', len(data['aberturas'])//4, 'det', len(data['detalle'])//4,
          'etiquetas', len(etiquetas), 'locales', len(locales), 'con nombre', sum(1 for l in locales if not l.get('auto')),
          'KB', os.path.getsize(os.path.join(OUT, nid+'.json'))//1024)
    print('  sin local:', [e[2]+' '+str(e[3]) for e in etiquetas if id(e) not in usados])
    if DBG:
        sc = 20  # px por metro
        im = np.full((int(H*sc), int(W*sc), 3), 255, np.uint8)
        rng = np.random.default_rng(1)
        for l in locales:
            col = tuple(int(v) for v in rng.integers(150, 245, 3))
            cv2.fillPoly(im, [np.array(l['poly'])*sc//100], col)
        for key, col in (('detalle', (215, 215, 215)), ('aberturas', (0, 150, 0)), ('muros', (0, 0, 0))):
            a = np.array(data[key]).reshape(-1, 4)*sc//100
            for x1, y1, x2, y2 in a: cv2.line(im, (int(x1), int(y1)), (int(x2), int(y2)), col, 1)
        for l in locales:
            cv2.putText(im, l['nombre'].encode('ascii', 'replace').decode(), (l['cx']*sc//100-30, l['cy']*sc//100), cv2.FONT_HERSHEY_SIMPLEX, 0.35, (0, 0, 200), 1)
        cv2.imwrite(os.path.join(DBG, nid+'.png'), im)
json.dump({'niveles': indice}, open(os.path.join(OUT, 'niveles.json'), 'w'), ensure_ascii=False, indent=1)
