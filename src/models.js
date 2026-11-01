import * as THREE from 'three';

// All assets are geometry and materials: no network, canvas textures or lights.
// Root transforms belong to view; rigs below them are the only animated objects.
const UP = new THREE.Vector3(0, 1, 0);
const DELTA = new THREE.Vector3();
const ARM_DOWN = new THREE.Vector3(0, -1, 0);
const ARM_TARGET = new THREE.Vector3();
const ARM_DIRECTION = new THREE.Vector3();
const ARM_POLE = new THREE.Vector3();
const ARM_ELBOW = new THREE.Vector3();
const ARM_LOWER = new THREE.Vector3();
const ARM_INVERSE = new THREE.Quaternion();
const BOX = new THREE.BoxGeometry(1, 1, 1);
const SPHERE = new THREE.SphereGeometry(1, 16, 12);
const JOINT = new THREE.SphereGeometry(1, 8, 6);
const CYLINDER = new THREE.CylinderGeometry(1, 1, 1, 10);
const TORUS = new THREE.TorusGeometry(1, 0.34, 8, 18);
const LIMB = new THREE.CylinderGeometry(0.7, 1, 1, 14);
const TAPER = new THREE.CylinderGeometry(0.36, 1, 1, 8);
const ROUNDED = makeRoundedBox();
const HUMAN_TORSO = makeHumanTorso();

function makeHumanTorso() {
  const geometry = ROUNDED.clone();
  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const y = positions.getY(i);
    positions.setX(i, positions.getX(i) * (0.82 + (y + 0.5) * 0.18));
    positions.setZ(i, positions.getZ(i) * (0.92 + Math.sin((y + 0.5) * Math.PI) * 0.08));
  }
  geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  return geometry;
}
const palettes = new Map();
const markingGeometries = new Map();
const KNEE = new THREE.Vector3();
const ANKLE = new THREE.Vector3();
const FOOT = new THREE.Vector3();

function makeRoundedBox() {
  const geometry = new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  const positions = geometry.attributes.position;
  const normals = geometry.attributes.normal;
  const point = new THREE.Vector3();
  const inner = new THREE.Vector3();
  const normal = new THREE.Vector3();
  for (let i = 0; i < positions.count; i += 1) {
    point.fromBufferAttribute(positions, i);
    inner.copy(point).clampScalar(-0.39, 0.39);
    normal.copy(point).sub(inner).normalize();
    point.copy(normal).multiplyScalar(0.11).add(inner);
    positions.setXYZ(i, point.x, point.y, point.z);
    normals.setXYZ(i, normal.x, normal.y, normal.z);
  }
  positions.needsUpdate = true;
  normals.needsUpdate = true;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function material(color, roughness = 0.65, metalness = 0.02, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
}

function mesh(parent, geometry, surface, position, scale, name) {
  const object = new THREE.Mesh(geometry, surface);
  if (position) object.position.set(...position);
  if (scale) object.scale.set(...scale);
  if (name) object.name = name;
  object.castShadow = true;
  object.receiveShadow = true;
  parent.add(object);
  return object;
}

function box(parent, size, position, surface, rounded = false, name) {
  return mesh(parent, rounded ? ROUNDED : BOX, surface, position, size, name);
}

function ball(parent, size, position, surface, name, lowPoly = false) {
  return mesh(parent, lowPoly ? JOINT : SPHERE, surface, position, size, name);
}

function pivot(parent, name, position = [0, 0, 0]) {
  const group = new THREE.Group();
  group.name = name;
  group.position.set(...position);
  parent.add(group);
  return group;
}

function placeSegment(object, a, b, radius) {
  DELTA.subVectors(b, a);
  const length = Math.max(DELTA.length(), 0.00001);
  object.position.copy(a).add(b).multiplyScalar(0.5);
  object.scale.set(radius, length, radius);
  object.quaternion.setFromUnitVectors(UP, DELTA.multiplyScalar(1 / length));
}

function segment(parent, a, b, radius, surface, tapered = false) {
  const object = mesh(parent, tapered ? TAPER : CYLINDER, surface);
  placeSegment(object, new THREE.Vector3(...a), new THREE.Vector3(...b), radius);
  return object;
}

function lines(parent, coordinates, color, opacity = 1, name = '') {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(coordinates, 3));
  const object = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
    color, transparent: opacity < 1, opacity, depthWrite: opacity === 1,
  }));
  object.name = name;
  parent.add(object);
  return object;
}

// Static furniture is batched by geometry + material, not one draw call per book.
function batchStaticRoom(room) {
  room.updateMatrixWorld(true);
  const batches = new Map();
  room.traverse((object) => {
    if (!object.isMesh || object.isInstancedMesh) return;
    const key = `${object.geometry.uuid}:${object.material.uuid}`;
    if (!batches.has(key)) batches.set(key, []);
    batches.get(key).push(object);
  });
  for (const objects of batches.values()) {
    if (objects.length < 2) continue;
    const first = objects[0];
    const batch = new THREE.InstancedMesh(first.geometry, first.material, objects.length);
    batch.name = 'batched-room-details';
    batch.castShadow = true;
    batch.receiveShadow = true;
    objects.forEach((object, index) => {
      batch.setMatrixAt(index, object.matrixWorld);
      object.removeFromParent();
    });
    batch.instanceMatrix.needsUpdate = true;
    batch.computeBoundingSphere();
    room.add(batch);
  }
}

function roomPalette() {
  if (!palettes.has('room')) palettes.set('room', {
    wall: material(0x27343d, 0.95), trim: material(0x46525b, 0.65),
    dark: material(0x101a21, 0.8), wood: material(0x352a25, 0.62),
    woodEdge: material(0x654b36, 0.58), cloth: material(0x263b41, 1),
    pillow: material(0x74634d, 1), brass: material(0xb2915e, 0.32, 0.65),
    paper: material(0xb7b5a1, 0.95), black: material(0x10151c, 0.5),
    red: material(0x672e2b, 0.9), ceramic: material(0x668b87, 0.28),
    screen: material(0x214350, 0.4, 0.1, { emissive: 0x1d7586, emissiveIntensity: 0.3 }),
    moon: material(0x538296, 0.3, 0.15, { emissive: 0x3b677c, emissiveIntensity: 0.24 }),
    rug: material(0x263038, 1), leaf: material(0x294a40, 0.95),
  });
  return palettes.get('room');
}

