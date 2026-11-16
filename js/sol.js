// Sol y sombras: posición del sol según fecha y hora, y sombras que proyectan muros y elementos.
import { esquinas, espaciosElegidos, puntoEnPoly, areaTrabajo } from './niveles.js';

const R = Math.PI / 180;
export const GEO = { lat: -34.86, lon: -56.19, huso: -3, norte: 234.5 };       // se pisa con data/niveles.json

/** Posición del sol (fórmulas de NOAA). hora = hora local decimal. Devuelve acimut (° desde el norte, horario) y altura (°). */
export function posSol(fecha, hora, g = GEO) {
  const d = new Date((fecha || new Date().toISOString().slice(0, 10)) + 'T00:00:00Z');
  const dia = Math.floor((d - Date.UTC(d.getUTCFullYear(), 0, 0)) / 864e5);
  const y = 2 * Math.PI / 365 * (dia - 1 + (hora - 12) / 24);
  const ec = 229.18 * (0.000075 + 0.001868 * Math.cos(y) - 0.032077 * Math.sin(y) - 0.014615 * Math.cos(2 * y) - 0.040849 * Math.sin(2 * y));
  const dec = 0.006918 - 0.399912 * Math.cos(y) + 0.070257 * Math.sin(y) - 0.006758 * Math.cos(2 * y) + 0.000907 * Math.sin(2 * y) - 0.002697 * Math.cos(3 * y) + 0.00148 * Math.sin(3 * y);
  const tst = hora * 60 + ec + 4 * g.lon - 60 * g.huso, ha = (tst / 4 - 180) * R, lat = g.lat * R;
  const el = Math.asin(Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(ha));
  const az = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(lat) - Math.tan(dec) * Math.cos(lat)) + Math.PI;
  return { az: ((az / R) % 360 + 360) % 360, el: el / R };
}
export function amanecer(fecha, g = GEO) {
  let sale = null, pone = null;
  for (let h = 3; h < 23; h += 1 / 30) { const e = posSol(fecha, h, g).el; if (e > 0 && sale === null) sale = h; if (e > 0) pone = h; }
  return { sale, pone };
}
export const hhmm = h => `${String(Math.floor(h + 1e-6)).padStart(2, '0')}:${String(Math.round((h % 1) * 60) % 60).padStart(2, '0')}`;
export const cardinal = az => ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'][Math.round(az / 45) % 8];

/** Vectores norte y este en coordenadas del plano (Y hacia abajo). `norte` = grados horarios desde "arriba". */
export function ejes(norte) { const a = norte * R, n = [Math.sin(a), -Math.cos(a)]; return { n, e: [-n[1], n[0]] }; }
/** Dirección horizontal hacia el sol en el plano, y desplazamiento de la sombra por metro de altura. */
export function vectores(sol, norte) {
  const { n, e } = ejes(norte), a = sol.az * R;
  const hacia = [n[0] * Math.cos(a) + e[0] * Math.sin(a), n[1] * Math.cos(a) + e[1] * Math.sin(a)];
  const largo = sol.el > 0 ? Math.min(12, 1 / Math.tan(sol.el * R)) : 0;
  return { hacia, sombra: [-hacia[0] * largo, -hacia[1] * largo], largo };
}

const SIN_SOMBRA = ['zona', 'texto', 'persona'];
/** Path2D (en metros) con todas las sombras del nivel para esa posición del sol. */
export function sombras(nivel, proy, sol, norte) {
  const p = new Path2D(); if (sol.el <= 0.5) return p;
  const { sombra: [sx, sy] } = vectores(sol, norte), alt = proy.altura || 3;
  const A = areaTrabajo(nivel, proy, 0), mg = 12 * alt * 3 + 5;
  const cuad = (x1, y1, x2, y2, h, base = 0) => {
    const a = [x1 + sx * base, y1 + sy * base], b = [x2 + sx * base, y2 + sy * base], c = [x2 + sx * h, y2 + sy * h], d = [x1 + sx * h, y1 + sy * h];
    const q = (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]) < 0 ? [a, d, c, b] : [a, b, c, d];     // mismo sentido siempre
    p.moveTo(q[0][0], q[0][1]); for (let i = 1; i < 4; i++) p.lineTo(q[i][0], q[i][1]); p.closePath();
  };
  const S = nivel.muros, P = nivel.pisos;
  for (let i = 0, n = 0; i < S.length; i += 4, n++) {
    const mx = (S[i] + S[i + 2]) / 2, my = (S[i + 1] + S[i + 3]) / 2;
    if (!A.todo && (mx < A.x0 - mg || mx > A.x1 + mg || my < A.y0 - mg || my > A.y1 + mg)) continue;
    cuad(S[i], S[i + 1], S[i + 2], S[i + 3], (P ? P[n] || 1 : 1) * alt);
  }
  for (const it of proy.items) {
    if (it.nivel !== nivel.id || SIN_SOMBRA.includes(it.modelo) || !(it.h > 0.05)) continue;
    const e = esquinas(it), h = it.modelo === 'silla' ? it.h * 1.85 : it.h;
    if (it.modelo === 'techo') {            // solo el techo da sombra
      const t = e.map(q => [q[0] + sx * h, q[1] + sy * h]);
      const sig = (t[1][0] - t[0][0]) * (t[3][1] - t[0][1]) - (t[1][1] - t[0][1]) * (t[3][0] - t[0][0]) < 0 ? [...t].reverse() : t;
      p.moveTo(sig[0][0], sig[0][1]); for (let i = 1; i < 4; i++) p.lineTo(sig[i][0], sig[i][1]); p.closePath();
    } else for (let i = 0; i < 4; i++) cuad(e[i][0], e[i][1], e[(i + 1) % 4][0], e[(i + 1) % 4][1], h);
  }
  return p;
}

