// Carga de los planos por nivel (generados con tools/convertir_plano.py) y geometría compartida.

const cache = new Map();
/** Ubicación y orientación del predio (para el estudio de sol). */
export const geo = {};

export async function cargarIndice() {
  const r = await fetch('data/niveles.json');
  if (!r.ok) throw new Error('No se pudo leer data/niveles.json');
  const j = await r.json(); Object.assign(geo, { lat: j.lat, lon: j.lon, huso: j.huso, norte: j.norte });
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
    muros: aMetros(d.muros), aberturas: aMetros(d.aberturas), barreras: aMetros(d.barreras || []), pisos: d.pisos || null, detalle: aMetros(d.detalle),
    locales: d.locales.map(l => ({
      id: l.id, nombre: l.nombre, auto: !!l.auto, exterior: !!l.exterior, area: l.area,
      poly: l.poly.map(p => [p[0] / 100, p[1] / 100]),
    })),
  };
  n.paths = { muros: aPath(n.muros), aberturas: aPath(n.aberturas), detalle: aPath(n.detalle) };
  n.locales.forEach(l => { [l.cx, l.cy] = centroide(l.poly); });
  cache.set(info.id, n);
  return n;
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
