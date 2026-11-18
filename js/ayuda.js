// Ayudas «?»: al lado de cada dato hay un botón que explica qué es, con un ejemplo.
// La clave es el comienzo del texto del rótulo (sin mayúsculas ni acentos).
const A = {
  // --- datos de la muestra ---
  'nombre en el plano': ['El texto que se escribe sobre el mueble en la planta, el PDF y el folleto.', 'Si ponés «Robótica 5.º B», la mesa aparece con ese nombre. Las mesas y stands con nombre cuentan como paradas en la simulación.'],
  'nombre': ['El título de la muestra. Aparece en el PDF y en el folleto.', '«Feria de Ciencias 2026».'],
  'fecha': ['El día de la muestra. Se usa en el PDF, en el folleto y para calcular dónde está el sol.', 'Con 20/11 el sol sale 05:34; con 21/06 sale mucho más tarde y las sombras son más largas.'],
  'altura (m)': ['Altura aproximada de cada piso. Con ella se levantan los muros en 3D y se calculan las sombras.', 'Con 3 m, un edificio de dos pisos da sombra como un muro de 6 m.'],
  'empieza': ['Hora en que abre la muestra.', '10:00. Junto con «Termina» define cuánto dura cada turno.'],
  'termina': ['Hora en que cierra la muestra.', 'De 10:00 a 12:00 son 120 minutos; con 3 turnos, cada uno dura 40.'],
  'edificios que se ven': ['Qué construcciones se dibujan. Las que todavía son proyecto vienen ocultas.', 'Si destildás «Casona», desaparece de la planta, del 3D, del folleto y del PDF.'],
  // --- espacios ---
  'espacios': ['Los lugares del colegio. Los tildados son donde va a ser la muestra.', '«2 · 483 m²» significa dos lugares elegidos que suman 483 metros cuadrados.'],
  // --- equipos ---
  'equipos': ['La lista de equipos que exponen, uno por renglón: nombre ; estudiantes ; lugar.', '«Huerta ; 6 ; Patio central» es el equipo Huerta, con 6 estudiantes, que querés en el patio central.'],
  'cada equipo usa': ['El mueble que recibe cada equipo.', 'Con «Mesa (1.2 × 0.6 m)» cada equipo tiene una mesa; con «Stand» un stand de 3 × 2 m, que ocupa mucho más.'],
  'equipo asignado': ['Qué equipo de tu lista ocupa esta mesa. Al elegirlo, la mesa toma su nombre, sus estudiantes y su color.', 'Elegís «Nexa (3)» y la mesa pasa a llamarse Nexa con 3 estudiantes. Si Nexa ya estaba en otra mesa, la deja libre.'],
  'estudiantes por equipo': ['Cuántos estudiantes se suponen cuando el renglón no lo dice.', 'Si escribís solo «Volcanes» y acá hay un 4, Volcanes queda con 4 estudiantes.'],
  'estudiantes por mesa': ['A partir de cuántos estudiantes se agrega otra mesa al equipo.', 'Con 4, un equipo de 9 recibe 3 mesas juntas. Con 0 siempre va una sola.'],
  'estudiantes': ['Cuántos estudiantes atienden este puesto. Se dibujan como pelotitas naranjas pegadas a la mesa.', 'Con 5, aparecen 5 pelotitas: primero atrás, después a los costados.'],
  // --- armar salón ---
  'lugar': ['En cuál de los lugares elegidos se arma la distribución.', 'Si elegiste el Auditorio y el Patio, acá decís en cuál van las sillas.'],
  'forma': ['Cómo se acomodan las sillas y mesas.', 'Auditorio: filas rectas. Anfiteatro: filas curvas alrededor del frente. Aula: una mesa por persona. U: mesas en herradura. Ronda: todos en círculo.'],
  'personas': ['Cuántos lugares para sentarse querés.', 'Si pedís 120 y en el salón entran 96, el sistema pone 96 y te avisa.'],
  'llenar todo el lugar': ['Ignora la cantidad de personas y pone todas las sillas que entran.', 'En el salón multiuso, en auditorio, entran unas 60. Prueba varios corrimientos de las filas y deja el que más da.'],
  'el frente esta': ['Hacia qué lado de la pantalla miran las sillas (donde está el escenario o el pizarrón).', '«Automático» prueba los cuatro lados y deja el que da más lugares y pone a la gente más cerca del escenario. «Arriba»: todos miran hacia el borde superior del plano.'],
  // --- propiedades ---
  'cambiar ': ['Reemplaza el mueble por otro del catálogo, conservando el lugar, el giro, el nombre y el equipo.', 'Tocás «Seleccionar equipos», elegís «Tablón» y todas las mesas de equipos pasan a ser tablones de una vez.'],
  'poner las que hagan falta': ['Al cambiar por una mesa más chica, pone varias juntas para llegar al mismo frente que tenía la anterior y para que entren todos sus estudiantes.', 'Un tablón de 2 m cambiado por mesas escolares de 0,6 m queda como 4 mesas escolares juntas.'],
  'mesas juntas': ['Cuántas mesas iguales van una al lado de la otra en este puesto.', 'Con 3, una mesa de 1,2 m pasa a ser un frente de 3,6 m, y el inventario cuenta 3.'],
  'ancho (m)': ['Medida del mueble de lado a lado, en metros.', '1,2 es una mesa de un metro veinte de frente.'],
  'fondo (m)': ['Medida del mueble de adelante hacia atrás, en metros.', '0,6 es una mesa de sesenta centímetros de profundidad.'],
  'alto (m)': ['Altura del mueble. Se ve en 3D y sirve para las sombras.', 'Una mesa mide 0,75; un panel, 1,8.'],
  'giro': ['Cuánto está girado el mueble, en grados.', '0 mira hacia abajo en la pantalla; 90 queda de costado.'],
  'color': ['El color con que se dibuja.', 'Podés pintar de un color los stands de cada grado.'],
  'es una parada': ['Si los visitantes de la simulación se detienen acá.', 'Una mesa de exposición sí; una mesa de café que no querés contar, no.'],
  'columnas': ['Cuántas copias a lo ancho.', '6 columnas y 2 filas hacen 12 sillas.'],
  'filas': ['Cuántas copias hacia abajo.', '6 columnas y 2 filas hacen 12 sillas.'],
  'separacion': ['Espacio libre entre una copia y la siguiente, en metros.', '0,1 deja diez centímetros entre silla y silla.'],
  // --- visita de padres ---
  'padres por turno': ['Cuántos padres esperás en cada turno.', 'Con 60 por turno y 3 turnos, pasan 180 padres en total. La simulación muestra un turno.'],
  'cantidad de turnos': ['En cuántos turnos se reparte el horario de la muestra.', 'De 10:00 a 12:00 con 3 turnos: 10:00, 10:40 y 11:20, de 40 minutos cada uno.'],
  'llegan durante': ['En cuántos minutos entran todos los padres del turno.', 'Con 5 entran casi todos juntos y el salón se llena. Con 30 entran de a poco.'],
  'entran por minuto': ['Se calcula solo: padres por turno dividido los minutos en que llegan.', '60 padres en 5 minutos son 12 por minuto.'],
  'segundos por stand': ['Cuánto se queda una persona mirando cada stand.', 'Con 60 segundos y 7 stands, solo en los stands se van 7 minutos, sin contar caminar.'],
  'stands por persona': ['Cuántos stands visita cada persona. 0 significa todos.', 'Con 3, cada padre mira tres stands y se va.'],
  'tope de visita': ['Tiempo máximo que una persona se queda. Al llegar, deja lo que le falta y sale. 0 es sin tope.', 'Con 10, a los diez minutos va a la salida aunque no haya visto todo.'],
  'velocidad al caminar': ['A qué velocidad camina una persona cuando tiene el paso libre. Cuando hay mucha gente, la simulación la frena sola.', '1,3 m/s es el paso normal de un adulto (unos 4,7 km/h). Con chicos o personas mayores, 1,0.'],
  'seguir a la persona': ['Qué visitante se muestra con el marcador celeste y su recorrido dibujado.', '0 es el primero que entra; 30 es el número 31.'],
  'recorrido': ['Cómo decide cada persona a qué stand ir.', 'Libre: va al más cercano y menos lleno. Guiado: todos siguen el mismo orden, en sentido único.'],
  'primero el stand': ['Cada padre va primero al stand de su hijo, se queda el doble, y después recorre el resto.', 'Los equipos con más estudiantes reciben más padres al principio.'],
  'entran por tandas': ['Los padres esperan en un lugar y entran en grupos.', 'Con tandas de 15 cada 4 minutos, adentro nunca hay muchos, pero cada uno espera más.'],
  'padres por tanda': ['Cuántos entran juntos en cada tanda.', '15: se abre la puerta para 15 y el resto sigue esperando.'],
  'una tanda cada': ['Cada cuántos minutos entra una tanda nueva.', '4: entra un grupo a las 10:00, otro a las 10:04, otro a las 10:08.'],
  'entradas': ['Cuántas entradas marcaste. Por ahí aparecen los padres.', 'Sin ninguna, la simulación no puede empezar.'],
  'salidas': ['Por dónde se van. Si no marcás ninguna, salen por la entrada.', 'Con la salida en otra puerta, la gente no se cruza.'],
  'stands a visitar': ['Las mesas y stands que tienen nombre: son las paradas del recorrido.', '7 quiere decir que cada padre tiene 7 lugares para ver.'],
  'lugar de espera': ['Dónde esperan los padres cuando entran por tandas.', 'Un patio o un hall cerca de la entrada.'],
  // --- resultado ---
  'hora simulada': ['Por dónde va el reloj de la simulación.', '10:35 quiere decir que pasaron 35 minutos desde que abrió.'],
  'tiempo simulado': ['Cuánto tiempo de la muestra lleva simulado.', '12:30 son doce minutos y medio.'],
  'recorriendo ahora': ['Padres que están adentro en este instante.', '0 al final significa que ya salieron todos.'],
  'esperando su tanda': ['Padres que todavía no entraron.', '8 esperando y 1 tanda adentro.'],
  'maximo a la vez': ['La mayor cantidad de gente junta que hubo.', '«60 padres + 28 estudiantes»: en el peor momento había 88 personas.'],
  'momento de mayor carga': ['A qué hora estuvo más lleno. Al terminar, el plano muestra ese instante.', '10:05: cinco minutos después de abrir.'],
  'lugar por persona': ['Metros cuadrados que le tocan a cada uno en el momento más lleno.', 'Más de 2 m² es cómodo; 1 m² ya es apretado; menos de 0,5 es demasiado.'],
  'ya salieron': ['Cuántos terminaron la visita.', '45 de 60: faltan 15.'],
  'densidad maxima': ['Personas por metro cuadrado en el punto más apretado.', 'Hasta 1 es cómodo, hasta 2 aceptable, hasta 3,5 apretado y más es crítico.'],
  'tiempo en aglomeracion': ['Qué parte del tiempo la gente estuvo apretada (2 o más por m²).', '3 % es poco; 30 % significa que casi un tercio de la visita fue entre empujones.'],
  'sale la ultima': ['Cuándo se va el último padre del turno.', 'Si el turno termina 10:40 y el último sale 10:35, sobran 5 minutos.'],
  'tarda en total': ['Cuánto demora una persona promedio en toda la visita.', '7:26 son siete minutos y veintiséis segundos, sumando stands, caminata y espera.'],
  '· en los stands': ['La parte del tiempo que pasa mirando stands.', 'Con 7 stands de 60 segundos son unos 7 minutos.'],
  '· caminando': ['La parte que se va en caminar y esperar que se libere el paso.', 'Si es mucho más que con una persona sola, hay congestión.'],
  '· esperando': ['Lo que espera antes de entrar, si hay tandas.', '3:20 esperando en el patio antes de pasar.'],
  'si estuviera sola': ['Cuánto tardaría la misma persona sin nadie más. Sirve para comparar.', 'Sola 5:10 y con gente 7:26: la gente le suma más de dos minutos.'],
  'stands visitados': ['Cuántos stands lleva vistos la persona que seguís.', '4 de 7.'],
  'camino': ['Metros que caminó la persona que seguís.', '22 m dentro del salón.'],
  // --- sol ---
  'sale el sol': ['Hora de salida del sol ese día.', '05:34 en noviembre.'],
  'se pone': ['Hora de puesta del sol.', '19:28 en noviembre.'],
  'altura del sol': ['Qué tan alto está el sol, en grados sobre el horizonte.', '23° es bajo: sombras largas. 70° es casi arriba: sombras cortas.'],
  'viene desde': ['Desde qué punto cardinal alumbra.', 'O (262°) es desde el oeste: las sombras caen hacia el este.'],
  'sombra de un muro': ['Largo de la sombra que da un muro de esa altura.', '7,0 m: la sombra llega siete metros desde la pared.'],
  'norte del plano': ['Hacia dónde queda el norte en el dibujo. De esto dependen todas las sombras.', 'Si al mediodía la sombra no cae donde debería, corregí este número.'],
  // --- folleto ---
  'titulo': ['El título grande del mapa.', 'Si lo dejás vacío usa el nombre de la muestra.'],
  'subtitulo': ['El renglón chico debajo del título.', '«20/11/2026 · 10:00 a 13:00 h · Planta baja».'],
  'texto en la partida': ['El cartel del punto donde empieza el caminito.', '«Entrada del colegio» o «Portón de Av. Millán».'],
  'texto en la llegada': ['El cartel del lugar de la muestra.', '«Salón multiuso» o «Feria de Ciencias».'],
  'colores': ['La paleta del mapa.', 'Cálido para imprimir en papel; Noche para una pantalla; Tinta para fotocopiar.'],
  'formato': ['La proporción de la imagen.', 'Cuadrado para redes; vertical para un volante.'],
  'encuadre': ['Cuánto del colegio se ve.', '«Acercar al recorrido» muestra solo el camino; «Todo el colegio» muestra el predio entero.'],
};
const norm = t => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const CLAVES = Object.keys(A).sort((a, b) => b.length - a.length);
const buscar = t => { const n = norm(t); return CLAVES.find(k => n.startsWith(k)); };

