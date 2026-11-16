# Muestras HCA

Aplicación web para organizar muestras y eventos en el colegio: se elige el nivel y los
espacios, se ubican mesas, sillas, bancos y stands sobre el plano, y se genera un PDF con
las ubicaciones.

## Qué hace

- **Niveles y espacios**: subsuelo, planta baja, primer y segundo piso, tomados del plano
  `PLANO_MDCI.dwg`. Los salones se detectan del plano; también se puede dibujar un espacio
  propio punto a punto y cambiarle el nombre a cualquiera.
- **Planta**: agregar elementos, moverlos, girarlos, duplicarlos, repetirlos en grilla
  (filas de sillas o stands), numerarlos y escribirles un nombre. Herramienta para medir.
- **Elementos propios**: cada usuario puede crear sus mesas, bancos y demás con sus medidas,
  forma y color.
- **Isométrica**: vista 3D con los muros levantados a la altura indicada (3 m por defecto),
  completos, bajos u ocultos. Se puede girar y descargar como imagen.
- **PDF**: una página por nivel con la planta a escala, la vista isométrica y el listado de
  elementos y nombres.
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
pip install opencv-python-headless numpy
python3 convertir_plano.py ents.ndjson blocks.json ../data
```

`convertir_plano.py` tiene al principio los recortes de cada nivel dentro de la lámina y los
nombres de las capas de muros y aberturas; si cambia el plano hay que ajustarlos ahí.