/** A cutaway night room. Furniture never enters the playable [-10,10] square. */
export function createRoom() {
  const room = new THREE.Group();
  room.name = 'night-room';
  room.userData.arenaBounds = { minX: -10, maxX: 10, minZ: -10, maxZ: 10 };
  const p = roomPalette();
  box(room, [25.4, 0.25, 25.4], [0, -0.205, 0], p.dark);
  const floor = new THREE.InstancedMesh(BOX, material(0xffffff, 0.83), 160);
  floor.name = 'individual-oak-floorboards';
  const transform = new THREE.Object3D();
  const color = new THREE.Color();
  for (let x = 0; x < 20; x += 1) {
    for (let z = 0; z < 8; z += 1) {
      const index = x * 8 + z;
      transform.position.set(-11.875 + x * 1.25, -0.04, -10.9375 + z * 3.125);
      transform.scale.set(1.238, 0.08, 3.108);
      transform.updateMatrix();
      floor.setMatrixAt(index, transform.matrix);
      floor.setColorAt(index, color.setHSL(0.075, 0.18, 0.19 + ((index * 17) % 13) / 190));
    }
  }
  floor.receiveShadow = true;
  floor.instanceMatrix.needsUpdate = true;
  floor.instanceColor.needsUpdate = true;
  room.add(floor);

  const grain = [];
  for (let i = 0; i < 130; i += 1) {
    const x = -12.2 + ((i * 47) % 243) / 10;
    const z = -12 + ((i * 31) % 232) / 10;
    grain.push(x, 0.002, z, x + 0.015, 0.002, Math.min(12.3, z + 0.3 + (i % 7) * 0.1));
  }
  lines(room, grain, 0x1c2429, 0.22, 'subtle-wood-grain');
  for (const s of [-1, 1]) {
    box(room, [0.022, 0.006, 20.3], [s * 10.15, 0.003, 0], p.brass);
    box(room, [20.3, 0.006, 0.022], [0, 0.003, s * 10.15], p.brass);
    box(room, [25, 0.34, 0.13], [0, 0.17, s * 12.45], p.trim, true);
    box(room, [0.13, 0.34, 25], [s * 12.45, 0.17, 0], p.trim, true);
  }
  // Only far walls are tall, so they cannot hide the player from the +X,+Z view.
  box(room, [25.3, 4.8, 0.22], [0, 2.4, -12.61], p.wall);
  box(room, [0.22, 4.8, 25.3], [-12.61, 2.4, 0], p.wall);
  for (let x = -11; x <= 11; x += 2.75) {
    box(room, [0.035, 3.8, 0.055], [x, 2.5, -12.47], p.trim);
  }
  box(room, [25.1, 0.16, 0.18], [0, 4.65, -12.43], p.trim, true);
  box(room, [0.18, 0.16, 25.1], [-12.43, 4.65, 0], p.trim, true);

  const window = pivot(room, 'moonlit-window', [4.3, 2.75, -12.43]);
  box(window, [4.15, 2.6, 0.12], [0, 0, 0], p.dark);
  for (const x of [-0.95, 0.95]) {
    for (const y of [-0.6, 0.6]) box(window, [1.76, 1.1, 0.04], [x, y, 0.075], p.moon);
  }
  box(window, [0.09, 2.6, 0.13], [0, 0, 0.15], p.trim);
  box(window, [4.15, 0.1, 0.13], [0, 0, 0.15], p.trim);
  box(window, [4.5, 0.13, 0.42], [0, -1.37, 0.17], p.woodEdge, true);
  for (const x of [-2.34, 2.34]) {
    for (let i = 0; i < 5; i += 1) {
      box(window, [0.15, 2.95, 0.22], [x + i * 0.105, -0.1, 0.15 + (i % 2) * 0.09], p.cloth, true);
    }
  }
  addSofa(room, p);
  addDesk(room, p);
  addShelf(room, p);
  addPlant(room, p, [11.35, 0, -11.25]);
  addPlant(room, p, [-11.4, 0, 10.9]);
  addSideTable(room, p);
  addWallDetails(room, p);
  addWeb(room, new THREE.Vector3(-12.4, 4.58, -12.4), 2.8, 1);
  addWeb(room, new THREE.Vector3(12.4, 4.58, -12.4), 1.8, -1);
  batchStaticRoom(room);
  return room;
}

function addSofa(room, p) {
  const sofa = pivot(room, 'worn-leather-sofa', [-5.7, 0, -11.38]);
  for (const x of [-1.7, 1.7]) for (const z of [-0.46, 0.46]) {
    box(sofa, [0.16, 0.24, 0.16], [x, 0.12, z], p.woodEdge, true);
  }
  box(sofa, [4.3, 0.42, 1.58], [0, 0.38, 0], p.wood, true);
  box(sofa, [4.18, 1.05, 0.35], [0, 1.02, -0.59], p.cloth, true);
  for (const x of [-1.32, 0, 1.32]) {
    box(sofa, [1.23, 0.3, 1.08], [x, 0.73, 0.15], p.cloth, true);
    const cushion = box(sofa, [1.18, 0.78, 0.24], [x, 1.12, -0.33], p.cloth, true);
    cushion.rotation.x = -0.12;
    for (const dx of [-0.27, 0.27]) ball(sofa, [0.035, 0.035, 0.025], [x + dx, 1.14, -0.193], p.dark, '', true);
  }
  for (const x of [-2.02, 2.02]) box(sofa, [0.37, 0.6, 1.55], [x, 0.88, 0], p.cloth, true);
  const pillow = box(sofa, [0.6, 0.6, 0.28], [1.4, 1.04, 0], p.pillow, true);
  pillow.rotation.z = -0.3;
  const throwBlanket = box(sofa, [0.62, 0.055, 1.06], [-1.1, 0.91, 0.19], p.red, true);
  throwBlanket.rotation.z = 0.04;
}

function addDesk(room, p) {
  const desk = pivot(room, 'night-shift-desk', [-11.35, 0, 3.2]);
  box(desk, [1.65, 0.16, 4.8], [0, 1.38, 0], p.woodEdge, true);
  for (const x of [-0.6, 0.6]) for (const z of [-2, 2]) {
    box(desk, [0.1, 1.32, 0.1], [x, 0.66, z], p.black);
  }
  box(desk, [1.22, 0.76, 1.08], [0, 0.89, 1.55], p.wood, true);
  for (let i = 0; i < 3; i += 1) {
    box(desk, [0.055, 0.19, 0.94], [0.637, 0.66 + i * 0.23, 1.55], p.woodEdge);
    box(desk, [0.045, 0.025, 0.23], [0.682, 0.66 + i * 0.23, 1.55], p.brass, true);
  }
  box(desk, [0.43, 0.045, 0.6], [0, 1.49, -0.6], p.black, true);
  box(desk, [0.1, 0.39, 0.13], [-0.1, 1.68, -0.6], p.black);
  box(desk, [0.12, 0.9, 1.35], [-0.16, 2.06, -0.6], p.black, true);
  box(desk, [0.025, 0.73, 1.18], [-0.087, 2.07, -0.6], p.screen);
  box(desk, [0.35, 0.045, 0.85], [0.48, 1.49, -0.55], p.black, true);
  for (let i = 0; i < 4; i += 1) box(desk, [0.017, 0.013, 0.7], [0.36 + i * 0.07, 1.52, -0.55], p.trim);
  for (let i = 0; i < 3; i += 1) {
    const paper = box(desk, [0.64, 0.012, 0.8], [0.12, 1.48 + i * 0.015, 0.62], p.paper);
    paper.rotation.y = i * 0.12;
  }
  mesh(desk, CYLINDER, p.ceramic, [0.1, 1.62, -1.72], [0.13, 0.27, 0.13]);
}

function addShelf(room, p) {
  const shelf = pivot(room, 'books-and-storage', [-11.45, 0, -5.4]);
  box(shelf, [0.12, 3.2, 4.3], [-0.66, 1.6, 0], p.wood);
  for (const z of [-2.08, 2.08]) box(shelf, [1.4, 3.2, 0.13], [0, 1.6, z], p.woodEdge, true);
  for (let level = 0; level <= 4; level += 1) {
    box(shelf, [1.4, 0.11, 4.3], [0, 0.18 + level * 0.74, 0], p.woodEdge, true);
  }
  const covers = [p.cloth, p.red, p.paper, p.dark, p.ceramic];
  for (let level = 0; level < 3; level += 1) {
    for (let i = 0; i < 7; i += 1) {
      const height = 0.36 + ((i * 3 + level) % 4) * 0.065;
      const z = -1.7 + i * 0.26;
      box(shelf, [0.75, height, 0.2], [0.22, 0.24 + level * 0.74 + height / 2, z], covers[(i + level) % covers.length], true);
      box(shelf, [0.008, 0.025, 0.15], [0.6, 0.33 + level * 0.74, z], p.brass);
    }
    box(shelf, [0.98, 0.48, 1.12], [0.08, 0.48 + level * 0.74, 1.25], p.rug, true);
    box(shelf, [0.02, 0.12, 0.3], [0.58, 0.5 + level * 0.74, 1.25], p.paper);
  }
  box(shelf, [0.8, 0.37, 1.1], [0.15, 2.65, -1.1], p.red, true);
  box(shelf, [0.85, 0.03, 1.15], [0.15, 2.85, -1.1], p.paper);
}

function addPlant(room, p, position) {
  const plant = pivot(room, 'ceramic-planter', position);
  mesh(plant, CYLINDER, p.ceramic, [0, 0.3, 0], [0.32, 0.6, 0.32]);
  mesh(plant, CYLINDER, p.wood, [0, 0.607, 0], [0.28, 0.018, 0.28]);
  for (let i = 0; i < 9; i += 1) {
    const angle = i * 2.4;
    const height = 0.9 + (i % 3) * 0.22;
    const tip = [Math.cos(angle) * 0.41, height, Math.sin(angle) * 0.41];
    segment(plant, [0, 0.5, 0], tip, 0.018, p.leaf);
    const leaf = ball(plant, [0.14, 0.39, 0.065], tip, p.leaf);
    leaf.rotation.set(Math.sin(angle) * 0.8, -angle, Math.cos(angle) * -0.8);
  }
}

