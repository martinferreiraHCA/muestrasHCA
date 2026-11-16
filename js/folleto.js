// Mapa ilustrado «Cómo llegar» para folletos: SVG vectorial, con capas con nombre para editarlo
// en Illustrator, Inkscape, Figma o Canva. Dibuja el predio, los edificios, los árboles y un
// caminito desde el punto de partida hasta la muestra.
import { Simulacion } from './sim.js';
import { espaciosElegidos, geo, centroide } from './niveles.js';

export const TEMAS = {
  calido: { nombre: 'Cálido', papel: '#FBF6EC', afuera: '#F3ECDD', cesped: '#DCE8CF', cesped2: '#CDE0BC', arena: '#F4E6C8', calle: '#E6DFD2', linea: '#FFFFFF',
    edif: '#FFFDF8', borde: '#D6C9B2', amb: '#E9DDC9', arbol: '#8FBF7F', arbol2: '#B4D8A3', cancha: '#A9D18E', acento: '#E8553D', sobreAcento: '#FFFFFF', tinta: '#2B2A28', suave: '#8A8275' },
  fresco: { nombre: 'Fresco', papel: '#F4F8FB', afuera: '#E9F0F5', cesped: '#D7EDE4', cesped2: '#C3E3D5', arena: '#EDF1E3', calle: '#DDE5EC', linea: '#FFFFFF',
    edif: '#FFFFFF', borde: '#C5D3E0', amb: '#DBE5EE', arbol: '#6FBF9B', arbol2: '#9AD8BC', cancha: '#9BD6B4', acento: '#2563EB', sobreAcento: '#FFFFFF', tinta: '#14213D', suave: '#6B7A90' },
  noche: { nombre: 'Noche', papel: '#0F172A', afuera: '#131C31', cesped: '#1B3A33', cesped2: '#21483E', arena: '#33384A', calle: '#1E293B', linea: '#475569',
    edif: '#2A3448', borde: '#4A5874', amb: '#3B4862', arbol: '#2F6B57', arbol2: '#3F8A70', cancha: '#2D5A4A', acento: '#FBBF24', sobreAcento: '#1F2937', tinta: '#F8FAFC', suave: '#9CA3AF' },
  tinta: { nombre: 'Tinta (blanco y negro)', papel: '#FFFFFF', afuera: '#FFFFFF', cesped: '#F4F4F4', cesped2: '#ECECEC', arena: '#FAFAFA', calle: '#EFEFEF', linea: '#FFFFFF',
    edif: '#FFFFFF', borde: '#1F1F1F', amb: '#BDBDBD', arbol: '#D9D9D9', arbol2: '#EDEDED', cancha: '#E4E4E4', acento: '#111111', sobreAcento: '#FFFFFF', tinta: '#111111', suave: '#555555' },
};
export const FORMATOS = { horizontal: [1600, 1200, 'Horizontal (4:3)'], cuadrado: [1400, 1400, 'Cuadrado'], vertical: [1200, 1600, 'Vertical (3:4)'] };
export const FOLLETO_DEF = { tema: 'calido', formato: 'horizontal', encuadre: 'recorrido', arboles: true, nombres: true, leyenda: true, titulo: '', subtitulo: '', partida: 'Entrada del colegio', llegada: '' };
const PARTIDA_PB = [102.4, 46.6];       // portón sobre la avenida, si no se marcó otro punto de partida
const FUENTE = "Poppins, 'Avenir Next', 'Segoe UI', Helvetica, Arial, sans-serif";

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const n1 = v => Math.round(v * 10) / 10;

