// Interfaz: une el estado, el editor 2D, la vista isométrica y la exportación.
import * as E from './estado.js';
import { proyecto, marcar, avisar, uid } from './estado.js';
import { cargarIndice, cargarNivel as cargarCrudo, nivelVisible, edificiosOcultos, zonasLibres, espaciosDe, espaciosElegidos, geo } from './niveles.js';
import * as SOL from './sol.js';
import { leerEquipos, distribuir } from './equipos.js';
import { armarSala, FORMAS } from './asientos.js';
import { iniciarAyuda } from './ayuda.js';
import { generarFolleto, aPNG, TEMAS, FORMATOS, FOLLETO_DEF } from './folleto.js';
import * as P from './plano.js';
import { ui } from './plano.js';
import { generarPDF } from './pdf.js';
import { Simulacion, SIM_DEF, DT, esParada, esEntrada, esSalida } from './sim.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = (v, min, max, def) => { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? Math.max(min, Math.min(max, n)) : def; };

let indice = [], nivel = null, iso = null, vistaIso = false, vistaSim = false, vistaSol = false, vistaFol = false, portapapeles = [], editandoPanel = false;

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
let crudo = null;        // el nivel completo; `nivel` es lo mismo sin los edificios ocultos
/** Nivel tal como se muestra en esta muestra (sin los edificios ocultos). */
const cargarNivel = async info => nivelVisible(await cargarCrudo(info), proyecto());
async function fijarNivel(id, encuadrar = true) {
  const info = indice.find(n => n.id === id) || indice.find(n => n.id === 'pb') || indice[0];
  $('cargando').classList.remove('oculto');
  try {
    crudo = await cargarCrudo(info); nivel = nivelVisible(crudo, proyecto());
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
  vistaIso = v === 'iso'; vistaSim = v === 'sim'; vistaSol = v === 'sol'; vistaFol = v === 'folleto';
  $('tabFolleto').classList.toggle('activo', vistaFol); $('herramientasFolleto').classList.toggle('oculto', !vistaFol); $('folleto').classList.toggle('oculto', !vistaFol);
  $('tabSol').classList.toggle('activo', vistaSol); $('herramientasSol').classList.toggle('oculto', !vistaSol);
  if (!vistaSol) solPausar();
  $('tabPlano').classList.toggle('activo', v === 'plano'); $('tabIso').classList.toggle('activo', vistaIso); $('tabSim').classList.toggle('activo', vistaSim);
  $('plano').classList.toggle('oculto', vistaIso || vistaFol); $('iso').classList.toggle('oculto', !vistaIso);
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
    if (vistaFol) await pintarFolleto();
    pintarPanel(); P.pedir();
  }
}
const verIso = si => ver(si ? 'iso' : 'plano');

// ---------- etapas: guía paso a paso ----------
const ETAPAS = [
  { id: 'datos', t: 'Datos', titulo: 'Datos de la muestra', vista: 'plano', herr: 'mover',
    ayuda: 'Poné el nombre, la fecha y el horario. Elegí el nivel (arriba) y, en «Edificios que se ven», qué construcciones mostrar.' },
  { id: 'lugares', t: 'Lugares', titulo: 'Elegir los lugares', vista: 'plano', herr: 'espacios',
    ayuda: 'Tocá en el plano los lugares donde va a ser la muestra, o tildalos en la lista. Si un límite está mal, corregilo con «Editar forma»; si falta un lugar, dibujalo con Rectángulo o Polígono.' },
  { id: 'equipos', t: 'Equipos', titulo: 'Cargar los equipos', vista: 'plano', herr: 'mover',
    ayuda: 'Escribí los equipos, uno por renglón, o pegá la planilla (Grupo, Equipo, Integrantes, Necesidad) y apretá «Distribuir». Si no elegiste lugares, el sistema los elige solo. el sistema arma varias distribuciones, simula la visita con cada una y deja la que mejor circula. Conviene marcar antes la Entrada (panel de la izquierda). Si no tenés equipos, seguí al paso siguiente.' },
  { id: 'muebles', t: 'Muebles', titulo: 'Distribuir los muebles', vista: 'plano', herr: 'mover',
    ayuda: 'Podés armar el salón solo (auditorio, anfiteatro, aula…) con el panel de la izquierda, o a mano: tocá un elemento de la lista para agregarlo y arrastralo a su lugar. Con uno seleccionado, a la derecha podés cambiarle el nombre, los estudiantes y repetirlo en filas.' },
  { id: 'recorrido', t: 'Recorrido', titulo: 'Entrada, salida y circulación', vista: 'sim', herr: 'mover',
    ayuda: 'Marcá por dónde entra y por dónde sale la gente y apretá «Simular» para ver cómo circula y dónde se junta.' },
  { id: 'sol', t: 'Sol', titulo: 'Sol y sombras', vista: 'sol', herr: 'mover',
    ayuda: 'Mirá qué partes quedan al sol a la hora de la muestra. Sirve sobre todo para los lugares al aire libre.' },
  { id: 'folleto', t: 'Folleto y PDF', titulo: 'Folleto y PDF', vista: 'folleto', herr: 'mover',
    ayuda: 'Revisá el mapa «cómo llegar», descargalo y generá el PDF con todo.' },
];
let lugar = -1;                                    // en la etapa de muebles: índice del lugar enfocado (-1 = todos)
const etapa = () => Math.min(ETAPAS.length, Math.max(1, proyecto().etapa || 1));
const lugares = () => nivel ? espaciosElegidos(nivel, proyecto()) : [];
function enfocarLugar() {
  const l = lugares();
  if (lugar >= l.length) lugar = -1;
  if (lugar < 0 || !l.length) P.encuadrar(); else P.centrarEn(l[lugar].poly);
}
async function irEtapa(n, mover = true) {
  n = Math.min(ETAPAS.length, Math.max(1, n));
  let e = ETAPAS[n - 1];
  if (n > 2 && !lugares().length && e.id !== 'equipos') { aviso('Primero elegí al menos un lugar para la muestra.'); n = 2; e = ETAPAS[1]; }
  proyecto().etapa = n; avisar('etapa');
  document.querySelectorAll('.panel.izq section[data-en]').forEach(s => s.classList.toggle('oculto', !$('chkTodoPanel').checked && !s.dataset.en.split(',').includes(e.id)));
  await ver(e.vista);
  if (e.vista === 'plano') ui.alHerramienta(e.herr);
  if (mover && e.vista !== 'folleto') {
    if (n <= 2) P.verTodo();
    else if (e.id === 'muebles') { lugar = lugares().length === 1 ? 0 : -1; enfocarLugar(); }
    else P.encuadrar();
  }
  if (n === 1) $('detEdificios').open = true;
  if (e.id === 'equipos') pintarEquipos();
  // en los pasos de ubicar cosas se ven las zonas que hay que dejar libres
  ui.zonas = ['equipos', 'muebles'].includes(e.id) ? zonasLibres(nivel, P.itemsNivel()) : null;
  if (e.id === 'muebles') pintarSala();
  pintarGuia();
}
function pintarGuia() {
  if (!nivel) return;
  const n = etapa(), e = ETAPAS[n - 1], p = proyecto(), l = lugares(), its = P.itemsNivel();
  $('etapas').innerHTML = ETAPAS.map((x, i) => `<button data-n="${i + 1}" class="${i + 1 === n ? 'activa' : i + 1 < n ? 'hecha' : ''}"><span class="n">${i + 1 < n ? '✓' : i + 1}</span>${x.t}</button>`).join('');
  let estado = '', extra = '';
  if (n === 1) estado = p.fecha ? `${p.fecha.split('-').reverse().join('/')}${p.horaInicio ? ' · ' + p.horaInicio + (p.horaFin ? ' a ' + p.horaFin : '') : ' · <span class="falta">falta el horario</span>'}` : '<span class="falta">falta la fecha</span>';
  if (n === 2) estado = l.length ? `<span class="ok">${l.length} lugar${l.length > 1 ? 'es' : ''} · ${Math.round(l.reduce((a, x) => a + x.area, 0))} m²</span>` : '<span class="falta">todavía no elegiste ninguno</span>';
  if (e.id === 'equipos') { const q = leerEquipos(p.equipos?.texto, p.equipos?.porDef ?? 4), u = its.filter(i => i.equipo).length; estado = q.length ? `${q.length} equipos cargados${u ? ` · <span class="ok">${u} ubicados</span>` : ' · <span class="falta">sin distribuir todavía</span>'}` : ''; }
  if (e.id === 'muebles') {
    const act = lugar >= 0 && l[lugar] ? l[lugar] : null;
    const dentro = act ? its.filter(i => puntoEnPoligono(i.x, i.y, act.poly)).length : its.length;
    estado = `${dentro} elemento${dentro === 1 ? '' : 's'}${act ? ' en este lugar' : ' en total'}`;
    if (l.length > 1) extra = `<div class="lugares"><button data-l="prev" title="Lugar anterior">◀</button><b title="${esc(act ? act.nombre : 'Todos los lugares')}">${esc(act ? act.nombre : 'Todos los lugares')}</b><button data-l="next" title="Lugar siguiente">▶</button><button data-l="todos" title="Ver todos los lugares juntos">Ver todos</button></div>`;
  }
  if (e.id === 'recorrido') { const ne = its.filter(esEntrada).length; estado = ne ? `<span class="ok">${ne} entrada${ne > 1 ? 's' : ''}</span>` : '<span class="falta">falta marcar la entrada</span>'; }
  if (e.id === 'sol' && !l.some(x => x.exterior || x.propio)) estado = 'Tus lugares son interiores: podés pasar al paso siguiente.';
  $('guia').innerHTML = `<span class="paso">Paso ${n} de ${ETAPAS.length}</span><h1>${e.titulo}</h1><p>${e.ayuda} ${estado ? '<b>' + estado + '</b>' : ''}</p>${extra}
    <div class="nav"><button data-n="${n - 1}" ${n === 1 ? 'disabled' : ''}>◀ Anterior</button>${n < ETAPAS.length ? `<button data-n="${n + 1}" class="primario">Siguiente ▶</button>` : ''}</div>`;
}
const puntoEnPoligono = (x, y, p) => { let d = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) if ((p[i][1] > y) !== (p[j][1] > y) && x < (p[j][0] - p[i][0]) * (y - p[i][1]) / (p[j][1] - p[i][1]) + p[i][0]) d = !d; return d; };