function addSideTable(room, p) {
  const table = pivot(room, 'sideboard-and-lamp', [11.42, 0, 4.8]);
  box(table, [1.55, 0.12, 3.2], [0, 1.15, 0], p.woodEdge, true);
  box(table, [1.38, 0.85, 2.9], [0, 0.67, 0], p.wood, true);
  for (const z of [-0.75, 0.75]) {
    box(table, [0.04, 0.7, 1.35], [-0.72, 0.68, z], p.woodEdge, true);
    box(table, [0.06, 0.05, 0.35], [-0.76, 0.94, z], p.brass, true);
  }
  for (const x of [-0.55, 0.55]) for (const z of [-1.25, 1.25]) {
    box(table, [0.12, 0.25, 0.12], [x, 0.125, z], p.black);
  }
  mesh(table, CYLINDER, p.brass, [0.03, 1.25, -0.7], [0.29, 0.06, 0.29]);
  mesh(table, CYLINDER, p.brass, [0.03, 1.63, -0.7], [0.035, 0.75, 0.035]);
  mesh(table, new THREE.CylinderGeometry(0.27, 0.43, 0.48, 14, 1, true), p.pillow, [0.03, 2.04, -0.7]);
  for (let i = 0; i < 3; i += 1) {
    const book = box(table, [0.75, 0.08, 0.62], [-0.05, 1.25 + i * 0.08, 0.7], [p.red, p.paper, p.cloth][i]);
    book.rotation.y = i * 0.13;
  }
}

function addWallDetails(room, p) {
  const frame = pivot(room, 'framed-night-landscape', [-5.7, 3.3, -12.43]);
  box(frame, [2.8, 1.37, 0.12], [0, 0, 0], p.woodEdge, true);
  box(frame, [2.57, 1.15, 0.03], [0, 0, 0.08], p.dark);
  for (let i = 0; i < 7; i += 1) {
    const mountain = box(frame, [0.43, 0.43, 0.025], [-1.03 + i * 0.34, -0.32 + (i % 3) * 0.1, 0.105], p.cloth);
    mountain.rotation.z = Math.PI / 4;
  }
  ball(frame, [0.11, 0.11, 0.02], [0.66, 0.25, 0.12], p.paper);
  const clock = pivot(room, 'wall-clock', [-9.8, 3.35, -12.36]);
  const surround = mesh(clock, CYLINDER, p.brass, [0, 0, 0], [0.48, 0.09, 0.48]);
  surround.rotation.x = Math.PI / 2;
  const face = mesh(clock, CYLINDER, p.paper, [0, 0, 0.06], [0.42, 0.018, 0.42]);
  face.rotation.x = Math.PI / 2;
  box(clock, [0.026, 0.3, 0.02], [0, 0.12, 0.08], p.dark);
  const hand = box(clock, [0.24, 0.023, 0.022], [0.09, -0.02, 0.08], p.dark);
  hand.rotation.z = -0.35;
  const outlet = pivot(room, 'power-outlet', [8.25, 0.48, -12.44]);
  box(outlet, [0.24, 0.27, 0.06], [0, 0, 0], p.trim, true);
  for (const x of [-0.045, 0.045]) ball(outlet, [0.016, 0.016, 0.01], [x, 0, 0.04], p.dark, '', true);
  lines(room, [8.25, 0.35, -12.37, 8.25, 0.035, -12.2, 8.25, 0.035, -12.2, 10.5, 0.035, -11.8], 0x0c151b, 1, 'loose-power-cable');
}

function addWeb(room, origin, radius, side) {
  const coordinates = [];
  const tips = [];
  for (let i = 0; i <= 10; i += 1) {
    const angle = (i / 10) * Math.PI / 2;
    const tip = new THREE.Vector3(
      origin.x + Math.cos(angle) * radius * side,
      origin.y - radius * (0.48 + Math.sin(angle * 2) * 0.36),
      origin.z + Math.sin(angle) * radius,
    );
    tips.push(tip);
    coordinates.push(...origin.toArray(), ...tip.toArray());
  }
  for (let ring = 1; ring <= 6; ring += 1) {
    for (let i = 0; i < tips.length - 1; i += 1) {
      const a = origin.clone().lerp(tips[i], ring / 6);
      const b = origin.clone().lerp(tips[i + 1], ring / 6);
      a.y -= 0.035 * Math.sin(i);
      b.y -= 0.035 * Math.sin(i + 1);
      coordinates.push(...a.toArray(), ...b.toArray());
    }
  }
  lines(room, coordinates, 0x9cbdc5, 0.35, 'corner-cobweb');
}

const OUTFITS = {
  hero: { outer: 0x4d5d49, outer2: 0x3a4838, inner: 0x2a3135, trousers: 0x2e3945, boots: 0x1b1d20, belt: 0x1a1c1d,
    accent: 0xe38e45, hair: 0x2a2220, skin: 0xc79273, glove: 0x22262a, scarf: 0x8c4034, cap: 0x23272b },
  medic: { outer: 0xa7c0b4, outer2: 0x8aa89b, inner: 0xe3e6dd, trousers: 0x38444f, boots: 0x20262b, belt: 0x2b3236,
    accent: 0xb84545, hair: 0x4b3022, skin: 0xd2a587, glove: 0xd6d8cf, scarf: 0xcfd6cc, cap: 0xa7c0b4 },
  doctor: { outer: 0xe1e2d7, outer2: 0xc9cbc0, inner: 0x6aa0a8, trousers: 0x4b808a, boots: 0xc7c8bf, belt: 0x4b808a,
    accent: 0x8a2d2d, hair: 0x302f2e, skin: 0xd0b09b, glove: 0x78b2c1, scarf: 0x5f9aa4, cap: 0x5f9aa4 },
  infected: { outer: 0x8fa3ad, outer2: 0x74878f, inner: 0x6c7b80, trousers: 0x59666b, boots: 0x3a4044, belt: 0x4d5559,
    accent: 0x7b2a2a, hair: 0x3a3f3b, skin: 0x9aa795, glove: 0x9aa795, scarf: 0x6c7b80, cap: 0x3a3f3b },
};
const CIVILIAN_TINTS = [
  { outer: 0x7b5a45, outer2: 0x5f4535, trousers: 0x33384a, hair: 0x2d2622, skin: 0xb98563, scarf: 0xb98a4a },
  { outer: 0x56627a, outer2: 0x434d62, trousers: 0x2f343b, hair: 0x6b5440, skin: 0xd0a183, scarf: 0xd4d0c2 },
  { outer: 0x7a4b4b, outer2: 0x5e3939, trousers: 0x3d3a34, hair: 0x1f1c1b, skin: 0x8a5f48, scarf: 0x4d6b5d },
  { outer: 0x5f6e54, outer2: 0x4a563f, trousers: 0x3a3f4a, hair: 0x8b7d6c, skin: 0xc79b7b, scarf: 0xa75b3e },
];

function humanPalette(variant = 'hero', tint = 0) {
  const key = `${variant}:${variant === 'civilian' ? tint % CIVILIAN_TINTS.length : 0}`;
  if (!palettes.has(key)) {
    const base = variant === 'civilian'
      ? { ...OUTFITS.hero, ...CIVILIAN_TINTS[tint % CIVILIAN_TINTS.length], accent: 0xc9b46a, boots: 0x25211f, belt: 0x1c1b1a, glove: 0x2c2a29, cap: 0x2f3239 }
      : OUTFITS[variant] || OUTFITS.hero;
    const sick = variant === 'infected';
    const skin = new THREE.Color(base.skin);
    palettes.set(key, {
      outer: material(base.outer, 0.88), outer2: material(base.outer2, 0.9), inner: material(base.inner, 0.9),
      trousers: material(base.trousers, 0.9), boots: material(base.boots, 0.7), belt: material(base.belt, 0.6),
      accent: material(base.accent, 0.7), hair: material(base.hair, 0.92), glove: material(base.glove, 0.8),
      scarf: material(base.scarf, 0.95), cap: material(base.cap, 0.95),
      skin: material(base.skin, sick ? 0.82 : 0.68), skinShade: material(skin.clone().multiplyScalar(0.78).getHex(), 0.85),
      lip: material(skin.clone().lerp(new THREE.Color(sick ? 0x4a3a40 : 0x8c4f4a), 0.55).getHex(), 0.8),
      vein: material(0x4b5d63, 0.9), stain: material(0x5e2f2c, 0.95), socket: material(0x22282b, 0.9),
      milk: material(0xcfd4c2, 0.5, 0, { emissive: 0x7f8f84, emissiveIntensity: 0.25 }),
      steel: material(0x374952, 0.35, 0.62), gun: material(0x17242c, 0.48, 0.35),
      woodEdge: material(0x654b36, 0.58), strap: material(0x1a292c, 0.9), seam: material(0x718078, 0.95),
      lens: material(0xe2e6cd, 0.22, 0.15, { emissive: 0xaedbe3, emissiveIntensity: 0.7 }),
      glass: material(0xbfe3ea, 0.15, 0.1, { transparent: true, opacity: 0.35 }),
      eye: material(0x182934, 0.4), eyeWhite: material(0xd5d7c9, 0.48),
      steth: material(0x1b2224, 0.5, 0.3), white: material(0xe6e8de, 0.8),
    });
  }
  return palettes.get(key);
}

