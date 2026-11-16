// Vista isométrica: levanta los muros a la altura indicada y muestra los elementos en 3D.
import * as THREE from 'three';
import { OrbitControls } from '../vendor/OrbitControls.js';
import { espaciosElegidos, areaTrabajo, esRedondo } from './niveles.js';

let cont, renderer, escena, camara, controles, grupo;
let giro = 0, area = null, altura = 3, visible = false;
const ELEV = Math.atan(1 / Math.SQRT2);       // 35,26°: isométrica verdadera

export function iniciarIso(contenedor) {
  cont = contenedor;
  renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setClearColor(0xfbfbfc);
  cont.appendChild(renderer.domElement);
  escena = new THREE.Scene();
  escena.add(new THREE.HemisphereLight(0xffffff, 0xb9b4aa, 2.1));
  const sol = new THREE.DirectionalLight(0xffffff, 1.6); sol.position.set(-3, 8, 5); escena.add(sol);
  camara = new THREE.OrthographicCamera(-10, 10, 10, -10, -2000, 4000);
  controles = new OrbitControls(camara, renderer.domElement);
  controles.maxPolarAngle = Math.PI / 2 - 0.05; controles.zoomToCursor = true;
  controles.addEventListener('change', pintar);
  new ResizeObserver(() => { if (visible) { ajustarTam(); encuadrar(false); } }).observe(cont);
}
function pintar() { renderer.render(escena, camara); }

function ajustarTam() {
  const r = cont.getBoundingClientRect(); if (!r.width) return;
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(r.width, r.height);
}

function limpiar(o) {
  o.traverse(m => { m.geometry?.dispose(); if (m.material) { m.material.map?.dispose(); m.material.dispose(); } });
  escena.remove(o);
}

const mat = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });
function caja(w, h, d, x, y, z, material) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material); m.position.set(x, y, z); return m;
}
function aclarar(hex, f) { const c = new THREE.Color(hex); return c.lerp(new THREE.Color(0xffffff), f); }

function mallaItem(it) {
  const g = new THREE.Group(), w = it.w, d = it.d, h = Math.max(it.h, 0.02);
  const m = mat(it.color), pata = mat(aclarar(it.color, -0.0).multiplyScalar(0.55));
  const patas = (alto, r = 0.04) => {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(caja(r, alto, r, sx * (w / 2 - r), alto / 2, sz * (d / 2 - r), pata));
  };
  switch (it.modelo) {
    case 'mesa': g.add(caja(w, 0.04, d, 0, h - 0.02, 0, m)); patas(h - 0.04, 0.05); break;
    case 'banco': g.add(caja(w, 0.05, d, 0, h - 0.025, 0, m));
      for (const sx of [-1, 1]) g.add(caja(0.05, h - 0.05, d * 0.9, sx * (w / 2 - 0.12), (h - 0.05) / 2, 0, pata)); break;
    case 'silla': g.add(caja(w, 0.04, d, 0, h - 0.02, 0, m)); patas(h - 0.04, 0.03);
      g.add(caja(w, h * 0.85, 0.03, 0, h + h * 0.425, -d / 2 + 0.015, m)); break;
    case 'mesa-redonda': {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(w / 2, w / 2, 0.04, 40), m); t.scale.z = d / w; t.position.y = h - 0.02; g.add(t);
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.2, h - 0.04, 16), pata); p.position.y = (h - 0.04) / 2; g.add(p); break;
    }
    case 'cilindro': { const t = new THREE.Mesh(new THREE.CylinderGeometry(w / 2, w / 2, h, 40), m); t.scale.z = d / w; t.position.y = h / 2; g.add(t); break; }
    case 'stand': {
      const claro = mat(aclarar(it.color, 0.82)), l = d * 0.6;
      g.add(caja(w, 0.02, d, 0, 0.01, 0, mat(aclarar(it.color, 0.6))));
      g.add(caja(w, h, 0.05, 0, h / 2, -d / 2 + 0.025, claro));
      for (const sx of [-1, 1]) g.add(caja(0.05, h, l, sx * (w / 2 - 0.025), h / 2, -d / 2 + l / 2, claro));
      g.add(caja(w, 0.3, 0.07, 0, h - 0.15, -d / 2 + 0.035, m)); break;
    }
    case 'persona': {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.32, w * 0.4, h * 0.82, 16), m); c.position.y = h * 0.41; g.add(c);
      const k = new THREE.Mesh(new THREE.SphereGeometry(w * 0.26, 16, 12), mat(0xf1c9a5)); k.position.y = h * 0.92; g.add(k); break;
    }
    case 'zona': g.add(caja(w, 0.02, d, 0, 0.012, 0, mat(it.color, { transparent: true, opacity: 0.35 }))); break;
    case 'texto': break;
    default: g.add(caja(w, h, d, 0, h / 2, 0, m));
  }
  g.position.set(it.x, 0, it.y); g.rotation.y = -it.rot * Math.PI / 180;
  return g;
}

