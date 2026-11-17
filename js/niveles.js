// Carga de los planos por nivel (generados con tools/convertir_plano.py) y geometría compartida.

const cache = new Map();
/** Ubicación y orientación del predio (para el estudio de sol). */
export const geo = {};

export async function cargarIndice() {
  const r = await fetch('data/niveles.json');
  if (!r.ok) throw new Error('No se pudo leer data/niveles.json');
  const j = await r.json(); Object.assign(geo, { lat: j.lat, lon: j.lon, huso: j.huso, norte: j.norte, edificios: j.edificios || [], calle: j.calle, predio: (j.predio || []).map(p => [p[0] / 100, p[1] / 100]) });
  return j.niveles;
}

function aMetros(lista) {
  const a = new Float32Array(lista.length);
  for (let i = 0; i < lista.length; i++) a[i] = lista[i] / 100;
  return a;
}
function aPath(seg) {
  const p = new Path2D();
  for (let i = 0; i < seg.length; i += 4) { p.moveTo(seg[i], seg[i + 1]); p.lineTo(seg[i + 2], seg[i + 3]); }
  return p;
}

export async function cargarNivel(info) {
  if (cache.has(info.id)) return cache.get(info.id);
  const r = await fetch('data/' + info.archivo);
  if (!r.ok) throw new Error('No se pudo leer el plano de ' + info.nombre);
  const d = await r.json();
  const n = {
    id: d.id, nombre: d.nombre, ancho: d.ancho / 100, alto: d.alto / 100,
    muros: aMetros(d.muros), aberturas: aMetros(d.aberturas), barreras: aMetros(d.barreras || []), pisos: d.pisos || null,
    notas: (d.notas || []).map(q => ({ x: q.x / 100, y: q.y / 100, t: q.t })),
    edif: d.edif || null, huellasEdif: d.huellasEdif || [],
    huellas: (d.huellas || []).map(h => h.map(p => [p[0] / 100, p[1] / 100])), arboles: (d.arboles || []).map(a => a.map(v => v / 100)), detalle: aMetros(d.detalle),
    locales: d.locales.map(l => ({
      id: l.id, nombre: l.nombre, auto: !!l.auto, exterior: !!l.exterior, edif: l.edif ?? 255, sin: l.sin || null, con: l.con || null, area: l.area,
      poly: l.poly.map(p => [p[0] / 100, p[1] / 100]),
    })),
  };
  n.paths = { muros: aPath(n.muros), aberturas: aPath(n.aberturas), detalle: aPath(n.detalle) };
  // punto del rótulo: viene calculado en los datos (el más alejado de los bordes); si falta, el centroide
  n.locales.forEach((l, i) => { const o = d.locales[i]; if (o.cx != null) { l.cx = o.cx / 100; l.cy = o.cy / 100; } else [l.cx, l.cy] = centroide(l.poly); });
  cache.set(info.id, n);
  return n;
}

/** Ids de los edificios que no se muestran en esta muestra. Por defecto, los que todavía son proyecto. */
export const edificiosOcultos = proy => proy.edificiosOcultos ?? geo.edificios.filter(e => e.proyecto).map(e => e.id);

const filtrados = new Map();
/**
 * Devuelve el nivel sin los edificios ocultos: mismos campos, pero sin sus muros, aberturas, detalle,
 * ambientes ni silueta. Todo el sistema (planta, 3D, circulación, sol, folleto, PDF) trabaja sobre esto.
 */