/** Smooth tapered tube (wide at a, narrower at b): continuous limbs without the bead look of stacked ellipsoids. */
function limb(parent, a, b, radius, surface) {
  const object = mesh(parent, LIMB, surface);
  placeSegment(object, new THREE.Vector3(...a), new THREE.Vector3(...b), radius);
  return object;
}
const BONE_A = new THREE.Vector3();
const BONE_B = new THREE.Vector3();
/** Tapered ellipsoid between two points: overlapping bones read as smooth anatomy instead of cylinders. */
function bone(parent, a, b, radius, surface, stretch = 1.1, depth = 1) {
  const object = mesh(parent, SPHERE, surface);
  BONE_A.set(...a); BONE_B.set(...b); DELTA.subVectors(BONE_B, BONE_A);
  const length = Math.max(DELTA.length(), 0.00001);
  object.position.copy(BONE_A).add(BONE_B).multiplyScalar(0.5);
  object.scale.set(radius, length / 2 * stretch, radius * depth);
  object.quaternion.setFromUnitVectors(UP, DELTA.multiplyScalar(1 / length));
  return object;
}

/**
 * A 1.85 m person facing +Z with boots on y=0 and jointed, equal-length arms.
 * variant: hero | medic | doctor | infected | civilian. All variants share one skeleton.
 * Limbs are long tapered ellipsoids with small joints, so silhouettes read as people rather than blocks.
 */
