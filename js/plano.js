// Editor 2D: dibuja el plano del nivel y permite ubicar, mover y girar elementos.
import { proyecto, marcar, avisar, uid, catalogo, itemDesdeTipo } from './estado.js';
import { espaciosDe, puntoEnPoly, esquinas, aLocal, esRedondo, areaTrabajo, ajustarTexto } from './niveles.js';

export const ui = {
  herramienta: 'mover', seleccion: new Set(), iman: true, detalle: true,
  capa: null, ocultar: null,           // extras que dibuja la simulación de circulación
  nivel: null, alSeleccionar: () => {}, pedirNombre: async () => null, pista: () => {},
};

let canvas, ctx, dpr = 1;
const vista = { x: 0, y: 0, k: 8 };          // k = píxeles por metro; (x, y) = metro en la esquina sup. izq.
let pendiente = false;
let accion = null;                             // arrastre en curso
let hover = null;                              // espacio bajo el cursor
let trazo = [], cursor = null;                 // dibujo de espacio
let medida = [];                               // medir
const punteros = new Map();

const ACENTO = '#1f4e9c';
const aMundo = (px, py) => [vista.x + px / vista.k, vista.y + py / vista.k];
const iman = v => ui.iman ? Math.round(v / 0.05) * 0.05 : v;
/** Para dibujar y medir: se pega a la esquina de muro más cercana (a menos de 10 px); si no, a la grilla. */
function imanPunto(x, y) {
  if (!ui.iman) return [x, y];
  const S = ui.nivel.muros; let m = (10 / vista.k) ** 2, r = null;
  for (let i = 0; i < S.length; i += 2) { const d = (S[i] - x) ** 2 + (S[i + 1] - y) ** 2; if (d < m) { m = d; r = [S[i], S[i + 1]]; } }
  return r || [iman(x), iman(y)];
}
const itemsNivel = () => proyecto().items.filter(i => i.nivel === ui.nivel.id);
const seleccionados = () => itemsNivel().filter(i => ui.seleccion.has(i.id));

export function iniciar(c) {
  canvas = c; ctx = c.getContext('2d');
  new ResizeObserver(ajustar).observe(c);
  c.addEventListener('pointerdown', alBajar);
  c.addEventListener('pointermove', alMover);
  c.addEventListener('pointerup', alSoltar);
  c.addEventListener('pointercancel', alSoltar);
  c.addEventListener('dblclick', alDoble);
  c.addEventListener('wheel', alRueda, { passive: false });
  c.addEventListener('dragover', e => e.preventDefault());
  c.addEventListener('drop', alSoltarTipo);
  c.addEventListener('pointerleave', () => { hover = null; cursor = null; pedir(); });
  ajustar();
}

function ajustar() {
  dpr = window.devicePixelRatio || 1;
  const r = canvas.getBoundingClientRect();
  if (!r.width) return;
  canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
  pedir();
}
export function pedir() { if (!pendiente) { pendiente = true; requestAnimationFrame(() => { pendiente = false; dibujar(); }); } }

export function fijarNivel(n) { ui.nivel = n; ui.seleccion.clear(); trazo = []; medida = []; encuadrar(); }
export function fijarHerramienta(h) {
  ui.herramienta = h; trazo = []; medida = []; hover = null;
  canvas.style.cursor = h === 'mover' ? 'default' : 'crosshair';
  ui.pista({
    mover: '', espacios: 'Tocá un salón para elegirlo o quitarlo.',
    dibujar: 'Tocá para marcar cada esquina (se pega a las esquinas de los muros). Doble clic o Enter para cerrar el espacio. Esc cancela.',
    medir: 'Tocá dos puntos para medir la distancia.',
  }[h]);
  pedir();
}

