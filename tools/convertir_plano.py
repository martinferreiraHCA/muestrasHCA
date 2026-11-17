#!/usr/bin/env python3
"""Convierte el volcado del DWG (ver extraer_dwg.mjs) en un JSON liviano por nivel.

Uso: python3 convertir_plano.py ents.ndjson blocks.json ../data [debug_dir]

Por cada nivel genera muros, aberturas y detalle como segmentos en centímetros
(origen arriba-izquierda, eje Y hacia abajo), las etiquetas de los locales y los
polígonos de los salones detectados automáticamente.
"""
import json, math, re, sys, os, unicodedata
import numpy as np, cv2
from scipy import ndimage
from skimage.segmentation import watershed
from skimage.morphology import h_maxima

SRC, BLK, OUT = sys.argv[1:4]
DBG = sys.argv[4] if len(sys.argv) > 4 else None

# Recortes de la lámina 1 del plano (coordenadas del dibujo, en metros).
H_MAX = 0.30    # (m) diferencia mínima de ancho para que un ensanche cuente como ambiente aparte
FUSION = 0.80   # dos zonas se unen si el paso entre ellas mide al menos esta fracción de la más angosta
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
arbol_pts = []                        # puntos de dibujo de árboles (capa 0 suelta y bloques 'arbol')
puertas_d = []                        # arcos de puerta dibujados en capas de detalle (se validan contra los muros)
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

def emit(e, T, layer, depth=0, arbol=False):
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
        for c2 in b['entities']: emit(c2, TT, L, depth+1, arbol or 'arbol' in e['name'].lower())
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
        if t == 'ARC' and k in ('a', 'm', 'd') and 0.55 <= r <= 1.3:
            sw = (a1-a0) % (2*math.pi)
            if 1.2 < sw < 1.9:
                h = ap(T, c['x']*mx, c['y']); (puertas if k != 'd' else puertas_d).append((h, ap(T, *pts[0]), ap(T, *pts[-1])))
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
    if arbol or (k == 'd' and L == '0' and depth == 0):
        for q in pts[::2]: arbol_pts.append(q)
    for i in range(len(pts)-1):
        out.append((pts[i][0], pts[i][1], pts[i+1][0], pts[i+1][1]))

for line in open(SRC):
    e = json.loads(line)
    p = e.get('startPoint') or e.get('center') or e.get('insertionPoint') or (e.get('vertices') or [None])[0] or (e.get('fitPoints') or e.get('controlPoints') or [None])[0]
    if not p or not (X0 < p['x'] < X1 and Y0 < p['y'] < Y1): continue
    emit(e, I, None)
print({k: len(v) for k, v in segs.items()}, 'puertas', len(puertas), 'textos', len(textos))

# ---------------------------------------------------------------------------------------------
# Curado a mano, hecho revisando la partición automática contra el plano (metros, origen del nivel).
# - EDIFICIOS: huellas aproximadas; los ambientes sin rótulo que caen fuera se descartan (canteros,
#   retiros, veredas), salvo los que se agregan abajo.
# - quitar: rectángulos (x0, y0, x1, y1) cuyo contenido se descarta (vacíos de doble altura, zonas
#   que se reemplazan por un contorno trazado a mano).
# - agregar: (nombre, contorno, es_exterior). Para lo que no tiene muros que lo encierren.
# - renombrar: ((x, y) de un punto interior, nombre) para halls y pasillos sin rótulo en el plano.
# Árboles del predio y de la vereda (x, y, radio de copa), ubicados a mano sobre el plano: en el DWG
# están dibujados como líneas sueltas, no como objetos. Se usan en el mapa del folleto.
ARBOLES = [(9.2, 4.6, 3.5), (8.3, 25, 2.6), (16.2, 22.7, 1), (20.2, 25.2, 1.5), (26, 26.5, 1.5), (30.4, 25.8, 3.6), (38.5, 27.5, 2),
           (47.7, 21.8, 1), (52.1, 21.8, 1.2), (45, 32.1, 4), (52.1, 41.4, 1), (71.7, 25, 2.5), (83.7, 30.8, 2.2), (97.1, 27.5, 3.6),
           (99.2, 7.1, 3.3), (101.7, 37.1, 2.6), (88.3, 46.7, 6.5), (101.2, 54.2, 5), (75, 39.6, 1), (75.4, 57.5, 1), (80, 62.9, 2.5),
           (55.4, 63.8, 2.2), (44.2, 60.8, 2), (46.7, 57.5, 2), (51.9, 54.2, 1), (87.9, 67.5, 1.5), (96.5, 36.3, 1.2),
           (107, 58, 1), (107.2, 61, 1), (107.4, 64, 1), (107.6, 67, 1),
           (107.9, 8.7, 1.7), (108.8, 18.2, 1.7), (109.4, 27.9, 1.8), (110.6, 39, 1.8), (111.7, 52.9, 1.8), (112.8, 65.2, 1.8)]
