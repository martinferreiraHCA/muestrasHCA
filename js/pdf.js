// Generación del PDF: planta con ubicaciones (vectorial), vista isométrica y listado.
import { espaciosDe, espaciosElegidos, areaTrabajo, esquinas, esRedondo, puntoEnPoly, ajustarTexto } from './niveles.js';
import { contraste } from './plano.js';

const rgb = hex => { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const m2 = n => String(n).replace('.', ',');
const fechaLinda = f => { const [a, m, d] = (f || '').split('-'); return a ? `${d}/${m}/${a}` : ''; };

/** Recorta un segmento contra un rectángulo (Liang–Barsky). */
function recortar(x0, y0, x1, y1, r) {
  let t0 = 0, t1 = 1; const dx = x1 - x0, dy = y1 - y0;
  for (const [p, q] of [[-dx, x0 - r.x0], [dx, r.x1 - x0], [-dy, y0 - r.y0], [dy, r.y1 - y0]]) {
    if (p === 0) { if (q < 0) return null; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return null; if (t > t0) t0 = t; } else { if (t < t0) return null; if (t < t1) t1 = t; }
  }
  return [x0 + t0 * dx, y0 + t0 * dy, x0 + t1 * dx, y0 + t1 * dy];
}

/**
 * @param proy     muestra a exportar
 * @param niveles  niveles ya cargados que tienen espacios elegidos o elementos
 * @param op       { formato: 'a4'|'a3', iso: bool, lista: bool, detalle: bool, capturaIso(nivel) -> dataURL }
 */
export function generarPDF(proy, niveles, op) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: op.formato || 'a4' });
  const PW = doc.internal.pageSize.getWidth(), PH = doc.internal.pageSize.getHeight(), M = 10;
  let primera = true;
  const pagina = () => { if (!primera) doc.addPage(); primera = false; };

  const encabezado = (sub) => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(28, 36, 48);
    doc.text(proy.nombre || 'Muestra', M, M + 6);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(102, 112, 133);
    doc.text(sub, M, M + 12, { maxWidth: PW - 2 * M - 40 });
    if (proy.fecha) doc.text(fechaLinda(proy.fecha), PW - M, M + 6, { align: 'right' });
    doc.setDrawColor(217, 221, 227); doc.setLineWidth(0.2); doc.line(M, M + 15, PW - M, M + 15);
  };

  const filas = [];       // listado general
  for (const nivel of niveles) {
    const items = proy.items.filter(i => i.nivel === nivel.id);
    const elegidos = espaciosElegidos(nivel, proy), todos = espaciosDe(nivel, proy);
    const A = areaTrabajo(nivel, proy, 1.5);
    pagina();
    encabezado(`${nivel.nombre}${elegidos.length ? '  ·  ' + elegidos.map(e => e.nombre).join(', ') : ''}  ·  Altura aprox. ${m2(proy.altura)} m`);

    // marco del plano
    const fx = M, fy = M + 19, fw = PW - 2 * M, fh = PH - fy - M - 8;
    const aw = A.x1 - A.x0, ah = A.y1 - A.y0, s = Math.min(fw / aw, fh / ah);       // mm por metro
    const ox = fx + (fw - aw * s) / 2, oy = fy + (fh - ah * s) / 2;
    const X = x => ox + (x - A.x0) * s, Y = y => oy + (y - A.y0) * s;

    doc.setFillColor(230, 238, 251);
    for (const e of elegidos) poligono(doc, e.poly.map(p => [X(p[0]), Y(p[1])]), 'F');

    const capa = (seg, ancho, color) => {
      doc.setLineWidth(ancho); doc.setDrawColor(...color);
      for (let i = 0; i < seg.length; i += 4) {
        const c = recortar(seg[i], seg[i + 1], seg[i + 2], seg[i + 3], A);
        if (c) doc.line(X(c[0]), Y(c[1]), X(c[2]), Y(c[3]));
      }
    };
    if (op.detalle !== false) capa(nivel.detalle, 0.05, [190, 196, 205]);
    capa(nivel.aberturas, 0.08, [125, 154, 139]);
    capa(nivel.muros, Math.max(0.15, Math.min(0.4, s * 0.06)), [28, 36, 48]);

    doc.setDrawColor(31, 78, 156); doc.setLineWidth(0.35);
    for (const e of elegidos) poligono(doc, e.poly.map(p => [X(p[0]), Y(p[1])]), 'S');

    // nombres de los espacios (arriba de cada uno)
    doc.setFont('helvetica', 'bold'); doc.setTextColor(31, 78, 156);
    for (const e of elegidos) {
      const yTop = Math.min(...e.poly.map(p => p[1]));
      doc.setFontSize(Math.max(6, Math.min(11, s * 1.6)));
      doc.text(e.nombre, X(e.cx), Math.max(fy + 3, Y(yTop) - 1), { align: 'center' });
    }

    // elementos
    let ref = 0;
    const orden = [...items].sort((a, b) => (a.modelo === 'zona' ? 0 : 1) - (b.modelo === 'zona' ? 0 : 1));
    for (const it of orden) {
      const col = rgb(it.color);
      let pts;
      if (esRedondo(it)) {
        const a = it.rot * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a); pts = [];
        for (let i = 0; i < 32; i++) { const t = i / 32 * 2 * Math.PI, lx = Math.cos(t) * it.w / 2, ly = Math.sin(t) * it.d / 2; pts.push([X(it.x + lx * c - ly * sn), Y(it.y + lx * sn + ly * c)]); }
      } else pts = esquinas(it).map(p => [X(p[0]), Y(p[1])]);
      doc.setLineWidth(0.12); doc.setDrawColor(60, 60, 60); doc.setFillColor(...col);
      if (it.modelo === 'zona' || it.modelo === 'stand') {
        doc.saveGraphicsState(); doc.setGState(new doc.GState({ opacity: 0.18 })); poligono(doc, pts, 'F'); doc.restoreGraphicsState();
        doc.setDrawColor(...col);
        if (it.modelo === 'zona') { doc.setLineDashPattern([1, 0.7], 0); poligono(doc, pts, 'S'); doc.setLineDashPattern([], 0); }
        else {
          poligono(doc, pts, 'S'); doc.setLineWidth(Math.max(0.5, s * 0.08));
          const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
          const l = mix(pts[0], pts[3], 0.6), r = mix(pts[1], pts[2], 0.6);
          doc.line(l[0], l[1], pts[0][0], pts[0][1]); doc.line(pts[0][0], pts[0][1], pts[1][0], pts[1][1]); doc.line(pts[1][0], pts[1][1], r[0], r[1]);
        }
      } else if (it.modelo !== 'texto') poligono(doc, pts, 'FD');

      if (!it.etiqueta) continue;
      const esp = elegidos.find(e => puntoEnPoly(it.x, it.y, e.poly)) || todos.filter(e => puntoEnPoly(it.x, it.y, e.poly)).sort((a, b) => a.area - b.area)[0];
      const fila = { ref: '', etiqueta: it.etiqueta, elemento: it.nombre, medidas: `${m2(it.w)} × ${m2(it.d)} m`, espacio: esp?.nombre || '', nivel: nivel.nombre };
      filas.push(fila);
      let t = ajustarTexto(it.etiqueta, it.w * s, it.d * s, it.modelo === 'texto' ? 12 : 4.5);
      if (t.tam < 1.25) {          // no entra: se usa un número de referencia
        fila.ref = String(++ref);
        t = ajustarTexto(fila.ref, it.w * s, it.d * s, 3); t.tam = Math.max(t.tam, 1.1);
      }
      const claro = it.modelo === 'zona' || it.modelo === 'stand';
      doc.setTextColor(...(it.modelo === 'texto' ? col : rgb(claro ? '#1c2430' : contraste(it.color))));
      doc.setFont('helvetica', 'bold'); doc.setFontSize(t.tam * 72 / 25.4);
      let g = ((it.rot % 360) + 360) % 360; if (g > 90 && g <= 270) g -= 180;
      const a = g * Math.PI / 180, u = [Math.cos(a), Math.sin(a)], v = [-Math.sin(a), Math.cos(a)];
      t.lineas.forEach((l, i) => {
        const w = doc.getTextWidth(l), baja = (i - (t.lineas.length - 1) / 2) * t.tam * 1.12 + t.tam * 0.35;
        doc.text(l, X(it.x) - u[0] * w / 2 + v[0] * baja, Y(it.y) - u[1] * w / 2 + v[1] * baja, { angle: -g });
      });
    }

    // marco, escala y pie
    doc.setDrawColor(217, 221, 227); doc.setLineWidth(0.2); doc.rect(fx, fy, fw, fh);
    const paso = [0.5, 1, 2, 5, 10, 20].find(p => p * s >= 18) || 20;
    const ex = PW - M - paso * s, ey = PH - M - 1;
    doc.setDrawColor(28, 36, 48); doc.setLineWidth(0.3);
    doc.line(ex, ey - 1.5, ex, ey); doc.line(ex, ey, ex + paso * s, ey); doc.line(ex + paso * s, ey - 1.5, ex + paso * s, ey);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(28, 36, 48);
    doc.text(`${m2(paso)} m`, ex + paso * s / 2, ey - 1.2, { align: 'center' });
    doc.setTextColor(102, 112, 133);
    doc.text(`Escala aprox. 1:${Math.round(1000 / s / 5) * 5}   ·   ${items.length} elemento${items.length === 1 ? '' : 's'}`, M, ey);

    if (op.iso && op.capturaIso) {
      const url = op.capturaIso(nivel, 2400, 1500);
      if (url) {
        pagina(); encabezado(`${nivel.nombre}  ·  Vista isométrica  ·  Altura aprox. ${m2(proy.altura)} m`);
        const y0 = M + 19, h = PH - y0 - M, w = PW - 2 * M, ar = 2400 / 1500;
        const iw = Math.min(w, h * ar), ih = iw / ar;
        doc.addImage(url, 'PNG', M + (w - iw) / 2, y0 + (h - ih) / 2, iw, ih, undefined, 'FAST');
      }
    }
  }

  if (op.lista !== false) listado(doc, proy, niveles, filas, { PW, PH, M, pagina, encabezado });

  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i); doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(150, 157, 170);
    doc.text(`Página ${i} de ${n}`, PW / 2, PH - 4, { align: 'center' });
  }
  return doc;
}