export function encuadrar() {
  if (!ui.nivel) return;
  const r = canvas.getBoundingClientRect();
  if (!r.width) return;
  const a = areaTrabajo(ui.nivel, proyecto(), 2);
  const w = a.x1 - a.x0, h = a.y1 - a.y0, m = 40;
  vista.k = Math.max(1, Math.min((r.width - 2 * m) / w, (r.height - 2 * m - 30) / h, 160));
  vista.x = a.x0 - (r.width / vista.k - w) / 2;
  vista.y = a.y0 - (r.height / vista.k - h) / 2 - 15 / vista.k;
  pedir();
}
export const centroVista = () => { const r = canvas.getBoundingClientRect(); return aMundo(r.width / 2, r.height / 2); };

// ---------- dibujo ----------
export function dibujarItem(c, it, k, sel) {
  // c ya está en metros; k = px por metro (para grosores constantes en pantalla)
  c.save();
  c.translate(it.x, it.y); c.rotate(it.rot * Math.PI / 180);
  const w = it.w, d = it.d, px = 1 / k;
  c.lineWidth = (sel ? 2 : 1) * px; c.strokeStyle = sel ? ACENTO : 'rgba(0,0,0,.55)'; c.fillStyle = it.color;
  const forma = () => { c.beginPath(); if (esRedondo(it)) c.ellipse(0, 0, w / 2, d / 2, 0, 0, 2 * Math.PI); else c.rect(-w / 2, -d / 2, w, d); };
  if (it.modelo === 'zona') {
    forma(); c.globalAlpha = .16; c.fill(); c.globalAlpha = 1;
    c.setLineDash([6 * px, 4 * px]); c.strokeStyle = sel ? ACENTO : it.color; c.lineWidth = 1.5 * px; c.stroke(); c.setLineDash([]);
  } else if (it.modelo === 'texto') {
    if (sel) { forma(); c.setLineDash([3 * px, 3 * px]); c.stroke(); c.setLineDash([]); }
  } else if (it.modelo === 'stand') {
    forma(); c.globalAlpha = .18; c.fill(); c.globalAlpha = 1; c.stroke();
    c.beginPath(); c.moveTo(-w / 2, d / 2 * 0.2); c.lineTo(-w / 2, -d / 2); c.lineTo(w / 2, -d / 2); c.lineTo(w / 2, d / 2 * 0.2);
    c.strokeStyle = it.color; c.lineWidth = Math.max(0.08, 3 * px); c.lineJoin = 'miter'; c.stroke();
  } else {
    forma(); c.globalAlpha = .9; c.fill(); c.globalAlpha = 1; c.stroke();
    if (it.modelo === 'silla') {
      c.beginPath(); c.moveTo(-w / 2, -d / 2 + d * 0.16); c.lineTo(w / 2, -d / 2 + d * 0.16); c.strokeStyle = 'rgba(0,0,0,.5)'; c.lineWidth = px; c.stroke();
    }
  }
  if (it.etiqueta) {
    const t = ajustarTexto(it.etiqueta, w, d, it.modelo === 'texto' ? 5 : 0.35);
    if (t.tam * k >= 4.5) {
      const r = ((it.rot % 360) + 360) % 360;
      if (r > 90 && r <= 270) c.rotate(Math.PI);
      c.font = `600 ${t.tam}px system-ui, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillStyle = (it.modelo === 'zona' || it.modelo === 'stand') ? '#1c2430' : it.modelo === 'texto' ? it.color : contraste(it.color);
      t.lineas.forEach((l, i) => c.fillText(l, 0, (i - (t.lineas.length - 1) / 2) * t.tam * 1.12));
    }
  }
  c.restore();
}
export function contraste(hex) {
  const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#1c2430' : '#ffffff';
}

function dibujar() {
  const n = ui.nivel; if (!n || !canvas.width) return;
  const p = proyecto(), k = vista.k, px = 1 / k;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#fbfbfc'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(dpr * k, 0, 0, dpr * k, -vista.x * k * dpr, -vista.y * k * dpr);

  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, n.ancho, n.alto);
  const espacios = espaciosDe(n, p), elegidos = new Set(p.espacios);
  const trazar = e => { ctx.beginPath(); e.poly.forEach((q, i) => i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])); ctx.closePath(); };
  for (const e of espacios) if (elegidos.has(e.id)) { trazar(e); ctx.fillStyle = 'rgba(31,78,156,.10)'; ctx.fill(); }
  if (hover) { trazar(hover); ctx.fillStyle = 'rgba(31,78,156,.20)'; ctx.fill(); }

  if (ui.detalle) { ctx.lineWidth = Math.min(0.03, px * 0.8); ctx.strokeStyle = '#c5cad3'; ctx.stroke(n.paths.detalle); }
  ctx.lineWidth = Math.min(0.05, px); ctx.strokeStyle = '#7d9a8b'; ctx.stroke(n.paths.aberturas);
  ctx.lineWidth = Math.max(px * 1.1, Math.min(0.07, px * 2)); ctx.strokeStyle = '#1c2430'; ctx.stroke(n.paths.muros);

  for (const e of espacios) {
    const sel = elegidos.has(e.id);
    if (sel || e.propio || ui.herramienta === 'espacios') {
      trazar(e); ctx.lineWidth = (sel ? 2.5 : 1) * px; ctx.strokeStyle = sel ? ACENTO : 'rgba(31,78,156,.35)';
      if (!sel) ctx.setLineDash([5 * px, 4 * px]); ctx.stroke(); ctx.setLineDash([]);
    }
    if ((sel || ui.herramienta === 'espacios' || k > 9) && !(e.auto && !sel && ui.herramienta !== 'espacios')) {
      const tam = Math.max(11 * px, Math.min(0.45, 14 * px));
      ctx.font = `${sel ? 700 : 500} ${tam}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = sel ? ACENTO : '#8a94a3';
      const hayItems = sel && itemsNivel().length;
      if (!hayItems) ctx.fillText(e.nombre, e.cx, e.cy);
      else { const y = Math.min(...e.poly.map(q => q[1])); ctx.textBaseline = 'bottom'; ctx.fillText(e.nombre, e.cx, y - 3 * px); }
    }
  }

  const its = itemsNivel();
  for (const it of its) if (!ui.ocultar?.(it)) dibujarItem(ctx, it, k, ui.seleccion.has(it.id));
  ui.capa?.(ctx, k);

  // tirador de giro
  const sel = seleccionados();
  if (sel.length === 1 && ui.herramienta === 'mover') {
    const [hx, hy] = posTirador(sel[0]);
    const a = sel[0].rot * Math.PI / 180, bx = sel[0].x + Math.sin(a) * sel[0].d / 2, by = sel[0].y - Math.cos(a) * sel[0].d / 2;
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(hx, hy); ctx.strokeStyle = ACENTO; ctx.lineWidth = px; ctx.stroke();
    ctx.beginPath(); ctx.arc(hx, hy, 6 * px, 0, 2 * Math.PI); ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 2 * px; ctx.stroke();
  }
  if (accion?.tipo === 'marco') {
    const { x0, y0, x1, y1 } = accion;
    ctx.fillStyle = 'rgba(31,78,156,.08)'; ctx.strokeStyle = ACENTO; ctx.lineWidth = px; ctx.setLineDash([4 * px, 3 * px]);
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0); ctx.strokeRect(x0, y0, x1 - x0, y1 - y0); ctx.setLineDash([]);
  }
  // espacio en construcción
  if (trazo.length) {
    ctx.beginPath(); trazo.forEach((q, i) => i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]));
    if (cursor) ctx.lineTo(cursor[0], cursor[1]);
    ctx.strokeStyle = ACENTO; ctx.lineWidth = 2 * px; ctx.stroke();
    ctx.fillStyle = ACENTO; trazo.forEach(q => { ctx.beginPath(); ctx.arc(q[0], q[1], 3.5 * px, 0, 7); ctx.fill(); });
    if (cursor) cota(trazo[trazo.length - 1], cursor);
  }
  if (medida.length) {
    const b = medida[1] || cursor;
    if (b) { ctx.beginPath(); ctx.moveTo(...medida[0]); ctx.lineTo(...b); ctx.strokeStyle = '#d9480f'; ctx.lineWidth = 2 * px; ctx.stroke(); cota(medida[0], b, '#d9480f'); }
  }
  dibujarEscala();
}

