// Equipos: se cargan en texto plano y se distribuyen solos en los lugares elegidos.
// La distribución arma dos alternativas (contra las paredes / en islas) y, si hay una Entrada
// marcada, las prueba con el simulador de circulación y se queda con la que circula mejor.
import { Simulacion, esEntrada } from './sim.js';
import { espaciosElegidos, puntoEnPoly, grupoEstudiantes } from './niveles.js';
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

/** Fondo extra que hay que reservar detrás del mueble para los estudiantes (las mesas; el stand los tiene adentro). */
const detras = (tipo, est) => tipo.modelo === 'stand' ? 0 : grupoEstudiantes(tipo.w, est).fondo;

/**
 * Distribuye los equipos en los lugares elegidos del nivel.
 * Devuelve { items, sinLugar, variante, resumen } sin modificar la muestra.
 */
export function distribuir(nivel, proy, equipos, tipo) {
  const espacios = espaciosElegidos(nivel, proy);
  if (!espacios.length) return { items: [], sinLugar: equipos, resumen: 'No hay lugares elegidos en este nivel.' };
  const base = { ...proy, items: proy.items.filter(i => !i.equipo && i.nivel === nivel.id) };      // lo ya ubicado a mano se respeta
  const xs = espacios.flatMap(e => e.poly.map(q => q[0])), ys = espacios.flatMap(e => e.poly.map(q => q[1]));
  const area = { x0: Math.max(0, Math.min(...xs) - 4), y0: Math.max(0, Math.min(...ys) - 4), x1: Math.min(nivel.ancho, Math.max(...xs) + 4), y1: Math.min(nivel.alto, Math.max(...ys) + 4) };
  const G = new Simulacion(nivel, base, {}, 1, area);
  const libre = (x, y) => { const gx = Math.floor((x - G.x0) / C), gy = Math.floor((y - G.y0) / C); return gx >= 0 && gy >= 0 && gx < G.gw && gy < G.gh && !G.bloq[gy * G.gw + gx]; };
  const estMax = Math.max(0, ...equipos.map(e => e.estudiantes));
  const w = tipo.w, d = tipo.d + detras(tipo, estMax);                 // huella reservada por puesto

  // huella de un puesto con el frente hacia `rot` (0 = frente hacia abajo en pantalla)
  const huella = (cx, cy, rot) => { const g = rot % 180 === 0; return { x0: cx - (g ? w : d) / 2, x1: cx + (g ? w : d) / 2, y0: cy - (g ? d : w) / 2, y1: cy + (g ? d : w) / 2 }; };
  const FR = { 0: [0, 1], 90: [-1, 0], 180: [0, -1], 270: [1, 0] };          // hacia dónde mira el frente
  const dentroLibre = (r, poly, m = 0) => {
    for (let y = r.y0 - m + C / 2; y < r.y1 + m; y += C) for (let x = r.x0 - m + C / 2; x < r.x1 + m; x += C) if (!libre(x, y) || !puntoEnPoly(x, y, poly)) return false;
    return true;
  };
  const choca = (a, b, m) => a.x0 - m < b.x1 && a.x1 + m > b.x0 && a.y0 - m < b.y1 && a.y1 + m > b.y0;
  const conFrente = (r, rot, largo) => { const [fx, fy] = FR[rot]; return { x0: r.x0 + Math.min(0, fx * largo), x1: r.x1 + Math.max(0, fx * largo), y0: r.y0 + Math.min(0, fy * largo), y1: r.y1 + Math.max(0, fy * largo) }; };

  function lugaresDe(e) {
    const ex = e.poly.map(q => q[0]), ey = e.poly.map(q => q[1]), bx0 = Math.min(...ex), bx1 = Math.max(...ex), by0 = Math.min(...ey), by1 = Math.max(...ey);
    // 1) contra las paredes: la espalda da a un muro (o al borde del espacio) y el frente queda despejado
    const per = [];
    for (const rot of [0, 270, 180, 90]) {
      const [fx, fy] = FR[rot], cand = [];
      for (let cy = by0; cy <= by1; cy += C) for (let cx = bx0; cx <= bx1; cx += C) {
        const r = huella(cx, cy, rot);
        // franja justo detrás de la espalda: tiene que ser pared o el límite del espacio
        let tot = 0, pared = 0;
        const hor = fx === 0, largo = hor ? r.x1 - r.x0 : r.y1 - r.y0;
        for (let t = C / 2; t < largo; t += C) {
          const px = hor ? r.x0 + t : (fx > 0 ? r.x0 - 0.25 : r.x1 + 0.25), py = hor ? (fy > 0 ? r.y0 - 0.25 : r.y1 + 0.25) : r.y0 + t;
          tot++; if (!libre(px, py) || !puntoEnPoly(px, py, e.poly)) pared++;
        }
        if (pared < tot * 0.75) continue;
        if (!dentroLibre(r, e.poly) || !dentroLibre(conFrente(r, rot, FRENTE), e.poly)) continue;
        cand.push({ cx, cy, rot, r });
      }
      // a lo largo de la pared, el más pegado a ella primero
      const along = c => (fx === 0 ? c.cx : c.cy), prof = c => (fx === 0 ? -fy * c.cy : -fx * c.cx);
      cand.sort((a, b) => along(a) - along(b) || prof(a) - prof(b));
      if (rot === 180 || rot === 90) cand.reverse();              // para recorrer el perímetro en orden
      // dos puestos enfrentados pueden compartir el pasillo, pero ninguno invade el frente del otro
      for (const c of cand) if (!per.some(p => choca(c.r, p.r, 0.35) || choca(c.r, conFrente(p.r, p.rot, FRENTE), 0.2) || choca(conFrente(c.r, c.rot, FRENTE), p.r, 0.2))) per.push(c);
    }
    // 2) islas en el interior, con pasillo alrededor
    const isl = [];
    for (let cy = by0; cy <= by1; cy += 0.4) for (let cx = bx0; cx <= bx1; cx += 0.4) {
      const r = huella(cx, cy, 0);
      if (!dentroLibre(r, e.poly, PASILLO)) continue;
      if (isl.some(p => choca(r, p.r, PASILLO))) continue;
      isl.push({ cx, cy, rot: 0, r, isla: true });
    }
    return { per, isl, islSolo: isl, islTrasPer: isl.filter(i => !per.some(p => choca(i.r, conFrente(p.r, p.rot, FRENTE), PASILLO - 0.4))) };
  }
  const L = espacios.map(e => ({ e, ...lugaresDe(e) }));

  // reparto de equipos entre lugares: primero los que piden uno, el resto según la capacidad
  function armar(variante) {
    const cap = L.map(l => variante === 'islas' ? l.islSolo.length || l.per.length : l.per.length + l.islTrasPer.length);
    const asign = L.map(() => []), sinLugar = [], libres = [];
    for (const q of equipos) {
      const i = q.lugar ? L.findIndex(l => l.e.nombre.toLowerCase().includes(q.lugar.toLowerCase())) : -1;
      if (i >= 0 && asign[i].length < cap[i]) asign[i].push(q); else libres.push(q);
    }
    const total = cap.reduce((a, b) => a + b, 0);
    for (const q of libres) {          // al lugar que queda más vacío en proporción
      let m = -1, mejor = Infinity;
      cap.forEach((c, i) => { if (asign[i].length < c) { const v = (asign[i].length + 1) / c; if (v < mejor) { mejor = v; m = i; } } });
      if (m < 0 || !total) sinLugar.push(q); else asign[m].push(q);
    }
    const items = [];
    L.forEach((l, i) => {
      const n = asign[i].length; if (!n) return;
      let sitios;
      if (variante === 'islas' && l.islSolo.length >= n) sitios = repartir(l.islSolo, n);
      else if (l.per.length >= n) sitios = repartir(l.per, n);              // bien separados a lo largo de las paredes
      else sitios = [...l.per, ...repartir(l.islTrasPer, n - l.per.length)];
      asign[i].forEach((q, k) => {
        // cada mesa va tan cerca de la pared como le permite su propio grupo de estudiantes
        const s = sitios[k], [fx, fy] = FR[s.rot], corr = (d - tipo.d) / 2 - (detras(tipo, estMax) - detras(tipo, q.estudiantes));       // el mueble va adelante; atrás, los estudiantes
        const it = itemDesdeTipo(tipo, Math.round((s.cx + fx * corr) * 100) / 100, Math.round((s.cy + fy * corr) * 100) / 100, nivel.id);
        Object.assign(it, { rot: s.rot, etiqueta: q.nombre, estudiantes: q.estudiantes, equipo: true });
        items.push(it);
      });
    });
    return { items, sinLugar, variante };
  }
  const repartir = (lista, n) => n >= lista.length ? lista : Array.from({ length: n }, (_, k) => lista[Math.floor((k + 0.5) * lista.length / n)]);

  const A = armar('paredes'), B = armar('islas');
  const distintas = L.some(l => l.islSolo.length) && JSON.stringify(A.items.map(i => [i.x, i.y])) !== JSON.stringify(B.items.map(i => [i.x, i.y])) && B.sinLugar.length <= A.sinLugar.length;
  let elegido = A, resumen;
  const hayEntrada = base.items.some(esEntrada);
  if (distintas && hayEntrada) {
    const nota = v => { const r = new Simulacion(nivel, { ...base, items: [...base.items, ...v.items] }, { ...(proy.sim || {}), porMinuto: 20, visitantes: Math.min(120, Math.max(40, equipos.length * 6)) }).completar(1500); return { r, n: r.pctAglom + r.densMax * 2 + r.tiempoProm / 60 }; };
    const a = nota(A), b = nota(B);
    if (b.n < a.n) elegido = B;
    resumen = `Probé dos distribuciones con el simulador: contra las paredes (${a.r.pctAglom.toFixed(1)} % del tiempo en aglomeración, densidad máx. ${a.r.densMax.toFixed(1)}) y en islas (${b.r.pctAglom.toFixed(1)} %, ${b.r.densMax.toFixed(1)}). Quedó la de ${elegido === A ? 'las paredes' : 'islas'}.`;
  } else resumen = hayEntrada || !distintas ? 'Los puestos quedaron contra las paredes, separados parejo, con el centro libre para circular.'
    : 'Los puestos quedaron contra las paredes, con el centro libre. Si marcás la Entrada (paso «Recorrido») y volvés a distribuir, comparo esta opción con una en islas usando el simulador.';
  const porLugar = L.map(l => `${l.e.nombre}: ${elegido.items.filter(i => puntoEnPoly(i.x, i.y, l.e.poly)).length}`).join(' · ');
  return { ...elegido, resumen: `${resumen} ${porLugar}.` };
}