export function createHuman(options = {}) {
  const variant = options.variant || 'hero';
  const human = new THREE.Group();
  human.name = 'human-survivor';
  human.userData.variant = variant;
  const rig = pivot(human, 'human-rig');
  const body = pivot(rig, 'human-upper-body');
  const p = humanPalette(variant, options.tint | 0);
  const hero = variant === 'hero', medic = variant === 'medic', doctor = variant === 'doctor';
  const infected = variant === 'infected', civilian = variant === 'civilian';
  const longCoat = doctor;
  // Women (Nina) get a narrower frame: sloping shoulders, a cinched waist, wider hips, slimmer limbs, longer hair.
  const female = medic;
  const frame = female ? { shoulder: 0.235, torso: [0.42, 0.5, 0.265], hem: [0.5, 0.15, 0.285], hips: [0.225, 0.095, 0.15], arm: [0.05, 0.039], leg: [0.09, 0.062] }
    : { shoulder: 0.285, torso: [0.52, 0.5, 0.3], hem: [0.47, 0.14, 0.3], hips: [0.2, 0.09, 0.14], arm: [0.062, 0.048], leg: [0.098, 0.07] };
  if (female) human.scale.setScalar(0.95);
  // Pelvis, belt and hip-length jacket hem.
  ball(body, frame.hips, [0, 0.94, 0], p.trousers);
  box(body, [female ? 0.38 : 0.45, 0.055, female ? 0.23 : 0.27], [0, female ? 1.08 : 1.03, 0], p.belt, true);
  box(body, [0.06, 0.045, 0.02], [0, female ? 1.08 : 1.03, female ? 0.12 : 0.14], p.steel);
  if (!longCoat && !infected) for (const side of [-1, 1]) box(body, [0.085, 0.12, 0.07], [side * (female ? 0.25 : 0.235), 0.97, 0.03], p.strap, true);
  mesh(body, HUMAN_TORSO, p.outer, [0, 1.27, -0.01], frame.torso, 'tailored-jacket');
  box(body, [frame.hem[0], longCoat ? 0.5 : frame.hem[1], frame.hem[2]], [0, longCoat ? 0.8 : female ? 1.0 : 1.045, 0.005], infected ? p.outer2 : p.outer, true);
  if (female) for (const side of [-1, 1]) ball(body, [0.062, 0.058, 0.06], [side * 0.082, 1.34, 0.12], p.outer);
  // Chest, closure and collar.
  box(body, [0.14, 0.11, 0.025], [0, 1.44, 0.155], p.inner, true);
  box(body, [0.016, 0.38, 0.02], [0, 1.26, 0.163], infected ? p.seam : p.steel);
  for (const side of [-1, 1]) {
    box(body, [0.105, 0.085, 0.03], [side * 0.12, 1.3, 0.165], p.outer2, true);
    box(body, [0.1, 0.018, 0.034], [side * 0.12, 1.34, 0.17], p.seam, true);
    const collar = box(body, [0.14, 0.07, 0.13], [side * 0.09, 1.5, 0.04], infected ? p.inner : p.outer, true);
    collar.rotation.z = side * 0.36; collar.rotation.x = -0.28;
    box(body, [0.035, 0.32, 0.018], [side * 0.18, 1.26, -0.165], p.seam, true);
  }
  mesh(body, CYLINDER, p.skin, [0, 1.565, 0.005], female ? [0.042, 0.13, 0.042] : [0.052, 0.13, 0.052]);
  if (hero || civilian) {
    const scarf = mesh(body, TORUS, p.scarf, [0, 1.52, 0.01], [0.095, 0.095, 0.12]);
    scarf.rotation.x = Math.PI / 2;
    box(body, [0.085, 0.26, 0.04], [-0.06, 1.37, 0.165], p.scarf, true).rotation.z = 0.08;
  }
  if (hero) {
    // Tactical rig: chest webbing, pack, patch.
    box(body, [0.38, 0.26, 0.055], [0, 1.2, 0.165], p.strap, true);
    for (const x of [-0.11, 0, 0.11]) box(body, [0.08, 0.13, 0.05], [x, 1.15, 0.2], p.outer2, true);
    box(body, [0.13, 0.045, 0.012], [0.06, 1.4, 0.2], p.accent);
    for (const side of [-1, 1]) box(body, [0.04, 0.38, 0.03], [side * 0.16, 1.31, 0.15], p.strap, true);
    box(body, [0.3, 0.4, 0.17], [0, 1.25, -0.25], p.strap, true);
    box(body, [0.26, 0.18, 0.09], [0, 1.17, -0.36], p.outer2, true);
    const roll = mesh(body, CYLINDER, p.accent, [0, 1.5, -0.25], [0.07, 0.3, 0.07]);
    roll.rotation.z = Math.PI / 2;
  } else if (doctor) {
    for (const side of [-1, 1]) { const lapel = box(body, [0.075, 0.28, 0.025], [side * 0.085, 1.33, 0.165], p.outer2, true); lapel.rotation.z = side * -0.2; }
    const steth = mesh(body, TORUS, p.steth, [0, 1.47, 0.035], [0.095, 0.13, 0.085]); steth.rotation.x = Math.PI / 2.4;
    ball(body, [0.028, 0.028, 0.018], [0.045, 1.22, 0.18], p.steel);
    for (const x of [0.1, 0.122, 0.144]) box(body, [0.01, 0.06, 0.01], [x, 1.37, 0.18], x > 0.12 ? p.accent : p.eye);
    box(body, [0.22, 0.17, 0.05], [0, 1.28, -0.17], p.outer, true);
  } else if (medic) {
    box(body, [0.065, 0.02, 0.018], [-0.12, 1.33, 0.18], p.accent);
    box(body, [0.02, 0.065, 0.019], [-0.12, 1.33, 0.18], p.accent);
    box(body, [0.045, 0.46, 0.035], [0.07, 1.26, 0.165], p.strap, true).rotation.z = -0.5;
    box(body, [0.22, 0.17, 0.085], [-0.18, 0.93, 0.0], p.strap, true);
    box(body, [0.26, 0.26, 0.1], [0, 1.25, -0.21], p.outer2, true);
  } else if (infected) {
    box(body, [0.15, 0.19, 0.02], [0.08, 1.3, 0.18], p.stain, true).rotation.z = 0.3;
    box(body, [0.085, 0.085, 0.02], [-0.12, 1.12, 0.17], p.stain, true);
    box(body, [0.33, 0.025, 0.02], [0, 1.14, 0.175], p.skinShade, true);
  } else {
    box(body, [0.26, 0.26, 0.12], [0, 1.24, -0.23], p.outer2, true);
  }
  // Head: skull, jaw, features, ears, hair and headwear.
  const head = pivot(body, 'human-head', [0, 1.69, 0.01]);
  ball(head, female ? [0.09, 0.117, 0.1] : [0.098, 0.122, 0.108], [0, 0.012, 0], p.skin);
  ball(head, female ? [0.064, 0.06, 0.074] : [0.076, 0.066, 0.082], [0, -0.07, 0.028], p.skin);
  ball(head, female ? [0.038, 0.036, 0.044] : [0.05, 0.04, 0.052], [0, -0.108, 0.058], p.skin);
  for (const side of [-1, 1]) {
    // (no separate cheek balls: they read as jowls up close; the skull and jaw carry the face)
    ball(head, [0.014, 0.03, 0.022], [side * 0.099, -0.005, 0.0], p.skinShade);
    const socket = ball(head, [0.0205, 0.0128, 0.009], [side * 0.04, 0.026, 0.096], infected ? p.socket : p.eyeWhite, '', true);
    if (infected) ball(head, [0.008, 0.008, 0.006], [side * 0.04, 0.025, 0.102], p.milk, '', true);
    else {
      ball(head, [0.0108, 0.0108, 0.007], [side * 0.04, 0.026, 0.1035], p.eye, '', true);
      ball(head, [0.0032, 0.0032, 0.003], [side * 0.04 + 0.004, 0.031, 0.1095], p.white, '', true);   // catch-light: the eye reads as alive
      box(head, female ? [0.04, 0.006, 0.012] : [0.046, 0.009, 0.014], [side * 0.04, female ? 0.056 : 0.05, 0.098], p.hair, true).rotation.z = side * (female ? -0.2 : -0.1);
      if (female) {
        // Lashes: a dark lid line above each eye, with a small flick at the outer corner.
        box(head, [0.044, 0.007, 0.012], [side * 0.04, 0.038, 0.101], p.eye, true);
        box(head, [0.012, 0.006, 0.01], [side * 0.064, 0.036, 0.097], p.eye, true).rotation.z = side * -0.5;
      }
    }
    socket.scale.z = 0.009;
  }
  ball(head, [0.012, 0.028, 0.02], [0, 0.0, 0.104], p.skin);
  ball(head, [0.016, 0.013, 0.016], [0, -0.026, 0.112], p.skin);
  if (female) {
    box(head, [0.04, 0.006, 0.007], [0, -0.062, 0.101], p.lip, true);
    box(head, [0.034, 0.007, 0.007], [0, -0.071, 0.099], p.lip, true);
  } else {
    box(head, [0.05, 0.008, 0.01], [0, -0.062, 0.1], p.lip, true);
    box(head, [0.04, 0.009, 0.01], [0, -0.073, 0.097], p.skinShade, true);
  }
  if (infected) {
    ball(head, [0.026, 0.014, 0.008], [0, -0.068, 0.101], p.socket, '', true);
    for (const side of [-1, 1]) {
      bone(head, [side * 0.055, 0.05, 0.092], [side * 0.025, -0.03, 0.105], 0.0032, p.vein);
      bone(head, [side * 0.08, -0.015, 0.07], [side * 0.065, -0.075, 0.078], 0.0032, p.vein);
    }
    ball(head, [0.08, 0.04, 0.08], [0.008, 0.095, -0.015], p.hair);
    ball(head, [0.03, 0.022, 0.04], [-0.056, 0.09, 0.03], p.hair);
  } else if (doctor) {
    ball(head, [0.104, 0.082, 0.114], [0, 0.065, -0.005], p.cap);
    box(head, [0.2, 0.09, 0.05], [0, -0.06, 0.082], p.white, true);
    for (const side of [-1, 1]) {
      const ring = mesh(head, TORUS, p.steel, [side * 0.04, 0.028, 0.108], [0.028, 0.028, 0.028]);
      ring.scale.z = 0.01;
      ring.scale.set(0.03, 0.03, 0.012);
      ball(head, [0.028, 0.026, 0.004], [side * 0.04, 0.028, 0.108], p.glass, '', true);
    }
    box(head, [0.02, 0.007, 0.007], [0, 0.03, 0.11], p.steel);
  } else {
    const dark = hero || civilian;
    ball(head, [0.104, 0.084, 0.118], [0, 0.065, -0.012], p.hair);
    if (hero) {
      ball(head, [0.108, 0.08, 0.12], [0, 0.085, -0.004], p.cap);
      box(head, [0.21, 0.03, 0.04], [0, 0.045, 0.1], p.cap, true);
    } else {
      if (female) {
        // Side-swept fringe hugging the forehead instead of a flat brim.
        ball(head, [0.1, 0.03, 0.05], [0.012, 0.085, 0.06], p.hair);
        ball(head, [0.04, 0.045, 0.04], [-0.062, 0.06, 0.07], p.hair);
      } else box(head, [0.16, 0.03, 0.025], [0, 0.07, 0.1], p.hair, true).rotation.x = 0.35;
      if (medic) {
        // Fuller hair: a high crown, curtains over the ears, a hair mass at the back and a long ponytail.
        ball(head, [0.108, 0.1, 0.12], [0, 0.05, -0.02], p.hair);
        ball(head, [0.1, 0.13, 0.07], [0, -0.06, -0.085], p.hair);
        for (const side of [-1, 1]) {
          bone(head, [side * 0.088, 0.05, 0.03], [side * 0.1, -0.12, -0.02], 0.032, p.hair, 1.05, 1.3);
          bone(head, [side * 0.07, 0.08, 0.075], [side * 0.03, 0.055, 0.103], 0.03, p.hair, 1.1, 0.6);
        }
        bone(head, [0, -0.02, -0.12], [0, -0.26, -0.15], 0.045, p.hair, 1.05);
        bone(head, [0, -0.24, -0.15], [0, -0.42, -0.14], 0.036, p.hair, 1.05);
        box(head, [0.03, 0.025, 0.03], [0, -0.04, -0.13], p.accent, true);
      } else if (dark && options.tint % 2 === 1) {
        ball(head, [0.11, 0.1, 0.04], [0, -0.05, -0.1], p.hair);
      }
    }
    if (hero || civilian) box(head, [0.08, 0.025, 0.016], [0, -0.095, 0.08], p.skinShade, true);
  }
  const legs = [-1, 1].map((side) => {
    const leg = pivot(rig, `human-leg-${side < 0 ? 'left' : 'right'}`, [side * (female ? 0.125 : 0.135), 0.86, 0]);
    const bareLeg = infected && side < 0;
    limb(leg, [0, 0.03, 0], [0, -0.38, 0], frame.leg[0], p.trousers);
    box(leg, [0.04, 0.15, 0.1], [side * 0.088, -0.14, 0.01], p.outer2, true);
    const knee = pivot(leg, 'knee', [0, -0.38, 0]);
    ball(knee, [0.07, 0.07, 0.072], [0, 0, 0.004], bareLeg ? p.skin : p.trousers, '', true);
    limb(knee, [0, -0.01, 0], [0, -0.34, 0], frame.leg[1], bareLeg ? p.skin : p.trousers);
    if (!infected) box(knee, [0.1, 0.11, 0.04], [0, -0.005, 0.07], p.strap, true);
    // Boot: same height as the gait solver expects, with a narrower footprint, shaft, sole and laces.
    box(knee, [0.165, 0.2, 0.345], [0, -0.38, 0.065], p.boots, true);
    bone(knee, [0, -0.26, 0], [0, -0.38, 0], 0.08, p.boots, 1.2);
    box(knee, [0.172, 0.03, 0.35], [0, -0.465, 0.065], p.strap, true);
    box(knee, [0.08, 0.01, 0.13], [0, -0.3, 0.15], p.seam, true);
    for (let i = 0; i < 3; i++) box(knee, [0.08, 0.01, 0.012], [0, -0.285 - i * 0.022, 0.158 + i * 0.01], p.steel, true);
    return { root: leg, knee, side };
  });
  const arms = [-1, 1].map((side) => {
    const arm = pivot(body, `human-arm-${side < 0 ? 'left' : 'right'}`, [side * frame.shoulder, female ? 1.385 : 1.39, 0]);
    ball(arm, female ? [0.06, 0.063, 0.063] : [0.072, 0.075, 0.075], [0, -0.005, 0], p.outer);
    limb(arm, [0, 0, 0], [0, -0.3, 0], frame.arm[0], p.outer);
    const elbow = pivot(arm, 'elbow', [0, -0.29, 0]);
    const bareArm = infected;
    ball(elbow, [0.045, 0.045, 0.045], [0, 0, 0], bareArm ? p.skin : p.outer);
    limb(elbow, [0, 0, 0], [0, -0.26, 0], frame.arm[1], bareArm ? p.skin : p.outer);
    box(elbow, [0.088, 0.04, 0.088], [0, -0.215, 0], p.outer2, true);
    return { root: arm, elbow, side };
  });
  addHandsAndLimbDetail({ body, arms, legs }, p, variant);
  addWeapon(body, p);
  human.traverse((node) => { if (node.isGroup) batchRigidDetails(node); });
  human.userData.modelRig = { kind: 'human', body, head, legs, arms, gun: body.getObjectByName('visible-carbine') };
  animateHuman(human, 0, false);
  return human;
}

