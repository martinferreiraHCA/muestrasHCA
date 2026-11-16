// Interfaz: une el estado, el editor 2D, la vista isométrica y la exportación.
import * as E from './estado.js';
import { proyecto, marcar, avisar, uid } from './estado.js';
import { cargarIndice, cargarNivel, espaciosDe, espaciosElegidos, geo } from './niveles.js';
import * as SOL from './sol.js';
import * as P from './plano.js';
import { ui } from './plano.js';
import { generarPDF } from './pdf.js';
import { Simulacion, SIM_DEF, DT, esParada, esEntrada, esSalida } from './sim.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = (v, min, max, def) => { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? Math.max(min, Math.min(max, n)) : def; };

let indice = [], nivel = null, iso = null, vistaIso = false, vistaSim = false, vistaSol = false, portapapeles = [], editandoPanel = false;

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

const opIso = () => {
  const q = $('chkSol3d').checked ? solAhora() : null;
  $('solHora3d').textContent = q ? `${SOL.hhmm(solHora())}` : '';
  return { muros: $('selMuros').value, etiquetas: $('chkEtiquetas3d').checked, sol: q && { hacia: SOL.vectores(q.sol, q.norte).hacia, el: q.sol.el } };
};
async function asegurarIso() {
  if (!iso) { iso = await import('./iso.js'); iso.iniciarIso($('iso')); }
  return iso;
}
async function ver(v) {
  vistaIso = v === 'iso'; vistaSim = v === 'sim'; vistaSol = v === 'sol';
  $('tabSol').classList.toggle('activo', vistaSol); $('herramientasSol').classList.toggle('oculto', !vistaSol);
  if (!vistaSol) solPausar();
  $('tabPlano').classList.toggle('activo', v === 'plano'); $('tabIso').classList.toggle('activo', vistaIso); $('tabSim').classList.toggle('activo', vistaSim);
  $('plano').classList.toggle('oculto', vistaIso); $('iso').classList.toggle('oculto', !vistaIso);
  $('herramientas').classList.toggle('oculto', v !== 'plano'); $('herramientasIso').classList.toggle('oculto', !vistaIso); $('herramientasSim').classList.toggle('oculto', !vistaSim);
  if (!vistaSim) simPausar();
  ui.capa = vistaSim ? (ctx, k) => sim?.dibujar(ctx, k, $('selSimMapa').value) : null;
  ui.ocultar = vistaSim ? it => it.modelo === 'persona' && sim && sim.t > 0 : null;
  ui.capaPantalla = null;
  if (vistaSol) {
    solCache = null; $('solFecha').value = solFecha(); $('solHora').value = solHora(); solTexto();
    ui.capa = (ctx, k) => { const q = solAhora(); SOL.dibujarSol(ctx, k, nivel, proyecto(), q.sol, q.norte, q.path); };
    ui.capaPantalla = (ctx, w, h) => { const q = solAhora(); SOL.dibujarRosa(ctx, w, h, q.sol, q.norte); };
  }
  ui.pista('');
  if (vistaIso) {
    try { await asegurarIso(); } catch (e) { aviso('No se pudo iniciar la vista 3D en este navegador.'); return ver('plano'); }
    iso.actualizarIso(nivel, proyecto(), opIso()); iso.mostrarIso(true);
    ui.pista('Arrastrá para orbitar · rueda para acercar · botón derecho para desplazar');
  } else {
    iso?.mostrarIso(false);
    if (vistaSim) { ui.alHerramienta('mover'); ui.seleccion.clear(); if (!sim) simCrear(); }
    if (vistaSol) { ui.alHerramienta('mover'); ui.seleccion.clear(); }
    pintarPanel(); P.pedir();
  }
}
const verIso = si => ver(si ? 'iso' : 'plano');