# Cada edificio se puede mostrar u ocultar en la app. 'proyecto': todavía no existe (obra futura), y
# viene oculto por defecto para no adelantar lo que no está construido. 'rects_<nivel>': zonas extra.
EDIFICIOS = [
    {'id': 'noroeste', 'nombre': 'Edificio noroeste (laboratorio y aulas)', 'rects': [(19.5, 6.5, 52.6, 23.6)]},
    {'id': 'norte', 'nombre': 'Edificio norte (biblioteca y aulas)', 'rects': [(53.4, 3.7, 98.8, 23.3)]},
    # notas del plano: «RAMPA A CONSTRUIR», «PASARELA A CONSTRUIR»
    {'id': 'obras', 'nombre': 'Rampas y pasarela (a construir)', 'proyecto': True,
     'rects': [(48.8, 30.2, 51.25, 46.6), (48.8, 30.2, 56.2, 32.45), (39.5, 47.5, 50.3, 52.8)]},
    {'id': 'casona', 'nombre': 'Casona', 'rects': [(49.0, 30.3, 76.2, 61.2)]},
    # nota del plano: «AREA DEPORTIVA TECHADA - AÑO 2012 - A DESMONTAR - 449.00 m2» donde va este edificio
    {'id': 'fondo', 'nombre': 'Edificio nuevo del fondo (auditorio, comedor y gimnasio)', 'proyecto': True,
     'rects': [(8.3, 42.0, 41.6, 66.4)], 'rects_p2': [(14.0, 36.0, 39.8, 46.0)]},
    # nota del plano (lámina de 2.º piso): «AULAS Y COMEDOR AÑO 2010 - A DEMOLER - 166.50 m2». Existe hoy pero el
    # plano ya no lo dibuja: se reconstruye su contorno a partir de la zona rayada.
    {'id': 'aulas2010', 'nombre': 'Aulas y comedor de 2010', 'demoler': True, 'rects': [],
     'manual': {'pb': ('Aulas y comedor (2010)', [(46.8, 23), (59.2, 23), (59.2, 27.6), (69.6, 27.6), (69.6, 32.5), (56.2, 32.5), (56.2, 31.5), (46.8, 31.5)])}},
]
def rects_de(e, nid): return e['rects']+e.get('rects_'+nid, [])
def edif_en(x, y, nid):
    """Índice del edificio que contiene el punto (metros del nivel), o 255 si es exterior."""
    for i, e in enumerate(EDIFICIOS):
        if any(r[0] <= x <= r[2] and r[1] <= y <= r[3] for r in rects_de(e, nid)): return i
    return 255