export function nivelVisible(n, proy) {
  const ids = edificiosOcultos(proy), oc = new Set(ids.map(id => geo.edificios.findIndex(e => e.id === id)).filter(i => i >= 0));
  const clave = n.id + '|' + [...oc].sort().join();
  if (filtrados.has(clave)) return filtrados.get(clave);
  const extra = l => (!l.sin || ids.includes(l.sin)) && (!l.con || !ids.includes(l.con));          // p. ej. la cancha techada actual, si se oculta el edificio nuevo
  let f;
  if (!oc.size || !n.edif) f = { ...n, locales: n.locales.filter(extra) };
  else {
    const cortar = k => { const S = n[k], E = n.edif[k], o = []; for (let i = 0, j = 0; i < S.length; i += 4, j++) if (!oc.has(E[j])) o.push(S[i], S[i + 1], S[i + 2], S[i + 3]); return new Float32Array(o); };
    f = { ...n, muros: cortar('muros'), aberturas: cortar('aberturas'), barreras: cortar('barreras'), detalle: cortar('detalle'),
      pisos: n.pisos ? n.pisos.filter((_, j) => !oc.has(n.edif.muros[j])) : null,
      locales: n.locales.filter(l => !oc.has(l.edif) && extra(l)), huellas: n.huellas.filter((_, i) => !oc.has(n.huellasEdif[i])) };
    f.paths = { muros: aPath(f.muros), aberturas: aPath(f.aberturas), detalle: aPath(f.detalle) };
  }
  filtrados.set(clave, f); return f;
}

/** Espacios disponibles en un nivel: los detectados del plano + los dibujados por el usuario. */
export function espaciosDe(nivel, proy) {
  const propios = proy.propios.filter(e => e.nivel === nivel.id).map(e => {
    const [cx, cy] = centroide(e.poly);
    return { id: e.id, nombre: e.nombre, poly: e.poly, area: Math.round(areaPoly(e.poly) * 10) / 10, cx, cy, propio: true };
  });
  const formas = proy.formas || {}, ocultos = proy.ocultos || [];
  const delPlano = nivel.locales.filter(l => !ocultos.includes(l.id)).map(l => {
    const e = { ...l, nombre: proy.renombres[l.id] || l.nombre }, poly = formas[l.id];
    if (poly) { [e.cx, e.cy] = centroide(poly); e.poly = poly; e.area = Math.round(areaPoly(poly) * 10) / 10; e.editado = true; }
    return e;
  });
  return [...propios, ...delPlano];
}
export const espaciosElegidos = (nivel, proy) => espaciosDe(nivel, proy).filter(e => proy.espacios.includes(e.id));

export function areaPoly(p) {
  let a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += p[j][0] * p[i][1] - p[i][0] * p[j][1];
  return Math.abs(a) / 2;
}
export function centroide(p) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const f = p[j][0] * p[i][1] - p[i][0] * p[j][1];
    a += f; cx += (p[j][0] + p[i][0]) * f; cy += (p[j][1] + p[i][1]) * f;
  }
  if (Math.abs(a) < 1e-9) return p[0];
  return [cx / (3 * a), cy / (3 * a)];
}
export function puntoEnPoly(x, y, p) {
  let d = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    if ((p[i][1] > y) !== (p[j][1] > y) && x < (p[j][0] - p[i][0]) * (y - p[i][1]) / (p[j][1] - p[i][1]) + p[i][0]) d = !d;
  }
  return d;
}

/** Esquinas de un elemento rotado, en metros. */
export function esquinas(it) {
  const a = it.rot * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), w = it.w / 2, d = it.d / 2;
  return [[-w, -d], [w, -d], [w, d], [-w, d]].map(([x, y]) => [it.x + x * c - y * s, it.y + x * s + y * c]);
}
export function aLocal(it, x, y) {
  const a = -it.rot * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), dx = x - it.x, dy = y - it.y;
  return [dx * c - dy * s, dx * s + dy * c];
}
const SEP_EST = 0.5, PEGADO = 0.27;            // separación entre estudiantes y distancia al borde de la mesa (m)
/**
 * Lugares (en coordenadas del mueble) de `n` estudiantes pegados a las caras de una mesa: primero la cara
 * de atrás, después los dos laterales y, si no alcanzan, la cara del frente. En un stand van adentro,
 * contra el panel del fondo y los laterales. `lado` dice en qué cara quedó cada uno.
 */
