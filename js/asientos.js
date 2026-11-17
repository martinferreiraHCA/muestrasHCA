// Armado automático de un salón: filas de auditorio, anfiteatro, aula, mesas en U, mesas redondas o ronda.
import { Simulacion } from './sim.js';
import { puntoEnPoly } from './niveles.js';
import { itemDesdeTipo } from './estado.js';

export const FORMAS = {
  auditorio: 'Auditorio: filas rectas con pasillo central',
  anfiteatro: 'Anfiteatro: filas curvas mirando al frente',
  aula: 'Aula: mesa y silla por persona',
  u: 'Mesas en U con sillas por fuera',
  redondas: 'Mesas redondas de 8',
  ronda: 'Ronda: sillas en círculo',
};
export const FRENTES = { arriba: [0, -1], abajo: [0, 1], izquierda: [-1, 0], derecha: [1, 0] };
const PASO = 0.55, FILA = 0.95, PASILLO = 1.2;        // separación entre sillas, entre filas y ancho del pasillo (m)

/**
 * Arma `personas` lugares en el espacio `esp` con la forma pedida, mirando hacia `frente`.
 * Devuelve { items, lugares, pedidas } sin tocar la muestra. Los elementos llevan `auto: 'sala'`.
 */
export function armarSala(nivel, proy, esp, cat, { forma = 'auditorio', personas = 50, frente = 'arriba', escenario = false } = {}) {
  const f = FRENTES[frente] || FRENTES.arriba, u = [-f[1], f[0]];
  const base = { ...proy, items: proy.items.filter(i => i.nivel === nivel.id && i.auto !== 'sala') };
  const xs = esp.poly.map(q => q[0]), ys = esp.poly.map(q => q[1]);
  const G = new Simulacion(nivel, base, {}, 1, { x0: Math.min(...xs) - 2, y0: Math.min(...ys) - 2, x1: Math.max(...xs) + 2, y1: Math.max(...ys) + 2 });
  const libre = (x, y) => { const gx = Math.floor((x - G.x0) / 0.2), gy = Math.floor((y - G.y0) / 0.2); return gx >= 0 && gy >= 0 && gx < G.gw && gy < G.gh && !G.bloq[gy * G.gw + gx] && puntoEnPoly(x, y, esp.poly); };
  const pu = esp.poly.map(q => q[0] * u[0] + q[1] * u[1]), pf = esp.poly.map(q => q[0] * f[0] + q[1] * f[1]);
  const u0 = Math.min(...pu), u1 = Math.max(...pu), vmax = Math.max(...pf), fondo = vmax - Math.min(...pf), uc = (u0 + u1) / 2, ancho = u1 - u0;
  const P = (uu, s) => [u[0] * uu + f[0] * (vmax - s), u[1] * uu + f[1] * (vmax - s)];       // (a lo ancho, distancia al frente) -> plano
  const giro = (dx, dy) => ((Math.atan2(-dx, dy) * 180 / Math.PI) % 360 + 360) % 360;          // para que el mueble mire hacia (dx, dy)
  const items = []; let lugares = 0;
  const cabe = (x, y, r) => [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]].every(([a, b]) => libre(x + a, y + b));
  const poner = (id, x, y, rot, extra) => { const it = itemDesdeTipo(cat(id), Math.round(x * 100) / 100, Math.round(y * 100) / 100, nivel.id); Object.assign(it, { rot: Math.round(rot), auto: 'sala', parada: false }, extra); items.push(it); return it; };
  const silla = (x, y, dx, dy) => { if (lugares >= personas || !cabe(x, y, 0.2)) return false; poner('silla', x, y, giro(dx, dy)); lugares++; return true; };

  let s0 = 2.2;
  if (escenario && forma !== 'ronda') {
    const w = Math.max(2, Math.min(5, ancho * 0.5)), [x, y] = P(uc, 1.4);
    if (cabe(x, y, 0.8)) { poner('tarima', x, y, giro(-f[0], -f[1]), { w, d: 2, etiqueta: 'Escenario' }); s0 = 3.6; }
  }
  const mitad = ancho / 2 - 0.5;

  if (forma === 'auditorio') {
    for (let s = s0; s < fondo - 0.4 && lugares < personas; s += FILA)
      for (let d = PASILLO / 2 + PASO / 2; d < mitad && lugares < personas; d += PASO) for (const lado of [-1, 1]) { const [x, y] = P(uc + lado * d, s); silla(x, y, f[0], f[1]); }
  } else if (forma === 'anfiteatro') {
    const [cx, cy] = P(uc, Math.max(1, s0 - 1.6));                 // el punto al que miran todos
    for (let r = 2.6; r < fondo + ancho && lugares < personas; r += 1.0) {
      const dt = PASO / r;
      for (let t = dt * 0.5 + (PASILLO / 2) / r; t < 1.45 && lugares < personas; t += dt) for (const lado of [-1, 1]) {
        const a = lado * t, x = cx + r * (Math.sin(a) * u[0] - Math.cos(a) * f[0]), y = cy + r * (Math.sin(a) * u[1] - Math.cos(a) * f[1]);
        silla(x, y, cx - x, cy - y);
      }
    }
  } else if (forma === 'aula') {
    for (let s = s0; s < fondo - 0.9 && lugares < personas; s += 1.3)
      for (let d = 0.5 + 0.45; d < mitad && lugares < personas; d += 0.9) for (const lado of [-1, 1]) {
        const [mx, my] = P(uc + lado * d, s), [sx, sy] = P(uc + lado * d, s + 0.5);
        if (lugares < personas && cabe(mx, my, 0.25) && cabe(sx, sy, 0.2)) { poner('mesa-escolar', mx, my, giro(f[0], f[1])); silla(sx, sy, f[0], f[1]); }
      }
  } else if (forma === 'ronda') {
    const [cx, cy] = P(uc, fondo / 2), rmax = Math.min(ancho, fondo) / 2 - 0.5;
    let r = Math.max(1.2, Math.min(rmax, personas * 0.6 / (2 * Math.PI)));
    for (; r > 0.9 && lugares < personas; r -= 0.95) {
      const n = Math.min(personas - lugares, Math.floor(2 * Math.PI * r / 0.6));
      for (let k = 0; k < n; k++) { const a = 2 * Math.PI * k / n, x = cx + r * Math.cos(a), y = cy + r * Math.sin(a); silla(x, y, cx - x, cy - y); }
    }
  } else if (forma === 'redondas') {
    const mesas = Math.ceil(personas / 8), sep = 3.0; let puestas = 0;
    for (let s = s0 + 1.2; s < fondo - 1.2 && puestas < mesas; s += sep) for (let d = (Math.floor(ancho / sep) % 2 ? 0 : sep / 2); d < mitad - 0.8 && puestas < mesas; d += sep) for (const lado of d === 0 ? [1] : [-1, 1]) {
      if (puestas >= mesas) break;
      const [x, y] = P(uc + lado * d, s); if (!cabe(x, y, 1.25)) continue;
      poner('mesa-redonda', x, y, 0, { w: 1.5, d: 1.5 }); puestas++;
      for (let k = 0; k < 8; k++) { const a = Math.PI / 8 + k * Math.PI / 4, px = x + 1.05 * Math.cos(a), py = y + 1.05 * Math.sin(a); silla(px, py, x - px, y - py); }
    }
  } else if (forma === 'u') {
    const n = Math.ceil(personas / 2), maxB = Math.max(1, Math.floor((ancho - 2.6) / 1.2)), maxA = Math.max(0, Math.floor((fondo - s0 - 1.9) / 1.2));
    const nb = Math.min(maxB, Math.max(1, Math.ceil(n / 3))), na = Math.min(maxA, Math.ceil((n - nb) / 2)), half = nb * 0.6, sb = s0 + na * 1.2 + 0.3;
    const mesa = (uu, s, alo) => { const [x, y] = P(uu, s); if (!cabe(x, y, 0.3)) return false; poner('mesa', x, y, alo ? giro(f[0], f[1]) : giro(u[0], u[1])); return true; };
    for (let i = 0; i < nb; i++) { const uu = uc - half + 0.6 + i * 1.2; if (mesa(uu, sb, true)) for (const o of [-0.3, 0.3]) { const [x, y] = P(uu + o, sb + 0.55); silla(x, y, f[0], f[1]); } }
    for (let i = 0; i < na; i++) for (const lado of [-1, 1]) {
      const s = s0 + 0.6 + i * 1.2;
      if (mesa(uc + lado * (half - 0.3), s, false)) for (const o of [-0.3, 0.3]) { const [x, y] = P(uc + lado * (half + 0.25), s + o); silla(x, y, -lado * u[0], -lado * u[1]); }
    }
  }
  return { items, lugares, pedidas: personas };
}
