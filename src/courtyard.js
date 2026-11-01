import * as THREE from 'three';

/**
 * The quarantine compound outside the hospital: a walled plaza with a fountain, a parked ambulance,
 * a field-clinic tent, a guard post, garden beds and a chicane before the north gate.
 * Obstacle footprints here mirror DAWN_SOLIDS in afterDawn.js; keep them in sync.
 */
export function buildCourtyard({ root, own, mesh, boxGeometry, cylinderGeometry, leafGeometry }) {
  // Returns an animate(time) hook for the blinking emergency lights and the fountain.
  const mat = (color, extra = {}) => own(new THREE.MeshStandardMaterial({ color, roughness: 0.86, ...extra }));
  const m = {
    pave: mat(0xb9b29c), paveDark: mat(0x948d7c), curb: mat(0xd2cbb3), brick: mat(0x8d5b49), brickDark: mat(0x6f4638),
    plaster: mat(0xd8cfb6), roof: mat(0x7b4838), glass: mat(0x7fb0c0, { roughness: 0.15, metalness: 0.2 }),
    dark: mat(0x1b2a30), steel: mat(0x5d7076, { metalness: 0.5, roughness: 0.5 }), water: mat(0x5aa3bb, { emissive: 0x2c6c84, emissiveIntensity: 0.35, roughness: 0.2 }),
    stone: mat(0xa6a08e), hedge: mat(0x3d6b34), soil: mat(0x5a4332), bloomA: mat(0xd98c9a), bloomB: mat(0xe8d36a),
    wood: mat(0x6d4f3a), canvas: mat(0xdcd5ba), red: mat(0xa23a33), white: mat(0xe8e8df), yellow: mat(0xc9a43a),
    sand: mat(0xa8956a), concrete: mat(0x9d9d95), green: mat(0x4e6656), bark: mat(0x655348), leaf: mat(0x5d8040),
    lampGlow: mat(0xfff0c8, { emissive: 0xffe3a0, emissiveIntensity: 0.9 }),
    blue: mat(0x4a7be0, { emissive: 0x3358c4, emissiveIntensity: 0.8 }), emerg: mat(0xe04a3a, { emissive: 0xc02a1e, emissiveIntensity: 0.8 }),
  };
  const roofGeometry = own(new THREE.ConeGeometry(1, 1, 4));
  const group = (name, x = 0, z = 0, rotation = 0) => {
    const node = new THREE.Group(); node.name = name; node.position.set(x, 0, z); node.rotation.y = rotation; root.add(node); return node;
  };
  const box = (parent, size, position, surface) => mesh(parent, boxGeometry, surface, position, size);
  const cylinder = (parent, radius, height, position, surface, rotation = null) => {
    const object = mesh(parent, cylinderGeometry, surface, position, [radius, height, radius]);
    if (rotation) object.rotation.set(...rotation); return object;
  };
  const ball = (parent, size, position, surface) => mesh(parent, leafGeometry, surface, position, size);

  // ---- Ground: paved plaza, joint grid, kerbs and a pale central promenade ----
  box(root, [28.6, 0.14, 37], [0, -0.07, -18.2], m.pave);
  for (let x = -12; x <= 12; x += 2) box(root, [0.05, 0.02, 36], [x, 0.01, -18.2], m.paveDark).castShadow = false;
  for (let z = -2; z >= -35; z -= 2) box(root, [26, 0.02, 0.05], [0, 0.01, z], m.paveDark).castShadow = false;
  box(root, [4.2, 0.03, 36], [0, 0.025, -18.2], m.curb).castShadow = false;
  for (const x of [-2.1, 2.1]) box(root, [0.18, 0.08, 36], [x, 0.04, -18.2], m.stone);
  box(root, [26, 0.02, 0.3], [0, 0.02, -29.6], m.yellow).castShadow = false;
  box(root, [3.8, 0.1, 11], [0, -0.01, -42], m.curb);
  // ---- Perimeter walls with pilasters, coping and quarantine banners ----
  for (const side of [-1, 1]) {
    box(root, [0.5, 3.4, 37], [side * 14.3, 1.7, -18.2], m.brick);
    box(root, [0.8, 0.22, 37.2], [side * 14.3, 3.5, -18.2], m.curb);
    box(root, [0.62, 0.9, 37], [side * 14.2, 0.45, -18.2], m.brickDark);
    for (let z = -2; z > -36; z -= 5.5) {
      box(root, [0.9, 3.8, 0.9], [side * 14.1, 1.9, z], m.brick); box(root, [1.1, 0.25, 1.1], [side * 14.1, 3.9, z], m.curb);
      box(root, [0.1, 1.1, 1.6], [side * 13.75, 2.1, z - 2.7], m.yellow); box(root, [0.12, 0.5, 1.6], [side * 13.72, 2.1, z - 2.7], m.dark);
    }
    box(root, [7.4, 3.4, 0.5], [side * 10.9, 1.7, -36.3], m.brick); box(root, [7.6, 0.22, 0.8], [side * 10.9, 3.5, -36.3], m.curb);
    box(root, [1.1, 4.1, 1.1], [side * 7.3, 2.05, -36.3], m.brick); box(root, [1.3, 0.25, 1.3], [side * 7.3, 4.2, -36.3], m.curb);
    cylinder(root, 0.16, 0.7, [side * 7.3, 4.6, -36.3], m.lampGlow).castShadow = false;
  }
  // ---- Hospital facade the survivor just left: wings, windows, cornice, canopy ----
  for (const side of [-1, 1]) {
    box(root, [9, 10, 6], [side * 9.7, 5, 3.2], m.plaster);
    box(root, [9.6, 0.4, 6.6], [side * 9.7, 10.2, 3.2], m.roof);
    box(root, [9.2, 0.35, 0.5], [side * 9.7, 3.4, 0.1], m.curb); box(root, [9.2, 0.35, 0.5], [side * 9.7, 6.8, 0.1], m.curb);
    for (const y of [1.9, 5.2, 8.6]) for (const x of [-3, -1, 1, 3]) {
      box(root, [1.2, 1.7, 0.1], [side * 9.7 + x * 1.1, y, -0.05], m.dark);
      box(root, [1.0, 1.5, 0.05], [side * 9.7 + x * 1.1, y, -0.1], m.glass);
      box(root, [1.45, 0.14, 0.4], [side * 9.7 + x * 1.1, y - 0.9, -0.12], m.curb);
    }
    box(root, [0.5, 0.3, 0.04], [side * 9.7, 5.2, -0.16], m.red);
  }
  box(root, [10.4, 0.5, 0.5], [0, 4.3, -0.1], m.curb);
  for (const x of [-2, 2]) { box(root, [0.5, 0.4, 0.5], [x, 0.2, -3.2], m.stone); ball(root, [0.45, 0.45, 0.45], [x, 0.7, -3.2], m.hedge); }
  // ---- Central fountain plaza: basin, water, column, tiers, benches and hedges ----
  const fountain = group('courtyard-fountain', 0, -20);
  cylinder(fountain, 2.7, 0.55, [0, 0.27, 0], m.stone); cylinder(fountain, 2.45, 0.5, [0, 0.38, 0], m.water);
  cylinder(fountain, 2.8, 0.1, [0, 0.58, 0], m.curb); cylinder(fountain, 0.4, 1.7, [0, 1.0, 0], m.stone);
  cylinder(fountain, 1.15, 0.14, [0, 1.35, 0], m.stone); cylinder(fountain, 1.0, 0.1, [0, 1.42, 0], m.water);
  cylinder(fountain, 0.22, 0.9, [0, 1.9, 0], m.stone); ball(fountain, [0.3, 0.3, 0.3], [0, 2.45, 0], m.curb);
  for (let a = 0; a < 4; a++) {
    const angle = a * Math.PI / 2 + Math.PI / 4, x = Math.sin(angle) * 4.5, z = Math.cos(angle) * 4.5;
    const bench = group('courtyard-bench', x, -20 + z, angle);
    box(bench, [2.2, 0.1, 0.55], [0, 0.48, 0], m.wood); box(bench, [2.2, 0.5, 0.08], [0, 0.78, -0.25], m.wood);
    for (const s of [-1, 1]) box(bench, [0.08, 0.45, 0.5], [s * 0.95, 0.22, 0], m.steel);
  }
  for (const x of [-4.4, 4.4]) for (const z of [-15.5, -24.5]) {
    box(root, [1.6, 0.55, 1.6], [x, 0.27, z], m.hedge); box(root, [1.7, 0.1, 1.7], [x, 0.58, z], m.hedge);
  }
  // ---- Parked ambulance (west) ----
  const ambulance = group('courtyard-ambulance', -9, -14, 0.06);
  box(ambulance, [2.3, 1.9, 3.9], [0, 1.35, 0.7], m.white); box(ambulance, [2.3, 1.35, 1.7], [0, 1.05, -2.2], m.white);
  box(ambulance, [2.0, 0.65, 0.08], [0, 1.45, -3.08], m.glass); box(ambulance, [0.08, 0.6, 1.2], [1.16, 1.5, -2.2], m.glass); box(ambulance, [0.08, 0.6, 1.2], [-1.16, 1.5, -2.2], m.glass);
  box(ambulance, [2.34, 0.28, 5.7], [0, 0.55, -0.1], m.dark); box(ambulance, [2.34, 0.12, 3.9], [0, 1.0, 0.7], m.red);
  for (const s of [-1, 1]) {
    box(ambulance, [0.06, 0.62, 0.62], [s * 1.17, 1.65, 1.0], m.red); box(ambulance, [0.06, 0.2, 0.62], [s * 1.17, 1.65, 1.0], m.white);
    for (const z of [-2.1, 1.7]) cylinder(ambulance, 0.45, 0.36, [s * 1.12, 0.45, z], m.dark, [0, 0, Math.PI / 2]);
  }
  box(ambulance, [1.6, 0.16, 0.5], [0, 2.4, -1.3], m.dark); box(ambulance, [0.7, 0.14, 0.4], [-0.4, 2.52, -1.3], m.emerg); box(ambulance, [0.7, 0.14, 0.4], [0.4, 2.52, -1.3], m.blue);
  for (const s of [-1, 1]) box(ambulance, [0.06, 1.7, 0.9], [s * 1.0, 1.35, 2.7], m.white).rotation.y = s * 1.2;
  // ---- Field clinic tent (west) with cots, crates, barrels and a generator cable ----
  const tent = group('courtyard-clinic-tent', -9.5, -24);
  box(tent, [4, 1.5, 4], [0, 0.75, 0], m.canvas); const roof = mesh(tent, roofGeometry, m.canvas, [0, 2.2, 0], [2.95, 1.6, 2.95]); roof.rotation.y = Math.PI / 4;
  box(tent, [1.3, 1.2, 0.08], [0, 0.6, 2.02], m.dark); box(tent, [1.3, 0.14, 0.1], [0, 1.2, 2.05], m.red);
  box(tent, [0.9, 0.3, 0.06], [0, 1.1, 2.08], m.white); box(tent, [0.3, 0.9, 0.08], [0, 1.1, 2.08], m.white);
  box(tent, [4.1, 0.1, 4.1], [0, 0.04, 0], m.wood);
  for (const z of [-0.8, 0.8]) for (const x of [-1.2, 1.2]) { box(tent, [0.7, 0.2, 1.7], [x, 0.4, z], m.green); }
  for (let i = 0; i < 4; i++) cylinder(root, 0.4, 0.95, [-12.2 + (i % 2) * 0.85, 0.48, -26.6 - Math.floor(i / 2) * 0.85], m.red);
  for (const z of [-30.6, -29.4]) for (const y of [0.4, 1.15]) box(root, [1.2, 0.7, 1.1], [-11.7, y, z], m.wood);
  box(root, [1.2, 0.7, 1.1], [-11.2, 0.4, -31.4], m.green);
  // ---- Generator yard cabling and fuel drums ----
  for (const [x, z] of [[-10.8, -7.4], [-10.1, -6.7], [-11.1, -6.6]]) cylinder(root, 0.35, 0.9, [x, 0.46, z], x < -10.5 ? m.green : m.red);
  box(root, [0.12, 0.05, 15.5], [-8.2, 0.05, -16.5], m.dark).castShadow = false;
  // ---- East guard post with antenna, sandbag cover and an awning ----
  const post = group('courtyard-guard-post', 10.5, -24);
  box(post, [5, 3, 4], [0, 1.5, 0], m.plaster); box(post, [5.4, 0.3, 4.4], [0, 3.15, 0], m.roof);
  box(post, [5.4, 0.5, 0.2], [0, 3.55, 2.1], m.roof); box(post, [5.4, 0.5, 0.2], [0, 3.55, -2.1], m.roof);
  box(post, [1.8, 1.2, 0.1], [-1.1, 1.8, 2.02], m.dark); box(post, [1.6, 1.0, 0.05], [-1.1, 1.8, 2.07], m.glass);
  box(post, [1.0, 2.2, 0.1], [1.4, 1.1, 2.02], m.wood); box(post, [3.2, 0.12, 1.3], [-0.3, 2.65, 2.7], m.green);
  for (const s of [-1, 1]) box(post, [0.1, 2.6, 0.1], [s * 1.8 - 0.3, 1.3, 3.3], m.steel);
  cylinder(post, 0.07, 6.5, [2.0, 6.0, -1.0], m.steel);
  box(post, [1.4, 0.06, 0.06], [2.0, 8.4, -1.0], m.steel); box(post, [1.0, 0.06, 0.06], [2.0, 7.7, -1.0], m.steel);
  for (let row = 0; row < 3; row++) for (let i = 0; i < 6 - row; i++) {
    box(root, [0.9, 0.34, 0.5], [3.8 + i * 0.95 + row * 0.47, 0.18 + row * 0.34, -21.2], m.sand);
  }
  // ---- Garden beds with shrubs and flowers (east), plus benches ----
  for (const z of [-9, -14.5]) {
    box(root, [5.2, 0.5, 1.8], [9, 0.25, z], m.stone); box(root, [4.8, 0.2, 1.4], [9, 0.55, z], m.soil);
    for (let i = 0; i < 6; i++) ball(root, [0.34, 0.3, 0.34], [6.9 + i * 0.84, 0.85, z + ((i % 2) - 0.5) * 0.5], i % 3 ? m.bloomA : m.bloomB);
  }
  for (const z of [-11.8]) {
    const bench = group('courtyard-bench', 11.6, z, -Math.PI / 2);
    box(bench, [2.2, 0.1, 0.55], [0, 0.48, 0], m.wood); box(bench, [2.2, 0.5, 0.08], [0, 0.78, -0.25], m.wood);
    for (const s of [-1, 1]) box(bench, [0.08, 0.45, 0.5], [s * 0.95, 0.22, 0], m.steel);
  }
  // ---- Concrete chicane in front of the gate, trees and lamp posts ----
  for (const side of [-1, 1]) {
    box(root, [7, 0.95, 0.8], [side * 6, 0.48, -29], m.concrete); box(root, [7, 0.18, 0.84], [side * 6, 0.6, -29], m.yellow);
    box(root, [7, 0.3, 1.1], [side * 6, 0.15, -29], m.concrete);
    cylinder(root, 0.25, 2.2, [side * 5.5, 1.1, -32], m.bark); ball(root, [1.6, 1.5, 1.6], [side * 5.5, 3.2, -32], m.leaf); ball(root, [1.1, 1.0, 1.1], [side * 5.9, 3.9, -31.6], m.leaf);
  }
  for (const [x, z] of [[-3.4, -5], [3.4, -5], [-3.4, -12], [3.4, -12], [-3.4, -27], [3.4, -27], [-12.8, -17], [12.8, -17]]) {
    cylinder(root, 0.07, 3.6, [x, 1.8, z], m.steel); box(root, [0.5, 0.18, 0.5], [x, 3.7, z], m.dark); box(root, [0.38, 0.1, 0.38], [x, 3.58, z], m.lampGlow).castShadow = false;
  }
  // Trees and rooftops beyond the walls.
  for (const side of [-1, 1]) for (const z of [-6, -15, -24, -33, -42]) {
    cylinder(root, 0.35, 3.4, [side * (19 + (Math.abs(z) % 4)), 1.7, z], m.bark);
    ball(root, [2.8, 2.6, 2.7], [side * (19 + (Math.abs(z) % 4)), 4.6, z], m.leaf);
  }
  for (const side of [-1, 1]) for (let i = 0; i < 3; i++) {
    box(root, [9, 7 + i * 2, 8], [side * (27 + i * 7), 3.5 + i, -10 - i * 15], m.plaster);
    box(root, [9.4, 0.3, 8.4], [side * (27 + i * 7), 7.1 + i * 2, -10 - i * 15], m.roof);
  }
  return {
    animate(time) {
      const flash = Math.sin(time * 9) > 0;
      m.blue.emissiveIntensity = flash ? 1.6 : 0.1;
      m.emerg.emissiveIntensity = flash ? 0.1 : 1.6;
      m.water.emissiveIntensity = 0.35 + Math.sin(time * 2.4) * 0.12;
      m.lampGlow.emissiveIntensity = 0.9 + Math.sin(time * 1.3) * 0.05;
    },
  };
}
