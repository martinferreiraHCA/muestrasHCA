// Estado de la aplicación: muestras (proyectos), catálogo propio, historial y guardado local.

const CLAVE = 'muestrasHCA.v1';

export const CATALOGO_BASE = [
  { id: 'mesa', nombre: 'Mesa', modelo: 'mesa', w: 1.2, d: 0.6, h: 0.75, color: '#c9a36b' },
  { id: 'mesa-escolar', nombre: 'Mesa escolar', modelo: 'mesa', w: 0.6, d: 0.45, h: 0.72, color: '#d8b98a' },
  { id: 'tablon', nombre: 'Tablón', modelo: 'mesa', w: 2.0, d: 0.8, h: 0.75, color: '#b98f55' },
  { id: 'mesa-redonda', nombre: 'Mesa redonda', modelo: 'mesa-redonda', w: 1.2, d: 1.2, h: 0.75, color: '#c9a36b' },
  { id: 'silla', nombre: 'Silla', modelo: 'silla', w: 0.45, d: 0.45, h: 0.45, color: '#5b7fb8' },
  { id: 'banco', nombre: 'Banco largo', modelo: 'banco', w: 2.0, d: 0.35, h: 0.45, color: '#8a6a45' },
  { id: 'stand', nombre: 'Stand', modelo: 'stand', w: 3.0, d: 2.0, h: 2.4, color: '#e2574c' },
  { id: 'panel', nombre: 'Panel / biombo', modelo: 'panel', w: 1.2, d: 0.06, h: 1.8, color: '#6f7c8c' },
  { id: 'tarima', nombre: 'Tarima', modelo: 'caja', w: 4.0, d: 3.0, h: 0.4, color: '#8d7b68' },
  { id: 'pantalla', nombre: 'Pantalla / TV', modelo: 'panel', w: 1.4, d: 0.1, h: 1.9, color: '#2b2f36' },
  { id: 'zona', nombre: 'Zona marcada', modelo: 'zona', w: 3.0, d: 3.0, h: 0, color: '#3aa76d' },
  { id: 'cartel', nombre: 'Texto / cartel', modelo: 'texto', w: 2.0, d: 0.5, h: 0, color: '#1c2430', etiqueta: 'Texto' },
  // para simular la circulación de gente
  { id: 'entrada', nombre: 'Entrada', modelo: 'zona', w: 1.6, d: 1.0, h: 0, color: '#1a9c4b', etiqueta: 'Entrada' },
  { id: 'salida', nombre: 'Salida', modelo: 'zona', w: 1.6, d: 1.0, h: 0, color: '#c0392b', etiqueta: 'Salida' },
  { id: 'persona', nombre: 'Persona', modelo: 'persona', w: 0.5, d: 0.5, h: 1.7, color: '#f08c00' },
];

export const MODELOS = {
  'mesa': 'Mesa rectangular', 'mesa-redonda': 'Mesa redonda', 'silla': 'Silla', 'banco': 'Banco',
  'stand': 'Stand (con fondo y laterales)', 'panel': 'Panel vertical', 'caja': 'Caja / volumen',
  'cilindro': 'Cilindro', 'zona': 'Zona en el piso', 'texto': 'Solo texto',
};

export const uid = () => Math.random().toString(36).slice(2, 10);

function proyectoNuevo(nombre = 'Muestra sin nombre') {
  return {
    id: uid(), nombre, fecha: new Date().toISOString().slice(0, 10), nivel: 'pb', altura: 3,
    espacios: [],          // ids de espacios elegidos (de cualquier nivel)
    propios: [],           // espacios dibujados: {id, nivel, nombre, poly:[[x,y]…] en metros}
    renombres: {},         // id de espacio -> nombre puesto por el usuario
    sim: {},               // parámetros de la simulación de circulación
    items: [],             // {id, nivel, tipo, nombre, modelo, x, y, rot, w, d, h, color, etiqueta}
  };
}

