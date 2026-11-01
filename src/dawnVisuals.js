import * as THREE from 'three';
import { createHuman, animateHuman } from './models.js';
/** Small interactive fixtures on the existing courtyard, sharing one resource owner. */
export function createDawnFixtures(parent, own, stops) {
  const boxGeometry = own(new THREE.BoxGeometry(1, 1, 1));
  const material = (color, extra = {}) => own(new THREE.MeshStandardMaterial({ color, roughness: 0.72, ...extra }));
  const steel = material(0x40555b, { metalness: 0.45 });
  const black = material(0x14272e), yellow = material(0xc5a35b), pale = material(0xd1d0b1);
  const green = material(0x84c794, { emissive: 0x53ae7a, emissiveIntensity: 0.7 });
  const root = new THREE.Group(); root.name = 'after-dawn-objectives'; parent.add(root);
  function box(node, size, position, surface) {
    const mesh = new THREE.Mesh(boxGeometry, surface); mesh.scale.set(...size); mesh.position.set(...position);
    mesh.castShadow = true; mesh.receiveShadow = true; node.add(mesh); return mesh;
  }
  const points = stops.map(({ id, x, z }, i) => {
    const group = new THREE.Group(); group.name = `dawn-${id}`; group.position.set(x, 0, z); root.add(group);
    if (i === 0) {
      box(group, [1.2, 0.8, 0.7], [0, 0.4, 0], steel);
      box(group, [0.95, 0.16, 0.75], [0, 0.85, 0], yellow);
      for (let y = 0.25; y < 0.65; y += 0.12) box(group, [0.7, 0.035, 0.03], [0, y, 0.365], black);
      box(group, [0.12, 0.35, 0.12], [0.35, 1, 0], black);
    } else if (i === 1) {
      box(group, [1.5, 0.1, 0.8], [0, 1, 0], pale);
      for (const x of [-0.55, 0.55]) box(group, [0.08, 1, 0.6], [x, 0.5, 0], steel);
      box(group, [0.7, 0.35, 0.4], [0, 1.22, 0], steel);
      box(group, [0.26, 0.13, 0.02], [-0.13, 1.25, 0.215], green);
      box(group, [0.025, 1.3, 0.025], [0.3, 1.9, -0.1], black);
    } else {
      for (const x of [-7, -2.3, 2.3, 7]) box(group, [0.25, 2.7, 0.25], [x, 1.35, 0], steel);
      for (const side of [-1, 1]) {
        box(group, [4.5, 0.12, 0.1], [side * 4.65, 2.5, 0], pale);
        for (let x = 2.5; x < 6.9; x += 0.3) box(group, [0.045, 2.4, 0.05], [side * x, 1.25, 0], steel);
      }
      box(group, [0.6, 0.6, 0.3], [1.5, 0.95, 0.65], steel);
      box(group, [0.18, 0.18, 0.03], [1.5, 1.05, 0.82], green);
    }
    const marker = new THREE.Mesh(own(new THREE.RingGeometry(0.85, 1, 36)),
      own(new THREE.MeshBasicMaterial({ color: 0xffc276, side: THREE.DoubleSide, transparent: true, opacity: 0.85 })));
    marker.rotation.x = -Math.PI / 2; marker.position.y = 0.05; group.add(marker);
    return { group, marker };
  });
  // An actual opening, not a disappearing wall: hinged leaves rotate away from the player.
  const leaves = [-1, 1].map(side => {
    const hinge = new THREE.Group(); hinge.position.set(side * 2.3, 0, -36); root.add(hinge);
    box(hinge, [2.25, 0.12, 0.14], [-side * 1.15, 2.5, 0], pale);
    box(hinge, [2.25, 0.12, 0.14], [-side * 1.15, 0.3, 0], steel);
    for (let i = 0; i < 8; i++) box(hinge, [0.055, 2.1, 0.055], [-side * (0.13 + i * 0.28), 1.4, 0], steel);
    return { hinge, side };
  });
  // The voice belongs to a visible survivor beyond the gate, using the same articulated human model.
  const nina = createHuman({ variant: 'medic' }); nina.name = 'medic-nina'; nina.position.set(0.9, 0, -40.2);
  const carbine = nina.getObjectByName('visible-carbine'); carbine.visible = false;
  // Own clones only: disposing this chapter must never dispose the player's shared model resources.
  const geometryCopies = new Map(), materialCopies = new Map();
  nina.traverse(node => {
    if (node.geometry) {
      if (!geometryCopies.has(node.geometry)) geometryCopies.set(node.geometry, own(node.geometry.clone()));
      node.geometry = geometryCopies.get(node.geometry);
    }
    if (node.material) {
      if (!materialCopies.has(node.material)) materialCopies.set(node.material, own(node.material.clone()));
      node.material = materialCopies.get(node.material);
    }
    if (node.isInstancedMesh) own(node);
  });
  root.add(nina);
  root.visible = false;
  return (state) => {
    root.visible = true;
    nina.visible = state.step >= 2;
    animateHuman(nina, state.time, false);
    nina.userData.modelRig.arms.forEach(({root: arm, elbow, side}) => {
      arm.rotation.set(0, 0, side * 0.1); elbow.rotation.set(-0.15, 0, 0);
    });
    points.forEach(({ marker }, i) => {
      marker.visible = i === state.step;
      marker.scale.setScalar(1 + Math.sin(state.time * 3) * 0.07);
    });
    leaves.forEach(({ hinge, side }) => { hinge.rotation.y = side * state.gate * Math.PI * 0.5; });
  };
}
