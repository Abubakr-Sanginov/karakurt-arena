import * as THREE from 'three';
import { createHuman, animateHuman } from './models.js';

const clamp = THREE.MathUtils.clamp;
const smooth = (x) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };
const outcomes = new WeakMap();

// Only rig transforms are animated. World position/yaw remain the view's property.
export function animateHumanOutcome(root, { kind = 'none', time = 0, duration } = {}) {
  const rig = root?.userData?.modelRig;
  if (rig?.kind !== 'human') return;
  let pose = outcomes.get(root);
  if (!pose) {
    const nodes = [root.getObjectByName('human-rig'), rig.body, rig.head,
      ...rig.legs.flatMap(({ root: leg, knee }) => [leg, knee]),
      ...rig.arms.flatMap(({ root: arm, elbow }) => [arm, elbow]),
      root.getObjectByName('visible-carbine')].filter(Boolean);
    pose = { nodes: nodes.map((node) => ({ node, p: node.position.clone(), q: node.quaternion.clone() })),
      pivot: nodes[0] };
    outcomes.set(root, pose);
  }
  for (const { node, p, q } of pose.nodes) { node.position.copy(p); node.quaternion.copy(q); }
  if (kind !== 'death' && kind !== 'victory') return;
  duration = Number.isFinite(duration) && duration > 0 ? duration : kind === 'death' ? 2.4 : 3.2;
  const t = clamp(Number.isFinite(time) ? time / duration : 0, 0, 1);
  if (kind === 'death') {
    // Hit -> stagger back with flung arms -> weapon drops, knees buckle -> topple forward -> last twitches.
    const hit = smooth(t / 0.08) * (1 - smooth((t - 0.08) / 0.16));
    const buckle = smooth((t - 0.07) / 0.2);
    const fall = smooth((t - 0.18) / 0.36);
    const twitch = Math.sin(t * 70) * 0.035 * smooth((t - 0.5) / 0.1) * (1 - smooth((t - 0.62) / 0.25));
    const drop = smooth((t - 0.1) / 0.2);
    pose.pivot.rotation.x = Math.PI * 0.49 * fall - 0.16 * hit;
    pose.pivot.rotation.z = 0.1 * fall + twitch;
    // Buckle, then fall forward toward the attacker; the full silhouette stays
    // across the side-on camera instead of pointing straight into the lens.
    pose.pivot.position.y = -0.1 * buckle + 0.36 * fall;
    rig.body.rotation.x = 0.33 * buckle * (1 - fall * 0.7) - 0.34 * hit;
    rig.head.rotation.x = 0.28 * buckle - 0.3 * hit;
    rig.head.rotation.z = 0.2 * fall;
    rig.legs.forEach(({ root: leg, knee, side }) => {
      leg.rotation.x = -0.45 * buckle + side * 0.18 * fall + 0.3 * hit;
      knee.rotation.x = 0.85 * buckle + twitch * 4;
    });
    rig.arms.forEach(({ root: arm, elbow, side }) => {
      arm.rotation.set(-0.18 * buckle - 0.5 * hit, 0, side * (0.22 * fall + 0.85 * hit));
      elbow.rotation.set(-0.25 - 0.35 * buckle + twitch * 3, 0, 0);
    });
    const weapon = root.getObjectByName('visible-carbine');
    if (weapon) {
      weapon.position.y -= 0.55 * drop;
      weapon.position.z += 0.3 * drop;
      weapon.rotation.x = 0.65 * buckle - 2.35 * fall;
      weapon.rotation.z = 0.5 * drop;
    }
  } else {
    // Relief: the carbine lowers, shoulders drop on an exhale, a fist rises and the head tips to the sky.
    const lift = smooth((t - 0.08) / 0.52);
    const settle = smooth((t - 0.65) / 0.35);
    const breath = Math.sin(t * duration * 1.6) * 0.012 * lift;
    rig.body.rotation.x = -0.065 * lift + breath;
    rig.head.rotation.x = -0.2 * lift + 0.05 * settle;
    rig.head.rotation.y = Math.sin(t * Math.PI * 2) * 0.12 * lift;
    const left = rig.arms.find(({ side }) => side < 0);
    const right = rig.arms.find(({ side }) => side > 0);
    if (left) {
      left.root.rotation.z = -2.35 * lift + 0.12 * settle;
      left.root.rotation.x = -0.25 * lift;
      left.elbow.rotation.y = -0.2 * lift;
      left.elbow.rotation.x = -0.35 * lift + Math.sin(t * duration * 5) * 0.08 * lift * (1 - settle);
    }
    if (right) { right.root.rotation.x = 0.35 * lift; right.elbow.rotation.x = -0.4 * lift; }
    const weapon = root.getObjectByName('visible-carbine');
    if (weapon) { weapon.rotation.x = 0.55 * lift; weapon.position.y -= 0.08 * lift; }
  }
}

