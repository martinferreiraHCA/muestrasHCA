// Equipos: se cargan en texto plano y se distribuyen solos en los lugares elegidos.
// Cada equipo reserva el lugar de su mueble y de sus estudiantes; se ubican contra las paredes,
// lo más separados posible, y en islas solo si no queda pared.
import { Simulacion } from './sim.js';
import { espaciosElegidos, puntoEnPoly, margenEstudiantes, zonasLibres, tocaZona, enPasillo } from './niveles.js';
import { itemDesdeTipo } from './estado.js';

const C = 0.2;                       // misma grilla que el simulador
const PASILLO = 1.8;                 // m libres entre islas y contra las paredes
const FRENTE = 1.0;
const COLORES_GRUPO = ['#c9a36b', '#8fb8de', '#a8d5a2', '#f2b5a0', '#d3b8e6', '#f3d98b', '#9fd6cf', '#e6a8c4'];                  // m libres delante de cada puesto

/**
 * Lee la lista de equipos. Entiende dos formatos:
 *  - Simple, una línea por equipo:  Nombre ; estudiantes ; lugar   (los dos últimos opcionales; también
 *    «Robótica (4)» o «Robótica x4»; las líneas que empiezan con # se ignoran).
 *  - Planilla pegada, con columnas  Grupo · Equipo · Integrantes · Necesidad  separadas por tabulación y
 *    títulos de sección entre medio. Los estudiantes se cuentan de los integrantes y de la necesidad se
 *    sacan los pedidos: un lugar con nombre («Mandala»), pared, lugar libre adelante, enchufe.
 */
export function leerEquipos(texto, porDefecto = 4) {
  const lineas = String(texto || '').split(/\r?\n/);
  const esFila = c => c.length >= 3 && /^\d+\s*\.?\s*[ºo°]?\s*\d*$/i.test(c[0].trim());
  if (lineas.some(l => esFila(l.split('\t')))) return leerPlanilla(lineas, esFila);
  const eq = [];
  for (let linea of lineas) {
    linea = linea.trim(); if (!linea || linea.startsWith('#')) continue;
    let partes = linea.split(/\s*[;|\t]\s*/);
    if (partes.length === 1 && /,\s*\d+\s*(,|$)/.test(linea)) partes = linea.split(/\s*,\s*/);
    let [nombre, n, ...resto] = partes, estudiantes = parseInt(n);
    if (partes.length === 1) { const m = linea.match(/^(.*?)\s*[(x×]\s*(\d{1,3})\s*\)?$/i); if (m) { nombre = m[1]; estudiantes = +m[2]; } }
    if (!isFinite(estudiantes)) { if (n && !resto.length) resto = [n]; estudiantes = porDefecto; }
    nombre = nombre.trim(); if (!nombre) continue;
    const pedido = resto.join(' ').trim();
    eq.push({ nombre, estudiantes: Math.max(0, Math.min(40, estudiantes)), ...pedidos(pedido, pedido) });
  }
  return eq;
}
const sinAcentos = t => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
/** Interpreta el texto de la necesidad. `lugarSuelto`: texto que, si no es un pedido conocido, es el nombre de un lugar. */
function pedidos(texto, lugarSuelto = '') {
  const t = sinAcentos(texto), r = { lugar: '', necesidad: texto.trim() };
  if (/\bpared/.test(t)) r.pared = true;
  if (/libre adelante|interactiv|espacio para|juego/.test(t)) r.libre = true;
  if (/enchufe|corriente|electric/.test(t)) r.enchufe = true;
  const m = t.match(/mandala|patio[a-z ]*|hall[a-z0-9 ]*|salon[a-z0-9 ]*|aula \d+|gimnasio|auditorio|comedor|biblioteca|laboratorio|cancha[a-z ]*/);
  if (m) r.lugar = m[0].trim();
  else if (lugarSuelto && !r.pared && !r.libre && !r.enchufe && !/flexible|central|sin pedido/.test(t)) r.lugar = lugarSuelto;
  return r;
}
function leerPlanilla(lineas, esFila) {
  const eq = [], vistos = new Set(); let seccion = '';
  for (const linea of lineas) {
    const c = linea.split('\t').map(x => x.trim());
    if (!esFila(c)) { if (c.length === 1 && c[0] && !/^grupo$/i.test(c[0])) seccion = c[0]; continue; }       // título de sección
    const nombre = c[1], clave = sinAcentos(nombre); if (!nombre || vistos.has(clave)) continue; vistos.add(clave);         // si se pegó dos veces, cuenta una
    const integrantes = c[2].split(/,|\s+y\s+|\s+e\s+/i).map(x => x.trim()).filter(Boolean);
    const nec = (c[3] || '').replace(/Grupo$/, '').trim();
    eq.push({ nombre, estudiantes: Math.min(40, integrantes.length), grupo: c[0], integrantes: integrantes.join(', '), ...pedidos(nec + ' · ' + seccion), necesidad: nec, seccion });
  }
  return eq;
}

