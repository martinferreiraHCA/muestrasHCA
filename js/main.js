// Interfaz: une el estado, el editor 2D, la vista isométrica y la exportación.
import * as E from './estado.js';
import { proyecto, marcar, avisar, uid } from './estado.js';
import { cargarIndice, cargarNivel, espaciosDe, espaciosElegidos } from './niveles.js';
import * as P from './plano.js';
import { ui } from './plano.js';
import { generarPDF } from './pdf.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = (v, min, max, def) => { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? Math.max(min, Math.min(max, n)) : def; };

let indice = [], nivel = null, iso = null, vistaIso = false, portapapeles = [], editandoPanel = false;

// ---------- utilidades de interfaz ----------
let tAviso;
function aviso(t) { const a = $('aviso'); a.textContent = t; a.classList.add('visible'); clearTimeout(tAviso); tAviso = setTimeout(() => a.classList.remove('visible'), 2600); }

/** Muestra un diálogo con un formulario. Devuelve los valores, o null si se cancela. */
function dialogo(html) {
  const d = $('dlg');
  d.innerHTML = `<form method="dialog">${html}</form>`;
  return new Promise(res => {
    d.onclose = () => {
      if (!d.returnValue || d.returnValue === 'cancelar') return res(null);
      const o = { _accion: d.returnValue };
      d.querySelectorAll('[name]').forEach(el => { o[el.name] = el.type === 'checkbox' ? el.checked : el.value; });
      res(o);
    };
    d.showModal();
    const primero = d.querySelector('input[type=text], input[type=number]'); primero?.select();
  });
}
const pie = (ok = 'Aceptar', extra = '') => `<div class="pie">${extra}<button value="cancelar" formnovalidate>Cancelar</button><button value="ok" class="primario">${ok}</button></div>`;
async function pedirNombre(titulo, valor = '') {
  const r = await dialogo(`<h3>${esc(titulo)}</h3><label>Nombre<input name="nombre" type="text" required value="${esc(valor)}"></label>${pie()}`);
  return r?.nombre.trim() || null;
}
async function confirmar(texto, ok = 'Eliminar') {
  return !!(await dialogo(`<h3>${esc(texto)}</h3>${pie(ok)}`));
}
function descargar(nombre, contenido, tipo) {
  const a = document.createElement('a');
  a.href = contenido.startsWith?.('data:') ? contenido : URL.createObjectURL(new Blob([contenido], { type: tipo }));
  a.download = nombre; a.click();
}
const archivo = s => (s || 'muestra').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'muestra';

// ---------- nivel y vistas ----------
async function fijarNivel(id, encuadrar = true) {
  const info = indice.find(n => n.id === id) || indice.find(n => n.id === 'pb') || indice[0];
  $('cargando').classList.remove('oculto');
  try {
    nivel = await cargarNivel(info);
  } catch (e) { $('cargando').textContent = 'No se pudo cargar el plano. ' + e.message; return; }
  $('cargando').classList.add('oculto');
  $('selNivel').value = nivel.id;
  if (encuadrar) P.fijarNivel(nivel); else { ui.nivel = nivel; P.pedir(); }
  pintarTodo();
}

const opIso = () => ({ muros: $('selMuros').value, etiquetas: $('chkEtiquetas3d').checked });
async function asegurarIso() {
  if (!iso) { iso = await import('./iso.js'); iso.iniciarIso($('iso')); }
  return iso;
}
async function verIso(si) {
  vistaIso = si;
  $('tabPlano').classList.toggle('activo', !si); $('tabIso').classList.toggle('activo', si);
  $('plano').classList.toggle('oculto', si); $('iso').classList.toggle('oculto', !si);
  $('herramientas').classList.toggle('oculto', si); $('herramientasIso').classList.toggle('oculto', !si);
  if (si) {
    try { await asegurarIso(); } catch (e) { aviso('No se pudo iniciar la vista 3D en este navegador.'); return verIso(false); }
    iso.actualizarIso(nivel, proyecto(), opIso()); iso.mostrarIso(true);
    ui.pista('Arrastrá para orbitar · rueda para acercar · botón derecho para desplazar');
  } else { iso?.mostrarIso(false); ui.pista(''); P.pedir(); }
}