function cota(a, b, color = ACENTO) {
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]); if (d < 0.01) return;
  const px = 1 / vista.k, t = d.toFixed(2).replace('.', ',') + ' m';
  ctx.font = `600 ${12 * px}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const x = (a[0] + b[0]) / 2, y = (a[1] + b[1]) / 2 - 12 * px, w = ctx.measureText(t).width + 8 * px;
  ctx.fillStyle = '#fff'; ctx.fillRect(x - w / 2, y - 9 * px, w, 18 * px);
  ctx.fillStyle = color; ctx.fillText(t, x, y);
}

function dibujarEscala() {
  const r = canvas.getBoundingClientRect();
  const pasos = [0.5, 1, 2, 5, 10, 20, 50]; const m = pasos.find(s => s * vista.k >= 70) || 50;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const x = r.width - 20 - m * vista.k, y = r.height - 18;
  ctx.strokeStyle = '#1c2430'; ctx.lineWidth = 1.5; ctx.beginPath();
  ctx.moveTo(x, y - 5); ctx.lineTo(x, y); ctx.lineTo(x + m * vista.k, y); ctx.lineTo(x + m * vista.k, y - 5); ctx.stroke();
  ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = '#1c2430'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.fillText(String(m).replace('.', ',') + ' m', x + m * vista.k / 2, y - 3);
}

// ---------- interacción ----------
function posTirador(it) {
  const a = it.rot * Math.PI / 180, dist = it.d / 2 + 22 / vista.k;
  return [it.x + Math.sin(a) * dist, it.y - Math.cos(a) * dist];
}
function itemEn(x, y) {
  const its = itemsNivel(), tol = 5 / vista.k;
  for (let i = its.length - 1; i >= 0; i--) {
    const it = its[i]; if (it.modelo === 'zona') continue;
    const [lx, ly] = aLocal(it, x, y);
    if (Math.abs(lx) <= it.w / 2 + tol && Math.abs(ly) <= it.d / 2 + tol) return it;
  }
  for (let i = its.length - 1; i >= 0; i--) {      // las zonas van por debajo de todo
    const it = its[i]; if (it.modelo !== 'zona') continue;
    const [lx, ly] = aLocal(it, x, y);
    if (Math.abs(lx) <= it.w / 2 && Math.abs(ly) <= it.d / 2) return it;
  }
  return null;
}
function espacioEn(x, y) {
  const c = espaciosDe(ui.nivel, proyecto()).filter(e => puntoEnPoly(x, y, e.poly));
  return c.sort((a, b) => a.area - b.area)[0] || null;
}
const pos = e => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

function alBajar(e) {
  if (!ui.nivel) return;
  canvas.focus(); canvas.setPointerCapture(e.pointerId);
  const [px, py] = pos(e); punteros.set(e.pointerId, [px, py]);
  if (punteros.size === 2) {                       // pellizco en pantallas táctiles
    const [a, b] = [...punteros.values()];
    accion = { tipo: 'pellizco', d: Math.hypot(a[0] - b[0], a[1] - b[1]), k: vista.k, m: aMundo((a[0] + b[0]) / 2, (a[1] + b[1]) / 2) };
    return;
  }
  const [x, y] = aMundo(px, py);
  const base = { px, py, movido: false };
  if (e.button === 1 || e.button === 2) { accion = { ...base, tipo: 'pan', vx: vista.x, vy: vista.y }; return; }
  if (ui.herramienta === 'mover') {
    const sel = seleccionados();
    if (sel.length === 1) {
      const [hx, hy] = posTirador(sel[0]);
      if (Math.hypot(x - hx, y - hy) < 10 / vista.k) { accion = { ...base, tipo: 'girar', it: sel[0] }; return; }
    }
    const it = itemEn(x, y);
    if (it) {
      if (e.shiftKey) { ui.seleccion.has(it.id) ? ui.seleccion.delete(it.id) : ui.seleccion.add(it.id); }
      else if (!ui.seleccion.has(it.id)) { ui.seleccion.clear(); ui.seleccion.add(it.id); }
      ui.alSeleccionar();
      accion = { ...base, tipo: 'arrastrar', x, y, origen: seleccionados().map(i => ({ i, x: i.x, y: i.y })), ancla: it };
      pedir(); return;
    }
    if (e.shiftKey) { accion = { ...base, tipo: 'marco', x0: x, y0: y, x1: x, y1: y }; return; }
  }
  accion = { ...base, tipo: 'pan', vx: vista.x, vy: vista.y, clic: true, x, y };
}

function alMover(e) {
  const [px, py] = pos(e);
  if (punteros.has(e.pointerId)) punteros.set(e.pointerId, [px, py]);
  const [x, y] = aMundo(px, py);
  if (accion?.tipo === 'pellizco' && punteros.size === 2) {
    const [a, b] = [...punteros.values()];
    vista.k = Math.max(1, Math.min(400, accion.k * Math.hypot(a[0] - b[0], a[1] - b[1]) / accion.d));
    vista.x = accion.m[0] - (a[0] + b[0]) / 2 / vista.k; vista.y = accion.m[1] - (a[1] + b[1]) / 2 / vista.k;
    pedir(); return;
  }
  if (!accion) {
    if (ui.herramienta === 'espacios') { const h = espacioEn(x, y); if (h?.id !== hover?.id) { hover = h; pedir(); } }
    if (ui.herramienta === 'dibujar' || ui.herramienta === 'medir') { cursor = imanPunto(x, y); pedir(); }
    if (ui.herramienta === 'mover') canvas.style.cursor = itemEn(x, y) ? 'move' : 'default';
    return;
  }
  if (!accion.movido && Math.hypot(px - accion.px, py - accion.py) < 4) return;
  if (accion.tipo === 'pan') { vista.x = accion.vx - (px - accion.px) / vista.k; vista.y = accion.vy - (py - accion.py) / vista.k; }
  else if (accion.tipo === 'arrastrar') {
    if (!accion.movido) marcar();
    const o = accion.origen.find(q => q.i === accion.ancla) || accion.origen[0];
    const dx = iman(o.x + x - accion.x) - o.x, dy = iman(o.y + y - accion.y) - o.y;
    accion.origen.forEach(q => { q.i.x = q.x + dx; q.i.y = q.y + dy; });
  } else if (accion.tipo === 'girar') {
    if (!accion.movido) marcar();
    let g = Math.atan2(x - accion.it.x, -(y - accion.it.y)) * 180 / Math.PI;
    if (!e.shiftKey) g = Math.round(g / 15) * 15;
    accion.it.rot = ((Math.round(g * 10) / 10) % 360 + 360) % 360;
    ui.pista(`Giro: ${accion.it.rot}°  ·  Shift = giro libre`);
  } else if (accion.tipo === 'marco') { accion.x1 = x; accion.y1 = y; }
  accion.movido = true; pedir();
}

function alSoltar(e) {
  punteros.delete(e.pointerId);
  const a = accion; accion = null;
  if (!a || a.tipo === 'pellizco') return;
  if (a.tipo === 'arrastrar' || a.tipo === 'girar') { if (a.movido) { avisar('items'); if (a.tipo === 'girar') ui.pista(''); } return; }
  if (a.tipo === 'marco') {
    const x0 = Math.min(a.x0, a.x1), x1 = Math.max(a.x0, a.x1), y0 = Math.min(a.y0, a.y1), y1 = Math.max(a.y0, a.y1);
    itemsNivel().forEach(i => { if (i.x >= x0 && i.x <= x1 && i.y >= y0 && i.y <= y1) ui.seleccion.add(i.id); });
    ui.alSeleccionar(); pedir(); return;
  }
  if (a.movido || !a.clic) return;
  // clic simple sobre el fondo
  const h = ui.herramienta;
  if (h === 'mover') { if (ui.seleccion.size) { ui.seleccion.clear(); ui.alSeleccionar(); pedir(); } }
  else if (h === 'espacios') {
    const esp = espacioEn(a.x, a.y);
    if (esp) { marcar(); const p = proyecto(); p.espacios = p.espacios.includes(esp.id) ? p.espacios.filter(i => i !== esp.id) : [...p.espacios, esp.id]; avisar('espacios'); }
  } else if (h === 'dibujar') {
    const q = imanPunto(a.x, a.y);
    if (trazo.length >= 3 && Math.hypot(q[0] - trazo[0][0], q[1] - trazo[0][1]) < 10 / vista.k) cerrarTrazo();
    else { trazo.push(q); pedir(); }
  } else if (h === 'medir') {
    const q = imanPunto(a.x, a.y);
    medida = medida.length === 1 ? [medida[0], q] : [q];
    if (medida.length === 2) ui.pista('Distancia: ' + Math.hypot(q[0] - medida[0][0], q[1] - medida[0][1]).toFixed(2).replace('.', ',') + ' m');
    pedir();
  }
}
function alDoble() { if (ui.herramienta === 'dibujar' && trazo.length >= 3) { trazo.pop(); cerrarTrazo(); } }

export async function cerrarTrazo() {
  if (trazo.length < 3) return;
  const poly = trazo; trazo = []; pedir();
  const nombre = await ui.pedirNombre('Nombre del espacio', 'Espacio propio');
  if (!nombre) return;
  marcar();
  const p = proyecto(), id = 'x-' + uid();
  p.propios.push({ id, nivel: ui.nivel.id, nombre, poly }); p.espacios.push(id);
  avisar('espacios');
}
export function cancelar() {
  if (trazo.length || medida.length) { trazo = []; medida = []; pedir(); return true; }
  return false;
}

function alRueda(e) {
  e.preventDefault();
  const [px, py] = pos(e), [x, y] = aMundo(px, py);
  const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
  vista.k = Math.max(1, Math.min(400, vista.k * f));
  vista.x = x - px / vista.k; vista.y = y - py / vista.k; pedir();
}

function alSoltarTipo(e) {
  e.preventDefault();
  const t = catalogo().find(c => c.id === e.dataTransfer.getData('text/plain')); if (!t) return;
  const [x, y] = aMundo(...pos(e)); agregar(t, iman(x), iman(y));
}
export function agregar(tipo, x, y) {
  if (!ui.nivel) return;
  if (x === undefined) {
    [x, y] = centroVista();
    const n = itemsNivel().filter(i => Math.abs(i.x - x) < 0.01 + 0.3 * 20 && i.tipo === tipo.id && Math.hypot(i.x - x, i.y - y) < 3).length;
    x = iman(x + n * 0.3); y = iman(y + n * 0.3);       // para que no caigan uno encima del otro
  }
  marcar();
  const it = itemDesdeTipo(tipo, x, y, ui.nivel.id);
  proyecto().items.push(it);
  ui.seleccion.clear(); ui.seleccion.add(it.id);
  if (ui.herramienta !== 'mover') ui.alHerramienta?.('mover');
  avisar('items'); ui.alSeleccionar();
}
/** Imagen del plano tal como se ve (para el PDF). */
export function imagen() { if (!canvas.width) return null; dibujar(); return { url: canvas.toDataURL('image/jpeg', 0.92), w: canvas.width, h: canvas.height }; }
export { seleccionados, itemsNivel };