// ---------- sol y sombras ----------
let solCache = null, solCorre = 0;
const solFecha = () => proyecto().sol?.fecha || proyecto().fecha || new Date().toISOString().slice(0, 10);
const solHora = () => proyecto().sol?.hora ?? horaDec(proyecto().horaInicio) ?? 12;
const solNorte = () => proyecto().norte ?? geo.norte ?? 0;
function horaDec(h) { const [a, b] = (h || '').split(':').map(Number); return isFinite(a) && isFinite(b) ? a + b / 60 : null; }
/** Sol y sombras del momento elegido (se recalcula solo si cambió algo). */
function solAhora() {
  const clave = [nivel.id, solFecha(), solHora(), solNorte()].join('|');
  if (!solCache || solCache.clave !== clave) {
    const sol = SOL.posSol(solFecha(), solHora(), geo), norte = solNorte();
    solCache = { clave, sol, norte, path: SOL.sombras(nivel, proyecto(), sol, norte) };
  }
  return solCache;
}
function solTexto() { $('solHoraTxt').textContent = SOL.hhmm(solHora()); }
function solPoner(cambio) { proyecto().sol = { fecha: solFecha(), hora: solHora(), ...cambio }; avisar('sol'); }
function solPausar() { cancelAnimationFrame(solCorre); solCorre = 0; const b = $('btnSolPlay'); if (b) b.textContent = '▶ Recorrer el día'; }
function solAlternar() {
  if (solCorre) return solPausar();
  $('btnSolPlay').textContent = '⏸ Pausa';
  const { sale, pone } = SOL.amanecer(solFecha(), geo); let h = Math.max(solHora(), sale), previo = performance.now();
  const cuadro = ahora => {
    h += (ahora - previo) / 1000 * 1.2; previo = ahora;           // 1,2 horas por segundo
    if (h >= pone) { solPausar(); return; }
    const q = Math.round(h * 12) / 12;
    proyecto().sol = { fecha: solFecha(), hora: q }; $('solHora').value = q; solTexto(); pintarPanelSol(true); P.pedir();
    solCorre = requestAnimationFrame(cuadro);
  };
  solCorre = requestAnimationFrame(cuadro);
}
let solTabla = null;
function pintarPanelSol(soloAhora) {
  const p = proyecto(), q = solAhora(), { sale, pone } = SOL.amanecer(solFecha(), geo), el = $('panelDer');
  const afuera = espaciosElegidos(nivel, p).filter(e => e.exterior || e.propio);
  const ahora = `<table class="resumen">
      <tr><td>Sale el sol</td><td>${sale === null ? '—' : SOL.hhmm(sale)}</td></tr>
      <tr><td>Se pone</td><td>${pone === null ? '—' : SOL.hhmm(pone)}</td></tr>
      <tr><td>Altura del sol</td><td>${q.sol.el > 0 ? Math.round(q.sol.el) + '°' : 'de noche'}</td></tr>
      <tr><td>Viene desde el</td><td>${q.sol.el > 0 ? SOL.cardinal(q.sol.az) + ' (' + Math.round(q.sol.az) + '°)' : '—'}</td></tr>
      <tr><td>Sombra de un muro de ${String(p.altura).replace('.', ',')} m</td><td>${q.sol.el > 0.5 ? (p.altura * SOL.vectores(q.sol, q.norte).largo).toFixed(1).replace('.', ',') + ' m' : '—'}</td></tr>
    </table>
    ${afuera.length ? `<p class="ayuda" style="margin:10px 0 4px">Al sol a las ${SOL.hhmm(solHora())}:</p><table class="resumen">${afuera.map(e => { const v = q.sol.el > 0.5 ? SOL.pctSol(e.poly, q.path) : 0; return `<tr><td>${esc(e.nombre)}</td><td><span class="barrita"><i style="width:${v}%"></i></span>${v} %</td></tr>`; }).join('')}</table>` : ''}`;
  if (soloAhora && $('solAhora')) { $('solAhora').innerHTML = ahora; return; }
  const clave = [nivel.id, solFecha(), solNorte(), afuera.map(e => e.id + e.area).join(), p.items.length, p.altura].join('|');
  if (!solTabla || solTabla.clave !== clave) solTabla = { clave, ...SOL.tablaSol(nivel, p, solFecha(), solNorte(), sale ?? 7, pone ?? 19) };
  const hi = horaDec(p.horaInicio), hf = horaDec(p.horaFin);
  el.innerHTML = `
    <section><h2>Sol y sombras</h2>
      <p class="ayuda">Sombras que dan los edificios (según sus pisos y la altura de ${String(p.altura).replace('.', ',')} m por piso) y los elementos altos, para la fecha y hora elegidas. Lo gris claro son interiores techados.</p>
      <div id="solAhora">${ahora}</div>
    </section>
    <section><h2>Hora por hora</h2>
      ${solTabla.esp.length ? `<p class="ayuda">Porcentaje de cada espacio al sol${hi !== null ? '. En amarillo, el horario de la muestra' : ''}.</p>
      <table class="tablasol"><tr><th>Hora</th>${solTabla.esp.map(e => `<th title="${esc(e.nombre)}">${esc(e.nombre.length > 9 ? e.nombre.slice(0, 8) + '…' : e.nombre)}</th>`).join('')}</tr>
      ${solTabla.horas.map((h, i) => `<tr class="${hi !== null && hf !== null && h >= Math.floor(hi) && h <= hf ? 'muestra' : ''}"><td>${SOL.hhmm(h)}</td>${solTabla.filas.map(f => `<td>${f[i] === null ? '—' : f[i] + ' %'}</td>`).join('')}</tr>`).join('')}</table>`
      : '<p class="ayuda">Elegí un espacio al aire libre (por ejemplo el Patio central) o dibujá uno para ver cuánto sol recibe a cada hora.</p>'}
    </section>
    <section><h2>Orientación</h2>
      <label>Norte del plano (grados desde «arriba», sentido horario)<input id="solNorte" type="number" min="0" max="360" step="0.5" value="${solNorte()}"></label>
      <p class="ayuda">Tomado del símbolo de norte del plano. Ubicación: Montevideo. No se consideran los árboles ni los edificios vecinos.</p>
    </section>`;
  $('solNorte').onchange = e => { proyecto().norte = num(e.target.value, 0, 360, geo.norte); avisar('sol'); };
}