// ---------- paneles ----------
function pintarBarra() {
  const p = proyecto();
  $('selProyecto').innerHTML = E.estado.proyectos.map(q => `<option value="${q.id}" ${q.id === p.id ? 'selected' : ''}>${esc(q.nombre || 'Sin nombre')}</option>`).join('');
  if (document.activeElement !== $('inNombre')) $('inNombre').value = p.nombre;
  $('inFecha').value = p.fecha || ''; if (document.activeElement !== $('inAltura')) $('inAltura').value = p.altura;
  $('btnDeshacer').disabled = !E.puedeDeshacer(); $('btnRehacer').disabled = !E.puedeRehacer();
}

function pintarEspacios() {
  if (!nivel) return;
  const p = proyecto(), f = $('inBuscarEsp').value.trim().toLowerCase();
  const todos = espaciosDe(nivel, p), sel = todos.filter(e => p.espacios.includes(e.id));
  $('resEspacios').textContent = sel.length ? `${sel.length} · ${Math.round(sel.reduce((a, e) => a + e.area, 0))} m²` : 'ninguno';
  const lista = todos.filter(e => !f || e.nombre.toLowerCase().includes(f))
    .sort((a, b) => (p.espacios.includes(b.id) - p.espacios.includes(a.id)) || (!!b.propio - !!a.propio) || (!!a.auto - !!b.auto) || a.nombre.localeCompare(b.nombre, 'es', { numeric: true }));
  $('listaEspacios').innerHTML = lista.map(e => `
    <div class="esp ${p.espacios.includes(e.id) ? 'sel' : ''}" data-id="${e.id}">
      <input type="checkbox" ${p.espacios.includes(e.id) ? 'checked' : ''} aria-label="Elegir ${esc(e.nombre)}">
      <span class="n" title="${esc(e.nombre)}">${esc(e.nombre)}</span><span class="a">${Math.round(e.area)} m²</span>
      <button data-a="renombrar" title="Cambiar nombre">✎</button>${e.propio ? '<button data-a="borrar" title="Eliminar espacio">✕</button>' : ''}
    </div>`).join('') || '<div class="vacio">No hay espacios con ese nombre. Podés dibujar uno con «Dibujar espacio».</div>';
}

function pintarCatalogo() {
  const propios = new Set(E.estado.catalogoPropio.map(t => t.id));
  $('catalogo').innerHTML = E.catalogo().map(t => `
    <button class="tipo" draggable="true" data-id="${t.id}" title="Agregar ${esc(t.nombre)}">
      <span class="muestra ${t.modelo === 'mesa-redonda' || t.modelo === 'cilindro' ? 'redonda' : ''}" style="background:${t.color}"></span>
      <span><b>${esc(t.nombre)}</b><small>${t.w} × ${t.d} m</small></span>
      ${propios.has(t.id) ? '<span class="editar" data-a="editar" title="Editar este elemento">✎</span>' : ''}
    </button>`).join('');
}

