// Simulación de circulación: visitantes que entran, recorren las paradas (stands, mesas) y salen.
// Modelo: grilla de 20 cm con obstáculos, campos de distancia (Dijkstra) hacia cada destino
// y separación entre personas; la velocidad baja cuando aumenta la densidad.
import { areaTrabajo, aLocal, esRedondo, posEstudiantes } from './niveles.js';

const C = 0.2;            // tamaño de celda (m)
const CH = 0.5;           // celda del mapa de calor (m)
const DT = 0.12;          // paso de simulación (s)
const AGLOM = 2;          // personas/m² a partir de las cuales se considera aglomeración

// llegada: minutos durante los que van entrando los visitantes; tiempoVisita: tope por persona en minutos (0 = sin tope)
// hijoPrimero: cada visitante va primero al puesto de su hijo. tandas: entran en grupos de `tandaTam` cada
// `tandaCada` minutos y mientras tanto esperan en el «Lugar de espera» (o en la entrada). seguir: n.º del
// visitante al que se le dibuja el recorrido (-1 = el del medio).
export const SIM_DEF = { visitantes: 80, porMinuto: 20, llegada: 0, tiempoVisita: 0, permanencia: 45, paradas: 0, modo: 'libre', velocidad: 1.3,       // m/s: paso promedio de un adulto caminando tranquilo
 
  turnos: 1, hijoPrimero: false, tandas: false, tandaTam: 20, tandaCada: 5, seguir: -1 };
const FIJOS = ['mesa', 'mesa-redonda', 'caja', 'cilindro', 'panel', 'banco', 'zona'];
export const esEntrada = it => it.tipo === 'entrada';
export const esSalida = it => it.tipo === 'salida';
export function esParada(it) {
  if (esEntrada(it) || esSalida(it) || it.tipo === 'acceso' || it.tipo === 'espera' || it.modelo === 'persona' || it.modelo === 'texto' || it.modelo === 'silla') return false;
  return it.parada ?? (it.modelo === 'stand' || (!!it.etiqueta && FIJOS.includes(it.modelo)));
}

