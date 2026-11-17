// Equipos: se cargan en texto plano y se distribuyen solos en los lugares elegidos.
// Cada equipo reserva el lugar de su mueble y de sus estudiantes; se ubican contra las paredes,
// lo más separados posible, y en islas solo si no queda pared.
import { Simulacion } from './sim.js';
import { espaciosElegidos, puntoEnPoly, margenEstudiantes } from './niveles.js';
import { itemDesdeTipo } from './estado.js';

const C = 0.2;                       // misma grilla que el simulador
const PASILLO = 1.8;                 // m libres entre islas y contra las paredes
const FRENTE = 1.0;                  // m libres delante de cada puesto

/**
 * Lee la lista de equipos. Una línea por equipo:  Nombre ; estudiantes ; lugar preferido
 * Los dos últimos datos son opcionales. Sirven como separador ; | tabulación o coma.
 * También se entiende «Robótica (4)» o «Robótica x4». Las líneas que empiezan con # se ignoran.
 */
export function leerEquipos(texto, porDefecto = 4) {
  const eq = [];
  for (let linea of String(texto || '').split(/\r?\n/)) {
    linea = linea.trim(); if (!linea || linea.startsWith('#')) continue;
    let partes = linea.split(/\s*[;|\t]\s*/);
    if (partes.length === 1 && /,\s*\d+\s*(,|$)/.test(linea)) partes = linea.split(/\s*,\s*/);
    let [nombre, n, ...resto] = partes, estudiantes = parseInt(n);
    if (partes.length === 1) { const m = linea.match(/^(.*?)\s*[(x×]\s*(\d{1,3})\s*\)?$/i); if (m) { nombre = m[1]; estudiantes = +m[2]; } }
    if (!isFinite(estudiantes)) { if (n && !resto.length) resto = [n]; estudiantes = porDefecto; }
    nombre = nombre.trim(); if (!nombre) continue;
    eq.push({ nombre, estudiantes: Math.max(0, Math.min(40, estudiantes)), lugar: resto.join(' ').trim() });
  }
  return eq;
}

const margen = (tipo, est) => margenEstudiantes(tipo.w, tipo.d, est, tipo.modelo === 'stand');
const FR = { 0: [0, 1], 90: [-1, 0], 180: [0, -1], 270: [1, 0] };          // hacia dónde mira el frente del puesto

/**
 * Distribuye los equipos en los lugares elegidos del nivel. Cada equipo reserva el lugar de su mueble más el
 * de sus estudiantes (pegados a las caras de la mesa), contra una pared y con el frente despejado.
 * Devuelve { items, sinLugar, resumen } sin modificar la muestra.
 */