function kitFor(map, own) {
  const material = (color, roughness = 0.8, metalness = 0.05, extra = {}) =>
    own(new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra }));
  const glow = (color) => material(color, 0.4, 0.1, { emissive: color, emissiveIntensity: 0.6 });
  const k = { map, own, boxGeometry: own(new THREE.BoxGeometry(1, 1, 1)),
    cylinderGeometry: own(new THREE.CylinderGeometry(1, 1, 1, 16)),
    sphereGeometry: own(new THREE.SphereGeometry(1, 12, 8)) };
  k.p = {
    floor: material(map.palette.floor, 0.88), wall: material(map.palette.wall, 0.92),
    steel: material(0x687a81, 0.42, 0.65), dark: material(0x18252d, 0.75, 0.2),
    cloth: material(map.id === 'night-ward' ? 0x637c89 : 0x697c68, 1),
    linen: material(0xadafa1, 1), rust: material(0x73503b, 0.82, 0.25),
    yellow: material(0xb8a368, 0.85), red: material(0x884b46, 0.9),
    cold: glow(0x6aafb9), warm: glow(0xcda665), green: glow(0x6caa8b),
    trim: material(0x3a4a52, 0.6, 0.2), concrete: material(0x56656b, 0.95),
    glass: material(0x9fd0da, 0.1, 0.1, { transparent: true, opacity: 0.22, depthWrite: false }),
    hazard: material(0xc9a227, 0.7), window: glow(0xf1d58b), skyline: material(0x0f1826, 1),
    moon: material(0xdfe8f3, 0.6, 0, { emissive: 0xb9cde6, emissiveIntensity: 0.9 }),
  };
  k.mesh = (parent, geometry, surface, size, position, name = '') => {
    const mesh = new THREE.Mesh(geometry, surface);
    mesh.scale.set(...size);
    mesh.position.set(...position);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  k.box = (parent, size, position, surface = k.p.steel, name) =>
    k.mesh(parent, k.boxGeometry, surface, size, position, name);
  k.cylinder = (parent, radius, height, position, surface = k.p.steel) =>
    k.mesh(parent, k.cylinderGeometry, surface, [radius, height, radius], position);
  return k;
}

function group(parent, name, x = 0, z = 0, rotation = 0) {
  const node = new THREE.Group();
  node.name = name;
  node.position.set(x, 0, z);
  node.rotation.y = rotation;
  parent.add(node);
  return node;
}

// Convert static descendants to root-local instances, retaining independent GPU buffers.
function batchStatic(root, own) {
  root.updateWorldMatrix(true, true);
  const inverse = root.matrixWorld.clone().invert();
  const batches = new Map();
  root.traverse((node) => {
    if (!node.isMesh || node.isInstancedMesh || Array.isArray(node.material)) return;
    const key = `${node.geometry.uuid}:${node.material.uuid}:${node.castShadow}:${node.receiveShadow}`;
    if (!batches.has(key)) batches.set(key, []);
    batches.get(key).push(node);
  });
  const matrix = new THREE.Matrix4();
  for (const objects of batches.values()) {
    if (objects.length < 2) continue;
    const first = objects[0];
    const batch = own(new THREE.InstancedMesh(first.geometry, first.material, objects.length));
    batch.name = 'batched-scenery';
    batch.castShadow = first.castShadow;
    batch.receiveShadow = first.receiveShadow;
    objects.forEach((object, i) => {
      batch.setMatrixAt(i, matrix.multiplyMatrices(inverse, object.matrixWorld));
      object.removeFromParent();
    });
    batch.instanceMatrix.needsUpdate = true;
    batch.computeBoundingSphere();
    root.add(batch);
  }
}