function addHandsAndLimbDetail({ arms }, p, variant) {
  const gloved = variant === 'hero' || variant === 'doctor' || variant === 'medic';
  const hand = gloved ? p.glove : p.skin;
  for (const { root, elbow, side } of arms) {
    box(root, [0.09, 0.07, 0.02], [0, -0.13, -0.052], side < 0 ? (variant === 'hero' ? p.accent : p.outer2) : p.strap, true);
    ball(elbow, [0.044, 0.05, 0.056], [0, -0.275, 0.004], hand);
    for (let finger = 0; finger < 4; finger++) {
      const x = -0.027 + finger * 0.018;
      bone(elbow, [x, -0.292, 0.036], [x, -0.322, 0.062], 0.0085, hand, 1.2);
    }
    ball(elbow, [0.017, 0.026, 0.03], [side * 0.04, -0.272, 0.016], hand);
  }
}

function batchRigidDetails(parent) {
  const groups = new Map();
  for (const node of [...parent.children]) {
    if (!node.isMesh || node.name || node.isInstancedMesh) continue;
    const key = `${node.geometry.uuid}:${node.material.uuid}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(node);
  }
  for (const nodes of groups.values()) {
    if (nodes.length < 3) continue;
    const batch = new THREE.InstancedMesh(nodes[0].geometry, nodes[0].material, nodes.length);
    batch.name = 'rigid-human-details'; batch.castShadow = true; batch.receiveShadow = true;
    nodes.forEach((node, i) => { node.updateMatrix(); batch.setMatrixAt(i, node.matrix); parent.remove(node); });
    batch.instanceMatrix.needsUpdate = true; batch.computeBoundingSphere(); parent.add(batch);
  }
}

function addWeapon(body, p) {
  const gun = pivot(body, 'visible-carbine', [0.085, 1.08, -0.03]);
  box(gun, [0.22, 0.16, 0.54], [0, 0, 0.21], p.gun, true);
  box(gun, [0.19, 0.12, 0.31], [0, 0.025, -0.24], p.woodEdge, true);
  box(gun, [0.13, 0.07, 0.18], [0, 0.13, 0.14], p.steel, true);
  box(gun, [0.1, 0.15, 0.15], [0, -0.15, 0.13], p.gun, true);
  box(gun, [0.12, 0.28, 0.1], [0, -0.2, -0.14], p.gun, true);
  box(gun, [0.15, 0.13, 0.52], [0, -0.03, 0.65], p.steel, true);
  segment(gun, [0, -0.012, 0.75], [0, -0.012, 1.33], 0.052, p.gun);
  segment(gun, [0, -0.012, 1.28], [0, -0.012, 1.39], 0.075, p.steel);
  const muzzle = pivot(gun, 'weapon-muzzle', [0, -0.012, 1.4]);
  pivot(muzzle, 'muzzle');
  const flashlight = pivot(gun, 'flashlight-mount', [-0.16, -0.07, 0.77]);
  segment(flashlight, [0, 0, -0.14], [0, 0, 0.2], 0.083, p.gun);
  mesh(flashlight, CYLINDER, p.steel, [0, 0, 0.19], [0.107, 0.05, 0.107]).rotation.x = Math.PI / 2;
  ball(flashlight, [0.065, 0.065, 0.012], [0, 0, 0.226], p.lens);
  pivot(flashlight, 'flashlight', [0, 0, 0.23]);
}

function poseHumanArm({ root, elbow, side }, x, y, z) {
  const upperLength = 0.29, lowerLength = 0.27;
  ARM_TARGET.set(x, y, z).sub(root.position);
  const distance = THREE.MathUtils.clamp(ARM_TARGET.length(), 0.05, upperLength + lowerLength - 0.001);
  ARM_DIRECTION.copy(ARM_TARGET).normalize();
  // Keep the elbow on the outer side of the ribcage while reaching the grip.
  ARM_POLE.set(side, -0.45, -0.12).addScaledVector(ARM_DIRECTION,
    -ARM_POLE.dot(ARM_DIRECTION)).normalize();
  const along = (upperLength * upperLength - lowerLength * lowerLength + distance * distance) / (2 * distance);
  const bend = Math.sqrt(Math.max(0, upperLength * upperLength - along * along));
  ARM_ELBOW.copy(ARM_DIRECTION).multiplyScalar(along).addScaledVector(ARM_POLE, bend);
  root.quaternion.setFromUnitVectors(ARM_DOWN, ARM_LOWER.copy(ARM_ELBOW).normalize());
  ARM_INVERSE.copy(root.quaternion).invert();
  ARM_LOWER.copy(ARM_DIRECTION).multiplyScalar(distance).sub(ARM_ELBOW)
    .applyQuaternion(ARM_INVERSE).normalize();
  elbow.quaternion.setFromUnitVectors(ARM_DOWN, ARM_LOWER);
}

const smoothstep = (x) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
/**
 * Procedural gait, idle breathing and combat reactions. options: recoil (0..1 shot kick),
 * hurt (0..1 flinch), dash (0..1 lunge), relaxed (swinging arms instead of a two-handed grip).
 */
export function animateHuman(group, time, moving, options = {}) {
  const rig = group?.userData?.modelRig;
  if (rig?.kind !== 'human') return;
  time = Number.isFinite(time) ? time : 0;
  const recoil = options.recoil || 0, hurt = options.hurt || 0, dash = options.dash || 0;
  const gait = Math.max(moving ? 1 : 0, dash);
  const stride = 1 + dash * 0.55;
  const cycle = time * (dash > 0 ? 13 : 9.5);
  const idle = 1 - gait;
  // Body: bob twice per stride, counter-rotating shoulders, forward lean and breathing.
  rig.body.position.y = -Math.abs(Math.sin(cycle)) * 0.03 * gait + Math.sin(time * 1.9) * 0.004 * idle;
  rig.body.rotation.z = Math.sin(cycle) * 0.04 * gait + Math.sin(time * 0.6) * 0.012 * idle + hurt * Math.sin(hurt * 18) * 0.05;
  rig.body.rotation.y = Math.sin(cycle) * 0.11 * gait + Math.sin(time * 0.45) * 0.02 * idle;
  rig.body.rotation.x = 0.045 * gait + dash * 0.38 + Math.sin(time * 1.8) * 0.008 * idle - recoil * 0.05 - hurt * 0.26;
  // Every few seconds a stationary survivor glances around and shifts weight.
  const glance = Math.pow(Math.max(0, Math.sin(time * 0.43)), 6) * idle;
  rig.body.rotation.z += Math.sin(time * 0.9) * glance * 0.03;
  rig.head.rotation.y = -rig.body.rotation.y * 0.7 + Math.sin(time * 0.8) * 0.06 * idle + Math.sin(time * 2.1) * glance * 0.55;
  rig.head.rotation.x = -rig.body.rotation.x * 0.55 - hurt * 0.2 + Math.sin(time * 1.1) * 0.012 * idle;
  rig.head.rotation.z = -rig.body.rotation.z * 0.6;
  rig.legs.forEach(({ root, knee, side }) => {
    const phase = cycle + (side < 0 ? 0 : Math.PI);
    const swing = Math.sin(phase);
    const forward = Math.cos(phase);
    root.rotation.x = swing * 0.46 * stride * gait;
    root.rotation.z = side * 0.02 * gait;
    knee.rotation.x = (Math.max(0, forward) * 0.62 + Math.max(0, -forward) * 0.1) * stride * gait;
    const angle = root.rotation.x + knee.rotation.x;
    const lowestSole = 0.86 - 0.38 * Math.cos(root.rotation.x)
      - 0.46 * Math.cos(angle) - 0.085 * Math.sin(angle)
      - 0.02 * Math.abs(Math.cos(angle)) - 0.2 * Math.abs(Math.sin(angle));
    root.position.y = 0.86 + Math.max(0, -lowestSole);
  });
  const gun = rig.gun;
  if (options.relaxed) {
    rig.arms.forEach(({ root, elbow, side }) => {
      const phase = cycle + (side < 0 ? 0 : Math.PI);
      const swing = -Math.sin(phase) * 0.55 * stride * gait;
      root.rotation.set(swing + Math.sin(time * 1.3 + side) * 0.02 * idle, 0, side * (0.08 + 0.03 * gait));
      elbow.rotation.set(-0.18 - Math.max(0, swing) * 0.7 - hurt * 0.4, 0, 0);
    });
    if (gun) { gun.position.set(0.085, 1.08, -0.03); gun.rotation.set(0, 0, 0); }
    return;
  }
  // The gun and shoulders share body motion; solve only the two rigid arm
  // bones so palms stay on the receiver and foregrip throughout the gait.
  // viewmodel: in first person the carbine and both hands ride higher and closer, so they sit in the lower view.
  const vm = options.viewmodel ? 1 : 0, vx = 0.09 * vm, vy = 0.15 * vm, vz = 0.17 * vm;
  if (gun) { gun.position.set(0.085 + vx, 1.08 + vy, -0.03 - recoil * 0.09 + vz); gun.rotation.set(-recoil * 0.13, 0, 0); }
  rig.arms.forEach((arm) => {
    poseHumanArm(arm, (arm.side < 0 ? 0 : 0.085) + vx,
      (arm.side < 0 ? 1.04 + recoil * 0.015 : 0.98 + recoil * 0.015) + vy,
      (arm.side < 0 ? 0.31 : 0.1) - recoil * 0.09 + vz);
  });
}

const spiderStyles = {
  normal: { size: 1, abdomen: 1, legs: 1, height: 1, red: 0xe23a40, shell: 0x15191e },
  runner: { size: 0.82, abdomen: 0.73, legs: 1.06, height: 0.72, red: 0xff583c, shell: 0x22272d },
  tank: { size: 1.46, abdomen: 1.25, legs: 0.95, height: 1.16, red: 0xc62436, shell: 0x14171b },
  boss: { size: 2, abdomen: 1.22, legs: 1, height: 1.18, red: 0xf73749, shell: 0x0d1219 },
};
function spiderPalette(variant) {
  if (!palettes.has(variant)) {
    const style = spiderStyles[variant];
    palettes.set(variant, {
      shell: material(style.shell, 0.18, 0.18),
      abdomen: new THREE.MeshPhysicalMaterial({ color: style.shell, roughness: 0.22,
        metalness: 0.22, clearcoat: 1, clearcoatRoughness: 0.18 }),
      joints: material(0x302b30, 0.3, 0.1),
      red: material(style.red, 0.27, 0.06, { emissive: style.red, emissiveIntensity: 0.22, side: THREE.DoubleSide }),
      highlights: material(0x765e65, 0.3, 0.22),
      eyes: material(0xd25b59, 0.2, 0, { emissive: 0x882521, emissiveIntensity: 0.35 }),
      fang: material(0xb4a99a, 0.32),
    });
  }
  return palettes.get(variant);
}

function abdomenMarking(variant) {
  if (markingGeometries.has(variant)) return markingGeometries.get(variant);
  const style = spiderStyles[variant];
  const outline = [
    [-0.1, -0.255], [0.1, -0.255], [0.07, -0.17], [0.024, -0.095],
    [0.105, 0.08], [-0.105, 0.08], [-0.024, -0.095], [-0.07, -0.17],
  ].map(([x, z]) => new THREE.Vector2(x * style.abdomen, z * style.abdomen));
  const triangles = THREE.ShapeUtils.triangulateShape(outline, []);
  const positions = [];
  const point = new THREE.Vector2();
  function vertex(a, b, c, i, j) {
    point.copy(a).addScaledVector(b.clone().sub(a), i / 5)
      .addScaledVector(c.clone().sub(a), j / 5);
    const nx = point.x / (0.28 * style.abdomen);
    const nz = (point.y + 0.065) / (0.32 * style.abdomen);
    positions.push(point.x, 0.215 * style.height * Math.sqrt(Math.max(0, 1 - nx * nx - nz * nz)) + 0.006, point.y);
  }
  for (const [a, b, c] of triangles) {
    for (let i = 0; i < 5; i += 1) for (let j = 0; j < 5 - i; j += 1) {
      vertex(outline[a], outline[b], outline[c], i, j);
      vertex(outline[a], outline[b], outline[c], i + 1, j);
      vertex(outline[a], outline[b], outline[c], i, j + 1);
      if (i + j < 4) {
        vertex(outline[a], outline[b], outline[c], i + 1, j);
        vertex(outline[a], outline[b], outline[c], i + 1, j + 1);
        vertex(outline[a], outline[b], outline[c], i, j + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  markingGeometries.set(variant, geometry);
  return geometry;
}

/** Eight independent three-segment legs; abdominal markings sit on top of the shell. */
export function createSpider(variant = 'normal') {
  if (!Object.hasOwn(spiderStyles, variant)) variant = 'normal';
  const style = spiderStyles[variant];
  const p = spiderPalette(variant);
  const spider = new THREE.Group();
  spider.name = `kara-${variant}`;
  spider.scale.setScalar(style.size);
  const rig = pivot(spider, 'spider-rig');
  // Leg sweep is wider than the abdomen, while the root scale stays fixed for view.
  rig.scale.setScalar(0.61);
  const body = pivot(rig, 'spider-body');
  body.position.y = 0.22 * style.height;
  const abdomen = pivot(body, 'spider-abdomen', [0, 0.035, -0.23]);
  ball(abdomen, [0.28 * style.abdomen, 0.215 * style.height, 0.32 * style.abdomen], [0, 0, -0.065], p.abdomen);
  const thorax = ball(body, [0.19, 0.155, 0.21], [0, -0.01, 0.155], p.shell);
  thorax.rotation.x = -0.13;
  ball(body, [0.13, 0.105, 0.12], [0, -0.05, 0.35], p.shell);
  // A curved, raised red hourglass is readable from the high camera, unlike a ventral decal.
  const marking = mesh(abdomen, abdomenMarking(variant), p.red, undefined, undefined, 'red-hourglass');
  marking.castShadow = false;
  for (const sign of [-1, 1]) {
    for (const z of [-0.2, -0.02, 0.13]) {
      const x = sign * 0.19 * style.abdomen;
      const nz = (z + 0.065) / (0.32 * style.abdomen);
      const y = 0.215 * style.height * Math.sqrt(Math.max(0.04, 1 - (x / (0.28 * style.abdomen)) ** 2 - nz * nz));
      ball(abdomen, [0.038 * style.abdomen, 0.018, 0.045 * style.abdomen], [x, y + 0.005, z], p.red);
    }
  }
  for (const side of [-1, 1]) {
    for (let row = 0; row < 2; row += 1) {
      ball(body, [0.034, 0.031, 0.027], [side * (0.064 + row * 0.057), 0.019 - row * 0.034, 0.44 - row * 0.035], p.eyes);
    }
    segment(body, [side * 0.08, -0.06, 0.41], [side * 0.105, -0.17, 0.49], 0.032, p.fang, true);
    // Palps are smaller than walking legs and intentionally do not count as legs.
    segment(body, [side * 0.13, -0.07, 0.35], [side * 0.15, -0.15, 0.46], 0.033, p.shell);
  }
  if (variant === 'tank' || variant === 'boss') {
    for (let i = 0; i < 4; i += 1) {
      const z = -0.23 + i * 0.1;
      for (const side of [-1, 1]) {
        const plate = box(abdomen, [0.095 * style.abdomen, 0.07, 0.078],
          [side * 0.23 * style.abdomen, 0.085 * style.height, z], p.joints, true);
        plate.rotation.z = side * 0.37;
      }
    }
    for (const side of [-1, 1]) {
      ball(body, [0.07, 0.074, 0.11], [side * 0.17, 0.065, 0.22], p.highlights);
    }
  }
  if (variant === 'boss') {
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i += 1) {
        const x = side * (0.13 + i * 0.05);
        const z = -0.22 + i * 0.16;
        segment(abdomen, [x, 0.14, z], [x * 1.25, 0.36 + i * 0.045, z - 0.09], 0.046, p.red, true);
      }
    }
  }
  const legs = [];
  const stride = [0.46, 0.2, -0.1, -0.38];
  const footX = [0.49, 0.71, 0.72, 0.55];
  for (const side of [-1, 1]) {
    for (let index = 0; index < 4; index += 1) {
      const leg = pivot(rig, `leg-${side < 0 ? 'L' : 'R'}${index + 1}`, [side * 0.17, 0.18 * style.height, stride[index] * 0.5]);
      const s = style.legs;
      const hip = new THREE.Vector3(0, 0, 0);
      const knee = new THREE.Vector3(side * footX[index] * 0.58 * s,
        0.16 * style.height, stride[index] * 0.82 * s);
      const ankle = new THREE.Vector3(side * footX[index] * 0.88 * s,
        -0.08, stride[index] * 1.28 * s);
      const foot = new THREE.Vector3(side * footX[index] * s,
        0.009 - 0.18 * style.height, stride[index] * 1.48 * s);
      const thickness = variant === 'tank' ? 1.6 : variant === 'boss' ? 1.4 : variant === 'runner' ? 0.82 : 1;
      const upperRadius = 0.039 * thickness;
      const lowerRadius = 0.03 * thickness;
      const tarsusRadius = 0.014 * thickness;
      const upper = segment(leg, hip.toArray(), knee.toArray(), upperRadius, p.shell);
      const lower = segment(leg, knee.toArray(), ankle.toArray(), lowerRadius, p.joints);
      const tarsus = segment(leg, ankle.toArray(), foot.toArray(), tarsusRadius, p.shell, true);
      const joint = ball(leg, [0.046 * thickness, 0.046 * thickness, 0.046 * thickness], knee.toArray(), p.red, '', true);
      legs.push({ hip, knee, ankle, foot, upper, lower, tarsus, joint, side, index,
        upperRadius, lowerRadius, tarsusRadius });
    }
  }
  spider.userData.modelRig = { kind: 'spider', body, abdomen, legs, style };
  animateSpider(spider, 0, false);
  return spider;
}

export function animateSpider(group, time, moving) {
  const rig = group?.userData?.modelRig;
  if (rig?.kind !== 'spider') return;
  time = Number.isFinite(time) ? time : 0;
  const intensity = moving ? 1 : 0;
  const cycle = time * (rig.style.height < 0.8 ? 16 : 11);
  rig.body.position.y = (0.22 + Math.sin(cycle * 2) * 0.015 * intensity) * rig.style.height;
  rig.body.rotation.z = Math.sin(cycle) * 0.045 * intensity;
  rig.abdomen.rotation.x = Math.sin(time * 2.5) * 0.025;
  for (const leg of rig.legs) {
    const phase = cycle + (leg.index % 2 ? Math.PI : 0) + (leg.side > 0 ? Math.PI : 0);
    const step = Math.sin(phase) * intensity;
    const lift = Math.max(0, Math.cos(phase)) * intensity;
    KNEE.copy(leg.knee);
    KNEE.y += lift * 0.035;
    KNEE.z += step * 0.035;
    ANKLE.copy(leg.ankle);
    ANKLE.y += lift * 0.06;
    ANKLE.z += step * 0.075;
    FOOT.copy(leg.foot);
    FOOT.y += lift * 0.055;
    FOOT.z += step * 0.1;
    placeSegment(leg.upper, leg.hip, KNEE, leg.upperRadius);
    placeSegment(leg.lower, KNEE, ANKLE, leg.lowerRadius);
    placeSegment(leg.tarsus, ANKLE, FOOT, leg.tarsusRadius);
    leg.joint.position.copy(KNEE);
  }
}

export const SPIDER_DEATH_SECONDS = 1.35;
const LEG_BASE = new THREE.Vector3();
function placeLeg(leg, knee, ankle, foot) {
  placeSegment(leg.upper, leg.hip, knee, leg.upperRadius);
  placeSegment(leg.lower, knee, ankle, leg.lowerRadius);
  placeSegment(leg.tarsus, ankle, foot, leg.tarsusRadius);
  leg.joint.position.copy(knee);
}
/**
 * Death throes: hop, flip onto the back, legs curl over the belly with fading twitches, then the
 * carcass shrinks away. Pass vanish=false to leave a curled corpse. Deterministic from time.
 */
export function animateSpiderDeath(group, time, vanish = true) {
  const rig = group?.userData?.modelRig;
  if (rig?.kind !== 'spider') return;
  const t = Math.min(1, Math.max(0, (Number.isFinite(time) ? time : 0) / SPIDER_DEATH_SECONDS));
  const h = rig.style.height;
  const flip = smoothstep(t / 0.3), curl = smoothstep((t - 0.12) / 0.5);
  const twitchDecay = (1 - smoothstep((t - 0.35) / 0.5)) * smoothstep(t / 0.1);
  const root = rig.body.parent;
  root.rotation.z = Math.PI * flip + Math.sin(t * 40) * 0.025 * twitchDecay;
  root.rotation.x = Math.sin(flip * Math.PI) * 0.22;
  root.position.y = 0.3 * h * flip + Math.sin(flip * Math.PI) * 0.32;
  rig.body.position.y = 0.22 * h;
  rig.body.rotation.set(0, 0, 0);
  rig.abdomen.rotation.x = -0.12 * curl + Math.sin(t * 33) * 0.05 * twitchDecay;
  rig.abdomen.scale.setScalar(1 + Math.sin(t * 26) * 0.03 * twitchDecay);
  for (const leg of rig.legs) {
    const wiggle = Math.sin(t * 46 + leg.index * 1.9 + (leg.side > 0 ? 1.3 : 0)) * 0.06 * twitchDecay;
    const knee = LEG_BASE.copy(leg.knee); knee.x *= 1 - 0.28 * curl; knee.y += 0.05 * curl; knee.z += wiggle;
    const ankle = leg.ankle.clone(); ankle.x *= 1 - 0.62 * curl; ankle.y += 0.13 * curl; ankle.z *= 1 - 0.3 * curl; ankle.z += wiggle;
    const foot = leg.foot.clone(); foot.x *= 1 - 0.84 * curl; foot.y += 0.34 * curl; foot.z *= 1 - 0.55 * curl; foot.z += wiggle * 1.5;
    placeLeg(leg, knee, ankle, foot);
  }
  const shrink = vanish ? 1 - smoothstep((t - 0.82) / 0.18) : 1;
  root.scale.setScalar(Math.max(0.0001, shrink * 0.61));
}
/**
 * Predator strike for devouring scenes, applied after animateSpider: the body rears, the front pair
 * of legs hammers down over the prey (reach 0..1, slam pulses), and the abdomen heaves while chewing.
 */
export function animateSpiderStrike(group, time, reach, chew = 0) {
  const rig = group?.userData?.modelRig;
  if (rig?.kind !== 'spider') return;
  const r = Math.min(1, Math.max(0, reach)), h = rig.style.height;
  const root = rig.body.parent;
  root.rotation.set(-0.3 * r + Math.sin(time * 14) * 0.015 * chew, 0, 0);
  root.position.y = 0.16 * r;
  rig.abdomen.scale.set(1 + Math.sin(time * 17) * 0.05 * chew, 1 + Math.sin(time * 17) * 0.07 * chew, 1 + Math.sin(time * 17 + 1) * 0.05 * chew);
  rig.body.rotation.x = Math.sin(time * 21) * 0.04 * chew;
  for (const leg of rig.legs) {
    if (leg.index > 1) continue;
    const k = leg.index === 0 ? r : r * 0.55;
    if (k <= 0) continue;
    const slam = (Math.sin(time * 9 + leg.side) * 0.5 + 0.5) * k;
    const knee = leg.knee.clone().lerp(new THREE.Vector3(leg.side * 0.32, 0.56 * h, 0.62), k);
    const ankle = leg.ankle.clone().lerp(new THREE.Vector3(leg.side * 0.2, 0.42 * h - slam * 0.1, 1.02), k);
    const foot = leg.foot.clone().lerp(new THREE.Vector3(leg.side * 0.1, -slam * 0.05, 1.22), k);
    placeLeg(leg, knee, ankle, foot);
  }
}