/** Simplifica una poligonal (Douglas–Peucker). */
function simplificar(p, eps) {
  if (p.length < 3) return p;
  let dm = 0, im = 0; const [a, b] = [p[0], p[p.length - 1]], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-9;
  for (let i = 1; i < p.length - 1; i++) { const d = Math.abs((b[0] - a[0]) * (a[1] - p[i][1]) - (a[0] - p[i][0]) * (b[1] - a[1])) / l; if (d > dm) { dm = d; im = i; } }
  return dm <= eps ? [a, b] : [...simplificar(p.slice(0, im + 1), eps).slice(0, -1), ...simplificar(p.slice(im), eps)];
}
/** Curva suave que pasa por los puntos (Catmull-Rom convertido a Bézier). */
function curva(p) {
  if (p.length < 3) return 'M' + p.map(q => `${n1(q[0])},${n1(q[1])}`).join(' L');
  let d = `M${n1(p[0][0])},${n1(p[0][1])}`;
  for (let i = 0; i < p.length - 1; i++) {
    const a = p[Math.max(0, i - 1)], b = p[i], c = p[i + 1], e = p[Math.min(p.length - 1, i + 2)], t = 0.22;
    d += ` C${n1(b[0] + (c[0] - a[0]) * t)},${n1(b[1] + (c[1] - a[1]) * t)} ${n1(c[0] - (e[0] - b[0]) * t)},${n1(c[1] - (e[1] - b[1]) * t)} ${n1(c[0])},${n1(c[1])}`;
  }
  return d;
}
/** Puntos equiespaciados sobre una poligonal, con su dirección. */
function alLargo(p, paso, desde, hastaFin) {
  const r = []; let acum = 0, prox = desde;
  const total = p.reduce((s, q, i) => i ? s + Math.hypot(q[0] - p[i - 1][0], q[1] - p[i - 1][1]) : 0, 0);
  for (let i = 1; i < p.length; i++) {
    const dx = p[i][0] - p[i - 1][0], dy = p[i][1] - p[i - 1][1], l = Math.hypot(dx, dy);
    while (prox <= acum + l && prox < total - hastaFin) { const t = (prox - acum) / l; r.push([p[i - 1][0] + dx * t, p[i - 1][1] + dy * t, Math.atan2(dy, dx) * 180 / Math.PI]); prox += paso; }
    acum += l;
  }
  return r;
}

/**
 * Genera el mapa. `nivel` es la planta de la muestra y `suelo` la planta baja (patios y árboles).
 * Devuelve { svg, w, h, metros, aviso }.
 */