function buildArchitecture(k, root) {
  const { halfWidth: w, halfDepth: d } = k.map.arena;
  const p = k.p;
  k.box(root, [w * 2 + 1.4, 0.34, d * 2 + 1.4], [0, -0.26, 0], p.dark);
  const nx = Math.ceil(w * 2), nz = Math.ceil(d * 2);
  const floor = k.own(new THREE.InstancedMesh(k.boxGeometry, p.floor, nx * nz));
  floor.name = 'quiet-tiled-floor';
  const tile = new THREE.Object3D();
  const color = new THREE.Color();
  for (let x = 0; x < nx; x += 1) for (let z = 0; z < nz; z += 1) {
    const i = x * nz + z;
    tile.position.set(-w + (x + 0.5) * w * 2 / nx, -0.045, -d + (z + 0.5) * d * 2 / nz);
    tile.scale.set(w * 2 / nx - 0.018, 0.09, d * 2 / nz - 0.018);
    tile.updateMatrix();
    floor.setMatrixAt(i, tile.matrix);
    floor.setColorAt(i, color.setScalar(0.94 + ((i * 17) % 7) * 0.008));
  }
  floor.receiveShadow = true;
  floor.instanceMatrix.needsUpdate = true;
  floor.instanceColor.needsUpdate = true;
  floor.computeBoundingSphere();
  root.add(floor);
  // Perimeter shell: framed openings, two-tone wainscot, pilasters and crown mouldings.
  const id = k.map.id, wallZ = -d - 0.35, wallX = -w - 0.35;
  const doorX = w * 0.46;
  const northOpenings = id === 'night-ward'
    ? [{ a: -w * 0.57 - 1.7, b: -w * 0.57 + 1.7, sill: 1.05, head: 3.05 }, { a: -1.7, b: 1.7, sill: 1.05, head: 3.05 },
      { a: doorX - 1.1, b: doorX + 1.1, sill: 0, head: 3.0 }]
    : id === 'quarantine-corridor' ? [{ a: doorX - 1.1, b: doorX + 1.1, sill: 0, head: 3.0 }]
      : [{ a: doorX - 1.1, b: doorX + 1.1, sill: 0, head: 3.0 }];
  const westOpenings = id === 'night-ward'
    ? [-5.6, 5.6].map((z) => ({ a: z - 1.0, b: z + 1.0, sill: 0, head: 2.6 }))
    : id === 'quarantine-corridor' ? [-9.2, -4.8, -0.4, 4.0, 8.4].map((z) => ({ a: z - 1.5, b: z + 1.5, sill: 0.9, head: 2.9 }))
      : [];
  wallRun(k, root, { axis: 'x', c: wallZ, from: -w - 0.45, to: w + 0.45, t: 0.22, h: 3.7, openings: northOpenings });
  wallRun(k, root, { axis: 'z', c: wallX, from: -d - 0.45, to: d + 0.45, t: 0.22, h: 3.7, openings: westOpenings });
  wallRun(k, root, { axis: 'x', c: wallZ + 0.1, from: -w - 0.3, to: w + 0.3, t: 0.1, h: 1.05, mat: p.trim, openings: northOpenings.filter((o) => o.sill === 0) });
  wallRun(k, root, { axis: 'z', c: wallX + 0.1, from: -d - 0.3, to: d + 0.3, t: 0.1, h: 1.05, mat: p.trim, openings: westOpenings.filter((o) => o.sill === 0) });
  k.box(root, [w * 2 + 1, 0.16, 0.34], [0, 3.62, wallZ + 0.05], p.trim);
  k.box(root, [0.34, 0.16, d * 2 + 1], [wallX + 0.05, 3.62, 0], p.trim);
  for (const side of [-1, 1]) {
    k.box(root, [w * 2 + 0.6, 0.16, 0.14], [0, 0.08, side * (d + 0.18)], p.steel);
    k.box(root, [0.14, 0.16, d * 2 + 0.6], [side * (w + 0.18), 0.08, 0], p.steel);
  }
  for (let x = -w + 1.5; x < w; x += 4.2) {
    if (northOpenings.some((o) => x > o.a - 0.5 && x < o.b + 0.5)) continue;
    k.box(root, [0.5, 3.6, 0.3], [x, 1.8, wallZ + 0.15], p.concrete);
    k.box(root, [0.62, 0.2, 0.4], [x, 3.55, wallZ + 0.15], p.trim);
    k.box(root, [0.62, 0.3, 0.4], [x, 0.15, wallZ + 0.15], p.trim);
  }
  for (let z = -d + 1.5; z < d; z += 4.2) {
    if (westOpenings.some((o) => z > o.a - 0.5 && z < o.b + 0.5)) continue;
    k.box(root, [0.3, 3.6, 0.5], [wallX + 0.15, 1.8, z], p.concrete);
    k.box(root, [0.4, 0.2, 0.62], [wallX + 0.15, 3.55, z], p.trim);
    k.box(root, [0.4, 0.3, 0.62], [wallX + 0.15, 0.15, z], p.trim);
  }
  const door = group(root, 'service-exit', doorX, -d - 0.15);
  k.box(door, [2.5, 0.22, 0.3], [0, 3.05, 0], p.trim);
  for (const side of [-1, 1]) k.box(door, [0.2, 3.0, 0.3], [side * 1.2, 1.5, 0], p.trim);
  k.box(door, [2.2, 2.9, 0.15], [0, 1.45, 0], p.dark);
  k.box(door, [1.88, 2.65, 0.06], [0, 1.34, 0.12], p.steel);
  k.box(door, [0.7, 0.9, 0.04], [0, 1.9, 0.16], p.glass);
  k.box(door, [0.12, 0.12, 0.18], [0.67, 1.23, 0.2], p.yellow);
  k.box(door, [1.4, 0.16, 0.08], [0, 3.3, 0.12], id === 'pump-exit' ? p.cold : p.green);
  const backdrop = group(root, 'backdrop');
  const shell = { w, d, wallZ, wallX };
  if (id === 'night-ward') buildWardShell(k, root, backdrop, shell);
  else if (id === 'quarantine-corridor') buildQuarantineShell(k, root, backdrop, shell);
  else buildPumpShell(k, root, backdrop, shell);
}

function wallRun(k, parent, { axis, c, from, to, t = 0.3, h = 3.5, mat = k.p.wall, openings = [] }) {
  const piece = (a, b, y0, y1) => {
    if (b - a < 0.01 || y1 - y0 < 0.01) return;
    const len = b - a, mid = (a + b) / 2, hh = y1 - y0;
    k.box(parent, axis === 'x' ? [len, hh, t] : [t, hh, len], axis === 'x' ? [mid, y0 + hh / 2, c] : [c, y0 + hh / 2, mid], mat);
  };
  let cursor = from;
  for (const op of [...openings].sort((x, y) => x.a - y.a)) {
    piece(cursor, op.a, 0, h); piece(op.a, op.b, 0, op.sill ?? 0); piece(op.a, op.b, op.head ?? h, h);
    cursor = op.b;
  }
  piece(cursor, to, 0, h);
}