function pintarPanel() {
  if (editandoPanel) return;
  const sel = P.seleccionados(), el = $('panelDer');
  if (!nivel) return;
  if (!sel.length) {
    const its = P.itemsNivel(), cuenta = new Map();
    its.forEach(i => cuenta.set(i.nombre, (cuenta.get(i.nombre) || 0) + 1));
    el.innerHTML = `
      <section><h2>Resumen · ${esc(nivel.nombre)}</h2>
        ${its.length ? `<table class="resumen">${[...cuenta].map(([n, c]) => `<tr><td>${esc(n)}</td><td>${c}</td></tr>`).join('')}
          <tr><td><b>Total</b></td><td><b>${its.length}</b></td></tr></table>` : '<p class="ayuda">Todavía no hay elementos en este nivel. Elegí los espacios y agregá mesas, sillas o stands desde la columna izquierda.</p>'}
      </section>
      <section><h2>Atajos</h2><ul class="atajos">
        <li><kbd>Supr</kbd> eliminar · <kbd>Ctrl</kbd>+<kbd>D</kbd> duplicar</li>
        <li><kbd>R</kbd> girar 90° · <kbd>Shift</kbd>+<kbd>R</kbd> 15°</li>
        <li><kbd>←↑↓→</kbd> mover 5 cm (<kbd>Shift</kbd> 50 cm)</li>
        <li><kbd>Shift</kbd>+arrastrar: selección múltiple</li>
        <li><kbd>Ctrl</kbd>+<kbd>C</kbd> / <kbd>V</kbd> copiar y pegar</li>
        <li><kbd>Ctrl</kbd>+<kbd>Z</kbd> deshacer · <kbd>F</kbd> encuadrar</li>
        <li>Rueda: zoom · arrastrar el fondo: desplazar</li></ul></section>`;
    return;
  }
  const u = sel[0], varios = sel.length > 1;
  const comun = k => sel.every(i => i[k] === u[k]) ? u[k] : '';
  el.innerHTML = `
    <section><h2>${varios ? sel.length + ' elementos' : esc(u.nombre)}</h2>
      <label>Nombre en el plano<input id="pEtiqueta" type="text" value="${esc(comun('etiqueta'))}" placeholder="${varios ? 'Mismo texto para todos' : 'Ej.: Stand 3 · 5.º B'}"></label>
      <div class="fila3">
        <label>Ancho (m)<input id="pW" type="number" min="0.05" max="60" step="0.05" value="${comun('w')}"></label>
        <label>Fondo (m)<input id="pD" type="number" min="0.02" max="60" step="0.05" value="${comun('d')}"></label>
        <label>Alto (m)<input id="pH" type="number" min="0" max="8" step="0.05" value="${comun('h')}"></label>
      </div>
      <div class="fila2">
        <label>Giro (°)<input id="pRot" type="number" step="5" value="${comun('rot')}"></label>
        <label>Color<input id="pColor" type="color" value="${comun('color') || '#888888'}"></label>
      </div>
      <div class="botones">
        <button id="pDup">Duplicar</button><button id="pGirar">Girar 90°</button>
        <button id="pFrente" title="Dibujar por encima de los demás">Al frente</button>
        <button id="pBorrar" class="peligro">Eliminar</button>
      </div>
    </section>
    <section><h2>Repetir en filas</h2>
      <p class="ayuda">Crea copias en grilla a partir de ${varios ? 'la selección' : 'este elemento'} (ideal para filas de sillas o stands).</p>
      <div class="fila2">
        <label>Columnas<input id="gCols" type="number" min="1" max="60" value="5"></label>
        <label>Filas<input id="gFilas" type="number" min="1" max="60" value="1"></label>
        <label>Separación → (m)<input id="gSx" type="number" min="0" max="20" step="0.05" value="0.1"></label>
        <label>Separación ↓ (m)<input id="gSy" type="number" min="0" max="20" step="0.05" value="0.6"></label>
      </div>
      <button id="gCrear" class="ancho">Crear grilla</button>
    </section>
    ${varios ? `<section><h2>Numerar</h2>
      <p class="ayuda">Pone nombres correlativos, ordenados de arriba abajo y de izquierda a derecha.</p>
      <div class="fila2"><label>Texto<input id="nPref" type="text" value="${esc(u.nombre)} "></label>
      <label>Desde<input id="nDesde" type="number" value="1"></label></div>
      <button id="nAplicar" class="ancho">Numerar selección</button></section>` : ''}`;

  // edición en vivo: una sola marca de deshacer por campo enfocado
  const vivo = (id, aplicar) => {
    const inp = $(id); let marcado = false;
    inp.addEventListener('focus', () => { marcado = false; });
    inp.addEventListener('input', () => {
      if (!marcado) { marcar(); marcado = true; }
      aplicar(inp.value); editandoPanel = true; avisar('items'); editandoPanel = false;
    });
  };
  vivo('pEtiqueta', v => sel.forEach(i => { i.etiqueta = v; }));
  vivo('pW', v => { const n = num(v, 0.05, 60, null); if (n) sel.forEach(i => { i.w = n; }); });
  vivo('pD', v => { const n = num(v, 0.02, 60, null); if (n) sel.forEach(i => { i.d = n; }); });
  vivo('pH', v => { const n = num(v, 0, 8, null); if (n !== null) sel.forEach(i => { i.h = n; }); });
  vivo('pRot', v => { const n = num(v, -3600, 3600, null); if (n !== null) sel.forEach(i => { i.rot = ((n % 360) + 360) % 360; }); });
  vivo('pColor', v => sel.forEach(i => { i.color = v; }));
  $('pDup').onclick = duplicar; $('pBorrar').onclick = borrar; $('pGirar').onclick = () => girarSel(90);
  $('pFrente').onclick = () => { marcar(); const p = proyecto(); p.items = [...p.items.filter(i => !ui.seleccion.has(i.id)), ...sel]; avisar('items'); };
  $('gCrear').onclick = () => grilla(num($('gCols').value, 1, 60, 1) | 0, num($('gFilas').value, 1, 60, 1) | 0, num($('gSx').value, 0, 20, 0), num($('gSy').value, 0, 20, 0));
  if (varios) $('nAplicar').onclick = () => {
    marcar();
    const paso = Math.max(0.3, Math.min(...sel.map(i => Math.min(i.w, i.d))));
    [...sel].sort((a, b) => (Math.round(a.y / paso) - Math.round(b.y / paso)) || (a.x - b.x))
      .forEach((i, k) => { i.etiqueta = $('nPref').value + ((parseInt($('nDesde').value) || 0) + k); });
    avisar('items');
  };
}