export function generarFolleto(nivel, suelo, proy, opciones = {}) {
  const op = { ...FOLLETO_DEF, ...opciones }, T = TEMAS[op.tema] || TEMAS.calido;
  const [W, H] = FORMATOS[op.formato] || FORMATOS.horizontal;
  const items = proy.items.filter(i => i.nivel === nivel.id);
  const destinos = espaciosElegidos(nivel, proy);
  let aviso = '';

  // --- recorrido ---
  const acc = items.find(i => i.tipo === 'acceso'), ent = items.find(i => i.tipo === 'entrada');
  const partida = acc ? [acc.x, acc.y] : nivel.id === 'pb' ? PARTIDA_PB : null;
  const principal = [...destinos].sort((a, b) => b.area - a.area)[0];
  const llegada = ent ? [ent.x, ent.y] : principal ? [principal.cx, principal.cy] : null;
  let ruta = null, metros = 0;
  if (!llegada) aviso = 'Elegí el espacio de la muestra (o marcá su Entrada) para trazar el recorrido.';
  else if (!partida) aviso = 'Marcá el punto de partida en este nivel (por ejemplo, la escalera por la que se llega).';
  else {
    const xs = [partida[0], llegada[0], ...destinos.flatMap(e => e.poly.map(q => q[0]))], ys = [partida[1], llegada[1], ...destinos.flatMap(e => e.poly.map(q => q[1]))];
    const circulos = nivel.id === 'pb' ? suelo.arboles.map(a => [a[0], a[1], Math.max(0.5, a[2] * 0.62)]) : [];      // el camino rodea los árboles
    const area = { circulos, x0: Math.max(0, Math.min(...xs) - 30), y0: Math.max(0, Math.min(...ys) - 30), x1: Math.min(nivel.ancho, Math.max(...xs) + 30), y1: Math.min(nivel.alto, Math.max(...ys) + 30) };
    // sin los marcadores ni muebles: el camino es por el edificio, no entre los stands
    const sim = new Simulacion(nivel, { ...proy, items: [] }, {}, 1, area);
    const cruda = sim.camino(partida, llegada, 1.4);
    if (!cruda) aviso = 'No encontré un camino a pie entre el punto de partida y la muestra. Probá mover el punto de partida.';
    else {
      ruta = simplificar(cruda, 0.8);
      metros = ruta.reduce((s, q, i) => i ? s + Math.hypot(q[0] - ruta[i - 1][0], q[1] - ruta[i - 1][1]) : 0, 0);
    }
  }

  // --- encuadre (en metros) ---
  const mx = 56, mArr = 214, mAb = op.leyenda ? 96 : 56;
  const fw = W - 2 * mx, fh = H - mArr - mAb;
  let v;
  if (op.encuadre === 'predio' || !ruta) v = { x0: 1, y0: 0.5, x1: 119, y1: 70.5 };
  else {
    const xs = [...ruta.map(q => q[0]), ...destinos.flatMap(e => e.poly.map(q => q[0]))], ys = [...ruta.map(q => q[1]), ...destinos.flatMap(e => e.poly.map(q => q[1]))];
    const m = Math.max(9, (Math.max(...xs) - Math.min(...xs)) * 0.16);
    v = { x0: Math.min(...xs) - m, y0: Math.min(...ys) - m, x1: Math.max(...xs) + m, y1: Math.max(...ys) + m };
  }
  const k = Math.min(fw / (v.x1 - v.x0), fh / (v.y1 - v.y0));           // px por metro
  const ox = mx + (fw - (v.x1 - v.x0) * k) / 2 - v.x0 * k, oy = mArr + (fh - (v.y1 - v.y0) * k) / 2 - v.y0 * k;
  const X = x => n1(ox + x * k), Y = y => n1(oy + y * k), P = q => `${X(q[0])},${Y(q[1])}`;
  const poli = (pts, attr) => `<polygon points="${pts.map(P).join(' ')}" ${attr}/>`;
  const visible = (x, y, r = 0) => X(x) > mx - r * k && X(x) < W - mx + r * k && Y(y) > mArr - r * k && Y(y) < H - mAb + r * k;
  const redondo = `stroke-linejoin="round" stroke-linecap="round"`;

  const capas = [];
  const capa = (id, nombre, cont) => { if (cont) capas.push(`<g id="${id}" data-name="${nombre}">\n${cont}\n</g>`); };

  // predio, calle, exteriores
  const pr = geo.predio?.length ? geo.predio : [[0, 0], [nivel.ancho, 0], [nivel.ancho, nivel.alto], [0, nivel.alto]];
  capa('predio', 'Predio', poli(pr, `fill="${T.cesped}" stroke="${T.cesped}" stroke-width="${n1(1.2 * k)}" ${redondo}`));
  if (pr.length === 4) {
    const a = pr[1], b = pr[2], an = 10, c = [(a[0] + b[0]) / 2 + an / 2 + 1.5, (a[1] + b[1]) / 2], g = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
    const calle = [[a[0] + 2.2, a[1] - 12], [a[0] + 2.2 + an, a[1] - 12], [b[0] + 2.2 + an, b[1] + 12], [b[0] + 2.2, b[1] + 12]];
    capa('calle', 'Calle', poli(calle, `fill="${T.calle}"`) +
      `\n<line x1="${X(a[0] + 2.2 + an / 2)}" y1="${Y(a[1] - 12)}" x2="${X(b[0] + 2.2 + an / 2)}" y2="${Y(b[1] + 12)}" stroke="${T.linea}" stroke-width="${n1(0.25 * k)}" stroke-dasharray="${n1(2 * k)} ${n1(2 * k)}"/>` +
      (geo.calle && visible(c[0], c[1]) ? `\n<text x="${X(c[0])}" y="${Y(c[1])}" transform="rotate(${n1(g)} ${X(c[0])} ${Y(c[1])})" text-anchor="middle" font-family="${FUENTE}" font-size="${n1(Math.max(13, 1.5 * k))}" font-weight="600" letter-spacing="${n1(0.3 * k)}" fill="${T.suave}">${esc(geo.calle.toUpperCase())}</text>` : ''));
  }
  const ext = suelo.locales.filter(l => l.exterior && !(nivel.id === 'pb' && proy.ocultos?.includes(l.id)));
  capa('exteriores', 'Patios y exteriores', ext.map(l => {
    const cancha = /cancha/i.test(l.nombre), verde = /arbolado|jard[ií]n/i.test(l.nombre), col = cancha ? T.cancha : verde ? T.cesped2 : T.arena;
    let s = poli(l.poly, `fill="${col}" stroke="${col}" stroke-width="${n1(0.9 * k)}" ${redondo}`);
    if (cancha) {
      const xs = l.poly.map(q => q[0]), ys = l.poly.map(q => q[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), lw = `fill="none" stroke="${T.linea}" stroke-width="${n1(0.18 * k)}"`;
      s += `\n<rect x="${X(x0 + 0.8)}" y="${Y(y0 + 0.8)}" width="${n1((x1 - x0 - 1.6) * k)}" height="${n1((y1 - y0 - 1.6) * k)}" rx="${n1(0.3 * k)}" ${lw}/>` +
        `<line x1="${X((x0 + x1) / 2)}" y1="${Y(y0 + 0.8)}" x2="${X((x0 + x1) / 2)}" y2="${Y(y1 - 0.8)}" ${lw}/><circle cx="${X((x0 + x1) / 2)}" cy="${Y((y0 + y1) / 2)}" r="${n1(1.8 * k)}" ${lw}/>`;
    }
    return s;
  }).join('\n'));

  // edificios
  const sombra = 0.9;
  capa('sombras-edificios', 'Sombras de edificios', nivel.huellas.map(h => poli(h.map(q => [q[0] + sombra, q[1] + sombra]), `fill="${T.tinta}" fill-opacity="0.13" stroke="${T.tinta}" stroke-opacity="0.13" stroke-width="${n1(0.5 * k)}" ${redondo}`)).join('\n'));
  capa('edificios', 'Edificios', nivel.huellas.map(h => poli(h, `fill="${T.edif}" stroke="${T.borde}" stroke-width="${n1(Math.max(1.5, 0.22 * k))}" ${redondo}`)).join('\n'));
  const idsDest = new Set(destinos.map(e => e.id));
  capa('ambientes', 'Divisiones interiores', nivel.locales.filter(l => !l.exterior && !idsDest.has(l.id) && !proy.ocultos?.includes(l.id))
    .map(l => poli(simplificar(l.poly, 0.22), `fill="none" stroke="${T.amb}" stroke-width="${n1(Math.max(1, 0.12 * k))}" ${redondo}`)).join('\n'));

  // árboles
  if (op.arboles) {
    const ar = suelo.arboles.filter(a => visible(a[0], a[1], a[2]));
    capa('arboles', 'Árboles', ar.map((a, i) => {
      const [x, y, r] = a, j = ((i * 37) % 11) / 11 - 0.5;
      return `<g><ellipse cx="${X(x + r * 0.22)}" cy="${Y(y + r * 0.28)}" rx="${n1(r * k)}" ry="${n1(r * k * 0.92)}" fill="${T.tinta}" fill-opacity="0.12"/>` +
        `<circle cx="${X(x)}" cy="${Y(y)}" r="${n1(r * k)}" fill="${T.arbol}"/>` +
        `<circle cx="${X(x - r * (0.22 + j * 0.1))}" cy="${Y(y - r * 0.24)}" r="${n1(r * k * 0.58)}" fill="${T.arbol2}"/></g>`;
    }).join('\n'));
  }

  // destino
  capa('destino', 'Lugar de la muestra', destinos.map(e => poli(e.poly, `fill="${T.acento}" fill-opacity="0.88" stroke="${T.sobreAcento}" stroke-width="${n1(Math.max(2, 0.3 * k))}" ${redondo}`)).join('\n'));

  // rótulos de exteriores y de los edificios
  const rot = [];
  const fPeq = Math.max(11, Math.min(17, 1.25 * k));
  if (op.nombres) for (const l of ext) {
    if (idsDest.has(l.id) || !visible(l.cx, l.cy)) continue;
    const xs = l.poly.map(q => q[0]), ancho = (Math.max(...xs) - Math.min(...xs)) * k, t = l.nombre.replace(/\s*\(.*\)/, '').toUpperCase();
    if (t.length * fPeq * 0.72 > ancho * 1.1) continue;
    const cx = l.cx, cy = l.cy;
    rot.push(`<text x="${X(cx)}" y="${Y(cy)}" text-anchor="middle" dominant-baseline="middle" font-family="${FUENTE}" font-size="${n1(fPeq)}" font-weight="600" letter-spacing="${n1(fPeq * 0.14)}" fill="${T.tinta}" fill-opacity="0.5">${esc(t)}</text>`);
  }

  // recorrido
  const marc = [];
  const pastilla = (x, y, texto, lado, fondo, color, tam = 19) => {
    const w = texto.length * tam * 0.58 + tam * 1.5, h = tam * 1.95, px = lado < 0 ? x - w - 20 : x + 20, py = y - h / 2;
    // si no entra de ese lado, se pasa al otro (nunca encima del marcador)
    const cx = px + w > W - mx - 6 ? Math.max(mx + 6, x - w - 20) : px < mx + 6 ? Math.min(W - mx - w - 6, x + 20) : px;
    return `<g><rect x="${n1(cx)}" y="${n1(py)}" width="${n1(w)}" height="${n1(h)}" rx="${n1(h / 2)}" fill="${fondo}" stroke="${T.tinta}" stroke-opacity="0.12"/>` +
      `<text x="${n1(cx + w / 2)}" y="${n1(py + h / 2 + 1)}" text-anchor="middle" dominant-baseline="middle" font-family="${FUENTE}" font-size="${tam}" font-weight="700" fill="${color}">${esc(texto)}</text></g>`;
  };
  if (ruta) {
    const px = ruta.map(q => [ox + q[0] * k, oy + q[1] * k]), d = curva(px);
    const gr = Math.max(6, Math.min(11, W / 170));
    capa('recorrido', 'Recorrido',
      `<path d="${d}" fill="none" stroke="${T.papel}" stroke-opacity="0.92" stroke-width="${n1(gr * 2.7)}" ${redondo}/>\n` +
      `<path d="${d}" fill="none" stroke="${T.acento}" stroke-width="${n1(gr)}" stroke-dasharray="0.1 ${n1(gr * 2.1)}" ${redondo}/>\n` +
      `<g id="flechas">` + alLargo(px, gr * 16, gr * 9, gr * 7).map(([x, y, a]) =>
        `<g transform="translate(${n1(x)} ${n1(y)}) rotate(${n1(a)})"><circle r="${n1(gr * 1.55)}" fill="${T.acento}"/><path d="M${n1(-gr * 0.45)},${n1(-gr * 0.7)} L${n1(gr * 0.55)},0 L${n1(-gr * 0.45)},${n1(gr * 0.7)}" fill="none" stroke="${T.sobreAcento}" stroke-width="${n1(gr * 0.36)}" ${redondo}/></g>`).join('') + `</g>`);
    const [sx, sy] = px[0], [ex, ey] = px[px.length - 1], R = gr * 1.9;
    marc.push(`<g id="partida"><circle cx="${n1(sx)}" cy="${n1(sy)}" r="${n1(R)}" fill="${T.papel}" stroke="${T.acento}" stroke-width="${n1(gr * 0.75)}"/><circle cx="${n1(sx)}" cy="${n1(sy)}" r="${n1(R * 0.38)}" fill="${T.acento}"/></g>`);
    const s = gr / 8;
    marc.push(`<g id="llegada" transform="translate(${n1(ex)} ${n1(ey)}) scale(${n1(s * 1.25)})"><ellipse cx="0" cy="2" rx="12" ry="4.5" fill="${T.tinta}" fill-opacity="0.22"/>` +
      `<path d="M0,0 C-13,-17 -23,-29 -23,-42 A23,23 0 1 1 23,-42 C23,-29 13,-17 0,0 Z" fill="${T.acento}" stroke="${T.sobreAcento}" stroke-width="3.5"/><circle cx="0" cy="-42" r="8.5" fill="${T.sobreAcento}"/></g>`);
    // los carteles van del lado contrario al que sigue el camino, para no taparlo
    const lejos = (a, b) => (b[0] - a[0] >= 0 ? -1 : 1), q1 = px[Math.min(px.length - 1, 4)], q2 = px[Math.max(0, px.length - 5)];
    const txtPartida = acc?.etiqueta && acc.etiqueta !== 'Acceso' ? acc.etiqueta : (op.partida === FOLLETO_DEF.partida && nivel.id !== 'pb' ? 'Punto de partida' : op.partida);
    if (txtPartida) marc.push(pastilla(sx, sy, txtPartida, lejos([sx, sy], q1), T.papel, T.tinta, 18));
    const nomLleg = op.llegada || principal?.nombre || 'Muestra';
    marc.push(pastilla(ex, ey - s * 52, nomLleg, lejos([ex, ey], q2), T.acento, T.sobreAcento, 21));
  } else for (const e of destinos) marc.push(pastilla(X(e.cx) - 20, Y(e.cy), e.nombre, 1, T.acento, T.sobreAcento, 20));
  capa('rotulos', 'Rótulos del mapa', rot.join('\n'));
  capa('marcadores', 'Marcadores y nombres', marc.join('\n'));

  // --- armado ---
  const titulo = op.titulo || proy.nombre || 'Muestra';
  const fecha = proy.fecha ? proy.fecha.split('-').reverse().join('/') : '';
  const hora = proy.horaInicio ? `${proy.horaInicio}${proy.horaFin ? ' a ' + proy.horaFin : ''} h` : '';
  const sub = op.subtitulo || [fecha, hora, nivel.nombre].filter(Boolean).join('  ·  ');
  const tamTit = Math.min(64, Math.max(34, (W - 2 * mx - 150) / (titulo.length * 0.56)));
  const minutos = Math.max(1, Math.round(metros / 70));
  const { n } = { n: [Math.sin((proy.norte ?? geo.norte ?? 0) * Math.PI / 180), -Math.cos((proy.norte ?? geo.norte ?? 0) * Math.PI / 180)] };
  const nx = W - mx - 46, ny = 112, gN = Math.atan2(n[0], -n[1]) * 180 / Math.PI;

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${FUENTE}">
<title>${esc(titulo)} · Cómo llegar</title>
<defs><clipPath id="marco-mapa"><rect x="${mx}" y="${mArr}" width="${fw}" height="${fh}" rx="34"/></clipPath></defs>
<g id="fondo" data-name="Fondo"><rect width="${W}" height="${H}" fill="${T.papel}"/></g>
<g id="mapa" data-name="Mapa" clip-path="url(#marco-mapa)">
<rect x="${mx}" y="${mArr}" width="${fw}" height="${fh}" fill="${T.afuera}"/>
${capas.join('\n')}
</g>
<rect x="${mx}" y="${mArr}" width="${fw}" height="${fh}" rx="34" fill="none" stroke="${T.tinta}" stroke-opacity="0.10" stroke-width="2"/>
<g id="encabezado" data-name="Encabezado">
<rect x="${mx}" y="58" width="74" height="9" rx="4.5" fill="${T.acento}"/>
<text x="${mx}" y="100" font-size="20" font-weight="700" letter-spacing="5" fill="${T.acento}">CÓMO LLEGAR</text>
<text x="${mx}" y="${n1(100 + tamTit * 0.98)}" font-size="${n1(tamTit)}" font-weight="800" fill="${T.tinta}">${esc(titulo)}</text>
<text x="${mx}" y="${n1(100 + tamTit * 0.98 + 34)}" font-size="22" font-weight="500" fill="${T.suave}">${esc(sub)}</text>
</g>
<g id="norte" data-name="Norte" transform="translate(${nx} ${ny})">
<circle r="34" fill="none" stroke="${T.tinta}" stroke-opacity="0.18" stroke-width="2"/>
<g transform="rotate(${n1(gN)})"><path d="M0,-25 L9,10 L0,4 L-9,10 Z" fill="${T.tinta}"/></g>
<text x="${n1(n[0] * 50)}" y="${n1(n[1] * 50)}" text-anchor="middle" dominant-baseline="middle" font-size="17" font-weight="700" fill="${T.tinta}">N</text>
</g>
${op.leyenda ? `<g id="leyenda" data-name="Leyenda" font-size="19" font-weight="500" fill="${T.tinta}">
${ruta ? `<line x1="${mx + 4}" y1="${H - 50}" x2="${mx + 74}" y2="${H - 50}" stroke="${T.acento}" stroke-width="8" stroke-dasharray="0.1 17" stroke-linecap="round"/>
<text x="${mx + 92}" y="${H - 43}">Recorrido a pie · unos ${Math.round(metros / 5) * 5} m, ${minutos} min</text>` : ''}
<rect x="${mx + (ruta ? 470 : 4)}" y="${H - 62}" width="26" height="24" rx="6" fill="${T.acento}"/>
<text x="${mx + (ruta ? 508 : 42)}" y="${H - 43}">Lugar de la muestra</text>
</g>` : ''}
</svg>`;
  return { svg, w: W, h: H, metros, aviso };
}

/** Convierte el SVG en PNG (data URL) al doble de resolución. */
export function aPNG(svg, w, h, escala = 2) {
  return new Promise((ok, mal) => {
    const img = new Image(), url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    img.onload = () => {
      const c = Object.assign(document.createElement('canvas'), { width: w * escala, height: h * escala });
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); ok(c.toDataURL('image/png'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); mal(new Error('No se pudo convertir el dibujo a imagen')); };
    img.src = url;
  });
}