function cartel(texto, alto, color = '#1c2430') {
  const c = document.createElement('canvas'), x = c.getContext('2d'), F = 64;
  x.font = `600 ${F}px system-ui, sans-serif`;
  const w = Math.ceil(x.measureText(texto).width) + 36; c.width = w; c.height = F + 28;
  x.font = `600 ${F}px system-ui, sans-serif`; x.textBaseline = 'middle'; x.textAlign = 'center';
  x.fillStyle = 'rgba(255,255,255,.92)'; x.beginPath(); x.roundRect(0, 0, w, c.height, 16); x.fill();
  x.strokeStyle = 'rgba(28,36,48,.35)'; x.lineWidth = 3; x.stroke();
  x.fillStyle = color; x.fillText(texto, w / 2, c.height / 2 + 3);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  s.scale.set(alto * w / c.height, alto, 1); s.renderOrder = 10;
  return s;
}

export function actualizarIso(nivel, proy, op = {}) {
  if (grupo) limpiar(grupo);
  grupo = new THREE.Group(); escena.add(grupo);
  area = areaTrabajo(nivel, proy, 1.2); altura = proy.altura || 3;
  const { x0, y0, x1, y1 } = area, aw = x1 - x0, ah = y1 - y0;
  const dentro = (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1;

  const piso = new THREE.Mesh(new THREE.PlaneGeometry(aw, ah), mat(0xf1efe9));
  piso.rotation.x = -Math.PI / 2; piso.position.set(x0 + aw / 2, -0.01, y0 + ah / 2); grupo.add(piso);

  for (const e of espaciosElegidos(nivel, proy)) {
    const s = new THREE.Shape(e.poly.map(p => new THREE.Vector2(p[0], -p[1])));
    const m = new THREE.Mesh(new THREE.ShapeGeometry(s), mat(0xdfe8f6)); m.rotation.x = -Math.PI / 2; m.position.y = 0.002; grupo.add(m);
  }

  // muros: una caja fina por tramo, solo dentro del área de trabajo
  const hm = op.muros === 'ocultos' ? 0 : op.muros === 'bajos' ? 1 : altura;
  const S = nivel.muros, tramos = [], lineas = [];
  for (let i = 0; i < S.length; i += 4) {
    if (!dentro((S[i] + S[i + 2]) / 2, (S[i + 1] + S[i + 3]) / 2)) continue;
    tramos.push(i); lineas.push(S[i], 0.004, S[i + 1], S[i + 2], 0.004, S[i + 3]);
  }
  const gl = new THREE.BufferGeometry(); gl.setAttribute('position', new THREE.Float32BufferAttribute(lineas, 3));
  grupo.add(new THREE.LineSegments(gl, new THREE.LineBasicMaterial({ color: 0x5a6472 })));
  if (hm > 0 && tramos.length) {
    const alta = hm > 1.5;
    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1),
      mat(0xe6e2d8, alta ? { transparent: true, opacity: 0.42, depthWrite: false } : {}), tramos.length);
    const o = new THREE.Object3D();
    tramos.forEach((i, n) => {
      const dx = S[i + 2] - S[i], dz = S[i + 3] - S[i + 1], l = Math.hypot(dx, dz);
      o.position.set((S[i] + S[i + 2]) / 2, hm / 2, (S[i + 1] + S[i + 3]) / 2);
      o.rotation.set(0, -Math.atan2(dz, dx), 0); o.scale.set(l + 0.06, hm, 0.07); o.updateMatrix(); inst.setMatrixAt(n, o.matrix);
    });
    grupo.add(inst);
  }

  const items = proy.items.filter(i => i.nivel === nivel.id);
  const altoCartel = Math.max(0.28, Math.min(1.4, Math.hypot(aw, ah) / 55));
  for (const it of items) {
    grupo.add(mallaItem(it));
    if (op.etiquetas !== false && it.etiqueta) {
      const s = cartel(it.etiqueta, altoCartel, it.modelo === 'texto' ? it.color : '#1c2430');
      const tope = it.modelo === 'silla' ? it.h * 1.85 : it.h;
      s.position.set(it.x, tope + altoCartel * 0.75, it.y); grupo.add(s);
    }
  }
  if (visible) pintar();
}