// A lit room behind a window/door opening: floor, rear wall, ceiling light and a bed.
function sideRoom(k, parent, { x, z, width, depth, axis = 'z', light = k.p.cold, bed = true }) {
  const node = group(parent, 'adjoining-room', x, z, axis === 'x' ? Math.PI / 2 : 0);
  k.box(node, [width, 0.1, depth], [0, -0.06, -depth / 2], k.p.dark);
  k.box(node, [width, 3.4, 0.2], [0, 1.7, -depth], k.p.wall);
  for (const s of [-1, 1]) k.box(node, [0.2, 3.4, depth], [s * width / 2, 1.7, -depth / 2], k.p.wall);
  k.box(node, [width * 0.5, 0.1, 0.3], [0, 3.2, -depth + 0.3], light).castShadow = false;
  if (bed) {
    k.box(node, [1.1, 0.5, 2.1], [-width * 0.25, 0.4, -depth + 1.3], k.p.steel);
    k.box(node, [1.0, 0.22, 1.9], [-width * 0.25, 0.72, -depth + 1.3], k.p.linen);
  }
  return node;
}

function buildWardShell(k, root, backdrop, { w, d, wallZ, wallX }) {
  const p = k.p;
  // Night skyline beyond the tall windows, with a moon and a balcony rail.
  const moon = k.mesh(backdrop, k.sphereGeometry, p.moon, [2.2, 2.2, 0.4], [-w * 0.2, 11, wallZ - 34]);
  moon.castShadow = false;
  for (let i = 0; i < 9; i += 1) {
    const bw = 4 + (i * 7) % 5, bh = 6 + (i * 5) % 9, bx = -w - 6 + i * 5.2;
    k.box(backdrop, [bw, bh, 4], [bx, bh / 2 - 1, wallZ - 14 - (i % 3) * 4], p.skyline);
    for (let y = 1.5; y < bh - 1; y += 2) for (let x = -bw / 2 + 0.8; x < bw / 2 - 0.4; x += 1.4) {
      if ((i * 31 + Math.round(y * 3) * 7 + Math.round(x * 5)) % 4 === 0) {
        k.box(backdrop, [0.5, 0.7, 0.05], [bx + x, y, wallZ - 11.9 - (i % 3) * 4], p.window).castShadow = false;
      }
    }
  }
  k.box(backdrop, [w * 2 + 6, 0.12, 1.2], [0, 0.5, wallZ - 0.8], p.dark);
  k.box(backdrop, [w * 2 + 6, 0.08, 0.08], [0, 1.45, wallZ - 1.35], p.steel);
  for (let x = -w - 2; x < w + 3; x += 1.2) k.box(backdrop, [0.05, 0.95, 0.05], [x, 0.98, wallZ - 1.35], p.steel);
  // Window glazing: mullions, translucent panes and heavy drawn curtains.
  for (const wx of [-w * 0.57, 0]) {
    const win = group(root, 'ward-window', wx, wallZ + 0.1);
    k.box(win, [3.4, 2.0, 0.04], [0, 2.05, -0.02], p.glass);
    for (const dx of [-1.7, -0.57, 0.57, 1.7]) k.box(win, [0.07, 2.1, 0.1], [dx, 2.05, 0]);
    k.box(win, [3.5, 0.07, 0.1], [0, 3.08, 0]); k.box(win, [3.5, 0.07, 0.1], [0, 1.03, 0]);
    k.box(win, [3.7, 0.12, 0.45], [0, 0.98, 0.18], p.linen);
    for (const s of [-1, 1]) {
      k.box(win, [0.55, 2.75, 0.14], [s * 1.95, 1.7, 0.2], p.cloth);
      for (let f = 0; f < 3; f += 1) k.box(win, [0.06, 2.7, 0.18], [s * (1.78 + f * 0.17), 1.7, 0.22], p.dark);
    }
    k.box(win, [4.6, 0.06, 0.06], [0, 3.12, 0.22]);
    k.box(win, [1.2, 0.04, 2.0], [0, 0.04, 1.0], p.cold).castShadow = false;
  }
  // West wall doors lead into dim single rooms behind the arena rail.
  for (const z of [-5.6, 5.6]) {
    sideRoom(k, backdrop, { x: wallX - 0.1, z, width: 4.2, depth: 5, axis: 'x', light: p.cold });
    const frame = group(root, 'ward-door-frame', wallX + 0.05, z, Math.PI / 2);
    k.box(frame, [2.3, 0.2, 0.3], [0, 2.7, 0], p.trim);
    for (const s of [-1, 1]) k.box(frame, [0.18, 2.7, 0.3], [s * 1.08, 1.35, 0]);
    k.box(frame, [0.9, 0.22, 0.04], [0, 2.95, 0.17], p.green).castShadow = false;
  }
  // Sconces, clock, notice board, extinguisher.
  for (const x of [-w + 4, -w + 12, w - 4]) {
    k.box(root, [0.55, 0.24, 0.2], [x, 2.55, wallZ + 0.22], p.steel);
    k.box(root, [0.4, 0.1, 0.08], [x, 2.38, wallZ + 0.34], p.warm).castShadow = false;
  }
  k.cylinder(root, 0.32, 0.06, [-w * 0.25, 3.0, wallZ + 0.2], p.linen).rotation.x = Math.PI / 2;
  k.box(root, [1.6, 1.0, 0.06], [w * 0.2, 1.9, wallZ + 0.15], p.cloth);
  for (const x of [-0.5, 0, 0.5]) k.box(root, [0.4, 0.3, 0.02], [w * 0.2 + x, 1.9 + (x ? 0.1 : -0.1), wallZ + 0.2], p.linen);
  k.box(root, [0.28, 0.7, 0.2], [w - 1.2, 0.45, wallZ + 0.2], p.red);
  // Floor: guide ribbons and bed bays.
  k.box(root, [0.25, 0.012, d * 2], [0, 0.012, 0], p.green).castShadow = false;
  k.box(root, [w * 2, 0.01, 0.25], [0, 0.02, 0], p.yellow).castShadow = false;
  // Curtain rails with drawn privacy screens beside each bed.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * 7.5, z = sz * 4.3;
    k.cylinder(root, 0.025, 2.9, [x - 1.6, 1.45, z]);
    k.cylinder(root, 0.025, 2.9, [x + 1.6, 1.45, z]);
    const rail = k.cylinder(root, 0.025, 3.2, [x, 2.9, z]); rail.rotation.z = Math.PI / 2;
    for (let f = 0; f < 4; f += 1) k.box(root, [0.2, 1.55, 0.04], [x - 1.5 + f * 0.1, 2.05, z], p.cloth);
  }
}