let ctxPrueba = null;
/** Porcentaje del espacio que recibe sol (muestreo de puntos). */
export function pctSol(poly, path) {
  ctxPrueba ||= document.createElement('canvas').getContext('2d');
  const xs = poly.map(q => q[0]), ys = poly.map(q => q[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const paso = Math.max(0.4, Math.sqrt((x1 - x0) * (y1 - y0)) / 28);
  let n = 0, sol = 0;
  for (let y = y0 + paso / 2; y < y1; y += paso) for (let x = x0 + paso / 2; x < x1; x += paso) {
    if (!puntoEnPoly(x, y, poly)) continue;
    n++; if (!ctxPrueba.isPointInPath(path, x, y)) sol++;
  }
  return n ? Math.round(100 * sol / n) : 0;
}

/** Tabla hora por hora del % de sol en cada espacio elegido que esté al aire libre. */
export function tablaSol(nivel, proy, fecha, norte, desde, hasta) {
  const esp = espaciosElegidos(nivel, proy).filter(e => e.exterior || e.propio);
  const horas = []; for (let h = Math.ceil(desde); h <= Math.floor(hasta); h++) horas.push(h);
  return { esp, horas, filas: esp.map(e => horas.map(h => { const s = posSol(fecha, h); return s.el > 0.5 ? pctSol(e.poly, sombras(nivel, proy, s, norte)) : null; })) };
}

/** Dibuja las sombras y la rosa de orientación sobre el plano (ctx en metros). */
export function dibujarSol(ctx, k, nivel, proy, sol, norte, path) {
  const px = 1 / k;
  // interiores: están techados, el sol no llega
  ctx.fillStyle = 'rgba(120,128,140,.16)';
  for (const l of nivel.locales) if (!l.exterior) { ctx.beginPath(); l.poly.forEach((q, i) => i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])); ctx.closePath(); ctx.fill(); }
  if (sol.el <= 0.5) { ctx.fillStyle = 'rgba(15,23,42,.45)'; ctx.fillRect(0, 0, nivel.ancho, nivel.alto); return; }
  ctx.fillStyle = 'rgba(15,23,42,.38)'; ctx.fill(path, 'nonzero');
}
export function dibujarRosa(ctx, w, h, sol, norte) {
  const cx = w - 62, cy = 74, r = 34, { n } = ejes(norte);
  ctx.save(); ctx.translate(cx, cy);
  ctx.beginPath(); ctx.arc(0, 0, r + 14, 0, 7); ctx.fillStyle = 'rgba(255,255,255,.93)'; ctx.fill(); ctx.strokeStyle = '#d9dde3'; ctx.lineWidth = 1; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-n[0] * r * 0.6, -n[1] * r * 0.6); ctx.lineTo(n[0] * r, n[1] * r); ctx.strokeStyle = '#1c2430'; ctx.lineWidth = 2; ctx.stroke();
  ctx.font = '700 12px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#1c2430';
  ctx.fillText('N', n[0] * (r + 7), n[1] * (r + 7));
  if (sol.el > 0) {
    const { hacia } = vectores(sol, norte), d = r * (1 - sol.el / 90 * 0.75);
    ctx.beginPath(); ctx.arc(hacia[0] * d, hacia[1] * d, 7, 0, 7); ctx.fillStyle = '#f59f00'; ctx.fill(); ctx.strokeStyle = '#e67700'; ctx.lineWidth = 1.5; ctx.stroke();
  }
  ctx.restore();
}