function pintarTodo() { pintarBarra(); pintarEspacios(); pintarCatalogo(); pintarPanel(); P.pedir(); }

// ---------- acciones sobre elementos ----------
function borrar() {
  if (!ui.seleccion.size) return;
  marcar(); const p = proyecto(); p.items = p.items.filter(i => !ui.seleccion.has(i.id)); ui.seleccion.clear(); avisar('items');
}
function clonar(items, dx, dy) {
  const p = proyecto(), nuevos = items.map(i => ({ ...i, id: uid(), nivel: nivel.id, x: i.x + dx, y: i.y + dy }));
  p.items.push(...nuevos); return nuevos;
}
function duplicar() {
  const sel = P.seleccionados(); if (!sel.length) return;
  marcar(); const n = clonar(sel, 0.5, 0.5); ui.seleccion.clear(); n.forEach(i => ui.seleccion.add(i.id)); avisar('items');
}
function girarSel(g) {
  const sel = P.seleccionados(); if (!sel.length) return;
  marcar();
  if (sel.length > 1) {         // el grupo gira alrededor de su centro
    const cx = sel.reduce((a, i) => a + i.x, 0) / sel.length, cy = sel.reduce((a, i) => a + i.y, 0) / sel.length, a = g * Math.PI / 180;
    sel.forEach(i => { const dx = i.x - cx, dy = i.y - cy; i.x = cx + dx * Math.cos(a) - dy * Math.sin(a); i.y = cy + dx * Math.sin(a) + dy * Math.cos(a); });
  }
  sel.forEach(i => { i.rot = (((i.rot + g) % 360) + 360) % 360; }); avisar('items');
}
function grilla(cols, filas, sx, sy) {
  const sel = P.seleccionados(); if (!sel.length || cols * filas < 2) return;
  if (cols * filas * sel.length > 2000) return aviso('Son demasiados elementos; probá con una grilla más chica.');
  marcar();
  const xs = sel.flatMap(i => [i.x - i.w / 2, i.x + i.w / 2]), ys = sel.flatMap(i => [i.y - i.d / 2, i.y + i.d / 2]);
  const u = sel[0], recto = sel.length === 1 && u.rot % 180 === 0, cruz = sel.length === 1 && u.rot % 180 === 90;
  const w = recto ? u.w : cruz ? u.d : Math.max(...xs) - Math.min(...xs), h = recto ? u.d : cruz ? u.w : Math.max(...ys) - Math.min(...ys);
  const nuevos = [];
  for (let f = 0; f < filas; f++) for (let c = 0; c < cols; c++) if (f || c) nuevos.push(...clonar(sel, c * (w + sx), f * (h + sy)));
  nuevos.forEach(i => ui.seleccion.add(i.id)); avisar('items');
  aviso(`Se crearon ${nuevos.length} copias.`);
}

