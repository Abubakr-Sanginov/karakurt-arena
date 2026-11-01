import * as THREE from 'three';
import { createHuman, createSpider } from './models.js';
import { HOME_PARTITIONS, HOME_ROOM_DEFS, HOME_ROOMS, CODE_NOTES, HOSPITAL_WALLS, SAFE_POS } from './sequelData.js';

// Table tops the code notes rest on, so each paper sits on its piece of furniture.
const NOTE_HEIGHT = [0.53, 0.97, 0.73, 0.91, 0.95];

/** Resources are cloned at the boundary: chapter disposal never invalidates the shared player rig. */
export function createSequelScene() {
  const root = new THREE.Group(); root.name = 'sequel-scenes';
  const resources = new Set(), own = value => { resources.add(value); return value; };
  const geometry = own(new THREE.BoxGeometry(1, 1, 1));
  const cylinderGeometry = own(new THREE.CylinderGeometry(1, 1, 1, 18));
  const sphereGeometry = own(new THREE.SphereGeometry(1, 14, 10));
  const kit = new Set([geometry, cylinderGeometry, sphereGeometry]);
  const mat = (color, extra = {}) => own(new THREE.MeshStandardMaterial({ color, roughness: 0.82, ...extra }));
  const glow = (color, intensity = 0.8) => mat(color, { emissive: color, emissiveIntensity: intensity, roughness: 0.4 });
  const p = {
    // Hospital
    hwall: mat(0xa9bfb6), hdado: mat(0x3b6a69), hfloorA: mat(0x879e98), hfloorB: mat(0x96ada6), hfloorDark: mat(0x4d625f),
    hcurtain: mat(0x7fa6b5, { side: THREE.DoubleSide }), hgreen: glow(0x6ccf9a, 0.9), hred: glow(0xd24f4f, 0.9),
    // Shared
    steel: mat(0x59727a, { metalness: 0.55, roughness: 0.45 }), dark: mat(0x141f26), white: mat(0xdadbcf),
    linen: mat(0xc9ccbc), glass: mat(0x9fd3dc, { transparent: true, opacity: 0.22, roughness: 0.1, depthWrite: false }),
    frameDark: mat(0x1d262b, { metalness: 0.4 }), rubber: mat(0x23282b),
    lamp: glow(0xbfe4e6, 0.7), warm: glow(0xffc27a, 0.85), blue: glow(0x6aa0e8, 0.7), ember: glow(0xff7a2e, 1.1),
    // Home
    plaster: mat(0x8c8174), plasterDark: mat(0x5d5448), wood: mat(0x6e4a32), woodDark: mat(0x3f2c22), woodLight: mat(0x9a7a55),
    carpet: mat(0x4d526b), rug: mat(0x7d3f3b), tile: mat(0xa4b0b0), tileDark: mat(0x5f6e72), stone: mat(0x6c6a66),
    cloth: mat(0x4a5f72), leather: mat(0x5a3b2c), bedding: mat(0xd7d4c7), red: mat(0x823f39), gold: mat(0xb39d63, { metalness: 0.5 }),
    paper: mat(0xf0e2b0, { emissive: 0xb89a4a, emissiveIntensity: 0.28 }), plant: mat(0x3f6b3f), bath: mat(0xdfe5e4),
    book: [mat(0x7a3c3c), mat(0x3d5a7a), mat(0x56753f), mat(0xa78a42)],
    tv: glow(0x6aa0e8, 0.7), monitor: glow(0x6aa0e8, 0.7), moon: glow(0xc9d8f0, 0.9), pool: glow(0x4a6fa8, 0.22), sky: mat(0x0b1426),
  };
  function box(parent, size, position, surface = p.steel, name = '') {
    const mesh = new THREE.Mesh(geometry, surface); mesh.scale.set(...size); mesh.position.set(...position); mesh.name = name;
    mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }
  function cyl(parent, radius, height, position, surface = p.steel, rotation = null, name = '') {
    const mesh = new THREE.Mesh(cylinderGeometry, surface); mesh.scale.set(radius, height, radius); mesh.position.set(...position);
    if (rotation) mesh.rotation.set(...rotation); mesh.name = name; mesh.castShadow = true; mesh.receiveShadow = true;
    parent.add(mesh); return mesh;
  }
  function ball(parent, size, position, surface) {
    const mesh = new THREE.Mesh(sphereGeometry, surface); mesh.scale.set(...size); mesh.position.set(...position);
    mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }
  function group(parent, name, x = 0, z = 0, rotation = 0) {
    const g = new THREE.Group(); g.name = name; g.position.set(x, 0, z); g.rotation.y = rotation; parent.add(g); return g;
  }
  /** Convert unnamed kit meshes to instances; named, animated or door parts keep their own transforms. */
  function batch(node) {
    node.updateMatrixWorld(true);
    const inverse = node.matrixWorld.clone().invert(), groups = new Map(), matrix = new THREE.Matrix4();
    node.traverse(mesh => {
      if (!mesh.isMesh || mesh.name || mesh.isInstancedMesh || !kit.has(mesh.geometry)) return;
      for (let up = mesh.parent; up && up !== node; up = up.parent) if (up.userData.keep) return;
      const key = `${mesh.geometry.uuid}:${mesh.material.uuid}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(mesh);
    });
    for (const objects of groups.values()) {
      if (objects.length < 2) continue;
      const mesh = own(new THREE.InstancedMesh(objects[0].geometry, objects[0].material, objects.length));
      mesh.castShadow = true; mesh.receiveShadow = true; mesh.name = 'batched-sequel-architecture';
      objects.forEach((object, i) => { mesh.setMatrixAt(i, matrix.multiplyMatrices(inverse, object.matrixWorld)); object.removeFromParent(); });
      mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere(); node.add(mesh);
    }
  }
  function model(parent, kind, name, options) {
    const model = kind === 'spider' ? createSpider('boss') : createHuman(options); model.name = name;
    const geometries = new Map(), materials = new Map();
    model.traverse(node => {
      if (node.geometry) { if (!geometries.has(node.geometry)) geometries.set(node.geometry, own(node.geometry.clone())); node.geometry = geometries.get(node.geometry); }
      if (node.material) { if (!materials.has(node.material)) materials.set(node.material, own(node.material.clone())); node.material = materials.get(node.material); }
      if (node.isInstancedMesh) own(node);
    }); parent.add(model); return model;
  }
  function human(parent, name, x, z, variant = 'civilian', tint = 0) {
    const h = model(parent, 'human', name, { variant, tint }); h.position.set(x, 0, z);
    h.getObjectByName('visible-carbine').visible = false; return h;
  }
  function lighting(parent, night = false) {
    parent.add(new THREE.HemisphereLight(night ? 0x5a7bb0 : 0xb5d7dd, 0x2a2328, night ? 0.95 : 1.4));
    const light = new THREE.DirectionalLight(night ? 0x819ed5 : 0xffd4a1, night ? 1.1 : 2.6); light.position.set(5, 12, 8); parent.add(light);
  }
  function pointLight(parent, color, intensity, x, y, z, distance = 11) {
    const light = new THREE.PointLight(color, intensity, distance, 1.8); light.position.set(x, y, z); parent.add(light); return light;
  }

  // ---------- Furniture and fixtures shared between chapters ----------
  function bed(parent, x, z, rotation = 0, sheet = p.bedding, frame = p.steel) {
    const n = group(parent, 'bed', x, z, rotation);
    box(n, [1.5, 0.22, 2.6], [0, 0.45, 0], frame);
    box(n, [1.4, 0.26, 2.45], [0, 0.69, 0], p.white);
    box(n, [1.4, 0.1, 1.6], [0, 0.86, 0.35], sheet);
    box(n, [0.8, 0.14, 0.42], [0, 0.88, -0.95], p.linen);
    box(n, [1.5, 0.7, 0.1], [0, 0.85, -1.3], frame);
    box(n, [1.5, 0.4, 0.08], [0, 0.65, 1.3], frame);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(n, [0.06, 0.4, 0.06], [sx * 0.7, 0.2, sz * 1.2], frame);
    return n;
  }
  function plant(parent, x, z, scale = 1) {
    cyl(parent, 0.3 * scale, 0.45 * scale, [x, 0.22 * scale, z], p.stone);
    for (let i = 0; i < 5; i++) {
      const a = i * 1.26;
      ball(parent, [0.22 * scale, 0.5 * scale, 0.1 * scale], [x + Math.cos(a) * 0.18 * scale, 0.85 * scale, z + Math.sin(a) * 0.18 * scale], p.plant)
        .rotation.set(Math.sin(a) * 0.5, a, Math.cos(a) * 0.5);
    }
  }
  function monitor(parent, x, y, z, rotation = 0) {
    const n = group(parent, 'screen', x, z, rotation); n.position.y = y;
    box(n, [0.5, 0.32, 0.03], [0, 0.22, 0], p.frameDark); box(n, [0.46, 0.28, 0.02], [0, 0.22, 0.02], p.monitor);
    box(n, [0.06, 0.1, 0.06], [0, 0.05, 0]); box(n, [0.22, 0.02, 0.14], [0, 0, 0]);
  }
  function chair(parent, x, z, rotation = 0, seat = p.cloth) {
    const n = group(parent, 'chair', x, z, rotation);
    box(n, [0.5, 0.08, 0.5], [0, 0.46, 0], seat); box(n, [0.5, 0.5, 0.06], [0, 0.75, -0.24], seat);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(n, [0.05, 0.44, 0.05], [sx * 0.21, 0.22, sz * 0.21], p.steel);
  }
  function bench(parent, x, z, rotation = 0, length = 2.6) {
    const n = group(parent, 'waiting-bench', x, z, rotation);
    for (let i = 0; i < Math.round(length / 0.65); i++) {
      const cx = (i - (Math.round(length / 0.65) - 1) / 2) * 0.65;
      box(n, [0.6, 0.08, 0.55], [cx, 0.46, 0], p.hdado); box(n, [0.6, 0.45, 0.07], [cx, 0.76, -0.27], p.hdado);
    }
    box(n, [length, 0.05, 0.06], [0, 0.3, 0.2], p.steel);
    for (const s of [-1, 1]) box(n, [0.06, 0.45, 0.5], [s * (length / 2 - 0.05), 0.22, 0], p.steel);
  }
  function ivStand(parent, x, z) {
    cyl(parent, 0.02, 1.9, [x, 0.95, z]); cyl(parent, 0.22, 0.04, [x, 0.03, z], p.frameDark);
    box(parent, [0.5, 0.03, 0.03], [x, 1.9, z]); box(parent, [0.09, 0.24, 0.05], [x - 0.18, 1.75, z], p.glass);
    box(parent, [0.09, 0.24, 0.05], [x + 0.18, 1.75, z], p.glass);
  }
  function gurney(parent, x, z, rotation = 0) {
    const n = group(parent, 'gurney', x, z, rotation);
    box(n, [0.8, 0.08, 2.0], [0, 0.82, 0], p.steel); box(n, [0.74, 0.12, 1.94], [0, 0.92, 0], p.white);
    box(n, [0.7, 0.04, 1.2], [0, 0.99, 0.3], p.hcurtain);
    for (const sx of [-1, 1]) { box(n, [0.04, 0.3, 1.9], [sx * 0.42, 1.0, 0]); for (const sz of [-1, 1]) cyl(n, 0.07, 0.05, [sx * 0.34, 0.07, sz * 0.8], p.rubber, [Math.PI / 2, 0, Math.PI / 2]); }
    box(n, [0.7, 0.06, 0.06], [0, 0.4, 0.8]); box(n, [0.7, 0.06, 0.06], [0, 0.4, -0.8]);
  }
  function wheelchair(parent, x, z, rotation = 0) {
    const n = group(parent, 'wheelchair', x, z, rotation);
    box(n, [0.55, 0.06, 0.5], [0, 0.5, 0], p.rubber); box(n, [0.55, 0.55, 0.06], [0, 0.82, -0.25], p.rubber);
    for (const s of [-1, 1]) { cyl(n, 0.33, 0.05, [s * 0.34, 0.33, -0.1], p.steel, [0, 0, Math.PI / 2]); cyl(n, 0.08, 0.04, [s * 0.28, 0.08, 0.28], p.rubber, [0, 0, Math.PI / 2]); box(n, [0.04, 0.04, 0.5], [s * 0.28, 0.68, 0]); }
  }
  function frame(parent, axis, x, z, width, height, depth, surface = p.frameDark) {
    // A door frame around an opening centred on (x, z); axis is the wall direction.
    const n = group(parent, 'door-frame', x, z, axis === 'z' ? Math.PI / 2 : 0);
    box(n, [width + 0.3, 0.2, depth], [0, height, 0], surface);
    for (const s of [-1, 1]) box(n, [0.15, height, depth], [s * (width / 2 + 0.075), height / 2, 0], surface);
    return n;
  }
  function sign(parent, x, y, z, width, color, rotation = 0) {
    const n = group(parent, 'sign', x, z, rotation); n.position.y = y;
    box(n, [width + 0.08, 0.3, 0.05], [0, 0, 0], p.frameDark); box(n, [width, 0.24, 0.02], [0, 0, 0.03], color).castShadow = false;
  }
  function cross(parent, x, y, z, size, color, rotation = 0) {
    const n = group(parent, 'cross', x, z, rotation); n.position.y = y;
    box(n, [size, size * 0.32, 0.04], [0, 0, 0], color); box(n, [size * 0.32, size, 0.04], [0, 0, 0], color);
    return n;
  }

  // ================= Hospital: triage hall + service corridor =================
  const hospital = group(root, 'sequel-hospital'); lighting(hospital);
  const wallHeight = 3.3;
  // Floors: checkerboard with guide stripes, corridor runner.
  box(hospital, [20.6, 0.25, 17.4], [0, -0.15, 2.3], p.hfloorDark);
  box(hospital, [4.4, 0.25, 14.2], [0, -0.15, -12.9], p.hfloorDark);
  for (let x = -9.5; x < 10; x += 1) for (let z = -5.5; z < 10.6; z += 1) box(hospital, [0.98, 0.02, 0.98], [x, 0.01, z], (Math.round(x) + Math.round(z)) % 2 ? p.hfloorA : p.hfloorB);
  for (let z = -6.5; z > -19.5; z -= 1) for (const x of [-1.5, -0.5, 0.5, 1.5]) box(hospital, [0.98, 0.02, 0.98], [x, 0.01, z], (Math.round(x * 2) + Math.round(z)) % 2 ? p.hfloorA : p.hfloorB);
  box(hospital, [0.3, 0.015, 17], [0, 0.025, 2], p.hgreen).castShadow = false;
  box(hospital, [0.25, 0.015, 13.5], [0, 0.025, -12.8], p.hgreen).castShadow = false;
  box(hospital, [20, 0.012, 0.2], [0, 0.034, 4.2], p.hred).castShadow = false;
  cross(hospital, 0, 0.03, 1.5, 2.2, p.hred, 0).rotation.x = -Math.PI / 2;
  // Walls from the collision data, with a teal dado and cap rail; lintel over the corridor door.
  for (const w of HOSPITAL_WALLS) {
    box(hospital, [w.width, wallHeight - (w.width < 1 ? 0.45 : 0), w.depth], [w.x, (wallHeight - (w.width < 1 ? 0.45 : 0)) / 2, w.z], p.hwall);
    if (w.width > 1) { box(hospital, [w.width, 1.05, w.depth + 0.1], [w.x, 0.525, w.z], p.hdado); box(hospital, [w.width, 0.08, w.depth + 0.18], [w.x, 1.1, w.z], p.steel); }
    else { box(hospital, [w.width + 0.1, 1.05, w.depth], [w.x, 0.525, w.z], p.hdado); box(hospital, [w.width + 0.18, 0.08, w.depth], [w.x, 1.1, w.z], p.steel); }
  }
  box(hospital, [3.6, 0.5, 0.3], [0, 3.0, -6], p.hwall);
  frame(hospital, 'x', 0, -6, 3.2, 2.75, 0.36);
  sign(hospital, 0, 3.25, -5.78, 2.0, p.hgreen);
  // Side walls: window band with night glow, pilasters and lamps.
  for (const side of [-1, 1]) {
    box(hospital, [0.3, wallHeight, 17.4], [side * 10.15, wallHeight / 2, 2.3], p.hwall);
    box(hospital, [0.4, 1.05, 17.4], [side * 10.1, 0.525, 2.3], p.hdado);
    box(hospital, [0.46, 0.08, 17.4], [side * 10.05, 1.1, 2.3], p.steel);
    for (let z = -4; z <= 10; z += 4.7) {
      box(hospital, [0.5, wallHeight, 0.45], [side * 9.95, wallHeight / 2, z], p.hwall);
      box(hospital, [0.6, 0.2, 0.55], [side * 9.95, wallHeight - 0.1, z], p.steel);
      box(hospital, [0.14, 0.14, 0.6], [side * 9.7, 2.5, z + 1.2], p.lamp).castShadow = false;
    }
    for (const z of [-1.5, 3.2, 7.9]) {
      box(hospital, [0.12, 1.1, 2.6], [side * 9.96, 2.35, z], p.glass); box(hospital, [0.2, 0.06, 2.8], [side * 9.92, 1.78, z]);
      box(hospital, [0.2, 0.06, 2.8], [side * 9.92, 2.92, z]); box(hospital, [0.2, 1.2, 0.06], [side * 9.92, 2.35, z]);
    }
    // Corridor walls: doorways with frames and small windows into dark rooms.
    box(hospital, [0.6, 0.12, 14.2], [side * 2.1, 2.55, -12.9], p.steel);
    box(hospital, [0.1, 1.05, 14.2], [side * 1.95, 0.525, -12.9], p.hdado);
    box(hospital, [0.08, 0.08, 14.2], [side * 1.93, 0.95, -12.9], p.steel);
    for (const z of [-9, -13, -17]) {
      frame(hospital, 'z', side * 2.05, z, 1.2, 2.2, 0.32);
      box(hospital, [0.06, 2.0, 1.1], [side * 2.14, 1.0, z], p.hdado);
      box(hospital, [0.06, 0.4, 0.5], [side * 1.99, 1.6, z], p.glass);
      sign(hospital, side * 1.88, 2.55, z, 0.5, side > 0 ? p.hred : p.hgreen, side * Math.PI / 2);
    }
  }
  // South: low wall with a glass entrance, canopy sign and sliding doors.
  box(hospital, [20.6, 1.2, 0.3], [0, 0.6, 10.7], p.hwall); box(hospital, [20.6, 0.08, 0.4], [0, 1.22, 10.7], p.steel);
  for (const sx of [-1, 1]) { box(hospital, [0.1, 1.6, 0.1], [sx * 2.1, 2.0, 10.7]); box(hospital, [1.9, 1.6, 0.04], [sx * 1.0, 2.0, 10.7], p.glass); }
  box(hospital, [4.4, 0.16, 0.3], [0, 2.9, 10.7], p.steel); sign(hospital, 0, 3.2, 10.5, 3.2, p.hred);
  // Reception: one straight counter on the west side (solid, see HOSPITAL_FURNITURE) so the corridor door stays clear.
  box(hospital, [4.4, 1.0, 0.7], [-5, 0.5, -3.6], p.hdado); box(hospital, [4.5, 0.08, 0.8], [-5, 1.04, -3.6], p.white);
  box(hospital, [4.4, 0.35, 0.25], [-5, 1.25, -3.85], p.hdado);
  monitor(hospital, -6.1, 1.08, -3.75, 0); monitor(hospital, -4.0, 1.08, -3.75, 0);
  box(hospital, [4.0, 0.6, 0.04], [-5, 1.5, -3.2], p.glass);
  chair(hospital, -6.1, -4.5, 0); chair(hospital, -4.0, -4.5, 0);
  for (let y = 1.2; y < 2.8; y += 0.55) for (let x = -7.4; x <= -2.9; x += 1.1) box(hospital, [1.0, 0.04, 0.3], [x, y, -5.7], p.steel);
  for (let x = -7.4; x <= -2.9; x += 0.55) for (let y = 1.2; y < 2.8; y += 0.55) box(hospital, [0.45, 0.3, 0.2], [x, y + 0.17, -5.7], p.book[(Math.round(x * 3) + Math.round(y * 5)) & 3]);
  // East of the door: notice board and a hand-sanitiser stand instead of more desks.
  box(hospital, [2.4, 1.2, 0.06], [5.2, 1.9, -5.8], p.hcurtain);
  for (const x of [-0.7, 0, 0.7]) box(hospital, [0.45, 0.35, 0.02], [5.2 + x, 1.95 + (x ? 0.15 : -0.1), -5.76], p.linen);
  cyl(hospital, 0.04, 1.1, [3.2, 0.55, -5.4], p.steel); box(hospital, [0.2, 0.3, 0.12], [3.2, 1.2, -5.4], p.white);
  // Waiting area, ward bays with curtains, gurneys and equipment.
  for (const z of [6.2, 8.4]) { bench(hospital, -4.2, z, Math.PI); bench(hospital, 4.2, z, Math.PI); }
  plant(hospital, -9.2, 9.7, 1.4); plant(hospital, 9.2, 9.7, 1.4); plant(hospital, -2.6, 9.6, 1.1); plant(hospital, 2.6, 9.6, 1.1);
  for (const side of [-1, 1]) {
    for (const z of [-2, 4, 9]) {
      const x = side * 7.3; bed(hospital, x, z, Math.PI / 2 * side, p.hcurtain);
      cyl(hospital, 0.025, 2.9, [x - 1.6, 1.45, z - 1.55], p.steel); cyl(hospital, 0.025, 2.9, [x + 1.6, 1.45, z - 1.55], p.steel);
      cyl(hospital, 0.025, 3.2, [x, 2.9, z - 1.55], p.steel, [0, 0, Math.PI / 2]);
      for (let f = 0; f < 5; f++) box(hospital, [0.62, 1.6, 0.04], [x - 1.2 + f * 0.6, 2.05, z - 1.55], p.hcurtain);
      box(hospital, [0.5, 0.65, 0.5], [x + side * 0.1, 0.33, z + 1.6], p.white); monitor(hospital, x + side * 0.1, 0.66, z + 1.6, side * Math.PI / 2);
      ivStand(hospital, x - side * 1.3, z + 1.2);
      box(hospital, [0.4, 0.12, 2.0], [side * 9.5, 1.9, z], p.steel); box(hospital, [0.12, 0.2, 0.7], [side * 9.6, 1.75, z], p.hgreen).castShadow = false;
    }
    if (side > 0) gurney(hospital, 4.8, -4.8, Math.PI / 2); wheelchair(hospital, side * 8.5, -4.7, side * 0.5);
  }
  box(hospital, [1.0, 2.0, 0.8], [-9.1, 1.0, 5.9], p.hred); box(hospital, [0.8, 1.2, 0.04], [-9.1, 1.25, 5.48], p.glass);
  cyl(hospital, 0.18, 0.5, [8.5, 0.25, 6.1], p.hdado); box(hospital, [0.5, 0.8, 0.5], [8.5, 0.9, 6.1], p.glass);
  // Columns with capitals, overhead ducts and hanging light panels.
  for (const x of [-5.2, 5.2]) for (const z of [-3, 4.6, 9.5]) {
    cyl(hospital, 0.38, wallHeight, [x, wallHeight / 2, z], p.hwall); cyl(hospital, 0.46, 0.25, [x, 0.12, z], p.hdado); cyl(hospital, 0.46, 0.2, [x, wallHeight - 0.1, z], p.hdado);
  }
  gurney(hospital, -1.0, -11.5, 0.15); wheelchair(hospital, 1.1, -15.3, -0.3);
  box(hospital, [0.5, 1.0, 0.5], [-1.4, 0.5, -15.9], p.hdado); box(hospital, [0.4, 0.7, 0.04], [-1.89, 1.7, -14.2], p.glass);
  box(hospital, [3.6, 0.2, 0.12], [0, 2.9, -19.8], p.lamp); frame(hospital, 'x', 0, -19.75, 2.8, 2.6, 0.34); sign(hospital, 0, 3.1, -19.55, 2.4, p.hgreen);
  box(hospital, [2.6, 2.4, 0.15], [0, 1.2, -19.9], p.frameDark);
  const door = group(hospital, 'barricade-door', -1.5, -6); door.userData.keep = true;
  box(door, [3, 2.9, 0.18], [1.5, 1.45, 0], p.steel);
  box(door, [2.6, 0.06, 0.2], [1.5, 1.0, 0], p.hred); box(door, [0.14, 0.34, 0.16], [2.6, 1.35, 0.16], p.gold);
  box(door, [1.0, 0.9, 0.04], [1.5, 1.85, 0.11], p.glass);
  const cracks = [];
  for (let i = 0; i < 7; i++) { const crack = box(door, [0.035, 0.65, 0.025], [0.4 + i * 0.36, 1.1 + (i % 3) * 0.25, 0.11], p.dark); crack.rotation.z = 0.35 * (i % 2 ? 1 : -1); cracks.push(crack); }
  batch(hospital);
  pointLight(hospital, 0xcfe8e4, 14, 0, 3.2, 3, 16); pointLight(hospital, 0xcfe8e4, 9, 0, 3.0, -13, 14);
  const doctor = human(hospital, 'knife-doctor', 0, 0, 'doctor');
  const knife = new THREE.Group(); knife.name = 'doctor-knife';
  const hand = doctor.userData.modelRig.arms[1].elbow; hand.add(knife); knife.position.set(0, -0.28, 0.04);
  box(knife, [0.07, 0.18, 0.07], [0, 0, 0], p.dark); box(knife, [0.055, 0.34, 0.025], [0, 0.25, 0], p.white);
  const nina = human(hospital, 'sequel-nina', -3, 5, 'medic');
  const giant = model(hospital, 'spider', 'nina-attacker'); giant.scale.setScalar(6.2);
  const maw = new THREE.Mesh(own(new THREE.SphereGeometry(1, 24, 16, Math.PI, Math.PI)), mat(0x090308, { side: THREE.BackSide }));
  maw.position.set(0, 0.16, 0.34); maw.scale.set(0.18, 0.18, 0.16); giant.add(maw);
  const rim = new THREE.Mesh(own(new THREE.TorusGeometry(1, 0.12, 8, 24)), p.red); rim.position.copy(maw.position); rim.scale.copy(maw.scale); giant.add(rim);

  // ================= Home: a modern house on one floor plan =================
  const home = group(root, 'sequel-home'); lighting(home, true);
  const roomFloor = { 'Гостиная': p.wood, 'Кухня': p.tile, 'Спальня': p.carpet, 'Прихожая': p.stone, 'Холл': p.woodLight, 'Оружейная': p.tileDark, 'Кабинет': p.woodDark, 'Ванная': p.tile };
  box(home, [25, 0.3, 25], [0, -0.2, 0], p.dark);
  for (const room of HOME_ROOMS) {
    const def = HOME_ROOM_DEFS_BY_NAME(room), width = def.x1 - def.x0, depth = def.z1 - def.z0;
    box(home, [width, 0.06, depth], [(def.x0 + def.x1) / 2, 0.01, (def.z0 + def.z1) / 2], roomFloor[room]);
  }
  // Floor patterns: checker tile, parquet strips, stone slabs.
  for (const [room, a, b] of [['Кухня', p.tile, p.tileDark], ['Ванная', p.tile, p.tileDark], ['Прихожая', p.stone, p.plasterDark]]) {
    const d = HOME_ROOM_DEFS_BY_NAME(room);
    for (let x = d.x0; x < d.x1 - 0.01; x += 1) for (let z = d.z0; z < d.z1 - 0.01; z += 1) {
      if ((Math.round(x) + Math.round(z)) % 2) box(home, [0.98, 0.012, 0.98], [x + 0.5, 0.045, z + 0.5], b === p.plasterDark ? p.woodDark : b).castShadow = false;
    }
  }
  for (let z = -11.5; z < 5.5; z += 0.6) box(home, [5.9, 0.008, 0.03], [0, 0.045, z], p.woodDark).castShadow = false;
  for (let x = -11.6; x < -3; x += 0.55) box(home, [0.03, 0.008, 8.9], [x, 0.045, 7.5], p.woodDark).castShadow = false;
  box(home, [0.12, 0.012, 11.5], [0, 0.058, -3.2], p.gold).castShadow = false;
  box(home, [3.4, 0.008, 3.4], [0, 0.066, -3.4], p.pool, 'moonlight-pool').castShadow = false;
  // Perimeter: tall north, east, west shells with glazing; a low glass facade to the south.
  const exterior = (axis, c, from, to, windows) => {
    const length = to - from, mid = (from + to) / 2;
    box(home, axis === 'x' ? [length, 3.3, 0.3] : [0.3, 3.3, length], axis === 'x' ? [mid, 1.65, c] : [c, 1.65, mid], p.plaster);
    box(home, axis === 'x' ? [length, 0.1, 0.5] : [0.5, 0.1, length], axis === 'x' ? [mid, 3.3, c] : [c, 3.3, mid], p.woodDark);
    box(home, axis === 'x' ? [length, 0.9, 0.36] : [0.36, 0.9, length], axis === 'x' ? [mid, 0.45, c] : [c, 0.45, mid], p.plasterDark);
    for (const at of windows) {
      const n = group(home, 'window', axis === 'x' ? at : c, axis === 'x' ? c : at, axis === 'x' ? 0 : c > 0 ? -Math.PI / 2 : Math.PI / 2);
      box(n, [2.6, 1.5, 0.34], [0, 1.9, 0], p.sky); box(n, [2.5, 1.4, 0.06], [0, 1.9, 0.18], p.glass);
      box(n, [0.06, 1.5, 0.1], [0, 1.9, 0.2], p.frameDark); box(n, [2.7, 0.06, 0.12], [0, 1.9, 0.2], p.frameDark);
      box(n, [2.8, 0.08, 0.5], [0, 1.12, 0.2], p.woodLight); box(n, [1.5, 0.01, 1.5], [0, 0.047, 0.9], p.blue).castShadow = false;
    }
  };
  exterior('x', -12.15, -12.3, 12.3, [-9, -6.5, 6, 9.5]); exterior('z', 12.15, -12.3, 12.3, [-9, -1.5, 7, 10]);
  exterior('z', -12.15, -12.3, 12.3, [-9.5, -6.2, 3.2, 9]);
  box(home, [25, 1.05, 0.3], [0, 0.525, 12.15], p.plasterDark); box(home, [25, 0.1, 0.4], [0, 1.1, 12.15], p.woodDark);
  for (let x = -12; x <= 12; x += 2.0) { box(home, [0.06, 1.7, 0.1], [x, 1.95, 12.15], p.frameDark); }
  box(home, [25, 1.7, 0.04], [0, 1.95, 12.15], p.glass);
  // Entry: wide double door, glazed sidelights, glowing sign and welcome mat.
  frame(home, 'x', 0, 12.15, 3.0, 2.9, 0.34, p.woodDark);
  box(home, [1.35, 2.7, 0.08], [-0.72, 1.35, 12.15], p.woodDark); box(home, [1.35, 2.7, 0.08], [0.72, 1.35, 12.15], p.woodDark);
  for (const sx of [-1, 1]) { box(home, [0.7, 1.2, 0.04], [sx * 0.72, 1.9, 12.1], p.glass); cyl(home, 0.04, 0.4, [sx * 0.15, 1.2, 12.05], p.gold, [Math.PI / 2, 0, 0]); }
  sign(home, 0, 3.35, 12.0, 1.6, p.hgreen);
  box(home, [2.8, 0.06, 0.6], [0, 0.03, 11], p.gold, 'home-exit');
  // Interior partitions from the collision data. East-west walls are glazed above 1 m for sightlines.
  for (const part of HOME_PARTITIONS) {
    const cuts = [...part.doors].sort((a, b) => a[0] - b[0]), segments = [];
    let cursor = part.from;
    for (const [a, b] of cuts) { segments.push([cursor, a]); cursor = b; }
    segments.push([cursor, part.to]);
    const along = part.axis === 'x';
    for (const [a, b] of segments) {
      if (b - a < 0.01) continue; const len = b - a, mid = (a + b) / 2;
      const at = (y, h, t) => [along ? [len, h, t] : [t, h, len], along ? [mid, y, part.c] : [part.c, y, mid]];
      if (along) {
        box(home, ...at(0.5, 1.0, 0.24), p.plaster); box(home, ...at(1.04, 0.08, 0.32), p.woodDark);
        box(home, ...at(1.9, 1.6, 0.04), p.glass); box(home, ...at(2.74, 0.12, 0.3), p.woodDark);
        for (let s = a + 0.6; s < b; s += 1.6) box(home, [0.07, 1.65, 0.1], [s, 1.9, part.c], p.frameDark);
      } else {
        box(home, ...at(1.4, 2.8, 0.24), p.plaster); box(home, ...at(0.2, 0.4, 0.3), p.woodDark); box(home, ...at(2.78, 0.12, 0.34), p.woodDark);
        box(home, ...at(1.1, 0.06, 0.32), p.woodDark);
      }
    }
    for (const [a, b] of part.doors) {
      const width = b - a, mid = (a + b) / 2;
      frame(home, part.axis, along ? mid : part.c, along ? part.c : mid, width - 0.2, 2.6, 0.36, p.woodDark);
      box(home, along ? [width, 0.2, 0.24] : [0.24, 0.2, width], along ? [mid, 2.85, part.c] : [part.c, 2.85, mid], p.plaster);
    }
  }
  // --- Living room: sofa, table, fire, television and lamps
  const sofa = group(home, 'sofa', -11.2, 8.5);
  box(sofa, [1.0, 0.4, 3.6], [0, 0.35, 0], p.cloth); box(sofa, [0.3, 0.8, 3.6], [-0.38, 0.75, 0], p.cloth);
  for (const z of [-1.8, 1.8]) box(sofa, [1.0, 0.65, 0.3], [0, 0.55, z], p.cloth);
  for (const z of [-0.9, 0.9]) box(sofa, [0.7, 0.14, 1.4], [0.04, 0.6, z], p.carpet);
  box(sofa, [0.18, 0.3, 0.4], [0.1, 0.85, -1.0], p.rug).rotation.y = 0.4;
  const rug = box(home, [4.6, 0.015, 3.6], [-8.4, 0.05, 8.5], p.rug); rug.castShadow = false;
  const table = group(home, 'coffee-table', -8.4, 8.5);
  box(table, [1.8, 0.07, 1.1], [0, 0.47, 0], p.woodLight); for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(table, [0.07, 0.44, 0.07], [sx * 0.8, 0.22, sz * 0.46], p.woodDark);
  box(table, [0.3, 0.05, 0.22], [-0.4, 0.52, 0.2], p.book[1]); cyl(table, 0.06, 0.1, [0.5, 0.55, -0.2], p.white);
  const arm = group(home, 'armchair', -6.8, 11, -0.6);
  box(arm, [1.1, 0.4, 1.0], [0, 0.35, 0], p.leather); box(arm, [1.1, 0.8, 0.25], [0, 0.75, -0.4], p.leather);
  for (const s of [-1, 1]) box(arm, [0.18, 0.55, 1.0], [s * 0.5, 0.55, 0], p.leather);
  const tv = group(home, 'tv-wall', -10.4, 3.4);
  box(tv, [2.4, 0.5, 0.5], [0, 0.3, 0.1], p.woodDark); box(tv, [1.9, 1.05, 0.06], [0, 1.45, -0.05], p.frameDark); box(tv, [1.8, 0.95, 0.02], [0, 1.45, 0.0], p.tv).castShadow = false;
  const fire = group(home, 'fireplace', -9.0, 11.6);
  box(fire, [2.6, 1.3, 0.8], [0, 0.65, 0], p.stone); box(fire, [1.4, 0.75, 0.2], [0, 0.45, 0.28], p.dark); box(fire, [1.1, 0.25, 0.05], [0, 0.22, 0.4], p.ember).castShadow = false;
  box(fire, [2.9, 0.12, 1.0], [0, 1.34, 0], p.woodDark); box(fire, [1.4, 1.2, 0.05], [0, 2.1, -0.34], p.dark);
  for (const [x, z] of [[-6, 5], [-11.2, 4.4]]) { cyl(home, 0.04, 1.6, [x, 0.8, z]); cyl(home, 0.25, 0.3, [x, 1.7, z], p.warm); cyl(home, 0.2, 0.04, [x, 0.02, z], p.frameDark); }
  plant(home, -11.2, 11.2, 1.5);
  for (let i = 0; i < 6; i++) box(home, [0.5, 0.04, 0.35], [-11.7, 1.6 + (i % 3) * 0.35, 4.6 + i * 0.65 - (i % 3) * 0.3], p.book[i & 3]);
  // --- Kitchen: run of cabinets, hob and hood, island with stools, pendant lights
  const cab = group(home, 'kitchen-run', -11.4, -0.5);
  box(cab, [1.1, 0.9, 6.1], [0, 0.45, 0], p.woodDark); box(cab, [1.2, 0.06, 6.1], [0, 0.93, 0], p.stone);
  for (let z = -2.7; z < 3; z += 0.9) box(cab, [0.03, 0.8, 0.03], [0.56, 0.45, z], p.steel);
  box(cab, [0.5, 0.8, 5.0], [-0.3, 2.0, -0.4], p.woodDark); box(cab, [0.5, 0.05, 5.0], [-0.3, 1.58, -0.4], p.frameDark);
  box(cab, [0.9, 2.0, 0.9], [-0.05, 1.0, 2.5], p.steel); box(cab, [0.02, 1.0, 0.04], [0.42, 1.2, 2.2], p.frameDark);
  box(cab, [0.6, 0.02, 0.9], [0, 0.97, -1.2], p.frameDark); for (const dz of [-1.45, -0.95]) cyl(cab, 0.12, 0.02, [0, 0.99, dz], p.rubber);
  box(cab, [0.5, 0.3, 0.9], [-0.15, 2.0 + 0.8, -1.2], p.steel); box(cab, [0.5, 0.06, 0.5], [0.1, 0.96, 0.9], p.glass);
  const island = group(home, 'kitchen-island', -8.3, -0.5);
  box(island, [3.2, 0.9, 1.2], [0, 0.45, 0], p.woodDark); box(island, [3.4, 0.07, 1.4], [0, 0.94, 0], p.stone); box(island, [3.0, 0.02, 0.9], [0, 0.45, 0.62], p.plasterDark);
  for (const x of [-1, 0, 1]) { cyl(island, 0.2, 0.05, [x, 0.7, 1.2], p.leather); cyl(island, 0.025, 0.7, [x, 0.35, 1.2]); cyl(island, 0.18, 0.02, [x, 0.01, 1.2], p.steel); }
  box(island, [0.4, 0.04, 0.3], [-0.9, 1.0, 0], p.book[3]); cyl(island, 0.12, 0.1, [0.9, 1.03, 0], p.white);
  box(home, [1.8, 0.07, 1.1], [-5.0, 0.78, -0.5], p.woodLight); for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(home, [0.07, 0.75, 0.07], [-5.0 + sx * 0.8, 0.38, -0.5 + sz * 0.46], p.woodDark);
  chair(home, -5.0, 0.7, Math.PI, p.leather);
  chair(home, -5.0, -1.7, 0, p.leather); chair(home, -4.1, -0.5, -Math.PI / 2, p.leather); chair(home, -5.9, -0.5, Math.PI / 2, p.leather);
  // --- Bedroom: bed with headboard, nightstands, wardrobe, rug, curtains
  const master = bed(home, -9.9, -10.5, Math.PI, p.hcurtain, p.woodDark); master.scale.set(1.5, 1.1, 1.05);
  box(home, [2.2, 1.0, 0.14], [-9.9, 0.7, -11.9], p.woodDark);
  box(home, [0.8, 0.7, 0.8], [-7.8, 0.35, -11.4], p.woodDark); cyl(home, 0.15, 0.3, [-8.05, 1.0, -11.55], p.warm); cyl(home, 0.04, 0.2, [-8.05, 0.82, -11.55]);
  box(home, [0.8, 0.7, 0.8], [-12 + 0.5, 0.35, -11.4], p.woodDark);
  const wardrobe = group(home, 'wardrobe', -11.5, -6.5); box(wardrobe, [0.9, 2.4, 2.9], [0, 1.2, 0], p.woodDark);
  for (const z of [-1.4, -0.5, 0.5, 1.4]) box(wardrobe, [0.03, 2.2, 0.04], [0.47, 1.2, z * 0.9], p.gold);
  box(wardrobe, [0.04, 2.3, 0.03], [0.47, 1.2, 0], p.frameDark);
  box(home, [4.6, 0.015, 3.4], [-8.9, 0.05, -8.4], p.plasterDark).castShadow = false;
  box(home, [0.04, 1.4, 0.8], [-4.3, 1.6, -6], p.glass);
  // --- Bathroom: vanity with mirror, bath, shower, towel rail
  const vanity = group(home, 'vanity', 6, -11.5);
  box(vanity, [2.8, 0.85, 0.65], [0, 0.43, 0], p.woodLight); box(vanity, [2.9, 0.06, 0.7], [0, 0.88, 0], p.stone);
  for (const x of [-0.7, 0.7]) { box(vanity, [0.55, 0.05, 0.4], [x, 0.92, 0], p.bath); cyl(vanity, 0.03, 0.25, [x, 1.05, -0.15]); }
  for (const x of [-0.7, 0.7]) box(vanity, [0.8, 1.0, 0.04], [x, 1.7, -0.32], p.glass);
  box(vanity, [2.8, 0.1, 0.1], [0, 2.4, -0.28], p.lamp).castShadow = false;
  const tub = group(home, 'bathtub', 10.6, -10.6);
  box(tub, [2.6, 0.62, 1.3], [0, 0.31, 0], p.bath); box(tub, [2.3, 0.06, 1.0], [0, 0.62, 0], p.sky);
  cyl(tub, 0.03, 0.8, [-1.1, 0.9, -0.5]); cyl(tub, 0.03, 0.4, [-1.0, 1.3, -0.4], p.steel, [0, 0, Math.PI / 2]);
  box(home, [0.04, 2.0, 2.4], [8.6, 1.0, -6.2], p.glass); box(home, [2.4, 0.04, 0.04], [7.4, 2.0, -5.0]);
  box(home, [1.6, 1.0, 1.0], [10.8, 0.5, -6.3], p.bath); box(home, [0.5, 0.45, 0.5], [11.4, 0.22, -3.8], p.bath);
  box(home, [0.04, 1.4, 0.7], [11.8, 1.5, -8.6], p.frameDark); for (const y of [1.1, 1.5, 1.9]) box(home, [0.05, 0.06, 0.7], [11.7, y, -8.6], p.steel);
  // --- Study: desk, bookcases, globe, banker lamp and a reading chair
  const desk = group(home, 'study-desk', 11.2, 2.5, -Math.PI / 2);
  box(desk, [3.2, 0.1, 1.2], [0, 0.88, 0], p.woodLight); for (const s of [-1, 1]) box(desk, [0.1, 0.84, 1.0], [s * 1.5, 0.42, 0], p.woodDark);
  box(desk, [0.6, 0.35, 0.04], [0.3, 1.2, -0.3], p.frameDark); box(desk, [0.52, 0.28, 0.02], [0.3, 1.2, -0.28], p.blue).castShadow = false;
  box(desk, [0.2, 0.04, 0.3], [-0.9, 0.95, 0.1], p.book[0]); cyl(desk, 0.1, 0.18, [-1.2, 1.05, -0.3], p.hgreen);
  chair(home, 9.7, 2.5, -Math.PI / 2, p.leather);
  for (let x = 3.9; x < 6.8; x += 0.8) { box(home, [0.7, 2.2, 0.35], [x, 1.1, 6.75], p.woodDark); for (let y = 0.4; y < 2.1; y += 0.4) box(home, [0.6, 0.3, 0.2], [x, y + 0.2, 6.7], p.book[(Math.round(x * 3) + Math.round(y * 5)) & 3]); }
  cyl(home, 0.35, 0.6, [11.5, 0.9, -0.4], p.gold); ball(home, [0.4, 0.4, 0.4], [11.5, 1.35, -0.4], p.blue); box(home, [0.9, 0.6, 0.9], [11.5, 0.3, -0.4], p.woodDark);
  box(home, [0.3, 1.6, 2.8], [3.35, 1.0, 5.2], p.woodDark); for (let y = 0.5; y < 1.8; y += 0.45) box(home, [0.28, 0.35, 2.5], [3.45, y, 5.2], p.book[(Math.round(y * 9)) & 3]);
  box(home, [2.6, 0.015, 2.0], [8.5, 0.05, 2.5], p.rug).castShadow = false;
  // --- Gun room: rifle racks, ammo crates, workbench and the safe
  const rack = group(home, 'gun-rack', 11.45, 9.5);
  box(rack, [0.4, 2.2, 4.0], [0, 1.1, 0], p.woodDark);
  for (let z = -1.6; z <= 1.6; z += 0.8) { cyl(rack, 0.035, 1.6, [-0.2, 1.1, z], p.frameDark); box(rack, [0.1, 0.5, 0.06], [-0.2, 0.7, z], p.leather); }
  const bench2 = group(home, 'workbench', 5.5, 11.3);
  box(bench2, [3.0, 0.9, 1.0], [0, 0.45, 0], p.woodLight); box(bench2, [3.1, 0.07, 1.1], [0, 0.93, 0], p.woodDark);
  box(bench2, [0.4, 0.2, 0.2], [-0.9, 1.1, 0], p.steel); box(bench2, [0.5, 0.12, 0.3], [0.7, 1.02, 0.1], p.red);
  box(home, [0.8, 0.5, 0.6], [3.7, 0.25, 11.6], p.woodDark); box(home, [0.8, 0.5, 0.6], [3.7, 0.75, 11.6], p.red);
  const safe = group(home, 'ten-digit-safe', SAFE_POS.x, SAFE_POS.z + 0.9);
  box(safe, [1.5, 1.7, 1.2], [0, 0.85, 0], p.dark);
  // Hinged door (left edge) swings outward when the safe is opened; a carbine rests on the shelf inside.
  box(safe, [1.3, 0.04, 1.0], [0, 0.85, -0.05], p.steel); box(safe, [0.2, 0.12, 0.8], [0.2, 0.93, -0.05], p.woodDark); box(safe, [0.1, 0.1, 0.75], [-0.1, 0.92, -0.05], p.frameDark);
  const safeDoor = group(safe, 'safe-door', -0.65, -0.65); safeDoor.userData.keep = true;
  box(safeDoor, [1.3, 1.5, 0.08], [0.65, 0.85, 0], p.steel); box(safeDoor, [0.55, 0.5, 0.08], [0.65, 1, -0.07], p.gold);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) box(safeDoor, [0.1, 0.1, 0.03], [0.5 + c * 0.15, 0.95 - r * 0.14, -0.13], p.white);
  box(safeDoor, [0.12, 0.12, 0.05], [1.05, 0.4, -0.05], p.red);
  // --- Foyer and hall: coat rack, bench, mirror, runner, columns, pendants and the stair alcove
  box(home, [1.0, 0.45, 0.45], [-1.5, 0.22, 11.6], p.woodLight); box(home, [0.5, 0.2, 0.4], [-1.7, 0.55, 11.6], p.rubber);
  box(home, [1.2, 0.06, 0.3], [-1.4, 2.0, 11.9], p.woodDark); for (const x of [-1.8, -1.4, -1.0]) { cyl(home, 0.025, 0.2, [x, 1.9, 11.85], p.gold); box(home, [0.1, 0.5, 0.06], [x, 1.6, 11.85], p.cloth); }
  box(home, [0.04, 1.6, 0.9], [-2.88, 1.6, 7.2], p.glass); box(home, [0.12, 0.8, 0.08], [-2.84, 0.4, 7.2], p.woodDark);
  box(home, [0.5, 0.9, 1.4], [2.7, 0.45, 8.5], p.woodDark); cyl(home, 0.2, 0.4, [2.65, 1.1, 8.1], p.warm); box(home, [0.35, 0.6, 0.04], [2.9, 1.7, 8.9], p.sky);
  box(home, [4.8, 0.012, 3.4], [0, 0.055, 8.8], p.rug).castShadow = false;
  for (const z of [-4.5, 5]) for (const x of [-2.7, 2.7]) { box(home, [0.3, 3.0, 0.3], [x, 1.5, z], p.plasterDark); box(home, [0.4, 0.14, 0.4], [x, 3.0, z], p.woodDark); }
  const stair = group(home, 'hall-stair', 0, -10.9);
  for (let i = 0; i < 9; i++) box(stair, [3.0, 0.24 * (i + 1), 0.22], [0, 0.12 * (i + 1), 0.99 - i * 0.24], i % 2 ? p.woodLight : p.woodDark);
  for (const s of [-1, 1]) { box(stair, [0.08, 0.9, 2.3], [s * 1.5, 1.4, 0], p.woodDark); box(stair, [0.1, 0.07, 2.3], [s * 1.5, 1.88, 0], p.gold); }
  box(stair, [3.0, 0.5, 0.12], [0, 2.7, -1.05], p.plasterDark); box(stair, [1.4, 1.5, 0.05], [0, 3.1, -1.12], p.moon).castShadow = false;
  plant(home, -2.3, -10.8, 1.6); plant(home, 2.3, -10.8, 1.6);
  const notes = CODE_NOTES.map(note => box(home, [0.55, 0.04, 0.38], [note.x, NOTE_HEIGHT[note.id] + 0.03, note.z], p.paper, `code-fragment-${note.id}`));
  batch(home);
  const fireLight = pointLight(home, 0xff7a30, 10, -9, 1.1, 10.3, 7);
  pointLight(home, 0xffb36a, 20, 0, 2.6, 9, 12); pointLight(home, 0x9fc0ff, 15, 0, 2.8, -4, 14); pointLight(home, 0xff8a3a, 12, -9, 1.2, 10.4, 9);
  pointLight(home, 0xffc98a, 12, -7.5, 2.2, -0.5, 9); pointLight(home, 0xffd49a, 10, 10, 1.8, 2.5, 8); pointLight(home, 0xaedfff, 10, 7.5, 2.2, -9, 9);
  const pursuer = model(home, 'spider', 'home-pursuer'); pursuer.scale.setScalar(4.2);
  const homeMaw = new THREE.Mesh(maw.geometry, maw.material); homeMaw.position.copy(maw.position); homeMaw.scale.copy(maw.scale); pursuer.add(homeMaw);
  const homeRim = new THREE.Mesh(rim.geometry, rim.material); homeRim.position.copy(rim.position); homeRim.scale.copy(rim.scale); pursuer.add(homeRim);

  // ================= Final clinic: crowded waiting hall =================
  const clinic = group(root, 'final-clinic'); lighting(clinic);
  box(clinic, [18.6, 0.2, 21], [0, -0.12, 0], p.hfloorDark);
  for (let x = -8.5; x < 9; x += 1) for (let z = -9.5; z < 10; z += 1) box(clinic, [0.98, 0.02, 0.98], [x, 0.01, z], (Math.round(x) + Math.round(z)) % 2 ? p.hfloorA : p.hfloorB);
  box(clinic, [0.3, 0.012, 18], [0, 0.03, 0], p.hgreen).castShadow = false;
  for (const side of [-1, 1]) {
    box(clinic, [0.3, 3.2, 21], [side * 9.15, 1.6, 0], p.hwall); box(clinic, [0.4, 1.05, 21], [side * 9.1, 0.525, 0], p.hdado);
    for (let z = -8; z <= 8; z += 4) { box(clinic, [0.5, 3.2, 0.45], [side * 8.95, 1.6, z], p.hwall); box(clinic, [0.12, 1.2, 2.4], [side * 8.95, 2.3, z + 2], p.glass); bench(clinic, side * 8.2, z + 2, side * Math.PI / 2 + Math.PI, 2.6); }
  }
  box(clinic, [18.6, 3.2, 0.3], [0, 1.6, -10.1], p.hwall); box(clinic, [18.6, 1.05, 0.4], [0, 0.525, -10.0], p.hdado);
  frame(clinic, 'x', 0, -9.9, 3.2, 2.9, 0.36); box(clinic, [3.4, 0.3, 0.3], [0, 3.0, -10.0], p.hwall);
  box(clinic, [3, 2.8, 0.15], [0, 1.4, -8], p.hdado, 'final-doctor-door'); sign(clinic, 0, 3.3, -9.7, 2.0, p.hred);
  for (const z of [-3, 3]) for (const x of [-4.2, 4.2]) bench(clinic, x, z, Math.PI, 2.6);
  for (const x of [-5.5, 5.5]) for (const z of [-6, 6]) { cyl(clinic, 0.38, 3.2, [x, 1.6, z], p.hwall); cyl(clinic, 0.46, 0.2, [x, 0.1, z], p.hdado); }
  plant(clinic, -8.2, 9.2, 1.6); plant(clinic, 8.2, 9.2, 1.6); plant(clinic, -3.2, -9.3, 1.4); plant(clinic, 3.2, -9.3, 1.4);
  box(clinic, [3.6, 0.9, 0.12], [0, 2.3, 10.2], p.hdado); cross(clinic, 0, 2.3, 10.1, 0.7, p.white);
  const queue = [human(clinic, 'queue-1', -1, 2, 'civilian', 0), human(clinic, 'queue-2', 1, 0, 'civilian', 1), human(clinic, 'queue-3', -1, -2, 'civilian', 2)];
  human(clinic, 'final-doctor', 0, -9, 'doctor'); batch(clinic);
  pointLight(clinic, 0xcfe8e4, 12, 0, 3.2, 0, 18);

  // ================= Final bedroom: dark room with a moonlit window =================
  const bedroom = group(root, 'final-bedroom'); lighting(bedroom, true);
  box(bedroom, [10.4, 0.25, 10.4], [0, -0.15, 0], p.wood);
  for (let x = -4.8; x < 5; x += 0.6) box(bedroom, [0.03, 0.01, 10], [x, 0.0, 0], p.woodDark).castShadow = false;
  box(bedroom, [10.4, 3.2, 0.3], [0, 1.6, -5.15], p.plaster); box(bedroom, [0.3, 3.2, 10.4], [-5.15, 1.6, 0], p.plaster);
  box(bedroom, [10.4, 1.0, 0.36], [0, 0.5, -5.1], p.plasterDark); box(bedroom, [0.36, 1.0, 10.4], [-5.1, 0.5, 0], p.plasterDark);
  bed(bedroom, 0, 0, 0, p.hcurtain, p.woodDark); box(bedroom, [1.7, 0.9, 0.14], [0, 0.9, -1.4], p.woodDark);
  box(bedroom, [0.7, 0.6, 0.6], [-1.4, 0.3, -1.1], p.woodDark); cyl(bedroom, 0.15, 0.3, [-1.4, 0.85, -1.1], p.warm);
  box(bedroom, [2.2, 0.9, 1.0], [-3.2, 0.45, -3.2], p.woodLight); box(bedroom, [2.0, 2.4, 0.9], [3.5, 1.2, -4.5], p.woodDark);
  box(bedroom, [2.6, 1.8, 0.1], [2.5, 1.9, -4.95], p.sky); box(bedroom, [2.5, 1.7, 0.04], [2.5, 1.9, -4.9], p.glass);
  box(bedroom, [0.08, 1.8, 0.14], [2.5, 1.9, -4.85], p.frameDark); box(bedroom, [2.6, 0.08, 0.14], [2.5, 1.9, -4.85], p.frameDark);
  ball(bedroom, [0.4, 0.4, 0.05], [3.1, 2.4, -4.93], p.moon);
  box(bedroom, [3.2, 0.012, 2.4], [0, 0.028, 0.5], p.rug).castShadow = false; batch(bedroom);
  pointLight(bedroom, 0x7aa4ff, 6, 2.5, 2.2, -3.8, 12);
  const nightmare = model(bedroom, 'spider', 'final-nightmare-spider'); nightmare.scale.setScalar(3);
  root.visible = false;
  return { root, hospital, home, clinic, bedroom, doctor, nina, giant, maw, door, cracks, notes, safe, pursuer, homeMaw, queue, nightmare,
    safeDoor,
    /** Ambient motion: fire and television flicker, heartbeat monitors, the safe door opening. */
    animate(time, state) {
      p.ember.emissiveIntensity = 1.05 + Math.sin(time * 13) * 0.25 + Math.sin(time * 7.3) * 0.2;
      fireLight.intensity = 10 * (0.82 + 0.18 * Math.sin(time * 11 + Math.sin(time * 3)));
      p.tv.emissiveIntensity = 0.55 + 0.25 * Math.sin(time * 3.1) * Math.sin(time * 1.7);
      p.monitor.emissiveIntensity = 0.35 + 0.65 * Math.pow(Math.max(0, Math.sin(time * 6)), 3);
      const open = state?.chapter === 'home' && state.weapon ? 1 : 0;
      const target = open * 1.9;
      safeDoor.rotation.y += (target - safeDoor.rotation.y) * 0.12;
    },
    dispose() { root.removeFromParent(); root.clear(); for (const resource of resources) resource.dispose(); resources.clear(); }, HOME_ROOMS };
}

function HOME_ROOM_DEFS_BY_NAME(name) { return HOME_ROOM_DEFS.find(room => room.name === name); }