// ---------- equipos en texto plano y distribución automática ----------
const TIPOS_EQ = ['fis-080', 'stand', 'mesa', 'tablon', 'mesa-redonda', 'mesa-escolar', 'gazebo'];
function pintarEquipos() {
  const q = proyecto().equipos || {};
  const tipos = E.catalogo().filter(t => TIPOS_EQ.includes(t.id) || !t.grupo);
  $('eqTipo').innerHTML = tipos.map(t => `<option value="${t.id}" ${t.id === (q.tipo || 'stand') ? 'selected' : ''}>${esc(t.nombre)} (${t.w} × ${t.d} m)</option>`).join('');
  if (document.activeElement !== $('eqTexto')) $('eqTexto').value = q.texto || '';
  $('eqPorDef').value = q.porDef ?? 4; $('eqPorMesa').value = q.porMesa ?? 4;
  contarEquipos();
}
function contarEquipos() {
  const l = leerEquipos($('eqTexto').value, num($('eqPorDef').value, 0, 40, 4));
  $('resEquipos').textContent = l.length ? `${l.length} · ${l.reduce((a, e) => a + e.estudiantes, 0)} estudiantes` : '';
  return l;
}
function guardarEquipos() { proyecto().equipos = { texto: $('eqTexto').value, tipo: $('eqTipo').value, porDef: num($('eqPorDef').value, 0, 40, 4), porMesa: num($('eqPorMesa').value, 0, 40, 4) }; avisar('nombre'); pintarGuia(); }
const sinAc = t => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const NO_SIRVE = /^(ss\.?hh|dep[oó]sito|cocina|oficina|administraci|direcci|recepci|vestuario|porter|kitchenette|sala de dormir|cancha|explanada|juegos|gradas|aulas y comedor|pasaje|jard[ií]n)/i;
/**
 * Elige solo los lugares para los equipos: los que algún equipo pide por nombre (cambiando de nivel si hace
 * falta) y, si no alcanzan, va sumando los más cercanos hasta que entren todos. Devuelve los que agregó.
 */
async function elegirLugares(equipos, tipo, porMesa) {
  const p = proyecto(), agregados = [], pedidos = [...new Set(equipos.map(q => q.lugar).filter(Boolean).map(sinAc))];
  const tiene = (niv, t) => espaciosDe(niv, p).find(e => sinAc(e.nombre).includes(t));
  // si lo pedido está en otro nivel y acá todavía no hay nada elegido, se pasa a ese nivel
  if (pedidos.length && !lugares().length && !pedidos.some(t => tiene(nivel, t))) for (const info of indice) {
    const niv = await cargarNivel(info);
    if (pedidos.some(t => tiene(niv, t))) { p.nivel = info.id; await fijarNivel(info.id); break; }
  }
  const sumar = e => { if (!p.espacios.includes(e.id)) { p.espacios.push(e.id); agregados.push(e.nombre); } };
  for (const t of pedidos) { const e = tiene(nivel, t); if (e) sumar(e); }
  const posibles = () => espaciosDe(nivel, p).filter(e => !p.espacios.includes(e.id) && !e.auto && e.area >= 18 && !NO_SIRVE.test(e.nombre));
  // sin nada elegido: se parte del salón o hall techado más grande (si no hay, de un patio)
  const techado = e => !e.exterior && !e.propio, util = /hall|sal[oó]n|antesala|mandala|comedor|auditorio|gimnasio|biblioteca|galer/i;
  if (!lugares().length) { const o = posibles().sort((a, b) => b.area - a.area), e = o.find(x => techado(x) && util.test(x.nombre)) || o.find(techado) || o[0]; if (e) sumar(e); }
  for (let k = 0; k < 10 && lugares().length; k++) {
    const r = await distribuir(nivel, p, equipos, tipo, porMesa, null);
    if (!r.sinLugar.length) break;
    const ancla = lugares(), dist = e => Math.min(...ancla.map(a => Math.hypot(a.cx - e.cx, a.cy - e.cy)));
    // se suman los más cercanos: primero halls y salones, después aulas, y los patios al final
    const orden = e => (techado(e) ? 0 : 2) + (/^aula/i.test(e.nombre) ? 1 : 0);
    const e = posibles().sort((a, b) => orden(a) - orden(b) || dist(a) - dist(b))[0];
    if (!e) break; sumar(e);
  }
  if (agregados.length) avisar('espacios');
  return agregados;
}
async function distribuirEquipos() {
  guardarEquipos();
  const l = contarEquipos(), p = proyecto();
  if (!l.length) return aviso('Escribí al menos un equipo, uno por renglón.');
  const tipoEq = E.catalogo().find(t => t.id === $('eqTipo').value), porMesa = num($('eqPorMesa').value, 0, 40, 4);
  aviso('Buscando lugar para los equipos…'); await new Promise(f => setTimeout(f, 30));
  const elegidos = await elegirLugares(l, tipoEq, porMesa);
  if (!lugares().length) return aviso('No encontré lugares donde ubicar los equipos en este nivel. Elegí alguno a mano en el paso 2.');
  const previos = p.items.filter(i => i.equipo && i.nivel === nivel.id).length;
  if (previos && !await confirmar(`Ya hay ${previos} puestos de equipos ubicados. ¿Los reemplazo por una distribución nueva?`, 'Reemplazar')) return;
  aviso('Preparando las distribuciones…'); $('btnDistribuir').disabled = true; await new Promise(f => setTimeout(f, 30));
  // Para elegir la mejor ubicación se simula la visita con cada alternativa. Hace falta una entrada: la marcada o,
  // en planta baja, el punto por donde se llega al lugar caminando desde el portón.
  const fijos = p.items.filter(i => i.nivel === nivel.id && !i.equipo);
  let entProv = null;
  if (!fijos.some(esEntrada) && nivel.id === 'pb') {
    const G0 = new Simulacion(nivel, { ...p, items: [] }, {}, 1, { x0: 0, y0: 0, x1: nivel.ancho, y1: nivel.alto });
    for (const dest of [...lugares()].sort((a, b) => b.area - a.area)) {          // el primer lugar al que se pueda llegar caminando desde el portón
      const ruta = G0.camino([102.4, 46.6], [dest.cx, dest.cy], 1.4), k = ruta ? ruta.findIndex(q => lugares().some(e => puntoEnPoligono(q[0], q[1], e.poly))) : -1;
      if (k >= 0) { const q = ruta[Math.min(ruta.length - 1, k + 6)]; entProv = { ...E.itemDesdeTipo(E.catalogo().find(t => t.id === 'entrada'), q[0], q[1], nivel.id) }; break; }
    }
  }
  const q = parSim(), vis = Math.min(q.visitantes, 80), parEv = { ...q, visitantes: vis, porMinuto: Math.max(q.porMinuto, vis / 6), tandas: false, seguir: -1 };
  const simular = fijos.some(esEntrada) || entProv ? items => {
    const s = new Simulacion(nivel, { ...p, items: [...fijos, ...(entProv ? [entProv] : []), ...items] }, parEv); const r = s.completar(3600);
    return { r, diag: s.diagnostico() };
  } : null;
  const r = await distribuir(nivel, p, l, tipoEq, porMesa, simular,
    async t => { $('eqResultado').textContent = t; aviso(t); await new Promise(f => setTimeout(f, 0)); });
  if (entProv && r.ensayos) r.resumen += ' Como no hay Entrada marcada, supuse que la gente llega desde el portón; si entra por otro lado, marcá la Entrada y volvé a distribuir.';
  marcar();
  p.items = [...p.items.filter(i => !(i.equipo && i.nivel === nivel.id)), ...r.items];
  ui.seleccion.clear(); avisar('items'); P.encuadrar();
  const ench = r.items.filter(i => i.enchufe).map(i => i.etiqueta), sinPedido = l.filter(q => q.lugar && !lugares().some(e => sinAc(e.nombre).includes(sinAc(q.lugar)))).map(q => `${q.nombre} (${q.lugar})`);
  if (elegidos.length) r.resumen = `Elegí estos lugares en ${nivel.nombre}: ${elegidos.join(', ')}. ` + r.resumen;
  if (ench.length) r.resumen += ` Piden enchufe cerca: ${ench.join(', ')}; el plano no indica dónde hay enchufes, así que eso revisalo en el lugar.`;
  if (sinPedido.length) r.resumen += ` No encontré en el plano el lugar pedido por: ${sinPedido.join(', ')}. Buscalo en la lista de lugares, ponele ese nombre con el lápiz y volvé a distribuir.`;
  $('eqResultado').innerHTML = `<b>${r.items.length} de ${l.length} equipos ubicados${r.mesas > r.items.length ? `, con ${r.mesas} mesas` : ''}.</b> ${esc(r.resumen)}` +
    (r.sinLugar.length ? ` <span class="alerta">No entraron: ${esc(r.sinLugar.map(e => e.nombre).join(', '))}. Elegí más lugares o un mueble más chico.</span>` : '');
  $('btnDistribuir').disabled = false; if (vistaSim) simCrear();
  aviso(`${r.items.length} equipos ubicados.`);
}