// ---------- catálogo propio ----------
async function editarTipo(t) {
  const nuevo = !t; t ??= { nombre: '', modelo: 'mesa', w: 1.2, d: 0.6, h: 0.75, color: '#7c9d5b' };
  const r = await dialogo(`<h3>${nuevo ? 'Crear mi propio elemento' : 'Editar elemento'}</h3>
    <label>Nombre<input name="nombre" type="text" required value="${esc(t.nombre)}" placeholder="Ej.: Mesa de laboratorio"></label>
    <label>Forma<select name="modelo">${Object.entries(E.MODELOS).map(([k, v]) => `<option value="${k}" ${k === t.modelo ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
    <div class="fila3">
      <label>Ancho (m)<input name="w" type="number" min="0.05" max="60" step="0.01" required value="${t.w}"></label>
      <label>Fondo (m)<input name="d" type="number" min="0.02" max="60" step="0.01" required value="${t.d}"></label>
      <label>Alto (m)<input name="h" type="number" min="0" max="8" step="0.01" required value="${t.h}"></label>
    </div>
    <label>Color<input name="color" type="color" value="${t.color}"></label>
    ${pie('Guardar', nuevo ? '' : '<button value="borrar" class="peligro izq" formnovalidate>Eliminar</button>')}`);
  if (!r) return;
  if (r._accion === 'borrar') E.estado.catalogoPropio = E.estado.catalogoPropio.filter(x => x.id !== t.id);
  else {
    const datos = { nombre: r.nombre.trim() || 'Elemento', modelo: r.modelo, w: num(r.w, 0.05, 60, 1), d: num(r.d, 0.02, 60, 1), h: num(r.h, 0, 8, 0.75), color: r.color };
    if (nuevo) E.estado.catalogoPropio.push({ id: 'p-' + uid(), ...datos }); else Object.assign(t, datos);
  }
  avisar('catalogo');
}

// ---------- PDF ----------
async function exportarPDF() {
  const p = proyecto();
  const conContenido = indice.filter(n => p.items.some(i => i.nivel === n.id) || p.espacios.some(id => id.startsWith(n.id + '-')) || p.propios.some(e => e.nivel === n.id && p.espacios.includes(e.id)));
  const lista = conContenido.length ? conContenido : indice.filter(n => n.id === nivel.id);
  const r = await dialogo(`<h3>Generar PDF</h3>
    <p class="ayuda">Se incluye una página por nivel con espacios o elementos: <b>${lista.map(n => esc(n.nombre)).join(', ')}</b>.</p>
    <label>Tamaño de hoja<select name="formato"><option value="a4">A4 apaisado</option><option value="a3">A3 apaisado</option></select></label>
    <label class="check"><input type="checkbox" name="iso" checked> Agregar vista isométrica</label>
    <label class="check"><input type="checkbox" name="lista" checked> Agregar listado de elementos y nombres</label>
    <label class="check"><input type="checkbox" name="detalle" ${ui.detalle ? 'checked' : ''}> Mostrar el detalle del plano (mobiliario fijo, pavimentos)</label>
    ${pie('Descargar PDF')}`);
  if (!r) return;
  aviso('Generando PDF…');
  await new Promise(f => setTimeout(f, 30));
  try {
    const niveles = []; for (const n of lista) niveles.push(await cargarNivel(n));
    let captura = null;
    if (r.iso) { try { await asegurarIso(); captura = (n, w, h) => { iso.actualizarIso(n, p, opIso()); return iso.capturar(w, h); }; } catch { /* sin WebGL: se omite */ } }
    const doc = generarPDF(p, niveles, { formato: r.formato, iso: !!captura, lista: r.lista, detalle: r.detalle, capturaIso: captura });
    if (captura) { iso.actualizarIso(nivel, p, opIso()); if (vistaIso) iso.encuadrar(true); }
    doc.save(archivo(p.nombre) + '.pdf');
    aviso('PDF listo.');
  } catch (e) { console.error(e); aviso('No se pudo generar el PDF: ' + e.message); }
}

// ---------- menú de la muestra ----------
async function menuProyecto() {
  const r = await dialogo(`<h3>${esc(proyecto().nombre)}</h3><div class="menu">
    <button value="duplicar">Duplicar esta muestra</button>
    <button value="exportar">Guardar en un archivo (para compartir o respaldar)</button>
    <button value="importar">Abrir una muestra desde un archivo…</button>
    <button value="vaciar">Quitar todos los elementos de ${esc(nivel.nombre)}</button>
    <button value="eliminar" class="peligro">Eliminar esta muestra</button>
    </div><div class="pie"><button value="cancelar">Cerrar</button></div>`);
  if (!r) return;
  if (r._accion === 'duplicar') E.duplicarProyecto();
  if (r._accion === 'exportar') descargar(archivo(proyecto().nombre) + '.muestra.json', JSON.stringify(E.exportarProyecto(), null, 1), 'application/json');
  if (r._accion === 'importar') {
    const inp = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,application/json' });
    inp.onchange = async () => {
      try { E.importarProyecto(JSON.parse(await inp.files[0].text())); await fijarNivel(proyecto().nivel); aviso('Muestra abierta.'); }
      catch (e) { aviso('No se pudo abrir: ' + e.message); }
    };
    inp.click();
  }
  if (r._accion === 'vaciar' && await confirmar(`¿Quitar todos los elementos de ${nivel.nombre}?`, 'Quitar')) {
    marcar(); const p = proyecto(); p.items = p.items.filter(i => i.nivel !== nivel.id); ui.seleccion.clear(); avisar('items');
  }
  if (r._accion === 'eliminar' && await confirmar(`¿Eliminar «${proyecto().nombre}»? No se puede deshacer.`)) { E.eliminarProyecto(); await fijarNivel(proyecto().nivel); }
}

// ---------- eventos ----------
function conectar() {
  $('selProyecto').onchange = async e => { E.abrirProyecto(e.target.value); await fijarNivel(proyecto().nivel); };
  $('btnNuevo').onclick = async () => { const n = await pedirNombre('Nueva muestra', 'Muestra de …'); if (n) { E.crearProyecto(n); await fijarNivel(proyecto().nivel); } };
  $('btnMasProyecto').onclick = menuProyecto;
  $('selNivel').onchange = async e => { proyecto().nivel = e.target.value; avisar('nivel'); await fijarNivel(e.target.value); if (vistaIso) verIso(true); };
  $('tabPlano').onclick = () => verIso(false); $('tabIso').onclick = () => verIso(true);
  $('btnDeshacer').onclick = () => E.deshacer(); $('btnRehacer').onclick = () => E.rehacer();
  $('btnPDF').onclick = exportarPDF;
  $('inNombre').oninput = e => { proyecto().nombre = e.target.value; avisar('nombre'); };
  $('inFecha').onchange = e => { proyecto().fecha = e.target.value; avisar('nombre'); };
  $('inAltura').onchange = e => { marcar(); proyecto().altura = num(e.target.value, 1, 8, 3); avisar('altura'); };
  $('inBuscarEsp').oninput = pintarEspacios;

  $('listaEspacios').onclick = async e => {
    const fila = e.target.closest('.esp'); if (!fila) return;
    const id = fila.dataset.id, p = proyecto(), a = e.target.dataset.a;
    if (a === 'renombrar') {
      const actual = espaciosDe(nivel, p).find(x => x.id === id);
      const n = await pedirNombre('Nombre del espacio', actual.nombre); if (!n) return;
      marcar(); const propio = p.propios.find(x => x.id === id);
      if (propio) propio.nombre = n; else p.renombres[id] = n;
    } else if (a === 'borrar') {
      marcar(); p.propios = p.propios.filter(x => x.id !== id); p.espacios = p.espacios.filter(x => x !== id);
    } else {
      marcar(); p.espacios = p.espacios.includes(id) ? p.espacios.filter(x => x !== id) : [...p.espacios, id];
      avisar('espacios'); P.encuadrar(); return;
    }
    avisar('espacios');
  };

  $('catalogo').onclick = e => {
    const b = e.target.closest('.tipo'); if (!b) return;
    const t = E.catalogo().find(c => c.id === b.dataset.id);
    if (e.target.dataset.a === 'editar') return editarTipo(t);
    if (vistaIso) verIso(false);
    P.agregar(t);
  };
  $('catalogo').addEventListener('dragstart', e => { const b = e.target.closest('.tipo'); if (b) e.dataTransfer.setData('text/plain', b.dataset.id); });
  $('btnNuevoTipo').onclick = () => editarTipo(null);

  const herr = h => { document.querySelectorAll('#herramientas [data-h]').forEach(b => b.classList.toggle('activo', b.dataset.h === h)); P.fijarHerramienta(h); };
  ui.alHerramienta = herr;
  document.querySelectorAll('#herramientas [data-h]').forEach(b => { b.onclick = () => herr(b.dataset.h); });
  $('chkIman').onchange = e => { ui.iman = e.target.checked; };
  $('chkDetalle').onchange = e => { ui.detalle = e.target.checked; P.pedir(); };
  $('btnEncuadrar').onclick = P.encuadrar;
  $('btnGiroIzq').onclick = () => iso.girar(-1); $('btnGiroDer').onclick = () => iso.girar(1);
  $('selMuros').onchange = $('chkEtiquetas3d').onchange = () => iso.actualizarIso(nivel, proyecto(), opIso());
  $('btnPNG').onclick = () => descargar(archivo(proyecto().nombre) + '-isometrica.png', iso.capturarVista());

  window.addEventListener('keydown', e => {
    if ($('dlg').open || e.target.matches('input, select, textarea')) return;
    const ctrl = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (ctrl && k === 'z') { e.preventDefault(); e.shiftKey ? E.rehacer() : E.deshacer(); return; }
    if (ctrl && k === 'y') { e.preventDefault(); E.rehacer(); return; }
    if (vistaIso) return;
    const sel = P.seleccionados();
    if (ctrl && k === 'd') { e.preventDefault(); duplicar(); }
    else if (ctrl && k === 'a') { e.preventDefault(); P.itemsNivel().forEach(i => ui.seleccion.add(i.id)); pintarPanel(); P.pedir(); }
    else if (ctrl && k === 'c') { portapapeles = sel.map(i => ({ ...i })); if (sel.length) aviso(`${sel.length} elemento${sel.length > 1 ? 's copiados' : ' copiado'}.`); }
    else if (ctrl && k === 'v') {
      if (!portapapeles.length) return;
      marcar(); portapapeles.forEach(i => { i.x += 0.5; i.y += 0.5; });
      const n = clonar(portapapeles, 0, 0); ui.seleccion.clear(); n.forEach(i => ui.seleccion.add(i.id)); avisar('items');
    }
    else if (ctrl) return;
    else if (k === 'delete' || k === 'backspace') { e.preventDefault(); borrar(); }
    else if (k === 'r') girarSel(e.shiftKey ? 15 : 90);
    else if (k.startsWith('arrow') && sel.length) {
      e.preventDefault(); const d = e.shiftKey ? 0.5 : 0.05; marcar();
      const [dx, dy] = { arrowleft: [-d, 0], arrowright: [d, 0], arrowup: [0, -d], arrowdown: [0, d] }[k];
      sel.forEach(i => { i.x = Math.round((i.x + dx) * 100) / 100; i.y = Math.round((i.y + dy) * 100) / 100; }); avisar('items');
    }
    else if (k === 'escape') { if (!P.cancelar()) { if (ui.herramienta !== 'mover') herr('mover'); else { ui.seleccion.clear(); pintarPanel(); P.pedir(); } } }
    else if (k === 'enter') P.cerrarTrazo();
    else if (k === 'v') herr('mover'); else if (k === 'e') herr('espacios'); else if (k === 'd') herr('dibujar');
    else if (k === 'm') herr('medir'); else if (k === 'f') P.encuadrar();
  });
}

// ---------- arranque ----------
let tIso;
async function arrancar() {
  E.cargar();
  ui.alSeleccionar = pintarPanel; ui.pedirNombre = pedirNombre; ui.pista = t => { $('pista').textContent = t || ''; };
  P.iniciar($('plano'));
  conectar();
  E.alCambiar(que => {
    // tras deshacer o cambiar de muestra puede haber ids seleccionados que ya no existen
    const ids = new Set(proyecto().items.map(i => i.id));
    [...ui.seleccion].forEach(id => { if (!ids.has(id)) ui.seleccion.delete(id); });
    pintarBarra();
    if (que !== 'items' && que !== 'nombre') pintarEspacios();
    if (que === 'catalogo' || que === 'todo') pintarCatalogo();
    if (que !== 'nombre') pintarPanel();
    P.pedir();
    if (vistaIso && iso && que !== 'nombre') { clearTimeout(tIso); tIso = setTimeout(() => iso.actualizarIso(nivel, proyecto(), opIso()), 60); }
  });
  try {
    indice = await cargarIndice();
  } catch (e) { $('cargando').textContent = 'No se pudo cargar el plano. Abrí el sitio desde un servidor web (no como archivo local).'; return; }
  $('selNivel').innerHTML = indice.map(n => `<option value="${n.id}">${esc(n.nombre)}</option>`).join('');
  await fijarNivel(proyecto().nivel);
}
arrancar();