CURADO = {
    'pb': {
        'quitar': [(24.6, 45.6, 39.3, 51.8), (28.5, 51.8, 39.0, 63.9), (71.5, 3.5, 96.5, 7.2)],
        'agregar': [
            ('Hall 1', [(24.7, 45.8), (39.1, 45.8), (39.1, 51.6), (24.7, 51.6)], False),
            ('Comedor 2', [(28.7, 51.9), (38.9, 51.9), (38.9, 63.8), (28.7, 63.8)], False),
            # el patio central tiene dos versiones: como es hoy (con el bloque de 2010 en el medio) y como quedaría
            ('Patio central', [(41, 23), (45.4, 23), (45.4, 17.6), (69, 17.6), (69, 20.4), (75.6, 20.4), (75.6, 23.2), (77.4, 23.2), (77.4, 32.5),
                               (69.6, 32.5), (69.6, 27.6), (59.2, 27.6), (59.2, 23), (46.8, 23), (46.8, 31.5), (49, 31.5), (49, 45.2), (41, 45.2)], True, None, 'aulas2010'),
            ('Patio central', [(41, 23), (45.4, 23), (45.4, 17.6), (69, 17.6), (69, 20.4), (75.6, 20.4), (75.6, 23.2), (77.4, 23.2),
                               (77.4, 32.5), (49, 32.5), (49, 45.2), (41, 45.2)], True, 'aulas2010'),
            # notas del plano: «FUENTE EXISTENTE - A DEMOLER», y canchas con «pav. césped sintético» (capa aparte)
            ('Fuente', [(36.8, 26.6), (41, 26.6), (41, 29.2), (36.8, 29.2)], True),
            ('Cancha de césped sintético (fútbol y básquetbol)', [(96.7, 57.7), (104.5, 57.7), (104.5, 67.4), (96.7, 67.4)], True),
            ('Patio este', [(77.6, 23.2), (102, 23.2), (103, 28), (100, 33), (96, 41.5), (82, 41.5), (79.5, 33), (77.6, 30)], True),
            ('Pasaje entre edificios', [(52.3, 8.3), (58.3, 8.3), (58.3, 17.4), (52.3, 17.4)], True),
            ('Cancha de fútbol', [(16.2, 31.1), (35.9, 31.1), (35.9, 41.8), (16.2, 41.8)], True),
            ('Explanada de hormigón', [(7, 4), (19.6, 4), (19.6, 29.3), (7, 29.3)], True),
            ('Patio abierto (frente de la casona)', [(39.5, 61.4), (77, 61.4), (77, 64.5), (39.5, 64.5)], True),
            # parque del frente: lo que queda afuera de los edificios, entre la casona, el patio este y la reja
            ('Patio exterior arbolado', [(73.6, 32.6), (77.4, 32.6), (79.5, 33), (82, 41.5), (96, 41.5), (100, 33), (103, 28), (106.1, 28),
                                         (107.1, 40.5), (104, 44), (103.8, 48.5), (104.2, 49.8), (98.5, 51.2), (98.3, 57.5), (92.6, 57.5),
                                         (92.6, 55), (81, 55), (81, 60.5), (73.6, 60.5), (73.6, 54), (75.7, 54), (75.7, 41), (73.6, 41)], True),
            ('Jardín junto a la cancha', [(19.8, 23.8), (40.8, 23.8), (40.8, 30.8), (19.8, 30.8)], True),
            # lo que hay hoy donde va el edificio nuevo: solo se muestra si ese edificio está oculto.
            # Contorno aproximado a partir de la nota del plano (área deportiva techada, 449 m2).
            ('Cancha techada', [(14.5, 45.8), (39.2, 45.8), (39.2, 64), (14.5, 64)], True, 'fondo'),
            ('Juegos infantiles', [(81, 55.3), (91.5, 55.3), (91.5, 65.8), (81, 65.8)], True),
        ],
        'renombrar': [((80, 16.3), 'Hall aulas 1 a 6')],
    },
    'p1': {
        'quitar': [(24.6, 45.6, 39.3, 51.8), (71.5, 3.5, 96.5, 7.2)],          # vacío sobre el Hall 1 y retiro del fondo
        'renombrar': [((33, 54), 'Antesala aulas 18 a 20'), ((20, 54.5), 'Pasillo aulas 12 a 17'), ((75, 15.5), 'Hall aulas 28 a 39'),
                      ((40, 13.5), 'Hall aulas 40 a 43'), ((32.5, 15), 'Hall escalera aulas 44 a 47'), ((69, 46), 'Terraza de la casona')],
    },
    'p2': {
        'quitar': [(10, 45.9, 39.3, 64)],
        'agregar': [('Gimnasio', [(10.1, 46), (39.2, 46), (39.2, 63.9), (10.1, 63.9)], False)],
        'renombrar': [((80, 15.7), 'Hall aulas 54 a 59'), ((24, 38.3), 'Gradas del gimnasio'), ((24, 41), 'Pasillo de vestuarios')],
    },
}