/** Ajusta la cámara ortográfica para que entre toda el área de trabajo. */
export function encuadrar(reorientar = true, aspecto) {
  if (!area) return;
  const r = cont.getBoundingClientRect(); aspecto ??= r.width / Math.max(1, r.height);
  const cx = (area.x0 + area.x1) / 2, cz = (area.y0 + area.y1) / 2, objetivo = new THREE.Vector3(cx, altura / 3, cz);
  if (reorientar) {
    const az = Math.PI / 4 + giro * Math.PI / 2, D = 600;
    camara.position.set(cx + D * Math.cos(ELEV) * Math.sin(az), objetivo.y + D * Math.sin(ELEV), cz + D * Math.cos(ELEV) * Math.cos(az));
    controles.target.copy(objetivo); camara.zoom = 1;
  }
  camara.lookAt(controles.target); camara.updateMatrixWorld();
  if (reorientar) {
    let mx = 0, my = 0; const v = new THREE.Vector3();
    for (const x of [area.x0, area.x1]) for (const z of [area.y0, area.y1]) for (const y of [0, altura + 0.6]) {
      v.set(x, y, z).applyMatrix4(camara.matrixWorldInverse); mx = Math.max(mx, Math.abs(v.x)); my = Math.max(my, Math.abs(v.y));
    }
    const medio = Math.max(my, mx / aspecto) * 1.06;
    camara.userData.medio = medio;
  }
  const medio = camara.userData.medio || 20;
  camara.left = -medio * aspecto; camara.right = medio * aspecto; camara.top = medio; camara.bottom = -medio;
  camara.updateProjectionMatrix(); controles.update(); pintar();
}

export function girar(dir) { giro = (giro + dir + 4) % 4; encuadrar(true); }
export function mostrarIso(si) { visible = si; if (si) { ajustarTam(); encuadrar(true); } }

/** Devuelve una imagen PNG (data URL) de la vista isométrica, al tamaño pedido. */
export function capturar(w = 2000, h = 1250) {
  const pr = renderer.getPixelRatio(), tam = renderer.getSize(new THREE.Vector2());
  const previo = { pos: camara.position.clone(), obj: controles.target.clone(), zoom: camara.zoom, medio: camara.userData.medio };
  renderer.setPixelRatio(1); renderer.setSize(w, h, false);
  encuadrar(true, w / h);
  const url = renderer.domElement.toDataURL('image/png');
  renderer.setPixelRatio(pr); renderer.setSize(tam.x || 300, tam.y || 150, false);
  if (visible) {
    camara.position.copy(previo.pos); controles.target.copy(previo.obj); camara.zoom = previo.zoom; camara.userData.medio = previo.medio;
    ajustarTam(); encuadrar(false);
  }
  return url;
}
/** Imagen de la vista tal como está en pantalla. */
export function capturarVista() { pintar(); return renderer.domElement.toDataURL('image/png'); }