function buildQuarantineShell(k, root, backdrop, { w, d, wallZ, wallX }) {
  const p = k.p;
  // West wall: glazed isolation cells with hazard framing and dim beds behind the glass.
  [-9.2, -4.8, -0.4, 4.0, 8.4].forEach((z, i) => {
    sideRoom(k, backdrop, { x: wallX - 0.1, z, width: 3.8, depth: 4.4, axis: 'x', light: i % 2 ? p.green : p.cold });
    const bay = group(root, 'sealed-quarantine-bay', wallX + 0.1, z, Math.PI / 2);
    k.box(bay, [3.1, 1.9, 0.04], [0, 1.95, 0], p.glass);
    for (const x of [-1.5, -0.5, 0.5, 1.5]) k.box(bay, [0.06, 2.0, 0.1], [x, 1.95, 0.02]);
    k.box(bay, [3.3, 0.1, 0.16], [0, 3.0, 0.02], p.hazard);
    k.box(bay, [3.3, 0.1, 0.16], [0, 0.95, 0.02], p.hazard);
    k.box(bay, [0.5, 0.5, 0.04], [1.0, 0.45, 0.1], p.yellow);
    k.box(bay, [2.85, 0.08, 0.09], [0, 3.2, 0.13], i % 2 ? p.green : p.cold).castShadow = false;
    k.box(bay, [0.7, 0.28, 0.04], [-0.9, 3.45, 0.1], p.dark);
  });
  // East wall: numbered bulkhead doors with biohazard plates.
  let n = 0;
  for (let z = -d + 2; z < d; z += 4.6) {
    const bulk = group(root, 'bulkhead-door', w + 0.35 - 0.01, z, -Math.PI / 2);
    k.box(bulk, [2.2, 0.16, 0.12], [0, 2.45, 0.06], p.hazard);
    k.box(bulk, [2.0, 2.4, 0.1], [0, 1.2, 0.05], p.steel);
    k.box(bulk, [0.7, 0.7, 0.04], [0, 1.6, 0.12], p.dark);
    k.cylinder(bulk, 0.3, 0.05, [0, 1.6, 0.14], p.yellow).rotation.x = Math.PI / 2;
    k.box(bulk, [0.2, 0.2, 0.06], [0.75, 1.1, 0.12], n++ % 2 ? p.green : p.red);
  }
  // Overhead services run along the wall tops: pipes, cable trays, ducts.
  for (const [y, off] of [[3.1, 0.2], [2.75, 0.25]]) {
    const pipe = k.cylinder(root, 0.11, d * 2, [wallX + off, y, 0], p.rust); pipe.rotation.x = Math.PI / 2;
  }
  k.box(root, [0.5, 0.3, d * 2], [w + 0.1, 3.2, 0], p.steel);
  for (let z = -d + 1; z < d; z += 3) k.box(root, [0.14, 0.34, 0.5], [w + 0.1, 3.2, z], p.dark);
  // Far end: circular airlock vault.
  const gate = group(root, 'airlock-gate', -w * 0.4, -d - 0.2);
  k.cylinder(gate, 1.5, 0.3, [0, 2.0, 0], p.steel).rotation.x = Math.PI / 2;
  k.cylinder(gate, 1.25, 0.34, [0, 2.0, 0.02], p.dark).rotation.x = Math.PI / 2;
  for (let a = 0; a < 8; a += 1) {
    const ang = a * Math.PI / 4;
    const spoke = k.box(gate, [0.14, 1.1, 0.1], [Math.cos(ang) * 0.55, 2.0 + Math.sin(ang) * 0.55, 0.2], p.yellow);
    spoke.rotation.z = ang - Math.PI / 2;
  }
  k.cylinder(gate, 0.3, 0.2, [0, 2.0, 0.26], p.red).rotation.x = Math.PI / 2;
  // Floor: hazard strips and floor plates.
  for (const x of [-w + 0.6, w - 0.6]) for (let z = -d + 0.4; z < d; z += 1.2) {
    k.box(root, [0.6, 0.01, 0.55], [x, 0.01, z], Math.round(z * 10) % 2 ? p.dark : p.yellow).castShadow = false;
  }
  const shower = group(root, 'decon-shower', w - 1.2, d - 1.6);
  k.box(shower, [0.1, 2.6, 2.2], [0.9, 1.3, 0], p.steel);
  k.box(shower, [1.8, 0.1, 2.2], [0, 2.6, 0], p.steel);
  for (const dz of [-0.6, 0.6]) k.cylinder(shower, 0.14, 0.05, [0, 2.52, dz], p.dark);
  k.box(shower, [1.8, 0.02, 2.2], [0, 0.02, 0], p.cold).castShadow = false;
}

