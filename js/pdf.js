// Generación del PDF: planta con ubicaciones (vectorial), vista isométrica y listado.
import { espaciosDe, espaciosElegidos, areaTrabajo, esquinas, esRedondo, puntoEnPoly, ajustarTexto, posEstudiantes } from './niveles.js';
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
  const AZUL = [31, 78, 156], TINTA = [28, 36, 48], GRIS = [102, 112, 133], LINEA = [217, 221, 227];
  const limpio = t => String(t ?? '').replace(/✓\s*/g, '').replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();     // la tipografía del PDF no tiene esos signos
  const hora = proy.horaInicio && proy.horaFin ? `${proy.horaInicio} a ${proy.horaFin} h` : proy.horaInicio ? `${proy.horaInicio} h` : '';
  const cuando = [fechaLinda(proy.fecha), hora].filter(Boolean).join('  ·  ');
  const secciones = [];                    // para el índice de la portada
  // la página 1 es la portada: se completa al final, cuando ya se sabe en qué página quedó cada cosa
  const pagina = titulo => { doc.addPage(); if (titulo) secciones.push({ titulo, pag: doc.getNumberOfPages() }); };

  const encabezado = (sub) => {
    doc.setFillColor(...AZUL); doc.rect(M, M, 1.6, 13, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(...TINTA);
    doc.text(sub.split('  ·  ')[0], M + 5, M + 5.5);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...GRIS);
    const resto = sub.split('  ·  ').slice(1).join('  ·  ');
    doc.text(resto || (proy.nombre || 'Muestra'), M + 5, M + 11.5, { maxWidth: PW - 2 * M - 70 });
    doc.setFontSize(9); doc.text(proy.nombre || 'Muestra', PW - M, M + 5.5, { align: 'right' });
    if (cuando) doc.text(cuando, PW - M, M + 11.5, { align: 'right' });
    doc.setDrawColor(...LINEA); doc.setLineWidth(0.2); doc.line(M, M + 15.5, PW - M, M + 15.5);
  };

  // ---- datos de los equipos: quiénes son y dónde están (se numeran por lugar, en el orden en que se recorren) ----
  const equipos = [];
  for (const nivel of niveles) {
    const elegidos = espaciosElegidos(nivel, proy), todos = espaciosDe(nivel, proy);
    for (const it of proy.items.filter(i => i.nivel === nivel.id && i.etiqueta && (i.equipo || i.integrantes))) {
      const esp = elegidos.find(e => puntoEnPoly(it.x, it.y, e.poly)) || todos.filter(e => puntoEnPoly(it.x, it.y, e.poly)).sort((a, b) => a.area - b.area)[0];
      equipos.push({ it, nivel, lugar: esp ? esp.nombre : 'Sin lugar', area: esp ? esp.area : 0 });
    }
  }
  const ordenNiv = n => niveles.indexOf(n);
  equipos.sort((a, b) => ordenNiv(a.nivel) - ordenNiv(b.nivel) || a.lugar.localeCompare(b.lugar, 'es', { numeric: true }) || Math.round(a.it.y / 2.5) - Math.round(b.it.y / 2.5) || a.it.x - b.it.x);
  equipos.forEach((e, i) => { e.num = i + 1; });
  const numDe = new Map(equipos.map(e => [e.it.id, e.num]));
  const variosNiveles = new Set(equipos.map(e => e.nivel.id)).size > 1;
  const dondeDe = e => e.lugar + (variosNiveles ? ` (${e.nivel.nombre})` : '');

  if (equipos.length && op.lista !== false) directorio(doc, proy, equipos, { PW, PH, M, pagina, encabezado, limpio, dondeDe, AZUL, TINTA, GRIS, LINEA });

  const filas = [];       // listado general
  for (const nivel of niveles) {
    const items = proy.items.filter(i => i.nivel === nivel.id);
    const elegidos = espaciosElegidos(nivel, proy), todos = espaciosDe(nivel, proy);
    /** Dibuja una página de plano: la general del nivel o el detalle de un lugar. */
    const plano = (A, tituloIndice, titulo, general) => {
    pagina(tituloIndice); encabezado(titulo);
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
      if (it.modelo === 'zona' || it.modelo === 'stand' || it.modelo === 'techo') {
        doc.saveGraphicsState(); doc.setGState(new doc.GState({ opacity: 0.18 })); poligono(doc, pts, 'F'); doc.restoreGraphicsState();
        doc.setDrawColor(...col);
        if (it.modelo !== 'stand') { doc.setLineDashPattern([1, 0.7], 0); poligono(doc, pts, 'S'); doc.setLineDashPattern([], 0); }
        else {
          poligono(doc, pts, 'S'); doc.setLineWidth(Math.max(0.5, s * 0.08));
          const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
          const l = mix(pts[0], pts[3], 0.6), r = mix(pts[1], pts[2], 0.6);
          doc.line(l[0], l[1], pts[0][0], pts[0][1]); doc.line(pts[0][0], pts[0][1], pts[1][0], pts[1][1]); doc.line(pts[1][0], pts[1][1], r[0], r[1]);
        }
      } else if (it.modelo !== 'texto') poligono(doc, pts, 'FD');

      doc.setFillColor(240, 140, 0); doc.setDrawColor(255, 255, 255); doc.setLineWidth(0.05);
      for (const [ex, ey] of posEstudiantes(it)) doc.circle(X(ex), Y(ey), Math.max(0.25, 0.19 * s), 'FD');
      if (!it.etiqueta) continue;
      const esp = elegidos.find(e => puntoEnPoly(it.x, it.y, e.poly)) || todos.filter(e => puntoEnPoly(it.x, it.y, e.poly)).sort((a, b) => a.area - b.area)[0];
      const fila = { ref: '', etiqueta: it.etiqueta, elemento: it.nombre, medidas: `${m2(it.w)} × ${m2(it.d)} m`, est: it.estudiantes || '', grupo: it.grupo || '', integrantes: it.integrantes || '', espacio: esp?.nombre || '', nivel: nivel.nombre };
      if (general) filas.push(fila);
      let t = ajustarTexto(it.etiqueta, it.w * s, it.d * s, it.modelo === 'texto' ? 12 : 4.5);
      if (t.tam < 1.25) {          // no entra: se usa un número de referencia
        fila.ref = String(++ref);
        t = ajustarTexto(fila.ref, it.w * s, it.d * s, 3); t.tam = Math.max(t.tam, 1.1);
      }
      const claro = it.modelo === 'zona' || it.modelo === 'stand' || it.modelo === 'techo';
      doc.setTextColor(...(it.modelo === 'texto' ? col : rgb(claro ? '#1c2430' : contraste(it.color))));
      doc.setFont('helvetica', 'bold'); doc.setFontSize(t.tam * 72 / 25.4);
      let g = ((it.rot % 360) + 360) % 360; if (g > 90 && g <= 270) g -= 180;
      const a = g * Math.PI / 180, u = [Math.cos(a), Math.sin(a)], v = [-Math.sin(a), Math.cos(a)];
      t.lineas.forEach((l, i) => {
        const w = doc.getTextWidth(l), baja = (i - (t.lineas.length - 1) / 2) * t.tam * 1.12 + t.tam * 0.35;
        doc.text(l, X(it.x) - u[0] * w / 2 + v[0] * baja, Y(it.y) - u[1] * w / 2 + v[1] * baja, { angle: -g });
      });
    }

    // número de cada equipo, en una medalla junto a su mesa (es el de la lista)
    for (const it of items) {
      const n = numDe.get(it.id); if (!n) continue;
      const c = esquinas(it), cx = X(Math.min(...c.map(q => q[0]))), cy = Y(Math.min(...c.map(q => q[1]))), r = Math.max(1.5, Math.min(2.6, s * 0.42));
      doc.setFillColor(...TINTA); doc.setDrawColor(255, 255, 255); doc.setLineWidth(0.25); doc.circle(cx, cy, r, 'FD');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(r * 3.4); doc.setTextColor(255, 255, 255); doc.text(String(n), cx, cy + r * 0.38, { align: 'center' });
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

    };
    const nota = equipos.length ? '  ·  Los números corresponden a la lista de equipos' : '';
    plano(areaTrabajo(nivel, proy, 1.5), `Plano de ${nivel.nombre.toLowerCase()}`, `Plano de ${nivel.nombre.toLowerCase()}${elegidos.length ? '  ·  ' + elegidos.map(e => e.nombre).join(', ') : ''}${nota}`, true);
    // un plano de cerca por cada lugar con elementos, para ver bien dónde va cada equipo
    const conCosas = elegidos.filter(e => items.some(i => puntoEnPoly(i.x, i.y, e.poly)));
    if (conCosas.length > 1) for (const e of conCosas) {
      const xs = e.poly.map(q => q[0]), ys = e.poly.map(q => q[1]), mg = 1.8, eq = equipos.filter(q => q.nivel === nivel && q.lugar === e.nombre);
      plano({ x0: Math.min(...xs) - mg, y0: Math.min(...ys) - mg, x1: Math.max(...xs) + mg, y1: Math.max(...ys) + mg }, `Detalle: ${e.nombre}`,
        `${e.nombre}  ·  ${nivel.nombre} · ${Math.round(e.area)} m²${eq.length ? ` · ${eq.length} equipo${eq.length === 1 ? '' : 's'}: ${eq.map(q => q.num + ' ' + q.it.etiqueta).join(', ')}` : ''}`, false);
    }

    if (op.iso && op.capturaIso) {
      const url = op.capturaIso(nivel, 2400, 1500);
      if (url) {
        pagina(`Vista isométrica de ${nivel.nombre.toLowerCase()}`); encabezado(`Vista isométrica  ·  ${nivel.nombre}  ·  Altura aprox. ${m2(proy.altura)} m`);
        const y0 = M + 19, h = PH - y0 - M, w = PW - 2 * M, ar = 2400 / 1500;
        const iw = Math.min(w, h * ar), ih = iw / ar;
        doc.addImage(url, 'PNG', M + (w - iw) / 2, y0 + (h - ih) / 2, iw, ih, undefined, 'FAST');
      }
    }
  }

  for (const pg of op.paginas || []) {        // mapas capturados del plano: circulación, sol y sombras
    pagina(pg.titulo.split('  ·  ').slice(1).join(' · ') || pg.titulo); encabezado(pg.titulo.split('  ·  ').slice(1).concat(pg.titulo.split('  ·  ')[0]).join('  ·  '));
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(60, 68, 82);
    pg.lineas = pg.lineas.flatMap(l => doc.splitTextToSize(l, PW - 2 * M));          // los renglones largos se parten
    pg.lineas.forEach((l, i) => doc.text(l, M, M + 21 + i * 4.5));
    const y0 = M + 21 + pg.lineas.length * 4.5 + 1, h = PH - y0 - M - 4, w = PW - 2 * M, ar = pg.w / pg.h;
    const iw = Math.min(w, h * ar), ih = iw / ar;
    doc.addImage(pg.url, pg.tipo || 'JPEG', M + (w - iw) / 2, y0, iw, ih, undefined, 'FAST');
    doc.setFontSize(7.5); doc.setTextColor(102, 112, 133);
    doc.text(pg.pie, M, PH - M - 0.5);
  }

  if (op.lista !== false) materiales(doc, proy, niveles, filas.filter(f => !equipos.some(e => e.it.etiqueta === f.etiqueta)), { PW, PH, M, pagina, encabezado });

  // ---- portada ----
  doc.setPage(1);
  doc.setFillColor(...AZUL); doc.rect(0, 0, PW, 46, 'F');
  doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.text('ORGANIZACIÓN DE LA MUESTRA', M + 6, 17, { charSpace: 0.6 });
  doc.setFont('helvetica', 'bold'); doc.setFontSize(Math.min(30, Math.max(18, 30 * 38 / Math.max(38, (proy.nombre || 'Muestra').length)))); doc.text(proy.nombre || 'Muestra', M + 6, 31);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(12); doc.text([cuando, niveles.map(n => n.nombre).join(' y ')].filter(Boolean).join('   ·   '), M + 6, 40);
  const lugares = [...new Map(equipos.map(e => [dondeDe(e), e])).keys()];
  const todosLug = niveles.flatMap(n => espaciosElegidos(n, proy).map(e => e.nombre));
  const tarjetas = [[equipos.length, equipos.length === 1 ? 'equipo' : 'equipos'], [equipos.reduce((a, e) => a + (e.it.estudiantes | 0), 0), 'estudiantes'],
    [todosLug.length || lugares.length, 'lugares'], [equipos.reduce((a, e) => a + (e.it.mesas || 1), 0), 'mesas o stands para equipos']].filter(t => t[0]);
  const tw = 58, ty = 56;
  tarjetas.forEach(([n, t], i) => {
    const x = M + 6 + i * (tw + 6);
    doc.setFillColor(244, 246, 250); doc.roundedRect(x, ty, tw, 26, 2.5, 2.5, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(24); doc.setTextColor(...AZUL); doc.text(String(n), x + 6, ty + 13);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...GRIS); doc.text(t, x + 6, ty + 20.5);
  });
  let cy = ty + 40; const colA = M + 6, colB = PW / 2 + 6;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...TINTA); doc.text('En este documento', colA, cy); doc.text('Dónde es la muestra', colB, cy);
  doc.setDrawColor(...LINEA); doc.setLineWidth(0.2); doc.line(colA, cy + 2, PW / 2 - 6, cy + 2); doc.line(colB, cy + 2, PW - M - 6, cy + 2);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  secciones.slice(0, 16).forEach((sc, i) => {
    const y = cy + 9 + i * 6.2; doc.setTextColor(...TINTA); doc.text(doc.splitTextToSize(sc.titulo, PW / 2 - 6 - colA - 14)[0], colA, y);
    doc.setTextColor(...GRIS); doc.text(String(sc.pag), PW / 2 - 6, y, { align: 'right' });
  });
  const porLugar = (todosLug.length ? todosLug : lugares).map(l => [l, equipos.filter(e => e.lugar === l || dondeDe(e) === l).length]);
  porLugar.slice(0, 16).forEach(([l, n], i) => {
    const y = cy + 9 + i * 6.2; doc.setTextColor(...TINTA); doc.text(doc.splitTextToSize(l, PW - M - 6 - colB - 30)[0], colB, y);
    doc.setTextColor(...GRIS); doc.text(n ? `${n} equipo${n === 1 ? '' : 's'}` : '—', PW - M - 6, y, { align: 'right' });
  });

  const n = doc.getNumberOfPages();
  for (let i = 2; i <= n; i++) {
    doc.setPage(i); doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(150, 157, 170);
    doc.text(`${proy.nombre || 'Muestra'}${cuando ? '  ·  ' + cuando : ''}`, M, PH - 4);
    doc.text(`Página ${i} de ${n}`, PW - M, PH - 4, { align: 'right' });
  }
  return doc;
}