const margen = (tipo, est) => margenEstudiantes(tipo.w, tipo.d, est, tipo.modelo === 'stand');
const FR = { 0: [0, 1], 90: [-1, 0], 180: [0, -1], 270: [1, 0] };          // hacia dónde mira el frente del puesto

/**
 * Distribuye los equipos en los lugares elegidos del nivel. Cada equipo reserva el lugar de su mueble más el
 * de sus estudiantes (pegados a las caras de la mesa), contra una pared y con el frente despejado.
 * Si se pasa `simular(items) -> { r, diag }`, arma varias alternativas, las prueba con el simulador de
 * circulación, se queda con la mejor y después intenta mejorarla moviendo los puestos donde se junta gente.
 * Devuelve { items, sinLugar, resumen } sin modificar la muestra.
 */
export async function distribuir(nivel, proy, equipos, tipo, porMesa = 0, simular = null, progreso = async () => {}) {
  const espacios = espaciosElegidos(nivel, proy);
  if (!espacios.length) return { items: [], sinLugar: equipos, mesas: 0, resumen: 'No hay lugares elegidos en este nivel.' };
  const base = { ...proy, items: proy.items.filter(i => !i.equipo && i.nivel === nivel.id) };      // lo ya ubicado a mano se respeta
  const xs = espacios.flatMap(e => e.poly.map(q => q[0])), ys = espacios.flatMap(e => e.poly.map(q => q[1]));
  const area = { x0: Math.max(0, Math.min(...xs) - 4), y0: Math.max(0, Math.min(...ys) - 4), x1: Math.min(nivel.ancho, Math.max(...xs) + 4), y1: Math.min(nivel.alto, Math.max(...ys) + 4) };
  const G = new Simulacion(nivel, base, {}, 1, area);
  const libre = (x, y) => { const gx = Math.floor((x - G.x0) / C), gy = Math.floor((y - G.y0) / C); return gx >= 0 && gy >= 0 && gx < G.gw && gy < G.gh && !G.bloq[gy * G.gw + gx] && !enPasillo(base.items, x, y); };
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
    const extra = q.libre ? 2.2 : 0;                    // lugar libre delante para los puestos interactivos
    return { w: Math.round((ancho + 2 * M.lados) * 5) / 5, d: Math.round((tipo.d + M.atras + M.frente + extra) * 5) / 5, M, mesas, ancho };
  };

  // Nunca delante de una puerta, entrada o salida. Además de las puertas del plano, se buscan los vanos sin
  // puerta: tramos del borde de un salón donde no hay muro.
  const zonas = zonasLibres(nivel, base.items);
  const muroCerca = (x, y, t) => { for (let dy = -t; dy <= t + 1e-9; dy += C) for (let dx = -t; dx <= t + 1e-9; dx += C) if (!libre0(x + dx, y + dy)) return true; return false; };
  const libre0 = (x, y) => { const gx = Math.floor((x - G.x0) / C), gy = Math.floor((y - G.y0) / C); return !(gx >= 0 && gy >= 0 && gx < G.gw && gy < G.gh) || !G.bloq[gy * G.gw + gx]; };
  for (const e of espacios) {
    const tol = e.exterior || e.propio ? 0.6 : 0.4, pts = [];
    e.poly.forEach((p, i) => { const q = e.poly[(i + 1) % e.poly.length], l = Math.hypot(q[0] - p[0], q[1] - p[1]), n = Math.max(1, Math.round(l / C)); for (let k = 0; k < n; k++) { const x = p[0] + (q[0] - p[0]) * k / n, y = p[1] + (q[1] - p[1]) * k / n; pts.push([x, y, muroCerca(x, y, tol)]); } });
    const N = pts.length; if (!pts.some(p => p[2])) continue;                       // sin muros (espacio abierto): no hay vanos que cuidar
    const ini = pts.findIndex(p => p[2]);
    for (let k = 0, hueco = []; k <= N; k++) {
      const p = pts[(ini + k) % N];
      if (!p[2]) hueco.push(p);
      else { if (hueco.length * C >= 0.6 && hueco.length * C <= 3.2) for (const h of hueco) zonas.push([h[0], h[1], 1.0]); hueco = []; }
    }
  }
  const grupos = [...new Set(equipos.map(q => q.grupo).filter(Boolean))];
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
        let tot = 0, pared = 0, muro = 0;            // la franja justo detrás tiene que ser pared o el límite del espacio
        for (let t = C / 2; t < largo; t += C) {
          const px = hor ? r.x0 + t : (fx > 0 ? r.x0 - 0.25 : r.x1 + 0.25), py = hor ? (fy > 0 ? r.y0 - 0.25 : r.y1 + 0.25) : r.y0 + t;
          tot++; if (!libre(px, py)) { pared++; muro++; } else if (!puntoEnPoly(px, py, e.poly)) pared++;
        }
        if (pared < tot * 0.75 || !dentroLibre(r, e.poly) || !dentroLibre(conFrente(r, rot, FRENTE), e.poly) || tocaZona(conFrente(r, rot, FRENTE), zonas)) continue;
        cand.push({ cx, cy, rot, r, muro: muro >= tot * 0.75 });           // muro: hay una pared de verdad detrás, no solo el borde del espacio
      }
      const along = c => (fx === 0 ? c.cx : c.cy);
      cand.sort((a, b) => along(a) - along(b));
      if (rot === 180 || rot === 90) cand.reverse();
      per.push(...cand);
    }
    const isl = [];
    for (let cy = by0; cy <= by1; cy += 0.4) for (let cx = bx0; cx <= bx1; cx += 0.4) { const r = rect(cx, cy, 0); if (dentroLibre(r, e.poly, PASILLO) && !tocaZona({ x0: r.x0 - 0.6, y0: r.y0 - 0.6, x1: r.x1 + 0.6, y1: r.y1 + 0.6 }, zonas)) isl.push({ cx, cy, rot: 0, r, isla: true }); }
    const res = { per, isl }; cache.set(clave, res); return res;
  }
  // dos puestos enfrentados pueden compartir el pasillo, pero ninguno invade el frente del otro
  const seMolestan = (c, p, sep) => choca(c.r, p.r, sep) || choca(c.r, conFrente(p.r, p.rot, FRENTE), 0.2) || choca(conFrente(c.r, c.rot, FRENTE), p.r, 0.2);

  const ORDEN = { grandes: (a, b) => b.estudiantes - a.estudiantes, chicos: (a, b) => a.estudiantes - b.estudiantes, lista: () => 0 };
  /** Ubica una lista de equipos en un espacio con una separación mínima entre puestos. Devuelve los que no entraron. */
  function ubicar(e, lista, sep, puestos, v) {
    const afuera = [];
    for (const q of [...lista].sort(ORDEN[v.orden])) {
      const h = huellaDe(q), S = sitios(e, h.w, h.d), k = Math.floor(S.per.length * v.giro / 4);
      const per = k ? [...S.per.slice(k), ...S.per.slice(0, k)] : S.per;            // por qué pared se empieza
      const enPared = () => (q.pared && per.find(c => c.muro && !puestos.some(p => seMolestan(c, p, sep)))) || per.find(c => !puestos.some(p => seMolestan(c, p, sep)));
      const enIsla = () => S.isl.find(c => !puestos.some(p => choca(c.r, conFrente(p.r, p.rot, p.isla ? 0 : FRENTE), PASILLO - 0.2)));
      const c = q.pared ? enPared() : v.islas ? enIsla() || enPared() : enPared() || enIsla();        // quien pidió pared no va al centro
      if (c) puestos.push({ ...c, q, h, e }); else afuera.push(q);
    }
    return afuera;
  }
  const perim = espacios.map(e => e.poly.reduce((s, q, i) => s + Math.hypot(q[0] - e.poly[(i + 1) % e.poly.length][0], q[1] - e.poly[(i + 1) % e.poly.length][1]), 0));
  const SEPS = [4, 3, 2.2, 1.6, 1.1, 0.7, 0.35];

  /** Arma una distribución completa según la variante. */
  function armar(v) {
    // reparto entre lugares: primero los que piden uno; el resto, en proporción al perímetro (o al área) de cada lugar
    const peso = espacios.map((e, i) => v.reparto === 'area' ? e.area : perim[i]);
    const asign = espacios.map(() => []), sueltos = [];
    for (const q of equipos) { const i = q.lugar ? espacios.findIndex(e => sinAcentos(e.nombre).includes(sinAcentos(q.lugar))) : -1; if (i >= 0) asign[i].push(q); else sueltos.push(q); }
    for (const q of sueltos) { let m = 0; espacios.forEach((_, i) => { if ((asign[i].length + 1) / peso[i] < (asign[m].length + 1) / peso[m]) m = i; }); asign[m].push(q); }
    const porEsp = espacios.map(() => []); let resto = [];
    espacios.forEach((e, i) => {
      if (!asign[i].length) return;
      // la mayor separación con la que entran todos (o un escalón menos, si la variante es compacta)
      let k = SEPS.findIndex(sep => !ubicar(e, asign[i], sep, [], v).length);
      if (k < 0) k = SEPS.length - 1; else if (v.compacto) k = Math.min(SEPS.length - 1, k + 1);
      resto.push(...ubicar(e, asign[i], SEPS[k], porEsp[i], v));
    });
    espacios.forEach((e, i) => { if (resto.length) resto = ubicar(e, resto, 0.35, porEsp[i], v); });      // los que no entraron prueban en los demás
    return { puestos: porEsp.flat(), resto };
  }
  const aItems = puestos => puestos.map(s => {
    const [fx, fy] = FR[s.rot], corr = s.h.M.atras + tipo.d / 2 - s.h.d / 2;          // el mueble dentro de su huella
    const it = itemDesdeTipo(tipo, Math.round((s.cx + fx * corr) * 100) / 100, Math.round((s.cy + fy * corr) * 100) / 100, nivel.id);
    const col = s.q.grupo ? COLORES_GRUPO[(grupos.indexOf(s.q.grupo) + COLORES_GRUPO.length) % COLORES_GRUPO.length] : it.color;         // un color por grupo
    return Object.assign(it, { rot: s.rot, etiqueta: s.q.nombre, estudiantes: s.q.estudiantes, equipo: true, w: s.h.ancho, mesas: s.h.mesas, color: col,
      grupo: s.q.grupo, integrantes: s.q.integrantes, necesidad: s.q.necesidad, enchufe: s.q.enchufe });
  });
  const cerrar = (d, texto, extra = {}) => ({ items: aItems(d.puestos), sinLugar: d.resto, mesas: d.puestos.reduce((a, s) => a + s.h.mesas, 0), ...extra,
    resumen: `${texto} ${espacios.map(e => `${e.nombre}: ${d.puestos.filter(s => s.e === e).length}`).join(' · ')}.` });

  const basica = armar({ orden: 'grandes', giro: 0 });
  if (!simular) return cerrar(basica, 'Los puestos quedaron contra las paredes, lo más separados posible. No pude simular la circulación porque falta marcar la Entrada: marcala y volvé a distribuir para que elija la mejor ubicación.');

  // ---- se simula cada alternativa y se elige la que mejor circula ----
  const VARIANTES = [
    { orden: 'grandes', giro: 0 }, { orden: 'grandes', giro: 1 }, { orden: 'grandes', giro: 2 }, { orden: 'grandes', giro: 3 },
    { orden: 'chicos', giro: 0 }, { orden: 'chicos', giro: 2 }, { orden: 'lista', giro: 1 }, { orden: 'grandes', giro: 0, compacto: true },
    { orden: 'grandes', giro: 0, islas: true }, { orden: 'grandes', giro: 2, islas: true }, { orden: 'grandes', giro: 0, reparto: 'area' }, { orden: 'chicos', giro: 1, reparto: 'area' },
  ];
  const nota = (d, r) => r.pctAglom + r.densMax * 2 + r.tiempoProm / 200 + d.resto.length * 60;
  const vistas = new Set(), probadas = [];
  for (const v of VARIANTES) {
    const d = armar(v), clave = d.puestos.map(s => [s.q.nombre, s.cx.toFixed(1), s.cy.toFixed(1), s.rot]).sort().join('|');
    if (vistas.has(clave)) continue; vistas.add(clave);
    await progreso(`Simulando la distribución ${probadas.length + 1}…`);
    const ev = simular(aItems(d.puestos)); probadas.push({ d, ...ev, n: nota(d, ev.r) });
  }
  let mejor = probadas.reduce((a, b) => b.n < a.n ? b : a);
  const primera = probadas[0], peor = probadas.reduce((a, b) => b.n > a.n ? b : a);

  // ---- mejoras: si la gente se junta frente a un puesto, se prueba llevarlo a otros sitios ----
  let movidos = 0, ensayos = probadas.length;
  for (let ronda = 0; ronda < 3 && mejor.diag?.parada; ronda++) {
    const i = mejor.d.puestos.findIndex(s => s.q.nombre === mejor.diag.parada); if (i < 0) break;
    const s0 = mejor.d.puestos[i], otros = mejor.d.puestos.filter((_, k) => k !== i);
    const libres = espacios.flatMap(e => { const S = sitios(e, s0.h.w, s0.h.d); return [...S.per.filter(c => !otros.some(p => seMolestan(c, p, 0.5))), ...S.isl.filter(c => !otros.some(p => choca(c.r, conFrente(p.r, p.rot, p.isla ? 0 : FRENTE), PASILLO - 0.2)))].map(c => ({ ...c, q: s0.q, h: s0.h, e })); })
      .filter(c => Math.hypot(c.cx - s0.cx, c.cy - s0.cy) > 1.5);
    if (!libres.length) break;
    const muestra = Array.from({ length: Math.min(5, libres.length) }, (_, k) => libres[Math.floor((k + 0.5) * libres.length / Math.min(5, libres.length))]);
    let gano = null;
    for (const c of muestra) {
      await progreso(`Mejorando: probando otro sitio para «${s0.q.nombre}»…`);
      const d = { puestos: [...otros, c], resto: mejor.d.resto }, ev = simular(aItems(d.puestos)), n = nota(d, ev.r); ensayos++;
      if (n < (gano ? gano.n : mejor.n) - 0.3) gano = { d, ...ev, n };
    }
    if (!gano) break;
    mejor = gano; movidos++;
  }
  const c = v => v.toFixed(1).replace('.', ',');
  return cerrar(mejor.d, `Simulé ${ensayos} distribuciones y dejé la que mejor circula: ${c(mejor.r.pctAglom)} % del tiempo en aglomeración y densidad máxima ${c(mejor.r.densMax)} pers./m²` +
    (peor.n - mejor.n > 0.5 ? ` (la peor daba ${c(peor.r.pctAglom)} % y ${c(peor.r.densMax)}).` : ' (todas daban parecido).') +
    (movidos ? ` Después cambié de sitio ${movidos} puesto${movidos > 1 ? 's' : ''} donde se juntaba la gente.` : '') +
    (mejor.d.puestos.some(s => s.isla) ? ' Algunos quedaron en el centro, en islas.' : ''), { ensayos, r: mejor.r });
}