function buildPumpShell(k, root, backdrop, { w, d, wallZ, wallX }) {
  const p = k.p;
  // Mezzanine catwalk behind the arena rail with stairs and railings.
  const deck = group(root, 'mezzanine', 0, wallZ + 1.1);
  k.box(deck, [w * 2 - 9, 0.14, 2.1], [4, 3.35, 0], p.steel);
  for (let x = -w + 6; x < w; x += 2.5) k.box(deck, [0.1, 3.3, 0.1], [x, 1.65, 0.9], p.dark);
  for (let x = -w + 5.6; x < w - 0.5; x += 0.7) k.box(deck, [0.04, 0.9, 0.04], [x, 3.9, 1.0], p.steel);
  k.box(deck, [w * 2 - 9, 0.05, 0.05], [4, 4.35, 1.0], p.steel);
  for (let s = 0; s < 14; s += 1) k.box(deck, [1.6, 0.1, 0.4], [-w + 3.4, 0.2 + s * 0.23, 1.4 - s * 0.14], p.steel);
  // Storage tanks and manifolds behind.
  for (let i = 0; i < 3; i += 1) {
    const tank = group(backdrop, 'storage-tank', -7 + i * 7, wallZ - 3.4);
    k.cylinder(tank, 2.1, 6.5, [0, 3.25, 0], p.steel);
    k.cylinder(tank, 2.18, 0.2, [0, 6.5, 0], p.dark);
    for (const y of [1.2, 3.2, 5.2]) k.cylinder(tank, 2.2, 0.14, [0, y, 0], p.rust);
    k.box(tank, [0.5, 0.5, 0.1], [0, 2.2, 2.12], p.warm);
  }
  // Pipe trunks across the wall with flanges, valves and wheels.
  for (const y of [1.6, 2.35, 3.05]) {
    const pipe = k.cylinder(root, y === 1.6 ? 0.2 : 0.14, w * 2 + 0.6, [0, y, wallZ + 0.4], y === 3.05 ? p.steel : p.rust);
    pipe.rotation.z = Math.PI / 2;
    for (let x = -w + 1; x < w; x += 3.2) k.box(root, [0.18, y === 1.6 ? 0.52 : 0.42, 0.42], [x, y, wallZ + 0.4], p.steel);
  }
  for (let x = -w + 2.4; x < w - 3; x += 4.8) {
    k.cylinder(root, 0.1, 0.8, [x, 2.0, wallZ + 0.4], p.dark);
    k.cylinder(root, 0.36, 0.05, [x, 2.45, wallZ + 0.4], p.red).rotation.x = Math.PI / 2;
  }
  // West wall control bank with indicator rows.
  const bank = group(root, 'control-bank', wallX + 0.55, 0, Math.PI / 2);
  k.box(bank, [7.2, 1.2, 0.8], [0, 0.6, 0], p.dark);
  k.box(bank, [7.0, 0.8, 0.12], [0, 1.4, -0.3], p.steel).rotation.x = -0.4;
  for (let i = 0; i < 12; i += 1) k.box(bank, [0.3, 0.14, 0.05], [-3.2 + i * 0.58, 1.45, -0.38], (i * 5) % 3 ? p.green : p.warm).castShadow = false;
  // Floor: drainage channel, safety borders, exit apron.
  k.box(root, [1.2, 0.02, d * 2], [0, 0.015, 0], p.dark).castShadow = false;
  for (const x of [-w + 0.7, w - 0.7]) k.box(root, [0.18, 0.012, d * 2 - 1], [x, 0.012, 0], p.yellow).castShadow = false;
  k.box(root, [4.6, 0.02, 1.6], [w * 0.46, 0.015, -d + 1.1], p.yellow).castShadow = false;
}