export function distribuir(nivel, proy, equipos, tipo, porMesa = 0) {
  const espacios = espaciosElegidos(nivel, proy);
  if (!espacios.length) return { items: [], sinLugar: equipos, resumen: 'No hay lugares elegidos en este nivel.' };
  const base = { ...proy, items: proy.items.filter(i => !i.equipo && i.nivel === nivel.id) };      // lo ya ubicado a mano se respeta
  const xs = espacios.flatMap(e => e.poly.map(q => q[0])), ys = espacios.flatMap(e => e.poly.map(q => q[1]));
  const area = { x0: Math.max(0, Math.min(...xs) - 4), y0: Math.max(0, Math.min(...ys) - 4), x1: Math.min(nivel.ancho, Math.max(...xs) + 4), y1: Math.min(nivel.alto, Math.max(...ys) + 4) };
  const G = new Simulacion(nivel, base, {}, 1, area);
  const libre = (x, y) => { const gx = Math.floor((x - G.x0) / C), gy = Math.floor((y - G.y0) / C); return gx >= 0 && gy >= 0 && gx < G.gw && gy < G.gh && !G.bloq[gy * G.gw + gx]; };
  const dentroLibre = (r, poly, m = 0) => {
    for (let y = r.y0 - m + C / 2; y < r.y1 + m; y += C) for (let x = r.x0 - m + C / 2; x < r.x1 + m; x += C) if (!libre(x, y) || !puntoEnPoly(x, y, poly)) return false;
    return true;
  };
  const choca = (a, b, m) => a.x0 - m < b.x1 && a.x1 + m > b.x0 && a.y0 - m < b.y1 && a.y1 + m > b.y0;
  const conFrente = (r, rot, largo) => { const [fx, fy] = FR[rot]; return { x0: r.x0 + Math.min(0, fx * largo), x1: r.x1 + Math.max(0, fx * largo), y0: r.y0 + Math.min(0, fy * largo), y1: r.y1 + Math.max(0, fy * largo) }; };
  // huella reservada por un equipo: el mueble más sus estudiantes
  // los equipos grandes reciben varias mesas juntas (una cada `porMesa` estudiantes)
  const mesasDe = q => tipo.modelo === 'stand' || tipo.modelo === 'techo' || !(porMesa > 0) ? 1 : Math.max(1, Math.ceil(q.estudiantes / porMesa));
  const huellaDe = q => {
    const mesas = mesasDe(q), ancho = tipo.w * mesas, M = margenEstudiantes(ancho, tipo.d, q.estudiantes, tipo.modelo === 'stand');
    return { w: Math.round((ancho + 2 * M.lados) * 5) / 5, d: Math.round((tipo.d + M.atras + M.frente) * 5) / 5, M, mesas, ancho };
  };

  const cache = new Map();
  /** Lugares posibles para una huella w × d en un espacio: contra las paredes (en orden, dando la vuelta) y en islas. */
  function sitios(e, w, d) {
    const clave = e.id + '|' + w + '|' + d; if (cache.has(clave)) return cache.get(clave);
    const ex = e.poly.map(q => q[0]), ey = e.poly.map(q => q[1]), bx0 = Math.min(...ex), bx1 = Math.max(...ex), by0 = Math.min(...ey), by1 = Math.max(...ey);
    const rect = (cx, cy, rot) => { const g = rot % 180 === 0; return { x0: cx - (g ? w : d) / 2, x1: cx + (g ? w : d) / 2, y0: cy - (g ? d : w) / 2, y1: cy + (g ? d : w) / 2 }; };
    const per = [];
    for (const rot of [0, 270, 180, 90]) {
      const [fx, fy] = FR[rot], cand = [];
      for (let cy = by0; cy <= by1; cy += C) for (let cx = bx0; cx <= bx1; cx += C) {
        const r = rect(cx, cy, rot), hor = fx === 0, largo = hor ? r.x1 - r.x0 : r.y1 - r.y0;
        let tot = 0, pared = 0;            // la franja justo detrás tiene que ser pared o el límite del espacio
        for (let t = C / 2; t < largo; t += C) {
          const px = hor ? r.x0 + t : (fx > 0 ? r.x0 - 0.25 : r.x1 + 0.25), py = hor ? (fy > 0 ? r.y0 - 0.25 : r.y1 + 0.25) : r.y0 + t;
          tot++; if (!libre(px, py) || !puntoEnPoly(px, py, e.poly)) pared++;
        }
        if (pared < tot * 0.75 || !dentroLibre(r, e.poly) || !dentroLibre(conFrente(r, rot, FRENTE), e.poly)) continue;
        cand.push({ cx, cy, rot, r });
      }
      const along = c => (fx === 0 ? c.cx : c.cy);
      cand.sort((a, b) => along(a) - along(b));
      if (rot === 180 || rot === 90) cand.reverse();
      per.push(...cand);
    }
    const isl = [];
    for (let cy = by0; cy <= by1; cy += 0.4) for (let cx = bx0; cx <= bx1; cx += 0.4) { const r = rect(cx, cy, 0); if (dentroLibre(r, e.poly, PASILLO)) isl.push({ cx, cy, rot: 0, r, isla: true }); }
    const res = { per, isl }; cache.set(clave, res); return res;
  }
  // dos puestos enfrentados pueden compartir el pasillo, pero ninguno invade el frente del otro
  const seMolestan = (c, p, sep) => choca(c.r, p.r, sep) || choca(c.r, conFrente(p.r, p.rot, FRENTE), 0.2) || choca(conFrente(c.r, c.rot, FRENTE), p.r, 0.2);

  /** Ubica una lista de equipos en un espacio con una separación mínima entre puestos. Devuelve los que no entraron. */
  function ubicar(e, lista, sep, puestos) {
    const afuera = [];
    for (const q of [...lista].sort((a, b) => b.estudiantes - a.estudiantes)) {
      const h = huellaDe(q), S = sitios(e, h.w, h.d);
      const c = S.per.find(c => !puestos.some(p => seMolestan(c, p, sep))) || S.isl.find(c => !puestos.some(p => choca(c.r, conFrente(p.r, p.rot, p.isla ? 0 : FRENTE), PASILLO - 0.2)));
      if (c) puestos.push({ ...c, q, h, e }); else afuera.push(q);
    }
    return afuera;
  }

  // reparto entre lugares: primero los que piden uno; el resto, en proporción al perímetro de cada lugar
  const perim = espacios.map(e => e.poly.reduce((s, q, i) => s + Math.hypot(q[0] - e.poly[(i + 1) % e.poly.length][0], q[1] - e.poly[(i + 1) % e.poly.length][1]), 0));
  const asign = espacios.map(() => []), sueltos = [];
  for (const q of equipos) { const i = q.lugar ? espacios.findIndex(e => e.nombre.toLowerCase().includes(q.lugar.toLowerCase())) : -1; if (i >= 0) asign[i].push(q); else sueltos.push(q); }
  for (const q of sueltos) { let m = 0; espacios.forEach((_, i) => { if ((asign[i].length + 1) / perim[i] < (asign[m].length + 1) / perim[m]) m = i; }); asign[m].push(q); }

  const todos = []; let resto = [];
  espacios.forEach((e, i) => {
    if (!asign[i].length) return;
    // la mayor separación con la que entran todos: así quedan repartidos parejo y no amontonados
    let puestos = null;
    for (const sep of [4, 3, 2.2, 1.6, 1.1, 0.7, 0.35]) { const p = []; if (!ubicar(e, asign[i], sep, p).length) { puestos = p; break; } }
    if (!puestos) { puestos = []; resto.push(...ubicar(e, asign[i], 0.35, puestos)); }
    e._puestos = puestos; todos.push(...puestos);
  });
  // los que no entraron en su lugar prueban en los demás
  for (const e of espacios) { if (!resto.length) break; e._puestos ||= []; const antes = e._puestos.length; resto = ubicar(e, resto, 0.35, e._puestos); todos.push(...e._puestos.slice(antes)); }

  const items = todos.map(s => {
    const [fx, fy] = FR[s.rot], corr = s.h.M.atras + tipo.d / 2 - s.h.d / 2;          // el mueble dentro de su huella
    const it = itemDesdeTipo(tipo, Math.round((s.cx + fx * corr) * 100) / 100, Math.round((s.cy + fy * corr) * 100) / 100, nivel.id);
    return Object.assign(it, { rot: s.rot, etiqueta: s.q.nombre, estudiantes: s.q.estudiantes, equipo: true, w: s.h.ancho, mesas: s.h.mesas });
  });
  const islas = todos.filter(s => s.isla).length;
  const porLugar = espacios.map(e => `${e.nombre}: ${(e._puestos || []).length}`).join(' · ');
  espacios.forEach(e => { delete e._puestos; });
  return { items, sinLugar: resto,
    mesas: todos.reduce((a, s) => a + s.h.mesas, 0),
    resumen: `Cada puesto reserva el lugar de su mesa y de sus estudiantes. Quedaron contra las paredes, lo más separados posible${islas ? `, y ${islas} en el centro porque no había más pared` : ', con el centro libre para circular'}. ${porLugar}.` };
}
