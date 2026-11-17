# Muestras HCA

Aplicación web para organizar muestras y eventos en el colegio: se elige el nivel y los
espacios, se ubican mesas, sillas, bancos y stands sobre el plano, y se genera un PDF con
las ubicaciones.

## Qué hace

- **Guía por etapas**: el armado va paso a paso (Datos → Lugares → Equipos → Muebles → Recorrido →
  Sol → Folleto y PDF). Cada paso muestra solo lo que hace falta, dice qué falta y acerca la
  vista a los lugares elegidos.
- **Pasillos y zonas libres**: se dibujan arrastrando sobre el plano; el armado automático y la
  distribución de equipos los respetan y llenan el resto. «Llenar todo el lugar» busca la mayor
  cantidad de sillas probando distintos corrimientos de las filas.
- **Obstáculos**: la fuente no se puede elegir ni ocupar, y la gente la rodea al caminar.
- **Distribución probada con simulación**: antes de ubicar los equipos se arman hasta 12
  distribuciones distintas, se simula la visita con cada una y queda la que menos aglomera;
  después se prueba cambiar de sitio los puestos donde se junta gente.
- **Armar el salón solo**: distribuye sillas y mesas automáticamente en un lugar para una cantidad
  de personas: auditorio (filas con pasillo), anfiteatro (filas curvas), aula, mesas en U, mesas
  redondas o ronda; con el frente hacia el lado que se elija y escenario opcional.
- **Ayudas «?»**: al lado de cada dato hay un botón que explica qué es, con un ejemplo.
- **Equipos en texto plano**: se escribe un equipo por renglón (`nombre ; estudiantes ; lugar`)
  y el sistema ubica un puesto por equipo contra las paredes de los lugares elegidos, separados
  lo más posible y con el centro libre (en islas solo si no queda pared). Cada puesto reserva
  el lugar de sus estudiantes, que van pegados a las caras de la mesa (atrás, laterales y
  frente); los equipos grandes reciben varias mesas juntas. Los estudiantes ocupan lugar en
  la simulación.
- **Niveles y espacios**: subsuelo, planta baja, primer y segundo piso, tomados del plano
  `PLANO_MDCI.dwg`. Los salones se detectan del plano y los exteriores de planta baja (patio
  central, patio este, cancha, explanada) vienen trazados.
- **Edificios visibles**: cada muestra elige qué edificios se muestran. Los que todavía son
  proyecto vienen ocultos (hoy, el edificio nuevo del fondo; en su lugar aparece la cancha
  techada actual). Lo oculto desaparece de la planta, la isométrica, la circulación, el sol,
  el folleto y el PDF. Se definen en `EDIFICIOS`, al principio de `tools/convertir_plano.py`.
- **Notas del plano**: la casilla «Notas» muestra sobre la planta las referencias escritas en el
  DWG (a construir, a demoler, a desmontar, existente, portones, pavimentos…). De ahí salen los
  estados de cada construcción: proyecto (oculta por defecto) o existente a demoler (visible).
- **Dibujo de espacios**: se dibujan espacios propios con Rectángulo o Polígono (se pegan a
  las esquinas de los muros) y con Editar forma se corrige cualquiera, incluso los del plano:
  mover esquinas, agregar o quitar, desplazarlo entero, renombrarlo o quitarlo. Siempre se
  puede volver a los espacios originales.
- **Planta**: agregar elementos, moverlos, girarlos, duplicarlos, repetirlos en grilla
  (filas de sillas o stands), numerarlos y escribirles un nombre. Herramienta para medir.
- **Elementos propios**: cada usuario puede crear sus mesas, bancos y demás con sus medidas,
  forma y color.
- **Isométrica**: vista 3D con los muros levantados a la altura indicada (3 m por defecto),
  completos, bajos u ocultos. Se puede girar y descargar como imagen.
- **Circulación**: simulación de gente. Se marcan una Entrada y una Salida, los visitantes
  recorren las paradas (stands y mesas con nombre) y se ve en vivo por dónde pasan, dónde se
  aglomeran y cuánto tardan. Compara el recorrido libre con uno guiado de sentido único y
  dibuja el orden sugerido. También se pueden poner personas a mano.