// New scenery implementation completed from campaignData, not a recovered original.
function addProp(k, parent, prop) {
  const node = group(parent, `prop-${prop.kind}`, prop.x, prop.z, prop.rotation);
  const p = k.p;
  if (prop.kind === 'bed') {
    k.box(node, [1.35, 0.16, 2.45], [0, 0.55, 0], p.steel);
    k.box(node, [1.24, 0.23, 2.27], [0, 0.74, 0], p.linen);
    k.box(node, [1.27, 0.07, 1.6], [0, 0.88, 0.32], p.cloth);
    k.box(node, [0.82, 0.13, 0.42], [-0.06, 0.91, -0.8], p.linen);
    for (const x of [-0.61, 0.61]) {
      for (const z of [-1.05, 1.05]) k.box(node, [0.07, 0.5, 0.07], [x, 0.27, z]);
      k.box(node, [0.05, 0.38, 2.35], [x, 0.95, 0]);
    }
    for (const z of [-1.17, 1.17]) k.box(node, [1.32, 0.48, 0.06], [0, 0.9, z]);
  } else if (prop.kind === 'crate') {
    // Low supply cases remain decorative; the round raised machines are collision cover.
    k.box(node, [1.25, 0.42, 0.95], [0, 0.21, 0], p.cloth);
    k.box(node, [1.3, 0.06, 1], [0, 0.45, 0], p.steel);
    for (const x of [-0.42, 0.42]) k.box(node, [0.07, 0.46, 1.01], [x, 0.23, 0], p.dark);
    k.box(node, [0.2, 0.035, 0.6], [0, 0.49, 0], p.linen);
    k.box(node, [0.6, 0.035, 0.2], [0, 0.491, 0], p.linen);
  } else if (prop.kind === 'lamp') {
    k.cylinder(node, 0.27, 0.08, [0, 0.04, 0], p.dark);
    k.cylinder(node, 0.035, 2.4, [0, 1.23, 0]);
    k.box(node, [0.68, 0.26, 0.24], [0, 2.42, 0], p.steel);
    k.box(node, [0.57, 0.12, 0.04], [0, 2.4, 0.14], k.map.id === 'pump-exit' ? p.warm : p.cold);
  } else throw new RangeError(`Unknown scenery prop: ${prop.kind}`);
  return node;
}

function addObstacle(k, parent, obstacle, index) {
  const node = group(parent, `cover-${index}`, obstacle.x, obstacle.z);
  node.userData.collisionRadius = obstacle.radius;
  const r = obstacle.radius;
  k.cylinder(node, r, 0.12, [0, 0.06, 0], k.p.yellow);
  k.cylinder(node, r * 0.92, 0.18, [0, 0.21, 0], k.p.dark);
  if (k.map.id === 'pump-exit') {
    k.cylinder(node, r * 0.78, 1.1, [0, 0.85, 0], k.p.rust);
    k.cylinder(node, r * 0.85, 0.12, [0, 1.46, 0], k.p.steel);
    k.cylinder(node, r * 0.28, 0.34, [0, 1.68, 0], k.p.dark);
    const pipe = k.cylinder(node, r * 0.24, r * 1.25, [0, 0.9, r * 0.1], k.p.steel);
    pipe.rotation.z = Math.PI / 2;
    for (const x of [-0.4, 0.4]) k.box(node, [r * 0.2, 0.45, r * 0.4], [x * r, 0.48, 0]);
    k.box(node, [0.24, 0.17, 0.06], [0, 1.04, r * 0.78], k.p.warm);
  } else {
    k.cylinder(node, r * 0.8, 0.9, [0, 0.75, 0], k.p.steel);
    k.cylinder(node, r * 0.84, 0.09, [0, 1.24, 0], k.p.linen);
    k.box(node, [r * 0.9, 0.17, 0.08], [0, 0.95, r * 0.79], k.p.dark);
    k.box(node, [r * 0.55, 0.07, 0.09], [0, 0.95, r * 0.84], k.p.green);
  }
}

// Infected are full human rigs in torn clothes. Geometry and materials are cloned so scenery owns and frees them.
const GOWNS = [0x8fa3ad, 0x9fae9c, 0xa99f96, 0x7f929f, 0x95a3a0];
function makeInfected(k, parent, person, index) {
  const root = group(parent, `infected-${person.id}`, person.x, person.z, person.rotation);
  root.userData.atmosphericOnly = true;
  const model = createHuman({ variant: 'infected' });
  const geometries = new Map(), materials = new Map();
  model.traverse((node) => {
    if (node.isInstancedMesh) k.own(node);
    if (node.geometry) {
      if (!geometries.has(node.geometry)) geometries.set(node.geometry, k.own(node.geometry.clone()));
      node.geometry = geometries.get(node.geometry);
    }
    if (node.material) {
      if (!materials.has(node.material)) materials.set(node.material, k.own(node.material.clone()));
      node.material = materials.get(node.material);
    }
  });
  model.getObjectByName('visible-carbine').visible = false;
  model.getObjectByName('tailored-jacket').material.color.setHex(GOWNS[index % GOWNS.length]);
  root.add(model);
  return { root, model, rig: model.userData.modelRig, phase: index * 2.17, id: person.id, dead: false, deathTime: 0 };
}