function poligono(doc, pts, estilo) {
  const rel = []; for (let i = 1; i < pts.length; i++) rel.push([pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]]);
  doc.lines(rel, pts[0][0], pts[0][1], [1, 1], estilo, true);
}

function listado(doc, proy, niveles, filas, { PW, PH, M, pagina, encabezado }) {
  let y;
  const nueva = () => { pagina(); encabezado('Listado de elementos y ubicaciones'); y = M + 23; };
  const tabla = (titulo, cols, datos) => {
    if (!datos.length) return;
    if (y > PH - 40) nueva();
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(28, 36, 48); doc.text(titulo, M, y); y += 5;
    const cab = () => {
      doc.setFillColor(238, 240, 243); doc.rect(M, y - 4, PW - 2 * M, 6, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(60, 68, 82);
      cols.forEach(c => doc.text(c.t, M + c.x + 1.5, y)); y += 6;
    };
    cab();
    for (const f of datos) {
      if (y > PH - M - 8) { nueva(); cab(); }
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(28, 36, 48);
      cols.forEach((c, i) => {
        const ancho = (cols[i + 1]?.x ?? PW - 2 * M) - c.x - 3;
        let t = String(f[c.k] ?? ''); while (t.length > 3 && doc.getTextWidth(t) > ancho) t = t.slice(0, -2) + '…';
        doc.text(t, M + c.x + 1.5, y);
      });
      doc.setDrawColor(232, 235, 239); doc.setLineWidth(0.1); doc.line(M, y + 1.6, PW - M, y + 1.6); y += 5.4;
    }
    y += 6;
  };
  nueva();
  const W = PW - 2 * M;
  // resumen por tipo y nivel
  const cuenta = new Map();
  for (const n of niveles) for (const it of proy.items.filter(i => i.nivel === n.id)) {
    const k = [n.nombre, it.nombre, it.w, it.d, it.h].join('|');
    const c = cuenta.get(k) || { nivel: n.nombre, elemento: it.nombre, medidas: `${m2(it.w)} × ${m2(it.d)}${it.h ? ' × ' + m2(it.h) : ''} m`, cant: 0 };
    c.cant++; cuenta.set(k, c);
  }
  tabla('Resumen de elementos', [{ t: 'Nivel', k: 'nivel', x: 0 }, { t: 'Elemento', k: 'elemento', x: W * 0.22 }, { t: 'Medidas (ancho × fondo × alto)', k: 'medidas', x: W * 0.55 }, { t: 'Cantidad', k: 'cant', x: W * 0.88 }], [...cuenta.values()]);
  tabla('Ubicaciones con nombre', [{ t: 'Ref.', k: 'ref', x: 0 }, { t: 'Nombre', k: 'etiqueta', x: W * 0.07 }, { t: 'Elemento', k: 'elemento', x: W * 0.42 }, { t: 'Medidas', k: 'medidas', x: W * 0.6 }, { t: 'Espacio', k: 'espacio', x: W * 0.73 }, { t: 'Nivel', k: 'nivel', x: W * 0.89 }], filas);
}
