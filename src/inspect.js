/**
 * Standalone model inspector. Renders just the vehicle on a turntable so the
 * geometry can be checked against the spec without the game running.
 */

import * as THREE from 'three';
import { buildVehicle, measure } from './model/vehicle-model.js';
import { materials, buildEnvironment, applyEnvironment } from './model/materials.js';
import { XM30, DERIVED } from './spec/xm30.js';

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();

const { envMap, background } = buildEnvironment(renderer);
scene.environment = envMap;
scene.background = background;
applyEnvironment(envMap);

const M = materials();

// Ground pad.
const pad = new THREE.Mesh(new THREE.CircleGeometry(24, 64), M.ground.clone());
pad.material.map = M.tile(M.textures.dirt, [8, 8]);
pad.rotation.x = -Math.PI / 2;
pad.receiveShadow = true;
scene.add(pad);

// Lighting: key sun + sky fill + a cool rim so the far side isn't dead.
const sun = new THREE.DirectionalLight(0xfff2d8, 3.1);
sun.position.set(9, 13, 7);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 60;
const sc = sun.shadow.camera;
sc.left = -10; sc.right = 10; sc.top = 10; sc.bottom = -10;
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.02;
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xa8c4de, 0x4a4535, 1.1));
const rim = new THREE.DirectionalLight(0x9fc0ff, 0.5);
rim.position.set(-8, 5, -9);
scene.add(rim);

const vehicle = buildVehicle();
scene.add(vehicle.root);

const { size } = measure(vehicle);
let tris = 0;
vehicle.root.traverse((o) => {
  if (o.isMesh) {
    const g = o.geometry;
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
  }
});
document.getElementById('m-len').textContent = size.z.toFixed(2) + ' m';
document.getElementById('m-wid').textContent = size.x.toFixed(2) + ' m';
document.getElementById('m-hgt').textContent = size.y.toFixed(2) + ' m';
document.getElementById('m-tri').textContent = Math.round(tris).toLocaleString();

/* ------------------------------ orbit camera ------------------------------ */
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 400);
const target = new THREE.Vector3(0, 1.5, 0);
const orbit = { theta: Math.PI * 0.72, phi: 1.16, radius: 15 };

function applyCamera() {
  const { theta, phi, radius } = orbit;
  camera.position.set(
    target.x + radius * Math.sin(phi) * Math.sin(theta),
    target.y + radius * Math.cos(phi),
    target.z + radius * Math.sin(phi) * Math.cos(theta),
  );
  camera.lookAt(target);
}

let dragging = false, lastX = 0, lastY = 0;
canvas.addEventListener('pointerdown', (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointerup', (e) => { dragging = false; canvas.releasePointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  orbit.theta -= (e.clientX - lastX) * 0.006;
  orbit.phi = Math.min(Math.PI * 0.495, Math.max(0.08, orbit.phi - (e.clientY - lastY) * 0.005));
  lastX = e.clientX; lastY = e.clientY;
  applyCamera();
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  orbit.radius = Math.min(60, Math.max(4, orbit.radius * (1 + Math.sign(e.deltaY) * 0.11)));
  applyCamera();
}, { passive: false });

const VIEWS = {
  iso:    { theta: Math.PI * 0.72, phi: 1.16, radius: 15,  target: [0, 1.5, 0] },
  side:   { theta: Math.PI * 0.5,  phi: Math.PI / 2 - 0.02, radius: 16, target: [0, 1.6, 0] },
  front:  { theta: 0,              phi: Math.PI / 2 - 0.06, radius: 14, target: [0, 1.6, 0] },
  rear:   { theta: Math.PI,        phi: Math.PI / 2 - 0.06, radius: 14, target: [0, 1.6, 0] },
  top:    { theta: 0.001,          phi: 0.09, radius: 17,  target: [0, 1.2, 0] },
  detail: { theta: Math.PI * 0.78, phi: 1.25, radius: 6.4, target: [0, 2.85, -0.2] },
};
function setView(name) {
  const v = VIEWS[name] || VIEWS.iso;
  orbit.theta = v.theta; orbit.phi = v.phi; orbit.radius = v.radius;
  target.set(...v.target);
  applyCamera();
}
document.querySelectorAll('#views button').forEach((b) =>
  b.addEventListener('click', () => setView(b.dataset.v)));

/* ------------------------------ articulation ------------------------------ */
const bind = (id, label, fn, fmt = (v) => v + '°') => {
  const el = document.getElementById(id), out = document.getElementById(label);
  const apply = () => { const v = +el.value; fn(v * Math.PI / 180); out.textContent = fmt(v); };
  el.addEventListener('input', apply);
  apply();
};
bind('s-az', 'v-az', (r) => { vehicle.azimuth = r; });
bind('s-el', 'v-el', (r) => { vehicle.elevation = r; });
bind('s-cdr', 'v-cdr', (r) => { vehicle.commanderAzimuth = r; });

/* --------------------------------- loop ---------------------------------- */
function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== w * renderer.getPixelRatio() || canvas.height !== h * renderer.getPixelRatio()) {
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
}

let last = performance.now();
function frame(now) {
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
  last = now;
  resize();
  vehicle.update(dt, dt * 4, 0);   // idle roll so the tracks are visibly moving
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
applyCamera();
resize();
requestAnimationFrame(frame);

// Exposed for the screenshot harness.
window.__inspector = { setView, vehicle, scene, camera, renderer, size, XM30, DERIVED };
window.__ready = true;