export function carasEstudiantes(w, d, n, stand = false) {
  const r = [], fila = (cant, f) => { for (let k = 0; k < cant && r.length < n; k++) r.push(f((k - (cant - 1) / 2) * SEP_EST)); };
  const capW = Math.max(1, Math.floor((stand ? w - 0.5 : w + 0.1) / SEP_EST)), capD = Math.max(1, Math.floor((stand ? d - 0.9 : d + 0.1) / SEP_EST));
  const q = stand ? -0.33 : PEGADO;                 // el stand los tiene adentro; la mesa, afuera pegados al borde
  for (let vuelta = 0; r.length < n && vuelta < 6; vuelta++) {
    const e = q + (stand ? -1 : 1) * vuelta * SEP_EST, falta = () => n - r.length;
    fila(Math.min(capW, falta()), x => [x, -d / 2 - e, 'atras']);
    const lat = Math.min(2 * capD, falta()), izq = Math.ceil(lat / 2), der = lat - izq, cy = stand ? 0.1 : 0;
    fila(izq, y => [-w / 2 - e, y + cy, 'lado']); fila(der, y => [w / 2 + e, y + cy, 'lado']);
    if (!stand) fila(Math.min(capW, falta()), x => [x, d / 2 + e, 'frente']);
  }
  return r;
}
/** Lugar que hay que dejar libre alrededor de una mesa para sus estudiantes. */
export function margenEstudiantes(w, d, n, stand = false) {
  if (stand || n <= 0) return { atras: 0, lados: 0, frente: 0 };
  const c = carasEstudiantes(w, d, n), m = k => Math.max(0, ...c.filter(p => p[2] === k).map(p => (k === 'lado' ? Math.abs(p[0]) - w / 2 : Math.abs(p[1]) - d / 2) + 0.24));
  return { atras: m('atras'), lados: m('lado'), frente: m('frente') };
}
/** Posiciones (en metros del plano) de los estudiantes de un puesto. */
export function posEstudiantes(it) {
  const n = it.estudiantes | 0; if (n <= 0) return [];
  const a = it.rot * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return carasEstudiantes(it.w, it.d, n, it.modelo === 'stand').map(([lx, ly]) => [it.x + lx * c - ly * s, it.y + lx * s + ly * c]);
}

export const esRedondo = it => it.modelo === 'mesa-redonda' || it.modelo === 'cilindro' || it.modelo === 'persona';

/** Rectángulo de trabajo: espacios elegidos + elementos del nivel; si no hay nada, el nivel entero. */
export function areaTrabajo(nivel, proy, margen = 1.5) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const suma = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  espaciosElegidos(nivel, proy).forEach(e => e.poly.forEach(p => suma(p[0], p[1])));
  proy.items.filter(i => i.nivel === nivel.id).forEach(i => esquinas(i).forEach(p => suma(p[0], p[1])));
  if (x0 === Infinity) return { x0: 0, y0: 0, x1: nivel.ancho, y1: nivel.alto, todo: true };
  return { x0: Math.max(0, x0 - margen), y0: Math.max(0, y0 - margen), x1: Math.min(nivel.ancho, x1 + margen), y1: Math.min(nivel.alto, y1 + margen) };
}

/** Parte el texto en 1 o 2 líneas y calcula el tamaño de letra (en las mismas unidades que w y d). */
export function ajustarTexto(texto, w, d, max = 0.6) {
  const K = 0.56;
  const una = Math.min(d * 0.6, w * 0.92 / (texto.length * K));
  let mejor = { lineas: [texto], tam: una };
  const esp = [...texto].map((c, i) => c === ' ' ? i : -1).filter(i => i > 0);
  if (esp.length) {
    const m = esp.reduce((a, b) => Math.abs(b - texto.length / 2) < Math.abs(a - texto.length / 2) ? b : a);
    const l = [texto.slice(0, m), texto.slice(m + 1)];
    const dos = Math.min(d * 0.38, w * 0.92 / (Math.max(l[0].length, l[1].length) * K));
    if (dos > una * 1.15) mejor = { lineas: l, tam: dos };
  }
  mejor.tam = Math.min(mejor.tam, max);
  return mejor;
}