- **Visita de los padres**: padres esperados por turno y cantidad de turnos; tiempo por stand;
  dinámicas a elegir (libre, guiada, primero el stand del hijo, por tandas con lugar de espera)
  y comparación automática entre todas. «Resultado al instante» calcula la simulación sin
  animarla. Informa cuánto tarda una persona promedio (en los stands, caminando, esperando) y
  cuánto tardaría sola, y permite seguir a una persona entre todas con su recorrido dibujado.
- **Entrada, salida y horario**: en la muestra se cargan la hora de inicio y de fin y se marcan
  la entrada y la salida con un clic en el plano. La simulación reparte la llegada de los
  visitantes en ese horario, admite un tope de tiempo de visita por persona, e informa el
  tiempo de recorrido, el máximo de personas a la vez y si el horario alcanza.
- **Sol y sombras**: para una fecha y una hora muestra en la planta las sombras de los
  edificios (según la cantidad de pisos) y de los elementos altos, cuánto sol recibe cada
  espacio al aire libre hora por hora, y lo mismo en la vista isométrica. Usa la ubicación de
  Montevideo y el norte del plano (se puede corregir). No considera árboles ni vecinos.
- **Folleto**: genera un mapa ilustrado «Cómo llegar» con el caminito desde el punto de partida
  (por defecto el portón del colegio) hasta la muestra, rodeando árboles y pasando por las
  puertas. Sale en SVG vectorial, con capas con nombre y textos editables, y en PNG. Tiene
  cuatro estilos de color, tres formatos y encuadre al recorrido o a todo el colegio.
- **PDF**: una página por nivel con la planta a escala, la vista isométrica, los mapas de
  circulación y de sol y sombras, y el listado de elementos y nombres.
- Las muestras se guardan solas en el navegador y se pueden exportar/importar como archivo.

## Cómo usarla

Es un sitio estático, sin instalación ni compilación. Hay que servirlo por HTTP (no abre
como archivo local porque carga los planos con `fetch`):

```bash
python3 -m http.server 8000   # y abrir http://localhost:8000
```

También funciona tal cual en GitHub Pages.

## Estructura

| Carpeta | Contenido |
| --- | --- |
| `index.html`, `css/`, `js/` | La aplicación (JavaScript sin dependencias de compilación) |
| `data/` | Planos por nivel ya convertidos (muros, aberturas, detalle y salones) |
| `vendor/` | three.js (vista isométrica) y jsPDF (exportación) |
| `tools/` | Scripts para regenerar `data/` a partir del DWG |

## Regenerar los planos desde el DWG

```bash
cd tools
npm install @mlightcad/libredwg-web
node --max-old-space-size=6000 extraer_dwg.mjs PLANO.dwg ents.ndjson blocks.json meta.json
pip install opencv-python-headless numpy scipy scikit-image
python3 convertir_plano.py ents.ndjson blocks.json ../data
```

`convertir_plano.py` tiene al principio los recortes de cada nivel dentro de la lámina y los
nombres de las capas de muros y aberturas; si cambia el plano hay que ajustarlos ahí.

## Cómo se definen los espacios

`convertir_plano.py` parte cada planta completa en ambientes:

1. Arma una imagen de barreras con los muros, las ventanas y frentes vidriados, y el cierre
   de las puertas (se detectan por el arco de la hoja).
2. Segmenta el espacio libre por transformada de distancia (watershed, con scikit-image):
   cada ambiente es una cuenca y los pasos angostos son las divisorias. Así salen también los
   halls, antesalas y pasillos que no tienen puerta.
3. Nombra cada ambiente con el rótulo del plano que cae adentro; los que no tienen rótulo se
   llaman Hall, Pasillo o Ambiente según su forma.
4. Aplica un curado hecho a mano revisando el resultado contra el plano (diccionario `CURADO`
   al principio del script): nombres de halls y pasillos, patios y exteriores trazados,
   vacíos de doble altura descartados.

Lo que quede mal se corrige en la app con «Editar forma», o agregando una línea a `CURADO`.

## Cómo funciona la simulación

Grilla de 20 cm con los muros, ventanas y muebles como obstáculos; campos de distancia
(Dijkstra) hacia cada parada y hacia la salida; separación entre personas y velocidad que
baja con la densidad. Es una aproximación para comparar distribuciones, no un estudio de
evacuación.