// ---------- armado automático de un salón ----------
const SALA_DEF = { forma: 'auditorio', personas: 60, frente: 'auto', escenario: true, llenar: false };
const NOMBRE_FRENTE = { arriba: 'arriba', abajo: 'abajo', izquierda: 'la izquierda', derecha: 'la derecha' };
const confSala = id => ({ ...SALA_DEF, ...(proyecto().salas?.[id] || {}) });
/** Muestra en el formulario la configuración guardada del lugar elegido. */
function cargarSala() {
  const q = confSala($('saLugar').value);
  $('saForma').value = q.forma; $('saPersonas').value = q.personas; $('saFrente').value = q.frente; $('saEscenario').checked = !!q.escenario; $('saLlenar').checked = !!q.llenar;
  $('saResultado').textContent = '';
}
function pintarSala() {
  const l = lugares(), previo = $('saLugar').value;
  $('saLugar').innerHTML = l.map((e, i) => `<option value="${e.id}" ${(lugar >= 0 ? i === lugar : e.id === previo) ? 'selected' : ''}>${esc(e.nombre)} (${Math.round(e.area)} m²)</option>`).join('');
  if (!$('saForma').options.length) $('saForma').innerHTML = Object.entries(FORMAS).map(([k, t]) => `<option value="${k}">${t}</option>`).join('');
  cargarSala(); pintarResumenSala();
}
const enLugar = (id, it) => { const e = lugares().find(x => x.id === id); return e && puntoEnPoligono(it.x, it.y, e.poly); };
/** Tabla con lo armado en cada lugar y el total. */
function pintarResumenSala() {
  const p = proyecto(), filas = lugares().map(e => ({ e, c: p.salas?.[e.id], n: p.items.filter(i => i.auto === 'sala' && i.tipo === 'silla' && i.nivel === nivel.id && puntoEnPoligono(i.x, i.y, e.poly)).length })).filter(f => f.c && f.n);
  $('saResumen').innerHTML = filas.length ? `<table class="resumen" style="margin-top:8px">${filas.map(f => `<tr><td>${esc(f.e.nombre)}<br><small>${esc(FORMAS[f.c.forma].split(':')[0])}${f.c.capacidad ? ` · entran hasta ${f.c.capacidad}` : ''}</small></td><td>${f.n}</td></tr>`).join('')}
    <tr><td><b>Total de lugares</b></td><td><b>${filas.reduce((a, f) => a + f.n, 0)}</b></td></tr></table>${lugares().length > 1 ? '<button id="btnArmarTodas" class="ancho">Volver a armar todos los lugares</button>' : ''}` : '';
  const b = $('btnArmarTodas'); if (b) b.onclick = () => { marcar(); filas.forEach(f => armarUna(f.e, f.c)); avisar('items'); P.encuadrar(); aviso('Lugares rearmados.'); };
}
/** Arma un lugar con su configuración y la guarda. No avisa ni marca: eso lo hace quien llama. */
function armarUna(e, op) {
  const p = proyecto();
  // un escenario que el usuario movió o giró dentro del lugar manda sobre el frente elegido
  const esc = p.items.find(i => (i.tipo === 'tarima' || i.tipo === 'escenario') && i.fijo && i.nivel === nivel.id && puntoEnPoligono(i.x, i.y, e.poly));
  op = { ...op, escenarioFijo: esc ? esc.id : null };
  const r = armarSala(nivel, p, e, id => E.catalogo().find(t => t.id === id), op);
  p.salas = { ...(p.salas || {}), [e.id]: { ...op, capacidad: r.capacidad, frenteUsado: r.frente } };
  p.items = [...p.items.filter(i => i === esc || !(i.auto === 'sala' && i.nivel === nivel.id && puntoEnPoligono(i.x, i.y, e.poly))), ...r.items];
  return r;
}
/** Si se movió o giró un escenario dentro de un lugar armado, se reacomodan las sillas delante de él. */
function seguirEscenario(movidos) {
  const p = proyecto(); let n = 0;
  for (const it of movidos) {
    if (it.tipo !== 'tarima' && it.tipo !== 'escenario') continue;
    const e = lugares().find(x => puntoEnPoligono(it.x, it.y, x.poly)), c = e && p.salas?.[e.id];
    if (!c) continue;                                  // solo en lugares que se armaron con el sistema
    p.items.forEach(i => { if ((i.tipo === 'tarima' || i.tipo === 'escenario') && i.fijo && i !== it && puntoEnPoligono(i.x, i.y, e.poly)) delete i.fijo; });
    it.fijo = true;
    const r = armarUna(e, c); n += r.lugares;
    $('saResultado').innerHTML = `<b>Reacomodé ${r.lugares} lugares</b> en ${esc(e.nombre)} delante del escenario, hacia donde mira${r.lugares < r.pedidas ? ` <span class="alerta">(con el escenario ahí entran ${r.lugares} de ${r.pedidas})</span>` : ''}. Si lo borrás, el frente vuelve a elegirse solo.`;
  }
  if (n) aviso(`Sillas reacomodadas según el escenario: ${n} lugares.`);
  return n;
}
function armarSalaAhora() {
  const e = lugares().find(x => x.id === $('saLugar').value);
  if (!e) return aviso('Primero elegí un lugar.');
  const op = { forma: $('saForma').value, personas: num($('saPersonas').value, 1, 1500, 60) | 0, frente: $('saFrente').value, escenario: $('saEscenario').checked, llenar: $('saLlenar').checked };
  marcar(); const r = armarUna(e, op);
  ui.seleccion.clear(); avisar('items'); P.centrarEn(e.poly);
  const extra = `${r.fijo ? ' Lo armé delante del escenario que ubicaste, hacia donde mira.' : ''}${r.automatico ? ` Elegí el frente hacia ${NOMBRE_FRENTE[r.frente]}, que es el que mejor rinde.` : ''}${op.escenario && op.forma !== 'ronda' && !r.conEscenario ? ' No encontré lugar para el escenario contra esa pared.' : ''}${r.pasillos ? ` Respeté ${r.pasillos} pasillo${r.pasillos > 1 ? 's' : ''} o zona${r.pasillos > 1 ? 's' : ''} libre${r.pasillos > 1 ? 's' : ''}.` : ''}`;
  $('saResultado').innerHTML = r.lugares >= r.pedidas
    ? `<b>${r.lugares} lugares armados</b> en ${esc(e.nombre)}${op.llenar ? ', el máximo que encontré' : `; con esta forma entran hasta ${r.capacidad}`}.${extra}`
    : `<b>Entraron ${r.lugares} de ${r.pedidas}.</b> <span class="alerta">En ${esc(e.nombre)} no hay lugar para más con esta forma.</span>${extra}`;
}
function quitarSala() {
  const p = proyecto(), id = $('saLugar').value, n = p.items.filter(i => i.auto === 'sala' && i.nivel === nivel.id && enLugar(id, i)).length;
  if (!n) return aviso('No hay nada armado automáticamente en ese lugar.');
  marcar(); p.items = p.items.filter(i => !(i.auto === 'sala' && i.nivel === nivel.id && enLugar(id, i))); if (p.salas) delete p.salas[id]; avisar('items'); $('saResultado').textContent = '';
}