// ---------- simulación de circulación ----------
let sim = null, simCorre = false, simRaf = 0, simPrevio = 0, simComp = null, tPanelSim = 0;
/** Minutos que dura la muestra según el horario cargado (0 si no hay horario). */
function duracionMuestra(p = proyecto()) {
  const m = h => { const [a, b] = (h || '').split(':').map(Number); return isFinite(a) && isFinite(b) ? a * 60 + b : null; };
  const i = m(p.horaInicio), f = m(p.horaFin);
  return i === null || f === null ? 0 : (f - i + 1440) % 1440;
}
/** Hora de reloj a `seg` segundos del comienzo de la muestra (o mm:ss si no hay horario). */
function reloj(seg) {
  const [a, b] = (proyecto().horaInicio || '').split(':').map(Number);
  if (!isFinite(a) || !isFinite(b)) return mmss(seg);
  const t = Math.round(a * 60 + b + seg / 60) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}
function parSim() {
  const q = { ...SIM_DEF, ...(proyecto().sim || {}) };
  // si no se indicó, la gente va llegando durante toda la muestra (menos el cuarto final)
  if (!q.llegada) { const d = duracionMuestra(); q.llegada = d ? Math.max(1, Math.round(d * 0.75)) : Math.max(1, Math.round(q.visitantes / 20)); q.llegadaAuto = true; }
  q.porMinuto = q.visitantes / q.llegada;
  return q;
}
function simCrear() {
  simPausar(); sim = nivel ? new Simulacion(nivel, proyecto(), parSim()) : null; simComp = null;
  if (vistaSim) { pintarPanel(); P.pedir(); }
}
function simPausar() { simCorre = false; cancelAnimationFrame(simRaf); const b = $('btnSimPlay'); if (b) b.textContent = '▶ Simular'; }
function simAlternar() {
  if (simCorre) return simPausar();
  if (!sim || sim.terminada) simCrear();
  if (sim.falta) { aviso(sim.falta); return; }
  simCorre = true; simPrevio = performance.now(); $('btnSimPlay').textContent = '⏸ Pausa';
  const cuadro = ahora => {
    if (!simCorre) return;
    const vel = +$('selSimVel').value, pasos = Math.min(400, Math.max(1, Math.round(Math.min(0.1, (ahora - simPrevio) / 1000) * vel / DT)));
    simPrevio = ahora;
    for (let i = 0; i < pasos && !sim.terminada; i++) sim.paso();
    P.pedir();
    if (ahora - tPanelSim > 400) { tPanelSim = ahora; pintarEstadoSim(); }
    if (sim.terminada) { simPausar(); pintarEstadoSim(); aviso('Simulación terminada.'); return; }
    simRaf = requestAnimationFrame(cuadro);
  };
  simRaf = requestAnimationFrame(cuadro);
}
const mmss = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const nivelDens = d => d < 1 ? 'cómoda' : d < 2 ? 'aceptable' : d < 3.5 ? 'apretada' : 'crítica';
function pintarEstadoSim() {
  const el = $('simEstado'); if (!el || !sim) return;
  if (sim.falta) { el.innerHTML = `<p class="ayuda alerta">${esc(sim.falta)}</p>`; return; }
  const r = sim.resumen(), dur = duracionMuestra(), hay = !!proyecto().horaInicio;
  const tarde = dur && r.terminada ? r.tUltimo / 60 - dur : 0;
  el.innerHTML = `<table class="resumen">
    <tr><td>${hay ? 'Hora simulada' : 'Tiempo simulado'}</td><td>${reloj(r.t)}</td></tr>
    <tr><td>Personas adentro</td><td>${r.adentro}</td></tr>
    <tr><td>Máximo a la vez</td><td>${r.maxAdentro}</td></tr>
    <tr><td>Ya salieron</td><td>${r.terminaron} de ${r.total}</td></tr>
    <tr><td>Recorrido por persona</td><td>${r.terminaron ? mmss(r.tiempoProm) + ' min' : '—'}</td></tr>
    <tr><td>Densidad máxima</td><td>${r.densMax.toFixed(1).replace('.', ',')} pers./m² <small>(${nivelDens(r.densMax)})</small></td></tr>
    <tr><td>Tiempo en aglomeración</td><td>${r.pctAglom.toFixed(1).replace('.', ',')} %</td></tr>
    ${r.terminada ? `<tr><td>Sale la última persona</td><td>${hay ? reloj(r.tUltimo) : mmss(r.tUltimo)}</td></tr>` : ''}
  </table>
  ${r.terminada && dur ? (tarde > 1
    ? `<p class="ayuda alerta">No alcanza el horario: la última persona sale ${Math.round(tarde)} min después del cierre. Probá con menos visitantes, menos tiempo por parada o más duración.</p>`
    : `<p class="ayuda">El horario alcanza: todos terminan ${Math.round(-tarde)} min antes del cierre.</p>`) : ''}
  ${r.apurados ? `<p class="ayuda alerta">${r.apurados} persona${r.apurados > 1 ? 's no llegaron' : ' no llegó'} a ver todas las paradas en el tiempo de visita.</p>` : ''}
  ${r.terminada && r.critico && r.pctAglom > 2 ? '<p class="ayuda">El círculo rojo punteado marca el punto más congestionado: conviene ensanchar ese paso o separar los puestos cercanos.</p>' : ''}
  ${sim.paradas.length ? `<p class="ayuda" style="margin-top:8px">Visitas por parada: ${sim.paradas.map(p => `${esc(p.nombre)} <b>${p.visitas}</b>`).join(' · ')}</p>` : ''}`;
}
function pintarPanelSim() {
  const p = parSim(), el = $('panelDer'), its = P.itemsNivel();
  const nE = its.filter(esEntrada).length, nS = its.filter(esSalida).length, nP = its.filter(esParada).length, nG = its.filter(i => i.modelo === 'persona').length;
  el.innerHTML = `
    <section><h2>Circulación de gente</h2>
      <p class="ayuda">Los visitantes entran por las <b>Entradas</b>, recorren las paradas (stands y mesas con nombre) y se van por la <b>Salida</b>. También podés poner <b>Personas</b> sueltas en el plano.</p>
      <table class="resumen">
        <tr><td>Entradas</td><td>${nE || '<b class="alerta">falta</b>'}</td></tr>
        <tr><td>Salidas</td><td>${nS || 'por la entrada'}</td></tr>
        <tr><td>Paradas del recorrido</td><td>${nP}</td></tr>
        <tr><td>Personas puestas a mano</td><td>${nG}</td></tr>
      </table>
    </section>
    <section><h2>Parámetros</h2>
      <div class="fila2">
        <label>Visitantes<input id="sVis" type="number" min="1" max="600" value="${p.visitantes}"></label>
        <label title="Minutos durante los que va entrando la gente">Llegan durante (min)<input id="sLle" type="number" min="1" max="1440" value="${p.llegada}"></label>
        <label>Segundos por parada<input id="sPer" type="number" min="0" max="900" value="${p.permanencia}"></label>
        <label title="0 = visitan todas">Paradas por persona<input id="sPar" type="number" min="0" max="99" value="${p.paradas}"></label>
        <label title="Tope de tiempo por persona; 0 = sin tope">Tiempo de visita (min)<input id="sTie" type="number" min="0" max="600" value="${p.tiempoVisita}"></label>
        <label>Entran por minuto<input type="text" disabled value="${(Math.round(p.porMinuto * 10) / 10).toString().replace('.', ',')}"></label>
      </div>
      <label>Recorrido<select id="sModo">
        <option value="libre" ${p.modo === 'libre' ? 'selected' : ''}>Libre: cada uno va al puesto más cercano y menos lleno</option>
        <option value="guiado" ${p.modo === 'guiado' ? 'selected' : ''}>Guiado: sentido único, todos en el mismo orden</option>
      </select></label>
      <p class="ayuda">${duracionMuestra() ? `La muestra dura ${duracionMuestra()} min (${esc(proyecto().horaInicio)} a ${esc(proyecto().horaFin)}).` : 'Cargá el horario de la muestra (a la izquierda) para saber si el tiempo alcanza.'} En «Paradas por persona» y «Tiempo de visita», 0 significa sin límite.</p>
    </section>
    <section><h2>Resultado</h2><div id="simEstado"></div></section>
    ${simComp ? `<section><h2>Comparación</h2>
      <table class="resumen comp"><tr><td></td><td>Libre</td><td>Guiado</td></tr>
        <tr><td>Duración total</td><td>${mmss(simComp.libre.t)}</td><td>${mmss(simComp.guiado.t)}</td></tr>
        <tr><td>Visita media</td><td>${mmss(simComp.libre.tiempoProm)}</td><td>${mmss(simComp.guiado.tiempoProm)}</td></tr>
        <tr><td>Densidad máx.</td><td>${simComp.libre.densMax.toFixed(1)}</td><td>${simComp.guiado.densMax.toFixed(1)}</td></tr>
        <tr><td>En aglomeración</td><td>${simComp.libre.pctAglom.toFixed(1)} %</td><td>${simComp.guiado.pctAglom.toFixed(1)} %</td></tr>
      </table><p class="ayuda" style="margin-top:8px">${esc(simComp.texto)}</p></section>` : ''}`;
  const campo = (id, k, min, max) => { $(id).onchange = e => { proyecto().sim = { ...(proyecto().sim || {}), [k]: k === 'modo' ? e.target.value : num(e.target.value, min, max, SIM_DEF[k]) }; avisar('sim'); }; };
  campo('sVis', 'visitantes', 1, 600); campo('sLle', 'llegada', 1, 1440); campo('sTie', 'tiempoVisita', 0, 600); campo('sPer', 'permanencia', 0, 900); campo('sPar', 'paradas', 0, 99); campo('sModo', 'modo');
  pintarEstadoSim();
}
async function simComparar() {
  simPausar();
  const base = new Simulacion(nivel, proyecto(), parSim());
  if (base.falta) return aviso(base.falta);
  if (base.paradas.length < 2) return aviso('Hacen falta al menos dos paradas (stands o mesas con nombre) para comparar recorridos.');
  aviso('Calculando las dos alternativas…'); await new Promise(f => setTimeout(f, 40));
  const libre = new Simulacion(nivel, proyecto(), { ...parSim(), modo: 'libre' }).completar();
  const g = new Simulacion(nivel, proyecto(), { ...parSim(), modo: 'guiado' }); const guiado = g.completar();
  const nota = r => r.pctAglom + r.densMax * 2;
  const parejo = Math.abs(libre.pctAglom - guiado.pctAglom) < 2 && Math.abs(libre.densMax - guiado.densMax) < 0.5;
  const mejor = parejo ? parSim().modo : nota(libre) <= nota(guiado) ? 'libre' : 'guiado';
  const m = mejor === 'libre' ? libre : guiado, otro = mejor === 'libre' ? guiado : libre;
  simComp = { libre, guiado, mejor, texto: parejo
    ? 'Las dos formas de recorrer dan una circulación parecida con esta distribución. Para mejorarla, probá separar más los puestos o mover la entrada y la salida.'
    : `Con esta distribución circula mejor el recorrido ${mejor}: ${m.pctAglom.toFixed(1)} % del tiempo en aglomeración contra ${otro.pctAglom.toFixed(1)} %. Se dejó elegido ese recorrido.` };
  proyecto().sim = { ...(proyecto().sim || {}), modo: mejor };
  const comp = simComp; avisar('sim'); simComp = comp;
  sim = new Simulacion(nivel, proyecto(), parSim()); sim.completar();
  pintarPanel(); P.pedir();
}