function animateInfected(person, time) {
  const t = time + person.phase, { rig } = person;
  animateHuman(person.model, 0, false);
  if (person.calm) {
    // Calmed: upright, head lifted, arms hanging, slow breathing. No more scratching and twitching.
    rig.body.rotation.set(0.04 + Math.sin(t * 0.8) * 0.01, Math.sin(t * 0.2) * 0.05, 0);
    rig.head.rotation.set(-0.05 + Math.sin(t * 0.5) * 0.02, Math.sin(t * 0.25) * 0.12, 0);
    rig.arms.forEach(({ root: arm, elbow, side }) => { arm.rotation.set(0.04, 0, side * 0.06); elbow.rotation.set(-0.12, 0, 0); });
    rig.legs.forEach(({ root: leg, knee }) => { leg.rotation.x = 0; knee.rotation.x = 0.02; });
    return;
  }
  rig.body.rotation.set(0.24 + Math.sin(t * 0.7) * 0.03, Math.sin(t * 0.33) * 0.1, Math.sin(t * 0.52) * 0.06);
  rig.head.rotation.set(0.3 + Math.sin(t * 0.8) * 0.04, Math.sin(t * 0.45) * 0.16, -0.12 + Math.sin(t * 0.3) * 0.05);
  rig.arms.forEach(({ root: arm, elbow, side }, i) => {
    arm.rotation.set(-0.12 + Math.sin(t * 0.6 + i * 2) * 0.1, 0, side * (0.1 + Math.sin(t * 0.9) * 0.03));
    elbow.rotation.set(-0.35 + Math.sin(t * 0.5 + i) * 0.08, 0, 0);
  });
  rig.legs.forEach(({ root: leg, knee, side }) => {
    leg.rotation.x = side * 0.04 + Math.sin(t * 0.4) * 0.02; knee.rotation.x = 0.06;
  });
}

/** Owns only scenery resources. No simulation, timers, listeners or shared model assets. */
export function createCampaignScenery(map) {
  if (!map?.arena || !map?.palette || !Array.isArray(map.props) || !Array.isArray(map.infected)) {
    throw new TypeError('Incomplete campaign scenery data');
  }
  const root = new THREE.Group();
  root.name = `campaign-${map.id}`;
  root.userData.mapId = map.id;
  const resources = new Set();
  const own = (value) => { resources.add(value); return value; };
  let disposed = false;
  let time = 0;
  let infected = [];
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    root.removeFromParent();
    root.clear();
    for (const resource of resources) resource.dispose();
    resources.clear();
    infected = [];
  };
  try {
    const k = kitFor(map, own);
        // Quiet floor and moderately reflective metal preserve the dark legs' silhouette.
    k.p.floor.color.lerp(new THREE.Color(0x8c9597), 0.12);
    buildArchitecture(k, root);
    map.obstacles.forEach((obstacle, index) => addObstacle(k, root, obstacle, index));
    map.props.forEach((prop) => addProp(k, root, prop));
    batchStatic(root, own);
    // Near walls exist at eye level, but stay cut away for the elevated cameras.
    // They must remain outside the shared static batches, whose visibility is common.
    const eyeWalls = group(root, 'first-person-near-walls');
    const { halfWidth: w, halfDepth: d } = map.arena;
    k.box(eyeWalls, [w * 2 + 1, 3.5, 0.22], [0, 1.75, d + 0.35], k.p.wall);
    k.box(eyeWalls, [0.22, 3.5, d * 2 + 1], [w + 0.35, 1.75, 0], k.p.wall);
    eyeWalls.visible = false;
    infected = map.infected.map((person, index) => makeInfected(k, root, person, index));
    infected.forEach((person) => animateInfected(person, 0));
    return {
      root,
      update(dt = 0) {
        if (disposed) return;
        const step = Number.isFinite(dt) ? clamp(dt, 0, 0.05) : 0;
        time += step;
        infected.forEach((person) => {
          if (!person.dead) { animateInfected(person, time); return; }
          person.deathTime += step;
          animateHumanOutcome(person.model, { kind: 'death', time: person.deathTime, duration: 1.5 });
        });
      },
      /** Shot bystanders collapse and stay on the floor; ids that are no longer dead (new run) stand up again. */
      syncInfected(deadIds = [], calmIds = []) {
        if (disposed) return;
        for (const person of infected) {
          person.calm = calmIds.includes(person.id);
          const dead = deadIds.includes(person.id);
          if (dead && !person.dead) { person.dead = true; person.deathTime = 0; }
          else if (!dead && person.dead) { person.dead = false; animateHumanOutcome(person.model, { kind: 'none' }); animateInfected(person, time); }
        }
      },
      setViewMode(mode) { if (!disposed) eyeWalls.visible = mode === 'first'; },
      setHorrorMode(enabled) {
        if (disposed) return;
        for (const surface of [k.p.cold, k.p.warm, k.p.green]) surface.emissiveIntensity = enabled ? 0.16 : 0.6;
      },
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
