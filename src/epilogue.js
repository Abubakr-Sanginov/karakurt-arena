import * as THREE from 'three';
import { animateHuman } from './models.js';
import { createDawnFixtures } from './dawnVisuals.js';
import { buildCourtyard } from './courtyard.js';

const clamp = THREE.MathUtils.clamp;
const ease = (value) => { const t = clamp(value, 0, 1); return t * t * (3 - 2 * t); };

/** A presentation-only courtyard: no fourth combat map or simulated movement. */
export function createDawnEpilogue() {
  const root = new THREE.Group();
  root.name = 'dawn-courtyard-epilogue';
  const resources = new Set();
  const own = (resource) => { resources.add(resource); return resource; };
  const boxGeometry = own(new THREE.BoxGeometry(1, 1, 1));
  const cylinderGeometry = own(new THREE.CylinderGeometry(1, 1, 1, 8));
  const leafGeometry = own(new THREE.IcosahedronGeometry(1, 1));
  const mat = (color, extra = {}) => own(new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra }));
  const p = { grass: mat(0x6b8c43), stone: mat(0xa8a18a), wall: mat(0x68706a),
    dark: mat(0x182c32), steel: mat(0x6b7e81, { metalness: 0.4 }), bark: mat(0x655348),
    leaf: mat(0x668443), pale: mat(0xd7c5a0), tile: mat(0x43585d),
    ceiling: mat(0x283c42), lamp: mat(0xaed5d6, { emissive: 0x8fc1ca, emissiveIntensity: 0.65 }) };
  function mesh(parent, geometry, material, position, scale) {
    const object = new THREE.Mesh(geometry, material);
    object.position.set(...position); object.scale.set(...scale);
    object.castShadow = true; object.receiveShadow = true; parent.add(object);
    return object;
  }
  const box = (parent, size, position, material) => mesh(parent, boxGeometry, material, position, size);
  // Outdoors is strictly beyond z=0. The opening shot is inside a sealed,
  // roofed service corridor with a closed door, never on a lawn facing a door.
  box(root, [90, 0.3, 100], [0, -0.22, -50], p.grass);
  const interior = new THREE.Group(); interior.name = 'interior-exit-corridor'; root.add(interior);
  box(interior, [10.4, 0.25, 15.8], [0, -0.12, 7.8], p.tile);
  for (let z = 0.5; z < 15.5; z += 1) {
    box(interior, [9.9, 0.006, 0.025], [0, 0.01, z], p.dark);
  }
  for (const x of [-3, -1, 1, 3]) box(interior, [0.025, 0.006, 15.6], [x, 0.01, 7.8], p.dark);
  box(interior, [0.3, 4, 16], [-5.1, 2, 8], p.wall);
  box(interior, [0.3, 4, 16], [5.1, 2, 8], p.wall);
  box(interior, [10.4, 0.3, 16], [0, 4.1, 8], p.ceiling);
  box(interior, [10.4, 4, 0.3], [0, 2, 15.8], p.wall);
  const interiorTrim = mat(0x3a5356), sign = mat(0x69ac8b, {emissive: 0x275d42, emissiveIntensity: 0.45});
  for (const side of [-1, 1]) {
    box(interior, [0.05, 0.14, 15.5], [side * 4.92, 1.1, 7.8], interiorTrim);
    for (const z of [2.5, 6.5, 10.5]) {
      box(interior, [0.1, 2.65, 1.7], [side * 4.88, 1.34, z], p.steel);
      box(interior, [0.05, 0.22, 0.2], [side * 4.8, 1.2, z + 0.5], p.dark);
    }
  }
  for (const z of [3, 8, 13]) {
    box(interior, [1.8, 0.08, 0.34], [0, 3.9, z], p.lamp);
    box(interior, [0.035, 0.008, 1], [0, 0.015, z], p.steel);
  }
  box(interior, [1.35, 0.24, 0.08], [0, 3.35, 0.2], sign);
  const indoorLight = new THREE.PointLight(0x93b9c1, 22, 14, 2);
  indoorLight.position.set(0, 3.3, 5); root.add(indoorLight);
  const courtyard = buildCourtyard({ root, own, mesh, boxGeometry, cylinderGeometry, leafGeometry });
  // Street beyond the courtyard, with a curb, lane markings and distant facades.
  box(root, [74, 0.08, 7], [0, -0.01, -47], p.dark);
  for (const z of [-43.3, -50.7]) box(root, [74, 0.18, 0.3], [0, 0, z], p.pale);
  for (let x = -34; x < 36; x += 6) box(root, [2.8, 0.015, 0.09], [x, 0.04, -47], p.pale);
  for (let x = -30; x < 34; x += 11) {
    const height = 9 + ((x + 30) % 4);
    box(root, [9.5, height, 10], [x, height / 2, -62], p.wall);
    box(root, [10, 0.25, 10.5], [x, height + 0.1, -62], p.pale);
    for (let y = 2; y < height - 1; y += 2.5) for (const dx of [-2.8, 0, 2.8]) {
      box(root, [1.4, 1.5, 0.08], [x + dx, y, -56.95], p.dark);
      box(root, [1.65, 0.12, 0.25], [x + dx, y - 0.77, -56.9], p.stone);
    }
  }
  // Batch static fixtures, including the corridor; animated door stays separate.
  root.updateMatrixWorld(true);
  const batches = new Map();
  root.traverse((object) => {
    if (!object.isMesh) return;
    const key = `${object.geometry.uuid}:${object.material.uuid}`;
    if (!batches.has(key)) batches.set(key, []);
    batches.get(key).push(object);
  });
  for (const objects of batches.values()) {
    if (objects.length < 2) continue;
    const batch = own(new THREE.InstancedMesh(objects[0].geometry, objects[0].material, objects.length));
    batch.name = 'batched-courtyard-fixtures';
    batch.castShadow = true; batch.receiveShadow = true;
    objects.forEach((object, index) => { batch.setMatrixAt(index, object.matrixWorld); object.removeFromParent(); });
    batch.instanceMatrix.needsUpdate = true; batch.computeBoundingSphere(); root.add(batch);
  }
  const bladeGeometry = own(new THREE.ConeGeometry(0.04, 0.45, 3));
  const blades = own(new THREE.InstancedMesh(bladeGeometry, p.grass, 1800));
  blades.name = 'courtyard-instanced-grass';
  const transform = new THREE.Object3D();
  for (let i = 0; i < blades.count; i += 1) {
    const side = i % 2 ? 1 : -1;
    transform.position.set(side * (14.8 + ((i * 73) % 2800) / 100), 0.16, -((i * 97) % 5400) / 100);
    transform.rotation.set(0.08, i * 2.39996, side * 0.12);
    transform.scale.setScalar(0.65 + (i % 7) * 0.1); transform.updateMatrix();
    blades.setMatrixAt(i, transform.matrix);
  }
  blades.instanceMatrix.needsUpdate = true; blades.computeBoundingSphere(); root.add(blades);
  // A real doorway separates the roofed interior from the sunlit courtyard.
  box(root, [4, 4, 0.28], [-3.2, 2, 0], p.wall);
  box(root, [4, 4, 0.28], [3.2, 2, 0], p.wall);
  box(root, [2.45, 0.5, 0.3], [0, 3.55, 0], p.wall);
  box(root, [2.4, 0.035, 0.5], [0, 0.015, 0], p.steel);
  for (const x of [-1.23, 1.23]) box(root, [0.09, 3.3, 0.38], [x, 1.65, 0], p.dark);
  box(root, [2.55, 0.1, 0.38], [0, 3.28, 0], p.dark);
  const hinge = new THREE.Group(); hinge.name = 'opening-exit-door'; hinge.position.set(1.18, 0, 0); root.add(hinge);
  // This leaf swings out into the yard, away from the waiting survivor.
  box(hinge, [2.35, 3.25, 0.14], [-1.175, 1.625, 0], p.steel);
  box(hinge, [0.09, 0.32, 0.14], [-2.08, 1.3, 0.12], p.dark);
  // The existing survivor rig opens the door; no detached camera-space hand.
  const sky = own(new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false,
    vertexShader: 'varying vec3 vPosition; void main(){vPosition=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: 'varying vec3 vPosition; void main(){float t=smoothstep(-0.05,0.6,normalize(vPosition).y);gl_FragColor=vec4(mix(vec3(1.0,0.77,0.5),vec3(0.34,0.64,0.84),t),1.0);}',
  }));
  const skyMesh = mesh(root, own(new THREE.SphereGeometry(130, 24, 16)), sky, [0, 0, 0], [1, 1, 1]);
  skyMesh.castShadow = false; skyMesh.receiveShadow = false;
  const sun = mesh(root, leafGeometry, own(new THREE.MeshBasicMaterial({ color: 0xffe6a7, toneMapped: false })), [-24, 14, -77], [4, 4, 4]);
  sun.castShadow = false;
  const daylight = new THREE.HemisphereLight(0xffe3c8, 0x4d4a38, 1.35); root.add(daylight);
  const light = new THREE.DirectionalLight(0xffc58a, 2.7); light.position.set(-24, 14, -77); root.add(light);
  root.visible = false;
  let disposed = false;
  let updateFixtures = null;
  return {
    root,
    update(time, duration, camera, actor = null) {
      if (disposed) return;
      root.visible = true;
      courtyard.animate(time);
      const fixtures = root.getObjectByName('after-dawn-objectives');
      if (fixtures) fixtures.visible = false;
      const t = clamp(time / Math.max(0.001, duration), 0, 1);
      const approach = ease(t / 0.2);
      const opening = ease((t - 0.18) / 0.2);
      const walking = ease((t - 0.38) / 0.56);
      daylight.intensity = 0.4 + 0.95 * opening;
      light.intensity = 0.25 + 2.45 * opening;
      const cameraOffset = 3.55 + Math.min(2.2, Math.max(0, 1 / camera.aspect - 1) * 1.3);
      // Wait until the trailing lens has cleared the threshold too.
      const z = 3.8 - approach * 2.4 - opening * 0.6 - walking * 9.8;
      const closing = ease((-z - cameraOffset - 0.25) / 1.25);
      hinge.rotation.y = -Math.PI * 0.53 * opening * (1 - closing);
      if (actor) {
        actor.position.set(0, 0, z);
        actor.rotation.set(0, Math.PI, 0);
        const human = actor.getObjectByName('human-survivor');
        if (human) {
          human.visible = true; human.scale.setScalar(1);
          human.position.set(0, 0, 0);
          animateHuman(human, time, (t > 0 && t < 0.2) || (t > 0.38 && t < 0.94));
          const rig = human.userData.modelRig;
          // The survivor leans through the door with his shoulder. Keep both
          // connected arm chains beside the torso, not reaching toward the lens.
          const push = ease((t - 0.16) / 0.08) * (1 - ease((t - 0.38) / 0.1));
          const stride = Math.sin(time * 10) * 0.14 * (t > 0.38 && t < 0.94 ? 1 : 0);
          rig.body.rotation.x += 0.12 * push;
          rig.head.rotation.x = -0.05 * walking;
          rig.arms.forEach(({ root: arm, elbow, side }) => {
            arm.rotation.set(-0.08 - side * stride, 0, side * 0.1);
            elbow.rotation.set(-0.18 - push * 0.35, 0, 0);
          });
          const weapon = human.getObjectByName('visible-carbine');
          if (weapon) {
            // A slung, lowered carbine is attached to the torso, not left
            // floating in the previous two-handed aiming position.
            weapon.position.set(0.29, 1.05, 0.04);
            weapon.rotation.set(0.72, 0, -0.08);
          }
        }
      }
      // Follow through the OPEN centre of the door at head height. The old
      // x=2.3 path crossed the solid jamb as z passed zero. Only arc sideways
      // once both camera and actor are outdoors; never put the lens in the rig.
      const reveal = ease((-z - 5.2) / 2.4);
      camera.position.set(0.52 + reveal * 2.15, 2.5 + reveal * 0.55, z + cameraOffset);
      camera.lookAt(-reveal * 0.6, 1.15 + reveal * 0.35, z - 0.3);
      camera.updateMatrixWorld();
    },
    updateJourney(state, camera, actor, moving) {
      if (disposed) return;
      root.visible = true;
      daylight.intensity = 1.35; light.intensity = 2.7;
      courtyard.animate(state.time);
      hinge.rotation.y = 0;
      updateFixtures ??= createDawnFixtures(root, own, state.stops);
      updateFixtures(state);
      actor.position.set(state.x, 0, state.z);
      actor.rotation.set(0, state.yaw, 0);
      const human = actor.getObjectByName('human-survivor');
      human.visible = true; human.scale.setScalar(1); human.position.set(0, 0, 0);
      // First person uses the same two-handed carbine pose and viewmodel as the arena chapters.
      const firstPerson = !!human.userData.viewmodel;
      animateHuman(human, state.time, moving, { viewmodel: firstPerson, relaxed: !firstPerson });
      const rig = human.userData.modelRig;
      const weapon = human.getObjectByName('visible-carbine');
      if (!firstPerson) {
        rig.arms.forEach(({ root: arm, elbow, side }) => {
          arm.rotation.set(Math.sin(state.time * 10) * side * (moving ? 0.16 : 0), 0, side * 0.1);
          elbow.rotation.set(-0.22, 0, 0);
        });
        weapon.position.set(0.29, 1.05, 0.04); weapon.rotation.set(0.72, 0, -0.08);
      }
      // Fixed trailing third-person view: WASD remains world-relative, no lens inside the body or facade.
      const distance = Math.max(7.4, Math.min(12, 5.5 / camera.aspect));
      camera.position.set(state.x + 1.6, 4.7, Math.min(-1.5, state.z + distance));
      camera.lookAt(state.x, 0.9, state.z - 3);
      camera.updateMatrixWorld();
    },
    dispose() {
      if (disposed) return; disposed = true;
      root.removeFromParent(); root.clear();
      for (const resource of resources) resource.dispose(); resources.clear();
    },
  };
}