export const estado = { proyectos: [], actual: null, catalogoPropio: [] };
const oyentes = new Set();
let historial = [], futuro = [], pendienteGuardar = null;

export function cargar() {
  try {
    const g = JSON.parse(localStorage.getItem(CLAVE) || 'null');
    if (g && Array.isArray(g.proyectos) && g.proyectos.length) Object.assign(estado, g);
  } catch { /* almacenamiento no disponible o dañado: se empieza de cero */ }
  if (!estado.proyectos.length) { const p = proyectoNuevo('Mi primera muestra'); estado.proyectos.push(p); estado.actual = p.id; }
  if (!estado.proyectos.some(p => p.id === estado.actual)) estado.actual = estado.proyectos[0].id;
}

function guardar() {
  clearTimeout(pendienteGuardar);
  pendienteGuardar = setTimeout(() => {
    try { localStorage.setItem(CLAVE, JSON.stringify(estado)); } catch { /* sin espacio o modo privado */ }
  }, 250);
}

export const proyecto = () => estado.proyectos.find(p => p.id === estado.actual);
export const catalogo = () => [...CATALOGO_BASE, ...estado.catalogoPropio];
export const alCambiar = fn => oyentes.add(fn);
export function avisar(que = 'todo') { guardar(); oyentes.forEach(fn => fn(que)); }

/** Guarda una foto del proyecto para poder deshacer. Llamar ANTES de modificarlo. */
export function marcar() {
  historial.push(JSON.stringify(proyecto()));
  if (historial.length > 80) historial.shift();
  futuro = [];
}
function restaurar(desde, hacia) {
  if (!desde.length) return false;
  hacia.push(JSON.stringify(proyecto()));
  const p = JSON.parse(desde.pop());
  estado.proyectos[estado.proyectos.findIndex(x => x.id === estado.actual)] = p;
  avisar();
  return true;
}
export const deshacer = () => restaurar(historial, futuro);
export const rehacer = () => restaurar(futuro, historial);
export const puedeDeshacer = () => historial.length > 0;
export const puedeRehacer = () => futuro.length > 0;

export function crearProyecto(nombre) {
  const p = proyectoNuevo(nombre); estado.proyectos.push(p); abrirProyecto(p.id); return p;
}
export function abrirProyecto(id) { estado.actual = id; historial = []; futuro = []; avisar(); }
export function duplicarProyecto() {
  const p = JSON.parse(JSON.stringify(proyecto())); p.id = uid(); p.nombre += ' (copia)';
  estado.proyectos.push(p); abrirProyecto(p.id);
}
export function eliminarProyecto() {
  estado.proyectos = estado.proyectos.filter(p => p.id !== estado.actual);
  if (!estado.proyectos.length) estado.proyectos.push(proyectoNuevo('Mi primera muestra'));
  abrirProyecto(estado.proyectos[0].id);
}
export function importarProyecto(obj) {
  if (!obj || !Array.isArray(obj.items)) throw new Error('El archivo no es una muestra válida');
  const p = Object.assign(proyectoNuevo(), obj, { id: uid() });
  (obj.catalogoPropio || []).forEach(t => { if (!catalogo().some(c => c.id === t.id)) estado.catalogoPropio.push(t); });
  delete p.catalogoPropio;
  estado.proyectos.push(p); abrirProyecto(p.id);
}
export function exportarProyecto() {
  const p = proyecto();
  const usados = new Set(p.items.map(i => i.tipo));
  return { ...p, catalogoPropio: estado.catalogoPropio.filter(t => usados.has(t.id)) };
}

export function itemDesdeTipo(tipo, x, y, nivel) {
  return { id: uid(), nivel, tipo: tipo.id, nombre: tipo.nombre, modelo: tipo.modelo, x, y, rot: 0,
    w: tipo.w, d: tipo.d, h: tipo.h, color: tipo.color, etiqueta: tipo.etiqueta || '' };
}