// ---------- paneles ----------
function pintarBarra() {
  const p = proyecto();
  $('selProyecto').innerHTML = E.estado.proyectos.map(q => `<option value="${q.id}" ${q.id === p.id ? 'selected' : ''}>${esc(q.nombre || 'Sin nombre')}</option>`).join('');
  if (document.activeElement !== $('inNombre')) $('inNombre').value = p.nombre;
  $('inFecha').value = p.fecha || ''; $('inInicio').value = p.horaInicio || ''; $('inFin').value = p.horaFin || '';
  if (nivel) { const its = P.itemsNivel(); $('nEntradas').textContent = its.filter(esEntrada).length || ''; $('nSalidas').textContent = its.filter(esSalida).length || ''; } if (document.activeElement !== $('inAltura')) $('inAltura').value = p.altura;
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
      <button data-a="forma" title="Editar la forma">◇</button><button data-a="renombrar" title="Cambiar nombre">✎</button><button data-a="borrar" title="Quitar espacio">✕</button>
    </div>`).join('') || '<div class="vacio">No hay espacios con ese nombre. Podés dibujar uno con «Rectángulo» o «Polígono».</div>';
  const tocados = (p.ocultos || []).some(id => id.startsWith(nivel.id + '-')) || Object.keys(p.formas || {}).some(id => id.startsWith(nivel.id + '-'));
  $('btnRestaurarEsp').classList.toggle('oculto', !tocados);
}

function pintarCatalogo() {
  const propios = new Set(E.estado.catalogoPropio.map(t => t.id));
  const boton = t => `
    <button class="tipo" draggable="true" data-id="${t.id}" title="Agregar ${esc(t.nombre)}">
      <span class="muestra ${['mesa-redonda', 'cilindro', 'persona'].includes(t.modelo) ? 'redonda' : ''}" style="background:${t.color}"></span>
      <span><b>${esc(t.nombre)}</b><small>${t.w} × ${t.d} m</small></span>
      ${propios.has(t.id) ? '<span class="editar" data-a="editar" title="Editar este elemento">✎</span>' : ''}
    </button>`;
  const todos = E.catalogo(), grupos = [...(E.estado.catalogoPropio.length ? ['Mis elementos'] : []), ...E.GRUPOS];
  $('catalogo').innerHTML = grupos.map(g => {
    const l = todos.filter(t => (t.grupo || 'Mis elementos') === g);
    return l.length ? `<h3>${g}</h3>` + l.map(boton).join('') : '';
  }).join('');
}

function pintarPanel() {
  if (editandoPanel || !nivel) return;
  if (vistaSim) return pintarPanelSim();
  if (vistaSol) return pintarPanelSol();
  const sel = P.seleccionados(), el = $('panelDer');
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
      <label class="check" title="Los visitantes de la simulación de circulación se detienen en las paradas"><input id="pParada" type="checkbox" ${sel.every(esParada) ? 'checked' : ''}> Es una parada del recorrido</label>
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
  $('pParada').onchange = e => { marcar(); sel.forEach(i => { i.parada = e.target.checked; }); avisar('items'); };
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
    ${sim && sim.t > 0 && !sim.falta && !$('plano').classList.contains('oculto') ? '<label class="check"><input type="checkbox" name="circ" checked> Agregar el mapa de circulación simulado</label>' : ''}
    ${$('plano').classList.contains('oculto') ? '' : `<label class="check"><input type="checkbox" name="sol" ${vistaSol ? 'checked' : ''}> Agregar el mapa de sol y sombras (${SOL.hhmm(solHora())} h)</label>`}
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
    const paginas = [];
    const fotoPlano = (capa, capaPantalla) => {
      const antes = [ui.capa, ui.capaPantalla, ui.ocultar, new Set(ui.seleccion)];
      ui.capa = capa; ui.capaPantalla = capaPantalla || null; ui.seleccion.clear();
      const img = P.imagen(); [ui.capa, ui.capaPantalla, ui.ocultar] = antes; antes[3].forEach(i => ui.seleccion.add(i)); P.pedir();
      return img;
    };
    if (r.circ && sim) {
      const mapa = $('selSimMapa').value === 'ninguno' ? 'transito' : $('selSimMapa').value;
      const img = fotoPlano((ctx, k) => sim.dibujar(ctx, k, mapa)), s = sim.resumen(), q = parSim();
      if (img) paginas.push({ ...img, titulo: `${nivel.nombre}  ·  Circulación de gente (simulación)`, lineas: [
        `${s.total} visitantes que llegan durante ${q.llegada} min · ${q.permanencia} s por parada${q.tiempoVisita ? ` · hasta ${q.tiempoVisita} min por persona` : ''} · recorrido ${q.modo} · máximo ${s.maxAdentro} personas a la vez`,
        `${p.horaInicio ? `Sale la última persona ${reloj(s.tUltimo)}` : `Duración ${mmss(s.tUltimo)}`} · recorrido por persona ${s.terminaron ? mmss(s.tiempoProm) + ' min' : '—'} · densidad máxima ${s.densMax.toFixed(1).replace('.', ',')} pers./m² (${nivelDens(s.densMax)}) · ${s.pctAglom.toFixed(1).replace('.', ',')} % del tiempo en aglomeración`],
        pie: 'Colores: zonas más transitadas o con aglomeración. Línea punteada y números: recorrido guiado sugerido. Círculo rojo: punto más congestionado.' });
    }
    if (r.sol) {
      const q = solAhora(), afuera = espaciosElegidos(nivel, p).filter(e => e.exterior || e.propio);
      const img = fotoPlano((ctx, k) => SOL.dibujarSol(ctx, k, nivel, p, q.sol, q.norte, q.path), (ctx, w, h) => SOL.dibujarRosa(ctx, w, h, q.sol, q.norte));
      if (img) paginas.push({ ...img, titulo: `${nivel.nombre}  ·  Sol y sombras  ·  ${solFecha().split('-').reverse().join('/')} a las ${SOL.hhmm(solHora())}`, lineas: [
        q.sol.el > 0.5 ? `Sol a ${Math.round(q.sol.el)}° de altura, desde el ${SOL.cardinal(q.sol.az)} · un muro de ${String(p.altura).replace('.', ',')} m da ${(p.altura * SOL.vectores(q.sol, q.norte).largo).toFixed(1).replace('.', ',')} m de sombra` : 'A esta hora no hay sol.',
        afuera.length ? 'Al sol: ' + afuera.map(e => `${e.nombre} ${q.sol.el > 0.5 ? SOL.pctSol(e.poly, q.path) : 0} %`).join(' · ') : 'Elegí espacios al aire libre para ver qué porcentaje queda al sol.'],
        pie: 'Sombras de los edificios y de los elementos altos. Gris claro: interiores techados. No se consideran árboles ni edificios vecinos.' });
    }
    const doc = generarPDF(p, niveles, { paginas, formato: r.formato, iso: !!captura, lista: r.lista, detalle: r.detalle, capturaIso: captura });
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
  $('selProyecto').onchange = async e => { E.abrirProyecto(e.target.value); await fijarNivel(proyecto().nivel); if (vistaSim) simCrear(); };
  $('btnNuevo').onclick = async () => { const n = await pedirNombre('Nueva muestra', 'Muestra de …'); if (n) { E.crearProyecto(n); await fijarNivel(proyecto().nivel); } };
  $('btnMasProyecto').onclick = menuProyecto;
  $('selNivel').onchange = async e => { proyecto().nivel = e.target.value; avisar('nivel'); await fijarNivel(e.target.value); simCrear(); solTabla = null; if (vistaIso) verIso(true); };
  $('tabPlano').onclick = () => ver('plano'); $('tabIso').onclick = () => ver('iso'); $('tabSim').onclick = () => ver('sim'); $('tabSol').onclick = () => ver('sol');
  $('solFecha').onchange = e => solPoner({ fecha: e.target.value });
  $('solHora').oninput = e => { proyecto().sol = { fecha: solFecha(), hora: +e.target.value }; solTexto(); pintarPanelSol(true); P.pedir(); };
  $('solHora').onchange = e => solPoner({ hora: +e.target.value });
  $('btnSolPlay').onclick = solAlternar; $('btnEncuadrar3').onclick = P.encuadrar;
  $('btnSolMuestra').onclick = () => { const h = horaDec(proyecto().horaInicio); if (h === null) return aviso('Cargá primero la hora de inicio de la muestra.'); $('solHora').value = h; solPoner({ hora: h, fecha: proyecto().fecha || solFecha() }); $('solFecha').value = solFecha(); solTexto(); };
  $('btnSimPlay').onclick = simAlternar; $('btnSimReset').onclick = () => { simCrear(); };
  $('selSimMapa').onchange = () => P.pedir(); $('btnSimComparar').onclick = simComparar; $('btnEncuadrar2').onclick = P.encuadrar;
  $('btnDeshacer').onclick = () => E.deshacer(); $('btnRehacer').onclick = () => E.rehacer();
  $('btnPDF').onclick = exportarPDF;
  $('inNombre').oninput = e => { proyecto().nombre = e.target.value; avisar('nombre'); };
  $('inFecha').onchange = e => { proyecto().fecha = e.target.value; avisar('nombre'); };
  $('inInicio').onchange = e => { proyecto().horaInicio = e.target.value; avisar('sim'); };
  $('inFin').onchange = e => { proyecto().horaFin = e.target.value; avisar('sim'); };
  const marcarPaso = async h => { if (vistaIso) await ver('plano'); ui.alHerramienta(h); };
  $('btnEntrada').onclick = () => marcarPaso('entrada'); $('btnSalida').onclick = () => marcarPaso('salida');
  $('inAltura').onchange = e => { marcar(); proyecto().altura = num(e.target.value, 1, 8, 3); avisar('altura'); };
  $('inBuscarEsp').oninput = pintarEspacios;
  $('btnRestaurarEsp').onclick = async () => {
    if (!await confirmar(`¿Volver a los espacios originales del plano en ${nivel.nombre}? Se pierden las formas corregidas y vuelven los que quitaste.`, 'Restaurar')) return;
    marcar(); const p = proyecto(), de = id => id.startsWith(nivel.id + '-');
    p.ocultos = (p.ocultos || []).filter(id => !de(id)); p.formas = Object.fromEntries(Object.entries(p.formas || {}).filter(([id]) => !de(id)));
    avisar('espacios');
  };

  $('listaEspacios').onclick = async e => {
    const fila = e.target.closest('.esp'); if (!fila) return;
    const id = fila.dataset.id, p = proyecto(), a = e.target.dataset.a;
    if (a === 'renombrar') {
      const actual = espaciosDe(nivel, p).find(x => x.id === id);
      const n = await pedirNombre('Nombre del espacio', actual.nombre); if (!n) return;
      marcar(); const propio = p.propios.find(x => x.id === id);
      if (propio) propio.nombre = n; else p.renombres[id] = n;
    } else if (a === 'borrar') { P.quitarEspacio(id); return; }
    else if (a === 'forma') {
      if (vistaIso || vistaSim || vistaSol) await ver('plano');
      ui.alHerramienta('forma'); ui.activo = id;
      const e = espaciosDe(nivel, p).find(x => x.id === id); P.centrarEn(e.poly); return;
    } else {
      marcar(); p.espacios = p.espacios.includes(id) ? p.espacios.filter(x => x !== id) : [...p.espacios, id];
      avisar('espacios'); P.encuadrar(); return;
    }
    avisar('espacios');
  };

  $('catalogo').onclick = async e => {
    const b = e.target.closest('.tipo'); if (!b) return;
    const t = E.catalogo().find(c => c.id === b.dataset.id);
    if (e.target.dataset.a === 'editar') return editarTipo(t);
    if (vistaIso || vistaSol) await ver('plano');
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
  $('btnGiroIzq').onclick = () => iso?.girar(-1); $('btnGiroDer').onclick = () => iso?.girar(1);
  $('selMuros').onchange = $('chkEtiquetas3d').onchange = $('chkSol3d').onchange = () => iso?.actualizarIso(nivel, proyecto(), opIso());
  $('btnPNG').onclick = () => iso && descargar(archivo(proyecto().nombre) + '-isometrica.png', iso.capturarVista());

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
    else if (k === 'delete' || k === 'backspace') { e.preventDefault(); if (!(ui.herramienta === 'forma' && P.borrarActivo())) borrar(); }
    else if (k === 'r') girarSel(e.shiftKey ? 15 : 90);
    else if (k.startsWith('arrow') && sel.length) {
      e.preventDefault(); const d = e.shiftKey ? 0.5 : 0.05; marcar();
      const [dx, dy] = { arrowleft: [-d, 0], arrowright: [d, 0], arrowup: [0, -d], arrowdown: [0, d] }[k];
      sel.forEach(i => { i.x = Math.round((i.x + dx) * 100) / 100; i.y = Math.round((i.y + dy) * 100) / 100; }); avisar('items');
    }
    else if (k === 'escape') { if (!P.cancelar()) { if (ui.herramienta !== 'mover') herr('mover'); else { ui.seleccion.clear(); pintarPanel(); P.pedir(); } } }
    else if (k === 'enter') P.cerrarTrazo();
    else if (k === 'v') herr('mover'); else if (k === 'e') herr('espacios'); else if (k === 'd') herr('dibujar');
    else if (k === 't') herr('rect'); else if (k === 'g') herr('forma');
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
    pintarBarra(); solCache = null;
    if (que !== 'nombre' && que !== 'sol' && sim) { sim = null; simComp = null; simPausar(); if (vistaSim) simCrear(); }
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