NOTA = re.compile(r'CONSTRUIR|DEMOLER|DESMONTAR|AÑO 20|PORTON|TANQUES|DOBLE ALTURA|a reparar|contrapiso|damero|a plantar|FUENTE|sintético|proyección|TECHO LIVIANO|CUBIERTA LIVIANA|AZOTEA|GRADAS|basketball|AREA DEPORTIVA|PEATONAL|VEHICULAR|HABILITADAS|pedregullo|EXPLANADA|Tejido|Medianera|CERCO', re.I)
LOCAL = re.compile(r'^(KITCHENETTE|REUNI[OÓ]N|AULA|SS\.?HH|OFICINA|HALL|LABORATORIO|ADMINISTRACI|COCINA|COMEDOR|SAL[OÓ]N|SALA|AUDITORIO|DEP[OÓ]SITO|RECEPCI|DIRECCI|VESTUARIO|PORTER|BIBLIOTECA|GALER|PATIO|AREA DEPORTIVA|CANCHA|AZOTEA|EXPLANADA|GIMNASIO|ENFERMER|SECRETAR|TALLER|CANTINA|CAPILLA|SUM\b)', re.I)
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
datos = {}
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
    # líneas larguísimas en la capa de muros son retiros/ejes, no paredes
    largo = lambda s: math.hypot(s[2]-s[0], s[3]-s[1])
    S['d'] += [s for s in S['m'] if largo(s) > 45]
    S['m'] = [s for s in S['m'] if largo(s) <= 45]
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
    # Aberturas que cuentan como cerramiento: las piezas chicas pegadas a un muro (puertas, ventanas)
    # y, de las piezas grandes, solo lo que está a menos de 3 m de un muro (frentes vidriados entre
    # columnas). Así no entran las grillas de piso ni los linderos, que comparten capa.
    toca = np.zeros(na, bool); chica = np.zeros(na, bool)
    for i in np.unique(la[(cerca > 0) & (ab > 0)]):
        if i: toca[i] = True; chica[i] = max(sa[i, 2], sa[i, 3])*RES < 7.5
    lejos = cv2.distanceTransform((img == 0).astype(np.uint8), cv2.DIST_L2, 3)*RES
    ab_ok = chica[la] | (toca[la] & (lejos < 3.0))
    img |= (ab_ok*255).astype(np.uint8)
    pu = [(h, math.hypot(a[0]-h[0], a[1]-h[1]), a, b) for h, a, b in puertas if ax <= h[0] <= bx and ay <= h[1] <= by]
    for h, r, a, b in pu:
        cv2.line(img, px(*h), px(*a), 255, 2); cv2.line(img, px(*h), px(*b), 255, 2)
    # puertas dibujadas en capas de detalle: valen si la bisagra está pegada a un muro y no repiten una ya detectada
    puertas_extra = []
    for h, a_, b_ in puertas_d:
        if not (ax <= h[0] <= bx and ay <= h[1] <= by): continue
        qx, qy = px(*h)
        if not (0 <= qx < iw and 0 <= qy < ih and cerca[qy, qx]): continue
        if any(math.hypot(h[0]-g[0][0], h[1]-g[0][1]) < 0.5 for g in pu): continue
        q = [cm(tx(h[0])), cm(ty(h[1])), cm(math.hypot(a_[0]-h[0], a_[1]-h[1]))]
        if not any(abs(q[0]-e[0]) < 30 and abs(q[1]-e[1]) < 30 for e in puertas_extra): puertas_extra.append(q)
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

    # Respaldo para locales con rótulo que la partición no logra cerrar: buscar sus cuatro muros.
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
    # Partición completa de la planta en ambientes (segmentación por transformada de distancia):
    # cada ambiente es una "cuenca" del espacio libre y los pasos angostos (puertas, vanos)
    # son las divisorias. Dos cuencas unidas por un paso casi tan ancho como ellas son el mismo ambiente.
    libre = (img == 0)
    dist = cv2.distanceTransform(libre.astype(np.uint8), cv2.DIST_L2, 5)*RES
    dsu = cv2.GaussianBlur(dist, (0, 0), 1.5)
    _, marc = cv2.connectedComponents((h_maxima(dsu, H_MAX) > 0).astype(np.uint8))
    lab = watershed(-dsu, marc, mask=libre)
    nl = int(lab.max())+1
    pico = np.zeros(nl); np.maximum.at(pico, lab.ravel(), dist.ravel())
    pares = {}
    for A_, B_, DA, DB in ((lab[:, :-1], lab[:, 1:], dist[:, :-1], dist[:, 1:]), (lab[:-1, :], lab[1:, :], dist[:-1, :], dist[1:, :])):
        m = (A_ != B_) & (A_ > 0) & (B_ > 0)
        a_, b_ = np.minimum(A_[m], B_[m]), np.maximum(A_[m], B_[m]); v = np.minimum(DA[m], DB[m])
        clave = a_.astype(np.int64)*nl+b_
        o = np.argsort(clave); clave, v = clave[o], v[o]
        if len(clave):
            ini = np.r_[0, np.flatnonzero(np.diff(clave))+1]
            for k_, mx_ in zip(clave[ini], np.maximum.reduceat(v, ini)): pares[int(k_)] = max(pares.get(int(k_), 0), float(mx_))
    padre = list(range(nl))
    def raiz(i):
        while padre[i] != i: padre[i] = padre[padre[i]]; i = padre[i]
        return i
    for k_, silla in sorted(pares.items(), key=lambda t: -t[1]):
        ra, rb = raiz(k_//nl), raiz(k_ % nl)
        if ra != rb and silla >= FUSION*min(pico[ra], pico[rb]):
            padre[rb] = ra; pico[ra] = max(pico[ra], pico[rb])
    lab = np.array([raiz(i) for i in range(nl)])[lab]
    borde = set(np.unique(np.r_[lab[:3].ravel(), lab[-3:].ravel(), lab[:, :3].ravel(), lab[:, -3:].ravel()]))
    def contorno(x0, y0, reg):
        cs, _ = cv2.findContours(reg, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not cs: return None
        c = cv2.approxPolyDP(max(cs, key=cv2.contourArea), 2.2, True).reshape(-1, 2)
        if len(c) < 3: return None
        return [[cm((p[0]+x0)*RES), cm((p[1]+y0)*RES)] for p in c]
    muro_cerca = cv2.dilate(img, np.ones((5, 5), np.uint8)) > 0
    def dentro_e_prev(x0, y0, x1, y1, reg):
        return any(y0 <= int(e[1]/RES) < y1 and x0 <= int(e[0]/RES) < x1 and reg[int(e[1]/RES)-y0, int(e[0]/RES)-x0] and not e[2].startswith(('SS.HH', 'Cancha', 'Patio', 'Explanada')) for e in etiquetas) and reg.sum()*RES*RES < 450
    locales = []; usados = {}
    ocup = np.zeros((ih, iw), bool)
    objs = ndimage.find_objects(lab)
    for i, sl in enumerate(objs, start=1):
        if sl is None or i in borde: continue
        y0, x0 = max(0, sl[0].start-3), max(0, sl[1].start-3); y1, x1 = min(ih, sl[0].stop+3), min(iw, sl[1].stop+3)
        reg = (lab[y0:y1, x0:x1] == i).astype(np.uint8)
        area = float(reg.sum())*RES*RES
        if area < 2.5: continue
        anillo = (cv2.dilate(reg, np.ones((3, 3), np.uint8)) > 0) & (reg == 0)
        cerrado = float(muro_cerca[y0:y1, x0:x1][anillo].mean()) if anillo.any() else 0     # parte del borde que es muro
        ext = cerrado < 0.5 or area > 450
        if ext and not dentro_e_prev(x0, y0, x1, y1, reg): continue       # afuera: solo si tiene rótulo (azoteas, galerías)
        reg2 = cv2.dilate(reg, np.ones((3, 3), np.uint8))
        poly = contorno(x0, y0, reg2)
        if not poly: continue
        dentro_e = [e for e in etiquetas if id(e) not in usados and y0 <= int(e[1]/RES) < y1 and x0 <= int(e[0]/RES) < x1
                    and reg2[max(0, int(e[1]/RES)-y0-6):int(e[1]/RES)-y0+7, max(0, int(e[0]/RES)-x0-6):int(e[0]/RES)-x0+7].any()]
        mo = cv2.moments(reg); cx_, cy_ = x0+mo['m10']/mo['m00'], y0+mo['m01']/mo['m00']
        dentro_e = [e for e in dentro_e if not ((e[2].startswith('SS.HH') and area > 22) or (e[2].startswith('Dep') and area > 60))]       # un baño no le da nombre a un hall
        dentro_e.sort(key=lambda e: (e[2].startswith('SS.HH') and area > 15, math.hypot(e[0]/RES-cx_, e[1]/RES-cy_)))
        for e in dentro_e: usados[id(e)] = 1
        nom = dentro_e[0][2]+(' '+dentro_e[0][3] if dentro_e[0][3] else '') if dentro_e else None
        ancho = 2*float(dist[y0:y1, x0:x1][reg > 0].max())
        # punto interior para el rótulo: el más alejado de los bordes
        dd = cv2.distanceTransform(reg, cv2.DIST_L2, 3); py_, px_ = np.unravel_index(int(dd.argmax()), dd.shape)
        l = {'nombre': nom, 'area': round(area, 1), 'poly': poly, 'cx': cm((x0+px_)*RES), 'cy': cm((y0+py_)*RES), 'ancho': round(ancho, 1)}
        if ext: l['exterior'] = True
        locales.append(l)
        ocup[y0:y1, x0:x1] |= reg > 0
    for e in etiquetas:
        if id(e) in usados or e[2].startswith('SS.HH'): continue
        r = ajustar(int(e[0]/RES), int(e[1]/RES))
        if not r: continue
        x0, y0, reg = r; area = float(reg.sum())*RES*RES
        zona = ocup[y0:y0+reg.shape[0], x0:x0+reg.shape[1]]
        if area < 4 or area > 300 or area < 0.6*reg.shape[0]*reg.shape[1]*RES*RES or (zona & (reg > 0)).sum() > 0.25*reg.sum(): continue
        poly = contorno(x0, y0, reg)
        if not poly: continue
        zona |= reg > 0; usados[id(e)] = 1
        dd = cv2.distanceTransform(reg, cv2.DIST_L2, 3); py_, px_ = np.unravel_index(int(dd.argmax()), dd.shape)
        locales.append({'nombre': e[2]+(' '+e[3] if e[3] else ''), 'area': round(area, 1), 'poly': poly, 'cx': cm((x0+px_)*RES), 'cy': cm((y0+py_)*RES), 'ancho': round(2*float(dd.max())*RES, 1)})
    # ambientes sin rótulo en el plano: se nombran por su forma
    cta = {}
    for l in sorted(locales, key=lambda l: (l['cy'], l['cx'])):
        if l['nombre']: continue
        esb = l['area']/max(0.5, l['ancho'])**2
        tipo = 'Exterior' if l.get('exterior') else 'Pasillo' if esb > 3.5 else 'Hall' if l['area'] >= 25 else 'Ambiente'
        cta[tipo] = cta.get(tipo, 0)+1; l['nombre'] = f'{tipo} {cta[tipo]}'; l['auto'] = True

    cur = CURADO.get(nid, {})
    en = lambda l, r: r[0] <= l['cx']/100 <= r[2] and r[1] <= l['cy']/100 <= r[3]
    edif = [r for e in EDIFICIOS for r in rects_de(e, nid)] if nid != 'ss' else [(0, 0, 999, 999)]
    locales = [l for l in locales if not any(en(l, r) for r in cur.get('quitar', []))
               and (not l.get('auto') or any(en(l, r) for r in edif))]
    for (qx, qy), nom in cur.get('renombrar', []):
        for l in locales:
            if cv2.pointPolygonTest(np.array(l['poly'], np.float32), (qx*100, qy*100), False) >= 0:
                l['nombre'] = nom; l.pop('auto', None); break
        else: print('  OJO: no hay ambiente en', (qx, qy), 'para', nom)
    for nom, pts, ext, *sin in cur.get('agregar', []):
        pg = np.array(pts, float); xs, ys = pg[:, 0], pg[:, 1]
        ar = abs(float(np.dot(xs, np.roll(ys, -1))-np.dot(ys, np.roll(xs, -1))))/2
        # punto del rótulo: el más alejado de los bordes (el promedio puede caer fuera en formas con entrantes)
        mk = np.zeros((int((ys.max()-ys.min())/0.2)+3, int((xs.max()-xs.min())/0.2)+3), np.uint8)
        cv2.fillPoly(mk, [np.c_[(xs-xs.min())/0.2+1, (ys-ys.min())/0.2+1].astype(np.int32)], 1)
        dd = cv2.distanceTransform(mk, cv2.DIST_L2, 3); qy, qx = np.unravel_index(int(dd.argmax()), dd.shape)
        l = {'nombre': nom, 'area': round(ar, 1), 'poly': [[cm(x), cm(y)] for x, y in pts], 'cx': cm(xs.min()+(qx-1)*0.2), 'cy': cm(ys.min()+(qy-1)*0.2)}
        if ext: l['exterior'] = True; l['edif'] = 255        # los patios trazados no son de ningún edificio
        if sin and sin[0]: l['sin'] = sin[0]             # solo si ese edificio está oculto
        if len(sin) > 1: l['con'] = sin[1]              # solo si ese edificio está visible
        locales.append(l)
    # nombres repetidos: se distinguen con una letra
    cuenta = {}
    for l in locales:
        if l['nombre'] and not l.get('sin') and not l.get('con'): cuenta[l['nombre']] = cuenta.get(l['nombre'], 0)+1
    visto = {}
    for l in sorted(locales, key=lambda l: (l['cy'], l['cx'])):
        n = l['nombre']
        if n and cuenta.get(n, 0) > 1 and not l.get('sin') and not l.get('con'):
            visto[n] = visto.get(n, 0)+1; l['nombre'] = f"{n} ({'abcdefghijklmnop'[visto[n]-1]})"
    locales.sort(key=lambda l: (l['nombre'] is None, l['nombre'] or '', l['cy'], l['cx']))
    k = 0; ids = set()
    for l in locales:
        # id estable a partir del nombre, para que las muestras guardadas sigan valiendo si se regenera el plano
        base = nid+'-'+re.sub(r'[^a-z0-9]+', '-', unicodedata.normalize('NFD', l['nombre'].lower()).encode('ascii', 'ignore').decode()).strip('-')
        i2 = base; n2 = 2
        while i2 in ids: i2 = f'{base}-{n2}'; n2 += 1
        ids.add(i2); l['id'] = i2
    # siluetas de los edificios (para el mapa del folleto)
    R3 = 0.1; hm_ = np.zeros((int(H/R3)+2, int(W/R3)+2), np.uint8)
    for l in locales:
        if not l.get('exterior'): cv2.fillPoly(hm_, [(np.array(l['poly'])/100/R3).astype(np.int32)], 255)
    hm_ = cv2.morphologyEx(cv2.dilate(hm_, np.ones((7, 7), np.uint8)), cv2.MORPH_CLOSE, np.ones((21, 21), np.uint8))
    hm_ = cv2.morphologyEx(hm_, cv2.MORPH_OPEN, np.ones((15, 15), np.uint8))
    huellas = []
    for c in cv2.findContours(hm_, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)[0]:
        if cv2.contourArea(c)*R3*R3 < 25: continue
        c = cv2.approxPolyDP(c, 2.5, True).reshape(-1, 2)
        if len(c) >= 3: huellas.append([[cm(p[0]*R3), cm(p[1]*R3)] for p in c])
    arboles = [[cm(x), cm(y), cm(r)] for x, y, r in ARBOLES] if nid == 'pb' else []
    data = {
        'id': nid, 'nombre': nombre, 'ancho': cm(W), 'alto': cm(H),
        'muros': pack(S['m']), 'aberturas': pack(S['a']), 'barreras': pack(barreras), 'detalle': pack(S['d'], 0.12),
        'etiquetas': [{'x': cm(e[0]), 'y': cm(e[1]), 't': e[2]+(' '+e[3] if e[3] else '')} for e in etiquetas],
        'locales': locales, 'huellas': huellas, 'arboles': arboles,
        # puertas: bisagra y radio de la hoja (para no poner nada delante)
        'puertas': [[cm(tx(h[0])), cm(ty(h[1])), cm(r)] for h, r, _, _ in pu]+puertas_extra,
        'notas': [{'x': cm(x), 'y': cm(y), 't': t} for x, y, h, t in T if NOTA.search(t) and 0 < x < W and 0 < y < H],
    }
    if nid != 'ss':
        def ed(seg):
            a = np.array(seg, float).reshape(-1, 4)/100
            return [edif_en((q[0]+q[2])/2, (q[1]+q[3])/2, nid) for q in a]
        data['edif'] = {k: ed(data[k]) for k in ('muros', 'aberturas', 'barreras', 'detalle')}
        data['edif']['puertas'] = [edif_en(x/100, y/100, nid) for x, y, r in data['puertas']]
        for l in locales:
            if 'edif' not in l: l['edif'] = edif_en(l['cx']/100, l['cy']/100, nid)
        h_manual = {}
        for ie, e in enumerate(EDIFICIOS):
            if nid in e.get('manual', {}):
                nom, pts = e['manual'][nid]; pc = [[cm(x), cm(y)] for x, y in pts]
                pg = np.array(pts, float); ar = abs(float(np.dot(pg[:, 0], np.roll(pg[:, 1], -1))-np.dot(pg[:, 1], np.roll(pg[:, 0], -1))))/2
                for i in range(len(pc)):
                    data['muros'] += pc[i]+pc[(i+1) % len(pc)]; data['edif']['muros'].append(ie)
                huellas.append(pc); h_manual[len(huellas)-1] = ie
                locales.append({'nombre': nom, 'area': round(ar, 1), 'poly': pc, 'cx': cm(pg[:, 0].mean()-3), 'cy': cm(pg[:, 1].mean()-1.5), 'edif': ie,
                                'id': nid+'-'+e['id']})
        data['huellasEdif'] = [h_manual.get(k, edif_en(float(np.mean([p[0] for p in h]))/100, float(np.mean([p[1] for p in h]))/100, nid)) for k, h in enumerate(huellas)]
    datos[nid] = data
    indice.append({'id': nid, 'nombre': nombre, 'archivo': nid+'.json', 'ancho': cm(W), 'alto': cm(H)})
    print(nid, f'{W:.1f}x{H:.1f} m', 'muros', len(data['muros'])//4, 'abert', len(data['aberturas'])//4, 'det', len(data['detalle'])//4,
          'etiquetas', len(etiquetas), 'locales', len(locales), 'con nombre', sum(1 for l in locales if not l.get('auto')))
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
# --- alturas para el estudio de sol y sombras ---
# Los niveles se dibujaron en láminas separadas: se calcula el desfasaje de cada uno respecto de
# planta baja comparando los dibujos, y con eso cuántos pisos hay encima de cada tramo de muro.
R2 = 0.2
def trama(d, claves=('muros', 'aberturas')):
    im = np.zeros((int(d['alto']/100/R2)+2, int(d['ancho']/100/R2)+2), np.uint8)
    for k in claves:
        for x1, y1, x2, y2 in np.array(d[k]).reshape(-1, 4): cv2.line(im, (int(x1/100/R2), int(y1/100/R2)), (int(x2/100/R2), int(y2/100/R2)), 255, 1)
    return cv2.GaussianBlur(im, (0, 0), 1.5)
def huella(d):
    im = np.zeros((int(d['alto']/100/R2)+2, int(d['ancho']/100/R2)+2), np.uint8)
    for l in d['locales']:
        if not l.get('exterior'): cv2.fillPoly(im, [(np.array(l['poly'])/100/R2).astype(np.int32)], 255)
    im = cv2.dilate(im, np.ones((7, 7), np.uint8))
    return cv2.morphologyEx(im, cv2.MORPH_CLOSE, np.ones((25, 25), np.uint8))
orden = [n for n in ('pb', 'p1', 'p2') if n in datos]
base = trama(datos['pb']); mg = int(6/R2); desf = {'pb': (0.0, 0.0)}
for n in orden[1:]:
    t = trama(datos[n])[mg:-mg, mg:-mg]
    lienzo = cv2.copyMakeBorder(base, mg, mg, mg, mg, cv2.BORDER_CONSTANT, value=0)
    if lienzo.shape[0] < t.shape[0]+1 or lienzo.shape[1] < t.shape[1]+1:
        lienzo = cv2.copyMakeBorder(lienzo, 0, max(0, t.shape[0]+1-lienzo.shape[0]), 0, max(0, t.shape[1]+1-lienzo.shape[1]), cv2.BORDER_CONSTANT, value=0)
    r = cv2.matchTemplate(lienzo, t, cv2.TM_CCORR_NORMED); _, v, _, loc = cv2.minMaxLoc(r)
    desf[n] = ((loc[0]-2*mg)*R2, (loc[1]-2*mg)*R2)       # nivel + desfasaje = planta baja
    print('desfasaje', n, desf[n], 'coincidencia', round(float(v), 3))
huellas = {n: huella(datos[n]) for n in orden}
for nid, d in datos.items():
    M_ = np.array(d['muros']).reshape(-1, 4)/100
    pisos = np.ones(len(M_), np.uint8)
    if nid in orden:
        for sup in orden[orden.index(nid)+1:]:
            h = huellas[sup]; ox, oy = desf[nid][0]-desf[sup][0], desf[nid][1]-desf[sup][1]
            mx = ((M_[:, 0]+M_[:, 2])/2+ox)/R2; my = ((M_[:, 1]+M_[:, 3])/2+oy)/R2
            ok = (mx >= 0) & (my >= 0) & (mx < h.shape[1]) & (my < h.shape[0])
            pisos[ok] += (h[my[ok].astype(int), mx[ok].astype(int)] > 0).astype(np.uint8)
    d['pisos'] = pisos.tolist()
    print(nid, 'muros por cantidad de pisos encima:', np.bincount(pisos).tolist()[1:])
    json.dump(d, open(os.path.join(OUT, nid+'.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
# Norte: el símbolo del plano apunta a 215,5° (antihorario desde +X del dibujo); en pantalla,
# con Y hacia abajo, son 234,5° en sentido horario desde "arriba".
json.dump({'edificios': [{'id': e['id'], 'nombre': e['nombre'], 'proyecto': bool(e.get('proyecto')), 'demoler': bool(e.get('demoler'))} for e in EDIFICIOS], 'predio': [[500, 380], [10410, 380], [10920, 6880], [750, 6880]], 'calle': 'Av. Millán', 'norte': 234.5, 'lat': -34.86, 'lon': -56.19, 'huso': -3, 'niveles': indice}, open(os.path.join(OUT, 'niveles.json'), 'w'), ensure_ascii=False, indent=1)