let globo;
function mostrar(boton, clave) {
  globo ||= document.body.appendChild(Object.assign(document.createElement('div'), { className: 'globo' }));
  const [que, ej] = A[clave];
  globo.innerHTML = `<p>${que}</p><p class="ej"><b>Ejemplo:</b> ${ej}</p>`;
  globo.style.display = 'block';
  const r = boton.getBoundingClientRect(), w = 280;
  globo.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left - w / 2)) + 'px';
  globo.style.top = (r.bottom + 8 + globo.offsetHeight > window.innerHeight ? r.top - globo.offsetHeight - 8 : r.bottom + 8) + 'px';
}
function decorar() {
  for (const el of document.querySelectorAll('.panel label, .panel .resumen td:first-child, .panel h2, .panel summary, dialog label')) {
    if (el.dataset.q) continue; el.dataset.q = '1';
    const nodo = [...el.childNodes].find(n => (n.nodeType === 3 && n.textContent.trim()) || (n.nodeType === 1 && ['B', 'SPAN'].includes(n.tagName) && !n.classList.contains('chip')));
    const clave = buscar(nodo ? nodo.textContent : el.textContent); if (!clave) continue;
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'q', textContent: '?', title: 'Qué es esto' });
    b.dataset.clave = clave; b.setAttribute('aria-label', 'Ayuda');
    if (nodo && nodo.nextSibling) el.insertBefore(b, nodo.nextSibling); else el.appendChild(b);
  }
}
export function iniciarAyuda() {
  let t; new MutationObserver(() => { clearTimeout(t); t = setTimeout(decorar, 80); }).observe(document.body, { childList: true, subtree: true });
  decorar();
  document.addEventListener('click', e => {
    const b = e.target.closest('button.q');
    if (b) { e.preventDefault(); e.stopPropagation(); mostrar(b, b.dataset.clave); } else if (globo && !e.target.closest('.globo')) globo.style.display = 'none';
  }, true);
  window.addEventListener('keydown', e => { if (e.key === 'Escape' && globo) globo.style.display = 'none'; });
}