function poligono(doc, pts, estilo) {
  const rel = []; for (let i = 1; i < pts.length; i++) rel.push([pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]]);
  doc.lines(rel, pts[0][0], pts[0][1], [1, 1], estilo, true);
}

/** Lista de equipos: quiénes los integran y dónde van a estar; y después, lugar por lugar. */
function directorio(doc, proy, equipos, { PW, PH, M, pagina, encabezado, limpio, dondeDe, AZUL, TINTA, GRIS, LINEA }) {
  const W = PW - 2 * M, base = PH - M - 9;
  const C = [{ t: 'N.º', w: 11 }, { t: 'Equipo', w: 40 }, { t: 'Grupo', w: 15 }, { t: 'Integrantes', w: 0 }, { t: 'Dónde va a estar', w: 46 }, { t: 'Mesa', w: 34 }, { t: 'Pedido', w: 44 }];
  C[3].w = W - C.reduce((a, c) => a + c.w, 0); let x = M; C.forEach(c => { c.x = x; x += c.w; });
  let y;
  const cab = () => {
    doc.setFillColor(...TINTA); doc.rect(M, y, W, 6.5, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(255, 255, 255);
    C.forEach(c => doc.text(c.t, c.x + 2, y + 4.4)); y += 6.5;
  };
  const nueva = sigue => { pagina(sigue ? null : 'Equipos: quiénes son y dónde están'); encabezado(`Equipos: quiénes son y dónde están  ·  ${equipos.length} equipos · ${equipos.reduce((a, e) => a + (e.it.estudiantes | 0), 0)} estudiantes. El número es el que figura en el plano.`); y = M + 20; cab(); };
  nueva(false);
  // por categoría (o por grupo si no hay categorías) y, dentro, por orden alfabético
  const clave = e => e.it.categoria || '', grupos = [...new Set(equipos.map(clave))];
  let par = false;
  for (const g of grupos) {
    const lista = equipos.filter(e => clave(e) === g).sort((a, b) => a.it.etiqueta.localeCompare(b.it.etiqueta, 'es'));
    if (g) {
      if (y > base - 14) nueva(true);
      const col = rgb(lista[0].it.color);
      doc.setFillColor(...col); doc.rect(M, y, W, 6, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(...rgb(contraste(lista[0].it.color)));
      doc.text(`${g}  ·  ${lista.length} equipo${lista.length === 1 ? '' : 's'}`, M + 2, y + 4.2); y += 6; par = false;
    }
    for (const e of lista) {
      const it = e.it, mesa = `${it.mesas > 1 ? it.mesas + ' × ' : ''}${it.nombre}`;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
      const cel = [String(e.num), it.etiqueta, limpio(it.grupo), limpio(it.integrantes) || `${it.estudiantes | 0} estudiantes`, dondeDe(e), mesa, limpio(it.necesidad) || '—'];
      doc.setFont('helvetica', 'bold'); const l1 = doc.splitTextToSize(cel[1], C[1].w - 6);
      doc.setFont('helvetica', 'normal'); const lin = cel.map((t, i) => i === 1 ? l1 : doc.splitTextToSize(t, C[i].w - 4));
      const alto = Math.max(...lin.map(l => l.length)) * 3.7 + 3.2;
      if (y + alto > base) { nueva(true); par = false; }
      if (par) { doc.setFillColor(246, 247, 250); doc.rect(M, y, W, alto, 'F'); } par = !par;
      // número en medalla, como en el plano
      doc.setFillColor(...TINTA); doc.circle(C[0].x + 5, y + 4.1, 2.7, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(255, 255, 255); doc.text(cel[0], C[0].x + 5, y + 5.1, { align: 'center' });
      doc.setFillColor(...rgb(it.color)); doc.setDrawColor(120, 120, 120); doc.setLineWidth(0.1); doc.rect(C[1].x + 1.2, y + 2.4, 2.6, 2.6, 'FD');
      doc.setFontSize(8.5); doc.setTextColor(...TINTA); doc.text(l1, C[1].x + 5.2, y + 4.9);
      doc.setFont('helvetica', 'normal');
      lin.forEach((l, i) => { if (i < 2) return; doc.setTextColor(...(i === 4 ? AZUL : i === 6 ? GRIS : TINTA)); if (i === 4) doc.setFont('helvetica', 'bold'); doc.text(l, C[i].x + 2, y + 4.9); doc.setFont('helvetica', 'normal'); });
      doc.setDrawColor(...LINEA); doc.setLineWidth(0.1); doc.line(M, y + alto, M + W, y + alto); y += alto;
    }
    y += 2.5;
  }

  // ---- lugar por lugar: para quien arma cada salón ----
  pagina('Equipos por lugar'); encabezado('Equipos por lugar  ·  Qué equipos van en cada espacio, en el orden de sus números');
  y = M + 22; const cols = 3, cw = (W - (cols - 1) * 8) / cols; let col = 0, yTope = y;
  const lugares = [...new Set(equipos.map(dondeDe))];
  for (const l of lugares) {
    const lista = equipos.filter(e => dondeDe(e) === l).sort((a, b) => a.num - b.num), alto = 9 + lista.length * 5;
    if (y + Math.min(alto, 24) > base) { col++; y = yTope; if (col >= cols) { pagina(null); encabezado('Equipos por lugar  ·  Continuación'); col = 0; y = yTope; } }
    const x0 = M + col * (cw + 8);
    doc.setFillColor(230, 238, 251); doc.roundedRect(x0, y, cw, 7, 1.5, 1.5, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(...AZUL); doc.text(doc.splitTextToSize(l, cw - 30)[0], x0 + 2.5, y + 4.8);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...GRIS);
    doc.text(`${lista.length} equipo${lista.length === 1 ? '' : 's'} · ${lista.reduce((a, e) => a + (e.it.estudiantes | 0), 0)} estud.`, x0 + cw - 2.5, y + 4.8, { align: 'right' }); y += 10;
    for (const e of lista) {
      if (y > base) { col++; y = yTope; if (col >= cols) { pagina(null); encabezado('Equipos por lugar  ·  Continuación'); col = 0; } }
      const xx = M + col * (cw + 8);
      doc.setFillColor(...TINTA); doc.circle(xx + 3.5, y - 1.2, 2.3, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(255, 255, 255); doc.text(String(e.num), xx + 3.5, y - 0.3, { align: 'center' });
      doc.setFontSize(8.5); doc.setTextColor(...TINTA); doc.text(doc.splitTextToSize(e.it.etiqueta, cw - 34)[0], xx + 8, y);
      doc.setFont('helvetica', 'normal'); doc.setTextColor(...GRIS); doc.text([limpio(e.it.grupo), `${e.it.estudiantes | 0} est.`].filter(Boolean).join(' · '), xx + cw - 2.5, y, { align: 'right' });
      y += 5;
    }
    y += 5;
  }
}

function materiales(doc, proy, niveles, filas, { PW, PH, M, pagina, encabezado }) {

  let y;
  let primera = true;
  const nueva = () => { pagina(primera ? 'Mobiliario y otros elementos' : null); primera = false; encabezado('Mobiliario y otros elementos  ·  Qué hay que llevar a cada nivel'); y = M + 23; };
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
    const una = Math.round(it.w / (it.mesas || 1) * 100) / 100, k = [n.nombre, it.nombre, una, it.d, it.h].join('|');           // las mesas juntas se cuentan una por una
    const c = cuenta.get(k) || { nivel: n.nombre, elemento: it.nombre, medidas: `${m2(una)} × ${m2(it.d)}${it.h ? ' × ' + m2(it.h) : ''} m`, cant: 0 };
    c.cant += it.mesas || 1; cuenta.set(k, c);
  }
  tabla('Resumen de elementos', [{ t: 'Nivel', k: 'nivel', x: 0 }, { t: 'Elemento', k: 'elemento', x: W * 0.22 }, { t: 'Medidas (ancho × fondo × alto)', k: 'medidas', x: W * 0.55 }, { t: 'Cantidad', k: 'cant', x: W * 0.88 }], [...cuenta.values()]);
  tabla('Otros elementos con nombre', [{ t: 'Ref.', k: 'ref', x: 0 }, { t: 'Nombre', k: 'etiqueta', x: W * 0.07 }, { t: 'Elemento', k: 'elemento', x: W * 0.42 }, { t: 'Medidas', k: 'medidas', x: W * 0.6 }, { t: 'Espacio', k: 'espacio', x: W * 0.73 }, { t: 'Nivel', k: 'nivel', x: W * 0.89 }], filas);
}