// ---------- folleto: mapa «cómo llegar» ----------
let folleto = null;
const opFol = () => ({ ...FOLLETO_DEF, ...(proyecto().folleto || {}) });
async function pintarFolleto() {
  const suelo = await cargarNivel(indice.find(n => n.id === 'pb') || indice[0]);
  folleto = generarFolleto(nivel, suelo, proyecto(), opFol());
  $('folleto').innerHTML = folleto.svg.replace(/^<\?xml[^>]*>\s*/, '');
  ui.pista(folleto.aviso);
}
function pintarPanelFolleto() {
  const o = opFol(), p = proyecto(), el = $('panelDer');
  const sel = (id, obj, v, nom) => `<select id="${id}">${Object.entries(obj).map(([k, t]) => `<option value="${k}" ${k === v ? 'selected' : ''}>${nom(t)}</option>`).join('')}</select>`;
  el.innerHTML = `
    <section><h2>Mapa para folleto</h2>
      <p class="ayuda">Un mapa ilustrado con el caminito desde el punto de partida hasta la muestra. El recorrido va a la <b>Entrada</b> de la muestra si está marcada; si no, al espacio elegido.</p>
      <label>Título<input id="fTitulo" type="text" value="${esc(o.titulo)}" placeholder="${esc(p.nombre)}"></label>
      <label>Subtítulo<input id="fSub" type="text" value="${esc(o.subtitulo)}" placeholder="Fecha · horario · nivel"></label>
      <label>Texto en la partida<input id="fPartida" type="text" value="${esc(o.partida)}"></label>
      <label>Texto en la llegada<input id="fLlegada" type="text" value="${esc(o.llegada)}" placeholder="Nombre del espacio"></label>
    </section>
    <section><h2>Estilo</h2>
      <label>Colores${sel('fTema', TEMAS, o.tema, t => t.nombre)}</label>
      <label>Formato${sel('fFormato', FORMATOS, o.formato, t => t[2])}</label>
      <label>Encuadre<select id="fEncuadre"><option value="recorrido" ${o.encuadre === 'recorrido' ? 'selected' : ''}>Acercar al recorrido</option><option value="predio" ${o.encuadre === 'predio' ? 'selected' : ''}>Todo el colegio</option></select></label>
      <label class="check"><input id="fArboles" type="checkbox" ${o.arboles ? 'checked' : ''}> Árboles</label>
      <label class="check"><input id="fNombres" type="checkbox" ${o.nombres ? 'checked' : ''}> Nombres de patios</label>
      <label class="check"><input id="fLeyenda" type="checkbox" ${o.leyenda ? 'checked' : ''}> Leyenda con distancia</label>
    </section>
    <section><h2>Para editarlo</h2>
      <p class="ayuda">El SVG es vectorial y viene separado en capas con nombre (predio, edificios, árboles, recorrido, marcadores, encabezado…), con los textos como texto. Se abre en Illustrator, Inkscape, Figma, Affinity o Canva.</p>
    </section>`;
  const poner = (id, k, check) => { const f = () => { proyecto().folleto = { ...(proyecto().folleto || {}), [k]: check ? $(id).checked : $(id).value }; avisar('folleto'); }; $(id)[check || $(id).tagName === 'SELECT' ? 'onchange' : 'oninput'] = f; };
  poner('fTitulo', 'titulo'); poner('fSub', 'subtitulo'); poner('fPartida', 'partida'); poner('fLlegada', 'llegada');
  poner('fTema', 'tema'); poner('fFormato', 'formato'); poner('fEncuadre', 'encuadre');
  poner('fArboles', 'arboles', true); poner('fNombres', 'nombres', true); poner('fLeyenda', 'leyenda', true);
}

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
  q.turnos = Math.max(1, q.turnos | 0);
  q.durTurno = duracionMuestra() / q.turnos;                 // minutos de cada turno (0 si no hay horario)
  // si no se indicó, los padres van llegando durante los primeros tres cuartos del turno
  if (!q.llegada) { q.llegada = q.durTurno ? Math.max(1, Math.round(q.durTurno * 0.75)) : Math.max(1, Math.round(q.visitantes / 20)); q.llegadaAuto = true; }
  q.porMinuto = q.visitantes / q.llegada;
  return q;
}
/** Cuánto tarda una persona sola (sin nadie más) en recorrer toda la muestra, con los mismos tiempos por stand. */
let soloCache = null;
function tiempoSolo() {
  const q = parSim(), clave = JSON.stringify([nivel.id, q.permanencia, q.paradas, q.modo, q.hijoPrimero, q.velocidad, proyecto().items.length, proyecto().items.map(i => [i.x, i.y, i.rot]).join()]);
  if (soloCache?.clave !== clave) {
    const s1 = new Simulacion(nivel, proyecto(), { ...q, visitantes: 1, porMinuto: 60, tandas: false, seguir: 0 }), r = s1.falta ? null : s1.completar(4 * 3600);
    soloCache = { clave, r: r && r.seguido };
  }
  return soloCache.r;
}
function simCrear() {
  simPausar(); simFix = null; if (vistaSim) ui.pista(''); sim = nivel ? new Simulacion(nivel, proyecto(), parSim()) : null; simComp = null;
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
    // segundos de simulación que corresponden a este cuadro: en tiempo real la gente camina a su velocidad verdadera
    const seg = Math.min(0.1, (ahora - simPrevio) / 1000) * +$('selSimVel').value;
    simPrevio = ahora;
    if (seg <= DT) sim.paso(Math.max(0.004, seg));
    else for (let i = 0, n = Math.min(1600, Math.round(seg / DT)); i < n && !sim.terminada; i++) sim.paso();
    P.pedir();
    if (ahora - tPanelSim > 400) { tPanelSim = ahora; pintarEstadoSim(); }
    if (sim.terminada) { simPausar(); pintarEstadoSim(); finSim(); aviso('Simulación terminada.'); return; }
    simRaf = requestAnimationFrame(cuadro);
  };
  simRaf = requestAnimationFrame(cuadro);
}
const mmss = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const nivelDens = d => d < 1 ? 'cómoda' : d < 2 ? 'aceptable' : d < 3.5 ? 'apretada' : 'crítica';
function pintarEstadoSim() {
  const el = $('simEstado'); if (!el || !sim) return;
  if (sim.falta) { el.innerHTML = `<p class="ayuda alerta">${esc(sim.falta)}</p>`; return; }
  const r = sim.resumen(), q = parSim(), dur = q.durTurno, hay = !!proyecto().horaInicio, sg = r.seguido, coma = v => v.toFixed(1).replace('.', ',');
  const tarde = dur && r.terminada ? r.tUltimo / 60 - dur : 0;
  el.innerHTML = `<table class="resumen">
    <tr><td>${hay ? 'Hora simulada' : 'Tiempo simulado'}</td><td>${reloj(r.t)}</td></tr>
    <tr><td>Recorriendo ahora</td><td>${r.adentro - r.esperando}</td></tr>
    ${q.tandas ? `<tr><td>Esperando su tanda</td><td>${r.esperando} <small>(${r.tandas} tanda${r.tandas === 1 ? '' : 's'} adentro)</small></td></tr>` : ''}
    <tr><td>Máximo a la vez</td><td>${r.maxAdentro} padres${r.estudiantes ? ` + ${r.estudiantes} estudiantes` : ''}</td></tr>
    ${r.maxAdentro ? `<tr><td>Momento de mayor carga</td><td>${hay ? reloj(r.tPico) : mmss(r.tPico)}</td></tr>
    <tr><td>Lugar por persona en ese momento</td><td>${(() => { const m = lugares().reduce((a, x) => a + x.area, 0) / (r.maxAdentro + r.estudiantes); return m ? coma(m) + ' m²' : '—'; })()}</td></tr>` : ''}
    <tr><td>Ya salieron</td><td>${r.terminaron} de ${r.total}</td></tr>
    <tr><td>Densidad máxima</td><td>${coma(r.densMax)} pers./m² <small>(${nivelDens(r.densMax)})</small></td></tr>
    <tr><td>Tiempo en aglomeración</td><td>${coma(r.pctAglom)} %</td></tr>
    ${r.terminada ? `<tr><td>Sale la última persona</td><td>${hay ? reloj(r.tUltimo) : mmss(r.tUltimo)}</td></tr>` : ''}
  </table>
  <h3 class="sub">Una persona promedio</h3>
  ${r.terminaron ? `<table class="resumen">
    <tr><td><b>Tarda en total</b></td><td><b>${mmss(r.tiempoProm)} min</b></td></tr>
    <tr><td>· en los stands</td><td>${mmss(r.paradoProm)}</td></tr>
    <tr><td>· caminando y haciendo lugar</td><td>${mmss(Math.max(0, r.tiempoProm - r.paradoProm - r.esperaProm))}</td></tr>
    ${q.tandas ? `<tr><td>· esperando su tanda</td><td>${mmss(r.esperaProm)}</td></tr>` : ''}
    <tr><td>Si estuviera sola</td><td>${tiempoSolo() ? mmss(tiempoSolo().t) + ' min' : '—'}</td></tr>
  </table>` : '<p class="ayuda">Todavía no salió nadie.</p>'}
  ${sg ? `<h3 class="sub">La persona que seguís <span class="punto"></span></h3><table class="resumen">
    <tr><td>${sg.fin ? 'Terminó el recorrido en' : 'Lleva'}</td><td><b>${mmss(sg.t)} min</b></td></tr>
    <tr><td>Stands visitados</td><td>${sg.vistas} de ${r.paradas}</td></tr>
    <tr><td>Caminó</td><td>${Math.round(sg.camino)} m</td></tr>
    <tr><td>${sg.fin ? 'Estuvo en los stands' : 'Ahora'}</td><td>${sg.fin ? mmss(sg.parado) : sg.estado === 'espera' ? 'espera su tanda' : sg.estado === 'sale' ? 'va a la salida' : (sg.estado === 'parado' ? 'está en ' : 'va a ') + esc(sg.en || '')}</td></tr>
    ${sg.hijo ? `<tr><td>El stand de su hijo</td><td>${esc(sg.hijo)}</td></tr>` : ''}
  </table>` : ''}
  ${r.terminada && dur ? (tarde > 1
    ? `<p class="ayuda alerta">No alcanza el turno de ${Math.round(dur)} min: la última persona sale ${Math.round(tarde)} min después. Probá con menos padres por turno, menos tiempo por stand o más turnos.</p>`
    : `<p class="ayuda">El turno de ${Math.round(dur)} min alcanza: todos terminan ${Math.round(-tarde)} min antes.</p>`) : ''}
  ${r.apurados ? `<p class="ayuda alerta">${r.apurados} persona${r.apurados > 1 ? 's no llegaron' : ' no llegó'} a ver todos los stands en el tiempo de visita.</p>` : ''}
  ${(() => { const dg = r.terminada && sim.diagnostico(); if (!dg) return r.terminada ? '<p class="ayuda ok">No hay puntos de aglomeración: la gente circula sin trabarse.</p>' : '';
    return `<div class="diag"><h3 class="sub"><span class="circ"></span>Punto más congestionado</h3>
      <p class="ayuda">Es el círculo rojo punteado del plano: el lugar donde la gente pasó más tiempo apretada (2 o más personas por m²). ${esc(dg.causa)}</p>
      <p class="ayuda"><b>Qué podés hacer:</b></p>
      <ul class="sugs">${dg.sugerencias.map(([f, t]) => `<li>${esc(t)}${f ? ` <button data-fix="${f}">Aplicar</button>` : ''}</li>`).join('')}</ul>
      <button data-fix="auto" class="primario ancho">Probar y dejar la mejor</button>
      ${simFix ? `<p class="ayuda ${simFix.mejoro ? 'ok' : ''}" style="margin-top:8px">${esc(simFix.texto)}</p>` : ''}</div>`; })()}
  ${sim.paradas.length ? `<p class="ayuda" style="margin-top:8px">Visitas por stand: ${sim.paradas.map(p => `${esc(p.nombre)} <b>${p.visitas}</b>`).join(' · ')}</p>` : ''}`;
}
const DINAMICAS = [
  { id: 'libre', nombre: 'Libre', cambios: { modo: 'libre', hijoPrimero: false, tandas: false } },
  { id: 'guiado', nombre: 'Guiado', cambios: { modo: 'guiado', hijoPrimero: false, tandas: false } },
  { id: 'hijo', nombre: 'Hijo primero', cambios: { modo: 'libre', hijoPrimero: true, tandas: false } },
  { id: 'tandas', nombre: 'Por tandas', cambios: { modo: 'libre', hijoPrimero: false, tandas: true } },
  { id: 'tandas-hijo', nombre: 'Tandas + hijo', cambios: { modo: 'libre', hijoPrimero: true, tandas: true } },
];
function pintarPanelSim() {
  const p = parSim(), el = $('panelDer'), its = P.itemsNivel();
  const nE = its.filter(esEntrada).length, nS = its.filter(esSalida).length, nP = its.filter(esParada).length, nW = its.filter(i => i.tipo === 'espera').length;
  const tot = p.visitantes * p.turnos, hi = proyecto().horaInicio;
  el.innerHTML = `
    <section><h2>Visita de los padres</h2>
      <table class="resumen">
        <tr><td>Entradas</td><td>${nE || '<b class="alerta">falta</b>'}</td></tr>
        <tr><td>Salidas</td><td>${nS || 'por la entrada'}</td></tr>
        <tr><td>Stands a visitar</td><td>${nP}</td></tr>
        <tr><td>Lugar de espera</td><td>${nW || (p.tandas ? 'en la entrada' : '—')}</td></tr>
      </table>
    </section>
    <section><h2>Turnos</h2>
      <div class="fila2">
        <label>Padres por turno<input id="sVis" type="number" min="1" max="600" value="${p.visitantes}"></label>
        <label>Cantidad de turnos<input id="sTur" type="number" min="1" max="20" value="${p.turnos}"></label>
        <label title="Minutos durante los que van llegando los padres de un turno">Llegan durante (min)<input id="sLle" type="number" min="1" max="1440" value="${p.llegada}"></label>
        <label>Entran por minuto<input type="text" disabled value="${(Math.round(p.porMinuto * 10) / 10).toString().replace('.', ',')}"></label>
      </div>
      <p class="ayuda">${p.durTurno ? `${p.turnos} turno${p.turnos > 1 ? 's' : ''} de ${Math.round(p.durTurno)} min${hi ? ` (${Array.from({ length: Math.min(p.turnos, 6) }, (_, k) => reloj(k * p.durTurno * 60)).join(', ')}${p.turnos > 6 ? '…' : ''})` : ''} · ${tot} padres en total.` : 'Cargá el horario de la muestra (paso 1) para saber cuánto dura cada turno.'} La simulación muestra un turno.</p>
    </section>
    <section><h2>Tiempos</h2>
      <div class="fila2">
        <label title="Cuánto se queda una persona en cada stand">Segundos por stand<input id="sPer" type="number" min="0" max="900" value="${p.permanencia}"></label>
        <label title="0 = visitan todos">Stands por persona<input id="sPar" type="number" min="0" max="99" value="${p.paradas}"></label>
        <label title="Tope de tiempo por persona; 0 = sin tope">Tope de visita (min)<input id="sTie" type="number" min="0" max="600" value="${p.tiempoVisita}"></label>
        <label title="Velocidad promedio al caminar sin gente alrededor">Velocidad al caminar (m/s)<input id="sVel" type="number" min="0.3" max="2.5" step="0.1" value="${p.velocidad}"></label>
        <label title="Qué visitante seguir con el marcador celeste (0 = el primero)">Seguir a la persona n.º<input id="sSeg" type="number" min="0" max="599" value="${p.seguir >= 0 ? p.seguir : Math.floor(p.visitantes / 2)}"></label>
      </div>
    </section>
    <section><h2>Dinámica</h2>
      <label>Recorrido<select id="sModo">
        <option value="libre" ${p.modo === 'libre' ? 'selected' : ''}>Libre: va al stand más cercano y menos lleno</option>
        <option value="guiado" ${p.modo === 'guiado' ? 'selected' : ''}>Guiado: sentido único, todos en el mismo orden</option>
      </select></label>
      <label class="check"><input id="sHijo" type="checkbox" ${p.hijoPrimero ? 'checked' : ''}> Primero el stand de su hijo (y se quedan el doble), después el resto</label>
      <label class="check"><input id="sTan" type="checkbox" ${p.tandas ? 'checked' : ''}> Entran por tandas y esperan en un lugar</label>
      <div class="fila2 ${p.tandas ? '' : 'oculto'}">
        <label>Padres por tanda<input id="sTam" type="number" min="1" max="300" value="${p.tandaTam}"></label>
        <label>Una tanda cada (min)<input id="sCad" type="number" min="1" max="120" value="${p.tandaCada}"></label>
      </div>
      ${p.tandas && !nW ? '<p class="ayuda">Marcá el <b>Lugar de espera</b> (columna izquierda); si no, esperan en la entrada.</p>' : ''}
    </section>
    <section><h2>Resultado</h2><div id="simEstado"></div></section>
    ${simComp ? `<section><h2>Comparación de dinámicas</h2>
      <table class="tablasol"><tr><th>Dinámica</th><th title="Tiempo promedio por persona">Por persona</th><th title="Sale la última persona">Termina</th><th title="Densidad máxima (pers./m²)">Dens.</th><th title="% del tiempo en aglomeración">Aglom.</th></tr>
        ${simComp.filas.map(f => `<tr class="${f.id === simComp.mejor ? 'muestra' : ''}"><td>${f.nombre}</td><td>${mmss(f.r.tiempoProm)}</td><td>${mmss(f.r.tUltimo)}</td><td>${f.r.densMax.toFixed(1)}</td><td>${f.r.pctAglom.toFixed(1)} %</td></tr>`).join('')}
      </table><p class="ayuda" style="margin-top:8px">${esc(simComp.texto)}</p></section>` : ''}`;
  const poner = (id, k, min, max) => { $(id).onchange = e => { const t = e.target; proyecto().sim = { ...(proyecto().sim || {}), [k]: t.type === 'checkbox' ? t.checked : t.tagName === 'SELECT' ? t.value : num(t.value, min, max, SIM_DEF[k]) }; avisar('sim'); }; };
  poner('sVis', 'visitantes', 1, 600); poner('sTur', 'turnos', 1, 20); poner('sLle', 'llegada', 1, 1440); poner('sTie', 'tiempoVisita', 0, 600); poner('sPer', 'permanencia', 0, 900);
  poner('sPar', 'paradas', 0, 99); poner('sSeg', 'seguir', 0, 599); poner('sVel', 'velocidad', 0.3, 2.5); poner('sModo', 'modo'); poner('sHijo', 'hijoPrimero'); poner('sTan', 'tandas'); poner('sTam', 'tandaTam', 1, 300); poner('sCad', 'tandaCada', 1, 120);
  pintarEstadoSim();
}
/** Calcula toda la simulación de una vez, sin animarla. */
// ---------- arreglos para el punto más congestionado ----------
let simFix = null;
const ARREGLOS = {
  llegada: q => ({ llegada: Math.min(q.durTurno ? Math.round(q.durTurno) : 240, Math.max(q.llegada + 2, q.llegada * 2)) }),
  tandas: q => ({ tandas: true, tandaTam: Math.max(5, Math.round(q.visitantes / 5)), tandaCada: Math.max(2, Math.round(q.llegada / 4)) }),
  guiado: () => ({ modo: 'guiado' }),
  permanencia: q => ({ permanencia: Math.max(10, Math.round(q.permanencia * 0.75)) }),
};
const NOMBRE_ARREGLO = { llegada: 'llegada más repartida', tandas: 'entrada por tandas', guiado: 'recorrido guiado', permanencia: 'menos tiempo por stand' };
async function simArreglar(cual) {
  const q = parSim(), antes = sim.resumen();
  aviso('Probando…'); await new Promise(f => setTimeout(f, 30));
  const probar = c => new Simulacion(nivel, proyecto(), { ...q, ...c }).completar(4 * 3600);
  let cambios, despues, nombre;
  if (cual === 'auto') {          // se prueban las que propone el diagnóstico y se queda con la que menos aglomera
    const op = sim.diagnostico().sugerencias.map(s => s[0]).filter(Boolean).map(k => ({ k, c: ARREGLOS[k](q) })).map(o => ({ ...o, r: probar(o.c) }));
    const m = op.reduce((a, b) => (b.r.pctAglom + b.r.densMax) < (a.r.pctAglom + a.r.densMax) ? b : a);
    cambios = m.c; despues = m.r; nombre = NOMBRE_ARREGLO[m.k];
  } else { cambios = ARREGLOS[cual](q); despues = probar(cambios); nombre = NOMBRE_ARREGLO[cual]; }
  const mejoro = despues.pctAglom + despues.densMax < antes.pctAglom + antes.densMax - 0.2, coma = v => v.toFixed(1).replace('.', ',');
  const fix = { mejoro, texto: mejoro
    ? `Apliqué «${nombre}»: la aglomeración bajó de ${coma(antes.pctAglom)} % a ${coma(despues.pctAglom)} % del tiempo y la densidad máxima de ${coma(antes.densMax)} a ${coma(despues.densMax)} pers./m². La visita por persona pasó de ${mmss(antes.tiempoProm)} a ${mmss(despues.tiempoProm)} min.`
    : `Probé «${nombre}» y no mejora (${coma(despues.pctAglom)} % contra ${coma(antes.pctAglom)} %), así que no cambié nada. Acá el problema es de espacio: conviene mover o separar los puestos.` };
  if (mejoro) { marcar(); proyecto().sim = { ...(proyecto().sim || {}), ...cambios }; avisar('sim'); }
  simFix = fix; sim = new Simulacion(nivel, proyecto(), parSim()); sim.completar(4 * 3600);
  pintarPanel(); P.pedir(); finSim();
}
const finSim = () => { const r = sim.resumen(); ui.pista(`Se muestra el momento de mayor carga (${proyecto().horaInicio ? reloj(r.tPico) : 'minuto ' + mmss(r.tPico)}): ${r.maxAdentro} padres a la vez. Verde: en un stand · azul: caminando · rojo: apretados · violeta: esperando · naranja: estudiantes.`); };
async function simYa() {
  simPausar(); simCrear();
  if (sim.falta) return aviso(sim.falta);
  aviso('Calculando…'); await new Promise(f => setTimeout(f, 30));
  const t0 = performance.now(); sim.completar(4 * 3600);
  pintarEstadoSim(); P.pedir(); finSim(); aviso(`Listo en ${((performance.now() - t0) / 1000).toFixed(1).replace('.', ',')} s.`);
}
async function simComparar() {
  simPausar();
  const base = new Simulacion(nivel, proyecto(), parSim());
  if (base.falta) return aviso(base.falta);
  if (base.paradas.length < 2) return aviso('Hacen falta al menos dos stands o mesas con nombre para comparar dinámicas.');
  aviso('Probando las dinámicas…'); await new Promise(f => setTimeout(f, 40));
  const filas = DINAMICAS.map(d => ({ ...d, r: new Simulacion(nivel, proyecto(), { ...parSim(), ...d.cambios }).completar(4 * 3600) }));
  // menos aglomeración y densidad primero; a igualdad, lo que termina antes
  const nota = r => r.pctAglom + r.densMax * 2 + r.tUltimo / 600;
  const m = filas.reduce((a, b) => nota(b.r) < nota(a.r) ? b : a);
  simComp = { filas, mejor: m.id, texto: `La que mejor circula es «${m.nombre}» (resaltada): ${m.r.pctAglom.toFixed(1)} % del tiempo en aglomeración, densidad máxima ${m.r.densMax.toFixed(1)} y termina a los ${mmss(m.r.tUltimo)} min. La dejé elegida; podés cambiarla arriba.` };
  proyecto().sim = { ...(proyecto().sim || {}), ...m.cambios };
  const comp = simComp; avisar('sim'); simComp = comp;
  sim = new Simulacion(nivel, proyecto(), parSim()); sim.completar(4 * 3600);
  pintarPanel(); P.pedir(); finSim();
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

function pintarEdificios() {
  const oc = edificiosOcultos(proyecto());
  $('listaEdificios').innerHTML = geo.edificios.map(e => `<label class="check"><input type="checkbox" data-id="${e.id}" ${oc.includes(e.id) ? '' : 'checked'}>
    <span>${esc(e.nombre)}${e.proyecto ? '<small>Proyecto: todavía no está construido</small>' : e.demoler ? '<small>Existe hoy; el plano prevé demolerlo</small>' : ''}</span></label>`).join('');
}
function pintarEspacios() {
  if (!nivel) return;
  pintarEdificios();
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
  const usados = id => proyecto().items.filter(i => i.tipo === id).reduce((n, i) => n + (i.mesas || 1), 0);        // en toda la muestra
  const boton = t => `
    <button class="tipo" draggable="true" data-id="${t.id}" title="Agregar ${esc(t.nombre)}">
      <span class="muestra ${['mesa-redonda', 'cilindro', 'persona'].includes(t.modelo) ? 'redonda' : ''}" style="background:${t.color}"></span>
      <span><b>${esc(t.nombre)}</b><small>${t.w} × ${t.d} m${t.stock ? ` · ${t.codigo} · <span class="${usados(t.id) > t.stock ? 'alerta' : ''}">${usados(t.id)} de ${t.stock}</span>` : ''}</small></span>
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
  if (vistaFol) return pintarPanelFolleto();
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
      ${!varios && (u.grupo || u.integrantes) ? `<p class="ayuda">${u.grupo ? `<b>${esc(u.grupo)}</b> · ` : ''}${esc(u.integrantes || '')}${u.necesidad ? `<br><b>Pide:</b> ${esc(u.necesidad)}` : ''}</p>` : ''}
      <label>Nombre en el plano<input id="pEtiqueta" type="text" value="${esc(comun('etiqueta'))}" placeholder="${varios ? 'Mismo texto para todos' : 'Ej.: Stand 3 · 5.º B'}"></label>
      <div class="fila3">
        <label>Ancho (m)<input id="pW" type="number" min="0.05" max="60" step="0.05" value="${comun('w')}"></label>
        <label>Fondo (m)<input id="pD" type="number" min="0.02" max="60" step="0.05" value="${comun('d')}"></label>
        <label>Alto (m)<input id="pH" type="number" min="0" max="8" step="0.05" value="${comun('h')}"></label>
      </div>
      <div class="fila2">
        <label title="Estudiantes que atienden este puesto">Estudiantes<input id="pEst" type="number" min="0" max="40" value="${comun('estudiantes') ?? ''}" placeholder="0"></label>
        <label>Giro (°)<input id="pRot" type="number" step="5" value="${comun('rot')}"></label>
      </div>
      <div class="fila2">
        <label>Color<input id="pColor" type="color" value="${comun('color') || '#888888'}"></label>
        <span></span>
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
  vivo('pEst', v => { const n = num(v, 0, 40, 0); sel.forEach(i => { i.estudiantes = Math.round(n); }); });
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
  sel.forEach(i => { i.rot = (((i.rot + g) % 360) + 360) % 360; }); seguirEscenario(sel); avisar('items');
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
    <label class="check"><input type="checkbox" name="fol" ${vistaFol ? 'checked' : ''}> Agregar el mapa «cómo llegar» del folleto</label>
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
        `${s.total} visitantes que llegan durante ${q.llegada} min · ${q.permanencia} s por parada${q.tiempoVisita ? ` · hasta ${q.tiempoVisita} min por persona` : ''} · recorrido ${q.modo}${q.hijoPrimero ? ' · primero el stand del hijo' : ''}${q.tandas ? ` · tandas de ${q.tandaTam} cada ${q.tandaCada} min` : ''} · máximo ${s.maxAdentro} personas a la vez`,
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
    if (r.fol) {
      const suelo = await cargarNivel(indice.find(n => n.id === 'pb') || indice[0]), f = generarFolleto(nivel, suelo, p, opFol());
      paginas.unshift({ url: await aPNG(f.svg, f.w, f.h, 2), tipo: 'PNG', w: f.w, h: f.h, titulo: `${nivel.nombre}  ·  Cómo llegar`, lineas: [], pie: '' });
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
  $('selProyecto').onchange = async e => { E.abrirProyecto(e.target.value); await fijarNivel(proyecto().nivel); await irEtapa(etapa()); };
  $('btnNuevo').onclick = async () => { const n = await pedirNombre('Nueva muestra', 'Muestra de …'); if (n) { E.crearProyecto(n); await fijarNivel(proyecto().nivel); await irEtapa(1); } };
  $('btnMasProyecto').onclick = menuProyecto;
  $('selNivel').onchange = async e => { proyecto().nivel = e.target.value; avisar('nivel'); await fijarNivel(e.target.value); simCrear(); solTabla = null; await irEtapa(etapa()); };
  $('tabPlano').onclick = () => ver('plano'); $('tabIso').onclick = () => ver('iso'); $('tabSim').onclick = () => ver('sim'); $('tabSol').onclick = () => ver('sol'); $('tabFolleto').onclick = () => ver('folleto');
  $('btnAcceso').onclick = async () => { await ver('plano'); ui.alHerramienta('acceso'); };
  $('btnFolSVG').onclick = () => folleto && descargar(archivo(proyecto().nombre) + '-como-llegar.svg', folleto.svg, 'image/svg+xml');
  $('btnFolPNG').onclick = async () => { if (!folleto) return; try { descargar(archivo(proyecto().nombre) + '-como-llegar.png', await aPNG(folleto.svg, folleto.w, folleto.h)); } catch (e) { aviso(e.message); } };
  $('solFecha').onchange = e => solPoner({ fecha: e.target.value });
  $('solHora').oninput = e => { proyecto().sol = { fecha: solFecha(), hora: +e.target.value }; solTexto(); pintarPanelSol(true); P.pedir(); };
  $('solHora').onchange = e => solPoner({ hora: +e.target.value });
  $('btnSolPlay').onclick = solAlternar; $('btnEncuadrar3').onclick = P.encuadrar;
  $('btnSolMuestra').onclick = () => { const h = horaDec(proyecto().horaInicio); if (h === null) return aviso('Cargá primero la hora de inicio de la muestra.'); $('solHora').value = h; solPoner({ hora: h, fecha: proyecto().fecha || solFecha() }); $('solFecha').value = solFecha(); solTexto(); };
  $('btnSimPlay').onclick = simAlternar; $('btnSimReset').onclick = () => { simCrear(); };
  $('selSimMapa').onchange = () => P.pedir(); $('btnSimComparar').onclick = simComparar;
  $('panelDer').addEventListener('click', e => { const b = e.target.closest('[data-fix]'); if (b) simArreglar(b.dataset.fix); });
  $('btnSimYa').onclick = simYa; $('btnEncuadrar2').onclick = P.encuadrar;
  $('btnDeshacer').onclick = () => E.deshacer(); $('btnRehacer').onclick = () => E.rehacer();
  $('btnPDF').onclick = exportarPDF;
  $('inNombre').oninput = e => { proyecto().nombre = e.target.value; avisar('nombre'); };
  $('inFecha').onchange = e => { proyecto().fecha = e.target.value; avisar('nombre'); };
  $('inInicio').onchange = e => { proyecto().horaInicio = e.target.value; avisar('sim'); };
  $('inFin').onchange = e => { proyecto().horaFin = e.target.value; avisar('sim'); };
  const marcarPaso = async h => { if (vistaIso) await ver('plano'); ui.alHerramienta(h); };
  $('btnEntrada').onclick = () => marcarPaso('entrada'); $('btnSalida').onclick = () => marcarPaso('salida'); $('btnEspera').onclick = () => marcarPaso('espera');
  $('inAltura').onchange = e => { marcar(); proyecto().altura = num(e.target.value, 1, 8, 3); avisar('altura'); };
  $('inBuscarEsp').oninput = pintarEspacios;
  const clicEtapa = e => { const b = e.target.closest('[data-n]'); if (b && !b.disabled) irEtapa(+b.dataset.n); };
  $('etapas').onclick = clicEtapa;
  $('guia').onclick = e => {
    const b = e.target.closest('[data-l]'); if (!b) return clicEtapa(e);
    const l = lugares().length;
    lugar = b.dataset.l === 'todos' ? -1 : b.dataset.l === 'next' ? (lugar + 1) % l : (lugar <= 0 ? l - 1 : lugar - 1);
    enfocarLugar(); pintarGuia(); pintarSala();
  };
  $('chkTodoPanel').onchange = () => irEtapa(etapa(), false);
  $('eqTexto').oninput = () => { contarEquipos(); }; $('eqTexto').onchange = $('eqTipo').onchange = $('eqPorDef').onchange = $('eqPorMesa').onchange = guardarEquipos;
  $('btnDistribuir').onclick = distribuirEquipos;
  $('btnPasillo').onclick = () => ui.alHerramienta('pasillo');
  $('saLugar').onchange = () => { cargarSala(); const e = lugares().find(x => x.id === $('saLugar').value); if (e) P.centrarEn(e.poly); };
  $('btnArmarSala').onclick = armarSalaAhora; $('btnQuitarSala').onclick = quitarSala;
  $('btnPDF2').onclick = () => exportarPDF();
  $('btn3D').onclick = () => ver('iso'); $('btnVolverPlanta').onclick = () => ver('plano');
  $('listaEdificios').onchange = e => {
    const id = e.target.dataset.id; if (!id) return;
    marcar(); const oc = new Set(edificiosOcultos(proyecto())); e.target.checked ? oc.delete(id) : oc.add(id);
    proyecto().edificiosOcultos = [...oc]; avisar('edificios');
  };
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
      if (vistaIso || vistaSim || vistaSol || vistaFol) await ver('plano');
      ui.alHerramienta('forma'); ui.activo = id;
      const e = espaciosDe(nivel, p).find(x => x.id === id); P.centrarEn(e.poly); return;
    } else {
      marcar(); p.espacios = p.espacios.includes(id) ? p.espacios.filter(x => x !== id) : [...p.espacios, id];
      avisar('espacios'); if (etapa() !== 2) P.encuadrar(); return;
    }
    avisar('espacios');
  };

  $('catalogo').onclick = async e => {
    const b = e.target.closest('.tipo'); if (!b) return;
    const t = E.catalogo().find(c => c.id === b.dataset.id);
    if (e.target.dataset.a === 'editar') return editarTipo(t);
    if (vistaIso || vistaSol || vistaFol) await ver('plano');
    P.agregar(t);
  };
  $('catalogo').addEventListener('dragstart', e => { const b = e.target.closest('.tipo'); if (b) e.dataTransfer.setData('text/plain', b.dataset.id); });
  $('btnNuevoTipo').onclick = () => editarTipo(null);

  const herr = h => { document.querySelectorAll('#herramientas [data-h]').forEach(b => b.classList.toggle('activo', b.dataset.h === h)); P.fijarHerramienta(h); };
  ui.alHerramienta = herr;
  document.querySelectorAll('#herramientas [data-h]').forEach(b => { b.onclick = () => herr(b.dataset.h); });
  $('chkIman').onchange = e => { ui.iman = e.target.checked; };
  $('chkDetalle').onchange = e => { ui.detalle = e.target.checked; P.pedir(); };
  $('chkNotas').onchange = e => { ui.notas = e.target.checked; P.pedir(); };
  $('btnEncuadrar').onclick = P.encuadrar;
  $('btnGiroIzq').onclick = () => iso?.girar(-1); $('btnGiroDer').onclick = () => iso?.girar(1);
  $('selMuros').onchange = $('chkEtiquetas3d').onchange = $('chkSol3d').onchange = () => iso?.actualizarIso(nivel, proyecto(), opIso());
  $('btnPNG').onclick = () => iso && descargar(archivo(proyecto().nombre) + '-isometrica.png', iso.capturarVista());

  window.addEventListener('keydown', e => {
    if ($('dlg').open || e.target.matches('input, select, textarea')) return;
    const ctrl = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (ctrl && k === 'z') { e.preventDefault(); e.shiftKey ? E.rehacer() : E.deshacer(); return; }
    if (ctrl && k === 'y') { e.preventDefault(); E.rehacer(); return; }
    if (vistaIso || vistaFol) return;
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
      sel.forEach(i => { i.x = Math.round((i.x + dx) * 100) / 100; i.y = Math.round((i.y + dy) * 100) / 100; }); seguirEscenario(sel); avisar('items');
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
  E.cargar(); iniciarAyuda();
  ui.alMover = seguirEscenario;
  ui.alSeleccionar = pintarPanel; ui.pedirNombre = pedirNombre; ui.pista = t => { $('pista').textContent = t || ''; };
  P.iniciar($('plano'));
  conectar();
  E.alCambiar(que => {
    // tras deshacer o cambiar de muestra puede haber ids seleccionados que ya no existen
    const ids = new Set(proyecto().items.map(i => i.id));
    [...ui.seleccion].forEach(id => { if (!ids.has(id)) ui.seleccion.delete(id); });
    if (crudo) { const f = nivelVisible(crudo, proyecto()); if (f !== nivel) { nivel = f; ui.nivel = f; solTabla = null; } }
    pintarBarra(); solCache = null; pintarGuia();
    if (ui.zonas && nivel) ui.zonas = zonasLibres(nivel, P.itemsNivel());
    if (nivel && ETAPAS[etapa() - 1].id === 'muebles') pintarResumenSala();
    if (vistaFol) { pintarFolleto(); if (que === 'folleto') return; }
    if (que !== 'nombre' && que !== 'sol' && que !== 'etapa' && sim) { sim = null; simComp = null; simPausar(); if (vistaSim) simCrear(); }
    if (que !== 'items' && que !== 'nombre') pintarEspacios();
    if (que === 'catalogo' || que === 'todo' || que === 'items') pintarCatalogo();
    if (que !== 'nombre') pintarPanel();
    P.pedir();
    if (vistaIso && iso && que !== 'nombre') { clearTimeout(tIso); tIso = setTimeout(() => iso.actualizarIso(nivel, proyecto(), opIso()), 60); }
  });
  try {
    indice = await cargarIndice();
  } catch (e) { $('cargando').textContent = 'No se pudo cargar el plano. Abrí el sitio desde un servidor web (no como archivo local).'; return; }
  $('selNivel').innerHTML = indice.map(n => `<option value="${n.id}">${esc(n.nombre)}</option>`).join('');
  await fijarNivel(proyecto().nivel);
  await irEtapa(etapa());
}
arrancar();