function azar(semilla) {      // generador reproducible (mulberry32)
  let a = semilla >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export class Simulacion {
  constructor(nivel, proy, params = {}, semilla = 7, area = null) {
    this.p = { ...SIM_DEF, ...params };
    this.rnd = azar(semilla);
    const items = proy.items.filter(i => i.nivel === nivel.id);
    const A = area || areaTrabajo(nivel, proy, 3);
    this.x0 = A.x0; this.y0 = A.y0;
    this.gw = Math.ceil((A.x1 - A.x0) / C); this.gh = Math.ceil((A.y1 - A.y0) / C);
    this.hw = Math.ceil((A.x1 - A.x0) / CH); this.hh = Math.ceil((A.y1 - A.y0) / CH);
    this.bloq = new Uint8Array(this.gw * this.gh);
    this.transito = new Float32Array(this.hw * this.hh); this.aglom = new Float32Array(this.hw * this.hh);

    // obstáculos: muros, ventanas y mobiliario
    for (const S of [nivel.muros, nivel.barreras]) for (let i = 0; i < S.length; i += 4) this.#linea(S[i], S[i + 1], S[i + 2], S[i + 3]);
    for (const it of items) {
      if (it.modelo === 'zona' || it.modelo === 'texto' || it.modelo === 'persona' || it.modelo === 'techo') continue;
      const a = it.rot * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), M = (lx, ly) => [it.x + lx * c - ly * s, it.y + lx * s + ly * c];
      if (it.modelo === 'stand') {
        const w = it.w / 2, d = it.d / 2, f = -d + it.d * 0.6;
        for (const [p, q] of [[[-w, f], [-w, -d]], [[-w, -d], [w, -d]], [[w, -d], [w, f]]]) this.#linea(...M(...p), ...M(...q));
      } else this.#celdasCerca(it, 0, (i) => { this.bloq[i] = 1; }, true);
    }
    for (const [cx, cy, r] of area?.circulos || [])           // obstáculos redondos extra (troncos de árboles)
      for (let y = cy - r; y <= cy + r; y += C * 0.9) for (let x = cx - r; x <= cx + r; x += C * 0.9) { const i = this.#idx(x, y); if (i >= 0 && Math.hypot(x - cx, y - cy) <= r) this.bloq[i] = 1; }
    // los estudiantes de cada puesto están parados en su lugar: ocupan espacio, cuentan para la densidad
    // y los caminos los rodean
    this.fijos = items.flatMap(posEstudiantes).map(([x, y]) => ({ x, y }));
    for (const f of this.fijos) for (const [dx, dy] of [[0, 0], [C, 0], [-C, 0], [0, C], [0, -C]]) { const i = this.#idx(f.x + dx * 0.6, f.y + dy * 0.6); if (i >= 0) this.bloq[i] = 1; }
    // penalización junto a obstáculos: la gente prefiere el centro de los pasillos
    this.pen = new Float32Array(this.gw * this.gh).fill(1);
    for (let y = 1; y < this.gh - 1; y++) for (let x = 1; x < this.gw - 1; x++) {
      const i = y * this.gw + x; if (this.bloq[i]) continue;
      let n = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) n += this.bloq[i + dy * this.gw + dx];
      if (n) this.pen[i] = 1.7;
    }

    // destinos
    this.campos = new Map();
    const fuentes = (it, margen, filtro) => { const l = []; this.#celdasCerca(it, margen, i => { if (!this.bloq[i]) l.push(i); }, false, filtro); return l; };
    this.entradas = items.filter(esEntrada).map(it => fuentes(it, 0)).filter(l => l.length);
    const sal = items.filter(esSalida).map(it => fuentes(it, 0.2)).flat();
    this.fSalida = sal.length ? sal : this.entradas.flat();
    const esp = items.filter(i => i.tipo === 'espera').map(it => fuentes(it, 0)).flat();
    this.fEspera = esp.length ? esp : this.entradas.flat(); this.hayEspera = esp.length > 0;
    this.paradas = [];
    const cruzaMuro = (p, q) => {
      for (const S of [nivel.muros, nivel.barreras]) for (let i = 0; i < S.length; i += 4) {
        const ax = S[i], ay = S[i + 1], bx = S[i + 2], by = S[i + 3];
        if (Math.max(ax, bx) < Math.min(p[0], q[0]) || Math.min(ax, bx) > Math.max(p[0], q[0]) || Math.max(ay, by) < Math.min(p[1], q[1]) || Math.min(ay, by) > Math.max(p[1], q[1])) continue;
        const d1 = (bx - ax) * (p[1] - ay) - (by - ay) * (p[0] - ax), d2 = (bx - ax) * (q[1] - ay) - (by - ay) * (q[0] - ax);
        const d3 = (q[0] - p[0]) * (ay - p[1]) - (q[1] - p[1]) * (ax - p[0]), d4 = (q[0] - p[0]) * (by - p[1]) - (q[1] - p[1]) * (bx - p[0]);
        if (d1 * d2 < 0 && d3 * d4 < 0) return true;
      }
      return false;
    };
    for (const it of items.filter(esParada)) {
      const f = it.modelo === 'zona' ? fuentes(it, 0)
        : it.modelo === 'stand' ? fuentes(it, 0.9, (lx, ly) => Math.abs(lx) < it.w / 2 - 0.15 && ly > -it.d / 2 + 0.25)
        : (() => {      // los visitantes se paran frente a la mesa (el lado opuesto a los estudiantes), no a los costados ni atrás
          const visible = i => !cruzaMuro(this.#centro(i), [it.x, it.y]);
          const frente = fuentes(it, 1.3, (lx, ly) => ly > it.d / 2 + 0.1 && Math.abs(lx) <= it.w / 2 + 0.3).filter(visible);
          return frente.length ? frente : fuentes(it, 0.75).filter(visible);          // si el frente está tapado, alrededor
        })();
      if (f.length) this.paradas.push({ it, nombre: it.etiqueta || it.nombre, fuentes: f, ocup: 0, visitas: 0 });
    }
    this.falta = !this.entradas.length ? 'Falta marcar al menos una Entrada (está en la lista de elementos).'
      : null;

    this.manuales = items.filter(i => i.modelo === 'persona').map(i => [i.x, i.y]);
    this.orden = null; this.ruta = null;
    if (!this.falta && this.p.modo === 'guiado' && this.paradas.length) this.#planificar();

    this.t = 0; this.agentes = []; this.creados = 0; this.fin = [];
    this.maxAdentro = 0; this.apurados = 0; this.tUltimo = 0;
    this.proxTanda = 0; this.nTandas = 0; this.esperas = []; this.tParados = []; this.seguido = null;
    this.nSeguir = this.p.seguir >= 0 ? Math.min(this.p.seguir, this.p.visitantes - 1) : Math.floor(this.p.visitantes / 2);
    this.densMax = 0; this.tAglom = 0; this.tTotal = 0; this.terminada = false;
    for (const [x, y] of this.manuales) this.#nuevo(x, y);
  }

  // ---------- grilla ----------
  #idx(x, y) { const gx = Math.floor((x - this.x0) / C), gy = Math.floor((y - this.y0) / C); return gx < 0 || gy < 0 || gx >= this.gw || gy >= this.gh ? -1 : gy * this.gw + gx; }
  #centro(i) { return [this.x0 + (i % this.gw + 0.5) * C, this.y0 + (Math.floor(i / this.gw) + 0.5) * C]; }
  #libre(x, y) { const i = this.#idx(x, y); return i >= 0 && !this.bloq[i]; }
  #linea(x1, y1, x2, y2) {
    const A = this, X1 = A.x0 + A.gw * C, Y1 = A.y0 + A.gh * C;
    if (Math.max(x1, x2) < A.x0 || Math.min(x1, x2) > X1 || Math.max(y1, y2) < A.y0 || Math.min(y1, y2) > Y1) return;
    const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / (C * 0.45)));
    for (let k = 0; k <= n; k++) { const i = this.#idx(x1 + (x2 - x1) * k / n, y1 + (y2 - y1) * k / n); if (i >= 0) this.bloq[i] = 1; }
  }
  /** Recorre las celdas dentro de la huella del elemento (o hasta `margen` metros alrededor). */
  #celdasCerca(it, margen, fn, soloDentro, filtro) {
    const r = Math.hypot(it.w, it.d) / 2 + margen;
    for (let y = it.y - r; y <= it.y + r; y += C) for (let x = it.x - r; x <= it.x + r; x += C) {
      const i = this.#idx(x, y); if (i < 0) continue;
      const [cx, cy] = this.#centro(i), [lx, ly] = aLocal(it, cx, cy);
      let dentro;
      if (esRedondo(it)) dentro = (lx / (it.w / 2 + margen)) ** 2 + (ly / (it.d / 2 + margen)) ** 2 <= 1;
      else dentro = Math.abs(lx) <= it.w / 2 + margen && Math.abs(ly) <= it.d / 2 + margen;
      if (dentro && (!filtro || filtro(lx, ly))) fn(i);
    }
  }

  /** Distancia caminando desde cada celda hasta el conjunto de celdas `fuentes` (Dijkstra). */
  #campo(clave, fuentes) {
    if (this.campos.has(clave)) return this.campos.get(clave);
    const { gw, gh, bloq, pen } = this, d = new Float32Array(gw * gh).fill(Infinity);
    const hk = [], hi = [];                       // montículo binario (distancia, celda)
    const meter = (k, i) => { let n = hk.length; hk.push(k); hi.push(i); while (n > 0) { const p = (n - 1) >> 1; if (hk[p] <= k) break; hk[n] = hk[p]; hi[n] = hi[p]; n = p; } hk[n] = k; hi[n] = i; };
    const sacar = () => {
      const k0 = hk[0], i0 = hi[0], k = hk.pop(), i = hi.pop(), L = hk.length;
      if (L) { let n = 0; for (;;) { let h = 2 * n + 1; if (h >= L) break; if (h + 1 < L && hk[h + 1] < hk[h]) h++; if (hk[h] >= k) break; hk[n] = hk[h]; hi[n] = hi[h]; n = h; } hk[n] = k; hi[n] = i; }
      return [k0, i0];
    };
    for (const i of fuentes) { d[i] = 0; meter(0, i); }
    while (hk.length) {
      const [k, i] = sacar(); if (k > d[i]) continue;
      const x = i % gw, y = (i - x) / gw;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
        const j = ny * gw + nx; if (bloq[j]) continue;
        if (dx && dy && (bloq[y * gw + nx] || bloq[ny * gw + x])) continue;      // no cortar esquinas
        const nd = Math.fround(k + (dx && dy ? 1.4142 : 1) * C * pen[j]);      // misma precisión que el arreglo
        if (nd < d[j]) { d[j] = nd; meter(nd, j); }
      }
    }
    this.campos.set(clave, d); return d;
  }
  #campoParada(n) { return this.#campo('p' + n, this.paradas[n].fuentes); }
  #campoSalida() { return this.#campo('s', this.fSalida); }

  /** Camino a pie entre dos puntos, esquivando muros y muebles. Devuelve [[x, y], …] o null si no hay paso. */
  camino(desde, hasta, radio = 1.2) {
    const cerca = (p, r) => { const l = []; for (let y = p[1] - r; y <= p[1] + r; y += C) for (let x = p[0] - r; x <= p[0] + r; x += C) { const i = this.#idx(x, y); if (i >= 0 && !this.bloq[i]) l.push(i); } return l; };
    const fu = cerca(hasta, radio); if (!fu.length) return null;
    const campo = this.#campo('c' + hasta.join(), fu);
    let pos = -1, mejor = Infinity;
    for (const i of cerca(desde, 3)) { const [x, y] = this.#centro(i), d = Math.hypot(x - desde[0], y - desde[1]); if (isFinite(campo[i]) && d < mejor) { mejor = d; pos = i; } }
    if (pos < 0) return null;
    const ruta = [desde, this.#centro(pos)];
    for (let g = 0; g < 20000 && campo[pos] > 0; g++) {
      const x = pos % this.gw, y = (pos - x) / this.gw; let m = pos;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= this.gw || ny >= this.gh) continue; const j = ny * this.gw + nx; if (campo[j] < campo[m]) m = j; }
      if (m === pos) break; pos = m; ruta.push(this.#centro(pos));
    }
    ruta.push(hasta);
    return ruta;
  }

  // ---------- recorrido guiado ----------
  #planificar() {
    const n = this.paradas.length, ini = this.entradas[0][this.entradas[0].length >> 1];
    const acc = this.paradas.map(p => p.fuentes[p.fuentes.length >> 1]);
    const D = (i, j) => { const v = this.#campoParada(j)[i < 0 ? ini : acc[i]]; return isFinite(v) ? v : 1e6; };
    const fin = i => { const v = this.#campoSalida()[acc[i]]; return isFinite(v) ? v : 1e6; };
    let o = [], libres = new Set(this.paradas.map((_, i) => i)), act = -1;
    while (libres.size) { let m = null; for (const j of libres) if (m === null || D(act, j) < D(act, m)) m = j; o.push(m); libres.delete(m); act = m; }
    const largo = o => o.reduce((s, j, k) => s + D(k ? o[k - 1] : -1, j), 0) + fin(o[o.length - 1]);
    for (let mejora = true, v = 0; mejora && v < 30; v++) {       // 2-opt
      mejora = false;
      for (let a = 0; a < n - 1; a++) for (let b = a + 1; b < n; b++) {
        const c = [...o.slice(0, a), ...o.slice(a, b + 1).reverse(), ...o.slice(b + 1)];
        if (largo(c) < largo(o) - 0.01) { o = c; mejora = true; }
      }
    }
    this.orden = o; this.largoRuta = largo(o);
    // traza del recorrido para dibujarlo
    const ruta = []; let pos = ini;
    const bajar = campo => {
      for (let g = 0; g < 4000 && campo[pos] > C; g++) {
        const x = pos % this.gw, y = (pos - x) / this.gw; let m = pos;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= this.gw || ny >= this.gh) continue; const j = ny * this.gw + nx; if (campo[j] < campo[m]) m = j; }
        if (m === pos) break; pos = m; if (g % 3 === 0) ruta.push(this.#centro(pos));
      }
      ruta.push(this.#centro(pos));
    };
    ruta.push(this.#centro(pos));
    for (const j of o) { if (isFinite(this.#campoParada(j)[pos])) bajar(this.#campoParada(j)); }
    if (isFinite(this.#campoSalida()[pos])) bajar(this.#campoSalida());
    this.ruta = ruta;
  }

  // ---------- agentes ----------
  #nuevo(x, y, numero = -1) {
    const n = this.paradas.length, cuantas = this.p.paradas > 0 ? Math.min(this.p.paradas, n) : n;
    const a = { x, y, vx: 0, vy: 0, vel: this.p.velocidad * (0.8 + this.rnd() * 0.4), estado: 'camina', destino: -1, espera: 0,
      vistas: new Set(), faltan: cuantas, paso: 0, t: 0, dens: 0, mejor: Infinity, tMejor: 0, tEsp: 0, tPar: 0, hijo: -1, camino: 0 };
    if (this.p.hijoPrimero && n) {            // el puesto del hijo: más probable cuantos más estudiantes tiene
      const pesos = this.paradas.map(p => Math.max(1, p.it.estudiantes | 0)), tot = pesos.reduce((u, v) => u + v, 0);
      let r = this.rnd() * tot; a.hijo = pesos.findIndex(w => (r -= w) < 0); if (a.hijo < 0) a.hijo = n - 1;
    }
    if (numero === this.nSeguir) { a.seguido = true; a.vel = this.p.velocidad; a.rastro = [[x, y]]; this.seguido = a; }
    this.agentes.push(a);
    if (this.p.tandas) a.estado = 'espera'; else this.#elegir(a);
  }
  #elegir(a) {
    if (a.destino >= 0) this.paradas[a.destino].ocup--;
    a.destino = -1; a.estado = 'sale'; a.mejor = Infinity; a.tMejor = this.t;
    if (a.faltan <= 0) return;
    const i = this.#idx(a.x, a.y);
    if (a.hijo >= 0 && !a.vistas.has(a.hijo) && isFinite(this.#campoParada(a.hijo)[i])) a.destino = a.hijo;
    else if (this.orden) {
      while (a.paso < this.orden.length) { const j = this.orden[a.paso++]; if (!a.vistas.has(j) && isFinite(this.#campoParada(j)[i])) { a.destino = j; break; } }
    } else {
      let mejor = Infinity;
      this.paradas.forEach((p, j) => {
        if (a.vistas.has(j)) return;
        const d = this.#campoParada(j)[i]; if (!isFinite(d)) return;
        const costo = d + p.ocup * 2.5 + this.rnd() * 1.5;        // evita los puestos llenos
        if (costo < mejor) { mejor = costo; a.destino = j; }
      });
    }
    if (a.destino >= 0) { a.estado = 'camina'; this.paradas[a.destino].ocup++; }
  }
  #salio(a) { this.fin.push(a.t); this.esperas.push(a.tEsp); this.tParados.push(a.tPar); if (a.seguido) a.fin = this.t; }

  /** Avanza la simulación `dt` segundos (por defecto un paso normal). */
  paso(dt = DT) {
    if (this.falta || this.terminada) return;
    const P = this.p; this.t += dt;
    // llegadas por las entradas
    const deben = Math.min(P.visitantes, Math.floor(this.t * P.porMinuto / 60) + 1);
    while (this.creados < deben) {
      const e = this.entradas[Math.floor(this.rnd() * this.entradas.length)], [x, y] = this.#centro(e[Math.floor(this.rnd() * e.length)]);
      this.#nuevo(x + (this.rnd() - 0.5) * C, y + (this.rnd() - 0.5) * C, this.creados); this.creados++;
    }
    if (P.tandas) {            // por tandas: sale un grupo del lugar de espera cuando se junta o cuando toca
      const esp = this.agentes.filter(a => a.estado === 'espera');
      if (esp.length && this.t >= this.proxTanda && (esp.length >= P.tandaTam || this.creados >= P.visitantes || this.t >= this.proxTanda + P.tandaCada * 60)) {
        esp.slice(0, P.tandaTam).forEach(a => this.#elegir(a));
        this.proxTanda = this.t + P.tandaCada * 60; this.nTandas++;
      }
    }
    // vecinos por grilla de 1 m
    const cubos = new Map(), clave = (x, y) => Math.floor(x) * 4096 + Math.floor(y);
    for (const a of this.agentes) { const k = clave(a.x, a.y); (cubos.get(k) || cubos.set(k, []).get(k)).push(a); }
    for (const a of this.fijos) { const k = clave(a.x, a.y); (cubos.get(k) || cubos.set(k, []).get(k)).push(a); }
    const quedan = [], tope = P.tiempoVisita * 60;
    if (this.agentes.length > this.maxAdentro) {          // se guarda una foto del momento de mayor carga
      this.maxAdentro = this.agentes.length;
      this.pico = { t: this.t, ag: this.agentes.map(a => ({ x: a.x, y: a.y, dens: a.dens, estado: a.estado })) };
    }
    for (const a of this.agentes) {
      // se le acabó el tiempo de visita: deja lo que falta y va a la salida
      if (tope && a.estado !== 'sale' && a.estado !== 'espera' && a.t - a.tEsp > tope) { a.faltan = 0; this.apurados++; this.#elegir(a); }
      let n = 1, rx = 0, ry = 0;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const l = cubos.get(clave(a.x + dx, a.y + dy)); if (!l) continue;
        for (const b of l) {
          if (b === a) continue;
          const ex = a.x - b.x, ey = a.y - b.y, d = Math.hypot(ex, ey);
          if (d < 1) n++;
          if (d < 0.65) { const f = (0.65 - d) / 0.65 / (d || 0.01); rx += (d ? ex : this.rnd() - 0.5) * f; ry += (d ? ey : this.rnd() - 0.5) * f; }
        }
      }
      // los que esperan su tanda están juntos a propósito: no cuentan como aglomeración del recorrido
      const esperando = a.estado === 'espera';
      a.dens = n / Math.PI; a.t += dt;
      if (esperando) a.tEsp += dt; else { this.tTotal += dt; if (a.dens > this.densMax) this.densMax = a.dens; }
      const hx = Math.floor((a.x - this.x0) / CH), hy = Math.floor((a.y - this.y0) / CH);
      if (!esperando && hx >= 0 && hy >= 0 && hx < this.hw && hy < this.hh) {
        this.transito[hy * this.hw + hx] += dt;
        if (a.dens >= AGLOM) { this.aglom[hy * this.hw + hx] += dt; this.tAglom += dt; }
      }
      const i = this.#idx(a.x, a.y);
      let dx = 0, dy = 0;
      if (esperando) {
        const campo = this.#campo('w', this.fEspera), d0 = i >= 0 ? campo[i] : Infinity;
        if (isFinite(d0) && d0 > C * 1.2) {
          const x = i % this.gw, y = (i - x) / this.gw; let m = i;
          for (let qy = -1; qy <= 1; qy++) for (let qx = -1; qx <= 1; qx++) { const nx = x + qx, ny = y + qy; if (nx < 0 || ny < 0 || nx >= this.gw || ny >= this.gh) continue; const j = ny * this.gw + nx; if (campo[j] < campo[m]) m = j; }
          const [cx, cy] = this.#centro(m), l = Math.hypot(cx - a.x, cy - a.y) || 1; dx = (cx - a.x) / l; dy = (cy - a.y) / l;
        }
      } else if (a.estado === 'parado') {
        a.espera -= dt; a.tPar += dt;
        if (a.espera <= 0) { a.vistas.add(a.destino); a.faltan--; this.paradas[a.destino].visitas++; this.#elegir(a); }
      } else {
        const campo = a.destino >= 0 ? this.#campoParada(a.destino) : this.#campoSalida();
        const d0 = i >= 0 ? campo[i] : Infinity;
        // si hace rato que no avanza (quedó trabado entre la gente), se da por llegado o sigue con otra cosa
        if (!(d0 >= a.mejor - 0.05)) { a.mejor = d0; a.tMejor = this.t; }
        const trabado = this.t - a.tMejor > 25;
        // llega al destino; si el puesto está lleno, se queda mirando desde atrás
        if (d0 <= C * 1.2 || (a.destino >= 0 && d0 < 2.2 && a.dens >= 1.6) || (trabado && (a.destino < 0 || d0 < 4))) {
          if (a.destino >= 0) { a.estado = 'parado'; a.espera = P.permanencia * (a.seguido ? 1 : 0.6 + this.rnd() * 0.8) * (a.destino === a.hijo ? 2 : 1); }
          else { this.#salio(a); continue; }                     // salió
        } else if (!isFinite(d0) || trabado) {
          if (a.destino >= 0) { if (trabado) { a.vistas.add(a.destino); a.faltan--; } this.#elegir(a); } else { this.#salio(a); continue; }
        } else {
          const x = i % this.gw, y = (i - x) / this.gw; let m = i;
          for (let qy = -1; qy <= 1; qy++) for (let qx = -1; qx <= 1; qx++) {
            const nx = x + qx, ny = y + qy; if (nx < 0 || ny < 0 || nx >= this.gw || ny >= this.gh) continue;
            const j = ny * this.gw + nx; if (campo[j] < campo[m]) m = j;
          }
          const [cx, cy] = this.#centro(m), l = Math.hypot(cx - a.x, cy - a.y) || 1;
          dx = (cx - a.x) / l; dy = (cy - a.y) / l;
        }
      }
      const lento = Math.max(0.15, Math.min(1, 1 - (a.dens - 0.8) / 3.5));
      const quieto = a.estado === 'parado' ? 0.8 : 1;
      a.vx = a.vx * 0.55 + dx * a.vel * lento * 0.45; a.vy = a.vy * 0.55 + dy * a.vel * lento * 0.45;
      const mx = (a.vx + rx * 1.5 * quieto) * dt, my = (a.vy + ry * 1.5 * quieto) * dt;
      const sub = Math.max(1, Math.ceil(Math.hypot(mx, my) / (C * 0.45)));       // sub-pasos: nadie atraviesa un muro
      for (let q = 0; q < sub; q++) {
        const ux = mx / sub, uy = my / sub;
        if (this.#libre(a.x + ux, a.y + uy)) { a.x += ux; a.y += uy; }
        else if (this.#libre(a.x + ux, a.y)) a.x += ux;
        else if (this.#libre(a.x, a.y + uy)) a.y += uy;
        else break;
      }
      if (a.seguido) { const u = a.rastro[a.rastro.length - 1], d = Math.hypot(a.x - u[0], a.y - u[1]); if (d > 0.3) { a.rastro.push([a.x, a.y]); a.camino += d; } }
      quedan.push(a);
    }
    if (quedan.length < this.agentes.length) this.tUltimo = this.t;
    this.agentes = quedan;
    if ((this.creados >= P.visitantes && !quedan.length) || this.t > 3 * 3600) this.terminada = true;
  }

  /** Avanza hasta el final sin dibujar (para comparar alternativas). */
  completar(maxSeg = 2 * 3600) { while (!this.terminada && !this.falta && this.t < maxSeg) this.paso(); return this.resumen(); }

  resumen() {
    const med = l => l.length ? l.reduce((a, b) => a + b, 0) / l.length : 0;
    const f = this.fin, prom = med(f), sg = this.seguido;
    let peor = 0, pi = -1; this.aglom.forEach((v, i) => { if (v > peor) { peor = v; pi = i; } });
    return {
      t: this.t, adentro: this.agentes.length, terminaron: f.length, total: this.p.visitantes + this.manuales.length,
      tiempoProm: prom, densMax: this.densMax, pctAglom: this.tTotal ? 100 * this.tAglom / this.tTotal : 0,
      esperaProm: med(this.esperas), paradoProm: med(this.tParados), tandas: this.nTandas, esperando: this.agentes.filter(a => a.estado === 'espera').length,
      seguido: sg && { t: sg.t, fin: sg.fin, espera: sg.tEsp, parado: sg.tPar, camino: sg.camino, vistas: sg.vistas.size, estado: sg.estado,
        en: sg.destino >= 0 ? this.paradas[sg.destino].nombre : null, hijo: sg.hijo >= 0 ? this.paradas[sg.hijo].nombre : null },
      tPico: this.pico ? this.pico.t : 0, estudiantes: this.fijos.length,
      paradas: this.paradas.length, terminada: this.terminada, maxAdentro: this.maxAdentro, apurados: this.apurados, tUltimo: this.tUltimo,
      critico: pi >= 0 && peor > 5 ? [this.x0 + (pi % this.hw + 0.5) * CH, this.y0 + (Math.floor(pi / this.hw) + 0.5) * CH] : null,
    };
  }

  // ---------- dibujo sobre el plano ----------
  #calor = null; #calorT = -1;
  dibujar(ctx, k, mapa) {
    const px = 1 / k;
    if (mapa !== 'ninguno') {
      if (!this.#calor || this.t - this.#calorT > 1 || this.terminada) {
        const src = mapa === 'aglomeracion' ? this.aglom : this.transito;
        let max = 0; for (const v of src) if (v > max) max = v;
        const c = this.#calor || Object.assign(document.createElement('canvas'), { width: this.hw, height: this.hh });
        const g = c.getContext('2d'), img = g.createImageData(this.hw, this.hh);
        if (max > 0) for (let i = 0; i < src.length; i++) {
          const v = Math.sqrt(src[i] / max); if (v < 0.04) continue;
          img.data[i * 4] = mapa === 'aglomeracion' ? 214 : 255 * Math.min(1, v * 2);
          img.data[i * 4 + 1] = mapa === 'aglomeracion' ? 40 * (1 - v) : 255 * Math.min(1, 2 - v * 2) * 0.85;
          img.data[i * 4 + 2] = mapa === 'aglomeracion' ? 40 : 30; img.data[i * 4 + 3] = 40 + 170 * v;
        }
        g.putImageData(img, 0, 0); this.#calor = c; this.#calorT = this.t;
      }
      ctx.imageSmoothingEnabled = true; ctx.drawImage(this.#calor, this.x0, this.y0, this.hw * CH, this.hh * CH);
    }
    if (this.ruta) {
      ctx.beginPath(); this.ruta.forEach((q, i) => i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]));
      ctx.strokeStyle = 'rgba(31,78,156,.75)'; ctx.lineWidth = Math.max(0.08, 2.5 * px); ctx.setLineDash([0.5, 0.3]); ctx.lineJoin = 'round'; ctx.stroke(); ctx.setLineDash([]);
      for (let i = 12; i < this.ruta.length - 2; i += 22) {          // flechas de sentido
        const [x, y] = this.ruta[i], [x2, y2] = this.ruta[i + 2], a = Math.atan2(y2 - y, x2 - x), s = Math.max(0.28, 7 * px);
        ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.beginPath(); ctx.moveTo(s, 0); ctx.lineTo(-s * 0.6, s * 0.6); ctx.lineTo(-s * 0.6, -s * 0.6); ctx.closePath();
        ctx.fillStyle = '#1f4e9c'; ctx.fill(); ctx.restore();
      }
      this.orden.forEach((j, n) => {
        const it = this.paradas[j].it, r = Math.max(0.3, 9 * px);
        ctx.beginPath(); ctx.arc(it.x, it.y - it.d / 2, r, 0, 7); ctx.fillStyle = '#1f4e9c'; ctx.fill();
        ctx.fillStyle = '#fff'; ctx.font = `700 ${r * 1.15}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(n + 1, it.x, it.y - it.d / 2 + r * 0.06);
      });
    }
    // personas a tamaño real (unos 45 cm); al terminar se muestra la foto del momento de mayor carga
    const r = Math.max(0.22, 3.2 * px), lista = this.terminada && this.pico ? this.pico.ag : this.agentes;
    for (const a of lista) {
      ctx.beginPath(); ctx.arc(a.x, a.y, r, 0, 7);
      ctx.fillStyle = a.estado === 'espera' ? '#7048a8' : a.dens >= AGLOM ? '#d62828' : a.estado === 'parado' ? '#2f9e44' : a.estado === 'sale' ? '#6c757d' : '#1971c2';
      ctx.fill(); ctx.lineWidth = Math.min(0.04, px); ctx.strokeStyle = 'rgba(20,28,40,.75)'; ctx.stroke();
    }
    const sg = this.seguido;
    if (sg && sg.rastro.length > 1) {          // la persona que se está siguiendo: su recorrido y un marcador grande
      ctx.beginPath(); sg.rastro.forEach((q, n) => n ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]));
      ctx.strokeStyle = '#0b7285'; ctx.lineWidth = Math.max(0.1, 2.5 * px); ctx.lineJoin = 'round'; ctx.stroke();
      if (!sg.fin) { ctx.beginPath(); ctx.arc(sg.x, sg.y, Math.max(0.42, 7 * px), 0, 7); ctx.fillStyle = '#15aabf'; ctx.fill(); ctx.lineWidth = 2.5 * px; ctx.strokeStyle = '#fff'; ctx.stroke(); }
    }
    const cr = this.terminada && this.resumen().critico;
    if (cr) { ctx.beginPath(); ctx.arc(cr[0], cr[1], Math.max(1, 16 * px), 0, 7); ctx.strokeStyle = '#d62828'; ctx.lineWidth = 2.5 * px; ctx.setLineDash([5 * px, 4 * px]); ctx.stroke(); ctx.setLineDash([]); }
  }
}
export { DT };
