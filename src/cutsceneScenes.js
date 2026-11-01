import * as THREE from 'three';
import { createHuman, createSpider, animateHuman, animateSpider, animateSpiderStrike } from './models.js';
import { createCampaignScenery } from './campaignVisuals.js';
import { CAMPAIGN } from './campaignData.js';
import { CUTSCENES, cutsceneDuration } from './cutsceneData.js';
import { proceduralTexture } from './proceduralTextures.js';

const clamp = THREE.MathUtils.clamp;
const smooth = (x) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };
const mix = (a, b, u) => a + (b - a) * u;
const span = (time, from, to) => clamp((time - from) / (to - from), 0, 1);
const mixVec = (a, b, u) => [mix(a[0], b[0], u), mix(a[1], b[1], u), mix(a[2], b[2], u)];

/** Small scene kit: owned geometry and materials, cloned human/spider models, disposal in one place. */
function createKit() {
  const root = new THREE.Group();
  let glowTexture = null;
  const resources = new Set();
  const own = (value) => { resources.add(value); return value; };
  const boxG = own(new THREE.BoxGeometry(1, 1, 1));
  const cylG = own(new THREE.CylinderGeometry(1, 1, 1, 20));
  const sphG = own(new THREE.SphereGeometry(1, 16, 12));
  const mat = (color, extra = {}) => own(new THREE.MeshStandardMaterial({ color, roughness: 0.82, ...extra }));
  const glow = (color, intensity = 0.9) => mat(color, { emissive: color, emissiveIntensity: intensity, roughness: 0.4 });
  const put = (mesh, parent, position, name = '') => {
    mesh.position.set(...position); mesh.name = name; mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  };
  const box = (parent, size, position, material, name) => { const m = new THREE.Mesh(boxG, material); m.scale.set(...size); return put(m, parent, position, name); };
  const cyl = (parent, radius, height, position, material, rotation = null) => {
    const m = new THREE.Mesh(cylG, material); m.scale.set(radius, height, radius); if (rotation) m.rotation.set(...rotation); return put(m, parent, position);
  };
  const ball = (parent, size, position, material) => { const m = new THREE.Mesh(sphG, material); m.scale.set(...size); return put(m, parent, position); };
  const group = (parent, name, x = 0, y = 0, z = 0, rotation = 0) => {
    const g = new THREE.Group(); g.name = name; g.position.set(x, y, z); g.rotation.y = rotation; parent.add(g); return g;
  };
  /** A cloned procedural texture (own repeat) wrapped in a material; falls back to a flat colour without a canvas. */
  function tmat(kind, texture = {}, extra = {}) {
    const map = proceduralTexture(kind, texture);
    if (map) own(map);
    return mat(map ? 0xffffff : texture.color ?? 0x888888, { map, ...extra });
  }
  /** A box that does not cast or receive shadows: floor decals, light strips, glows. */
  function flat(parent, size, position, material, name) {
    const mesh = box(parent, size, position, material, name); mesh.castShadow = false; mesh.receiveShadow = false; return mesh;
  }
  /** A sun-like light that casts soft shadows inside a box around (centre) that follow() can move. */
  function sunLight(color, intensity, offset, area = 40) {
    const light = new THREE.DirectionalLight(color, intensity);
    light.castShadow = true;
    light.shadow.mapSize.set(2048, 2048);
    Object.assign(light.shadow.camera, { left: -area, right: area, top: area, bottom: -area, near: 1, far: 220 });
    light.shadow.camera.updateProjectionMatrix();
    light.shadow.bias = -0.0004; light.shadow.normalBias = 0.04; light.shadow.radius = 3;
    root.add(light, light.target);
    return {
      light,
      follow(x, y, z) { light.target.position.set(x, y, z); light.position.set(x + offset[0], y + offset[1], z + offset[2]); light.target.updateMatrixWorld(); },
    };
  }
  /** Soft round glow (street lamps, windows, the sun) as an additive sprite. */
  function glowSprite(parent, position, size, color = 0xffe2a8, opacity = 0.7) {
    if (!glowTexture) {
      const surface = typeof document !== 'undefined' && document.createElement ? document.createElement('canvas') : null;
      const context = surface?.getContext?.('2d');
      if (context) {
        surface.width = surface.height = 128;
        const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
        gradient.addColorStop(0, 'rgba(255,255,255,1)'); gradient.addColorStop(0.25, 'rgba(255,255,255,.45)'); gradient.addColorStop(1, 'rgba(255,255,255,0)');
        context.fillStyle = gradient; context.fillRect(0, 0, 128, 128);
        glowTexture = own(new THREE.CanvasTexture(surface));
      }
    }
    if (!glowTexture) return null;
    const material = own(new THREE.SpriteMaterial({ map: glowTexture, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    const sprite = new THREE.Sprite(material); sprite.scale.set(size, size, 1); sprite.position.set(...position); parent.add(sprite); return sprite;
  }
  /** Floating dust motes around the camera for air and depth; deterministic from time. */
  function dustMotes(count = 140, radius = 6, color = 0xfff0d0, opacity = 0.5) {
    const positions = new Float32Array(count * 3);
    const geometry = own(new THREE.BufferGeometry()); geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = own(new THREE.PointsMaterial({ color, size: 0.035, transparent: true, opacity, depthWrite: false, sizeAttenuation: true, toneMapped: false }));
    const points = new THREE.Points(geometry, material); points.frustumCulled = false; root.add(points);
    return {
      update(time, camera) {
        for (let i = 0; i < count; i++) {
          const a = i * 12.9898, b = i * 78.233, c = i * 37.719;
          const fx = (Math.sin(a) * 43758.5453) % 1, fy = (Math.sin(b) * 43758.5453) % 1, fz = (Math.sin(c) * 43758.5453) % 1;
          positions[i * 3] = camera.position.x + (fx - 0.5) * radius * 2 + Math.sin(time * 0.3 + i) * 0.25;
          positions[i * 3 + 1] = camera.position.y + (fy - 0.5) * radius + Math.sin(time * 0.2 + i * 0.7) * 0.15;
          positions[i * 3 + 2] = camera.position.z + (fz - 0.5) * radius * 2 + Math.cos(time * 0.25 + i) * 0.25;
        }
        geometry.attributes.position.needsUpdate = true;
      },
    };
  }
  function model(parent, kind, options) {
    const m = kind === 'spider' ? createSpider(options?.variant || 'boss') : createHuman(options);
    const geometries = new Map(), materials = new Map();
    m.traverse((node) => {
      if (node.geometry) { if (!geometries.has(node.geometry)) geometries.set(node.geometry, own(node.geometry.clone())); node.geometry = geometries.get(node.geometry); }
      if (node.material) { if (!materials.has(node.material)) materials.set(node.material, own(node.material.clone())); node.material = materials.get(node.material); }
      if (node.isInstancedMesh) own(node);
    });
    parent.add(m);
    return m;
  }
  // Screen-space dressing attached to the camera: fade to black and eyelids.
  const fadeMaterial = own(new THREE.MeshBasicMaterial({ color: 0x010207, transparent: true, opacity: 0, depthTest: false, depthWrite: false, toneMapped: false }));
  const planeG = own(new THREE.PlaneGeometry(2, 2));
  const fade = new THREE.Mesh(planeG, fadeMaterial); fade.renderOrder = 1200; fade.frustumCulled = false; fade.position.z = -0.3;
  const lidMaterial = own(new THREE.MeshBasicMaterial({ color: 0x010207, depthTest: false, depthWrite: false, toneMapped: false }));
  const lidTop = new THREE.Mesh(planeG, lidMaterial), lidBottom = new THREE.Mesh(planeG, lidMaterial);
  for (const lid of [lidTop, lidBottom]) { lid.renderOrder = 1201; lid.frustumCulled = false; lid.visible = false; }
  const tintMaterial = own(new THREE.MeshBasicMaterial({ color: 0x8a0f0f, transparent: true, opacity: 0, depthTest: false, depthWrite: false, toneMapped: false }));
  const tint = new THREE.Mesh(planeG, tintMaterial); tint.renderOrder = 1199; tint.frustumCulled = false; tint.position.z = -0.29; tint.visible = false;
  const dress = new THREE.Group(); dress.add(tint, fade, lidTop, lidBottom);
  /** opacity 0..1 fades the whole view to black; openness 0 (closed) .. 1 (open) slides two eyelids away from the middle. */
  function setScreen(camera, opacity, openness = 1, redness = 0) {
    if (dress.parent !== camera) camera.add(dress);
    const half = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 0.3;
    tint.scale.set(half * camera.aspect, half, 1);
    tintMaterial.opacity = clamp(redness, 0, 1);
    tint.visible = redness > 0.001;
    fade.scale.set(half * camera.aspect, half, 1);
    fadeMaterial.opacity = clamp(opacity, 0, 1);
    fade.visible = opacity > 0.001;
    const o = clamp(openness, 0, 1);
    for (const [lid, sign] of [[lidTop, 1], [lidBottom, -1]]) {
      lid.visible = o < 0.999;
      lid.scale.set(half * camera.aspect, half * 0.5, 1);
      lid.position.set(0, sign * half * (0.5 + o), -0.3 - 0.004);
    }
  }
  /** Detach the fade and eyelid planes from the camera so gameplay is never covered by a finished scene. */
  function hideScreen() { dress.removeFromParent(); }
  function dispose() {
    dress.removeFromParent(); root.removeFromParent(); root.clear();
    for (const resource of resources) resource.dispose?.();
    resources.clear();
  }
  return { root, own, mat, glow, tmat, flat, sunLight, glowSprite, dustMotes, box, cyl, ball, group, model, setScreen, hideScreen, dispose };
}

// ============================================================================
// Scene 1: waking up on the ward floor (chapter 1)
// ============================================================================
function wakeUp(k) {
  const dust = k.dustMotes(120, 5, 0x9fb4d8, 0.35);
  const scenery = createCampaignScenery(CAMPAIGN[0]);
  k.root.add(scenery.root);
  const hemi = new THREE.HemisphereLight(0x7f96c8, 0x2a2430, 1.7); k.root.add(hemi);
  const emergency = new THREE.PointLight(0xff4a3a, 16, 16, 1.6); emergency.position.set(-3, 3.2, 2); k.root.add(emergency);
  const cold = new THREE.PointLight(0x9ac8ff, 18, 18, 1.5); cold.position.set(2, 3.4, -1); k.root.add(cold);
  const hero = k.model(k.root, 'human', { variant: 'hero' });
  const carbine = hero.getObjectByName('visible-carbine'); carbine.visible = false;
  const rig = hero.userData.modelRig;
  const HIP = { x: 0, z: 1.0 };
  let last = 0;
  return {
    update(time, camera) {
      const dt = Math.min(0.05, Math.max(0, time - last)); last = time;
      scenery.update(dt);
      emergency.intensity = 12 + Math.sin(time * 9) * 4 * (Math.sin(time * 1.3) > 0.2 ? 1 : 0.2);
      cold.intensity = 14 + Math.sin(time * 37) * 3 * (Math.random() > 0.97 ? 3 : 0.4);
      // Lying -> sitting up -> standing. The body rotates around the hips, not the feet.
      const sit = smooth(span(time, 6.2, 8.4)), stand = smooth(span(time, 8.9, 11.6));
      const angle = mix(-Math.PI / 2, 0, Math.max(sit * 0.93, stand));
      const hipY = mix(0.17, 0.86, stand) + sit * 0.05 * (1 - stand);
      hero.rotation.set(angle, 0, 0);
      hero.position.set(HIP.x, hipY - 0.86 * Math.cos(angle), HIP.z - 0.86 * Math.sin(angle));
      hero.rotation.y = 0;
      animateHuman(hero, time, false, { relaxed: true });
      // Legs rest along the floor until the stand-up straightens them.
      const legWorld = -Math.PI / 2 * (1 - stand);
      rig.legs.forEach(({ root: leg, knee }) => { leg.rotation.x = legWorld - angle; knee.rotation.x = 0.1 * (1 - stand); });
      rig.arms.forEach(({ root: arm, elbow, side }) => {
        const brace = sit * (1 - stand);
        arm.rotation.set(0.5 * brace - 0.3 * (1 - sit), 0, side * (0.3 + 0.6 * brace));
        elbow.rotation.set(-0.2 - 0.5 * brace, 0, 0);
      });
      rig.head.rotation.set(-0.25 * (1 - sit) + 0.35 * sit * (1 - stand), Math.sin(time * 0.7) * 0.2 * sit, 0);
      carbine.visible = time > 12.7;
      if (carbine.visible) { const up = smooth(span(time, 12.7, 13.6)); rig.arms.forEach(({ root: arm, elbow }) => { arm.rotation.x = -0.9 * up; elbow.rotation.x = -0.6 * up; }); }
      // Camera: eyes on the ceiling, then the room, then a side view, then behind the hero.
      let pos, look;
      if (time < 6.2) {
        const u = smooth(time / 6.2);
        pos = [0, 0.38, 1.0 - 0.7]; look = mixVec([0, 3.2, 0.5], [3.2, 0.9, -3.4], u);
        pos[0] += Math.sin(time * 1.3) * 0.02;
      } else if (time < 11.6) {
        const u = smooth(span(time, 6.2, 11.6));
        pos = mixVec([4.6, 1.2, 5.2], [3.6, 1.5, 4.4], u); look = mixVec([0, 0.6, 0.8], [0, 1.0, 0.9], u);
      } else {
        const u = smooth(span(time, 11.6, 15));
        pos = mixVec([-2.4, 1.7, 5.6], [-0.9, 1.5, 4.2], u); look = mixVec([0, 1.4, -1], [0, 1.45, -3], u);
      }
      camera.position.set(...pos); camera.lookAt(...look);
      // Eyes: closed, a heavy blink, then open.
      const open = time < 1.8 ? 0 : time < 2.5 ? smooth(span(time, 1.8, 2.5)) * 0.45 : time < 3.0 ? 0.45 * (1 - smooth(span(time, 2.5, 3.0))) : smooth(span(time, 3.0, 4.4));
      dust.update(time, camera);
      k.setScreen(camera, 1 - smooth(span(time, 0, 1.2)) + smooth(span(time, 14.2, 15)), time < 6.2 ? open : 1);
    },
    dispose() { scenery.dispose(); },
  };
}

// ============================================================================
// Scene 2: the matriarch rises in the pump room (chapter 3)
// ============================================================================
function bossIntro(k) {
  const dust = k.dustMotes(160, 7, 0xffc08a, 0.45);
  const scenery = createCampaignScenery(CAMPAIGN[2]);
  k.root.add(scenery.root);
  const straggler = scenery.root.getObjectByName('infected-pump-straggler'); if (straggler) straggler.visible = false;
  k.root.add(new THREE.HemisphereLight(0x8a8fa8, 0x2a2018, 1.0));
  const amber = new THREE.PointLight(0xffa24a, 40, 26, 1.4); amber.position.set(0, 4, 2); k.root.add(amber);
  const red = new THREE.PointLight(0xff3b30, 0, 20, 1.5); red.position.set(0, 2, -6); k.root.add(red);
  const boss = k.model(k.root, 'spider', { variant: 'boss' });
  const BOSS_SCALE = 5;
  const hero = k.model(k.root, 'human', { variant: 'hero' });
  hero.position.set(0, 0, 8.5); hero.rotation.y = Math.PI;
  const hatch = [];
  for (let i = 0; i < 8; i++) {
    const s = k.model(k.root, 'spider', { variant: i % 3 === 0 ? 'runner' : 'normal' });
    s.visible = false; hatch.push({ s, angle: i * 0.8 + 0.3, speed: 2.4 + (i % 4) * 0.35 });
  }
  let last = 0;
  return {
    update(time, camera) {
      const dt = Math.min(0.05, Math.max(0, time - last)); last = time;
      scenery.update(dt);
      amber.intensity = 34 + Math.sin(time * 11) * 6 + (Math.sin(time * 3) > 0.9 ? -12 : 0);
      const rise = smooth(span(time, 3.6, 8.4));
      boss.visible = time > 3.2;
      boss.scale.setScalar(BOSS_SCALE);
      boss.position.set(0, -3.6 * (1 - rise), -8);
      boss.rotation.y = 0;
      animateSpider(boss, time, time > 3.4 && rise < 1);
      const roar = smooth(span(time, 8.0, 8.6)) * (1 - smooth(span(time, 11.2, 12))); 
      animateSpiderStrike(boss, time, roar * (0.6 + 0.4 * Math.sin(time * 9)), roar);
      red.intensity = roar * 30;
      hero.visible = true;
      animateHuman(hero, time, false, { viewmodel: false });
      hero.rotation.y = Math.PI + Math.sin(time * 0.6) * 0.04;
      for (const h of hatch) {
        const u = span(time, 9.4, 14);
        h.s.visible = u > 0;
        const r = 1.2 + u * 14 * h.speed / 3;
        h.s.position.set(Math.sin(h.angle) * r * 0.9, 0, -8 + Math.cos(h.angle) * r * 0.55);
        h.s.rotation.y = Math.atan2(Math.sin(h.angle), Math.cos(h.angle) * 0.6);
        animateSpider(h.s, time * 1.4 + h.angle, true);
      }
      let pos, look;
      if (time < 4) { const u = smooth(time / 4); pos = mixVec([0.5, 3.0, 12.2], [0.2, 2.5, 10.6], u); look = [0, 1.6, -8]; }
      else if (time < 8.4) { const u = smooth(span(time, 4, 8.4)); pos = mixVec([-3.2, 0.7, 2.2], [-1.2, 1.0, -1.2], u); look = mixVec([0, 0.5, -8], [0, 1.4, -8], u); }
      else if (time < 11.2) { const u = smooth(span(time, 8.4, 11.2)); pos = mixVec([-1.6, 1.6, 0.4], [0.8, 2.2, -1.0], u); look = mixVec([0, 1.4, -8], [0, 1.9, -8], u); }
      else { const u = smooth(span(time, 11.2, 14)); pos = mixVec([-4.2, 1.6, 9.2], [-2.4, 1.8, 10.4], u); look = mixVec([0, 1.2, -3], [0, 1.2, -5], u); }
      // Tremor of the pipes and floor as the creature breaks through.
      const shake = (0.01 + 0.05 * Math.sin(Math.PI * span(time, 3, 9))) * (time < 12 ? 1 : 0.2);
      camera.position.set(pos[0] + Math.sin(time * 41) * shake, pos[1] + Math.sin(time * 53) * shake, pos[2]);
      camera.lookAt(...look);
      dust.update(time, camera);
      k.setScreen(camera, 1 - smooth(span(time, 0, 0.7)) + smooth(span(time, 13.3, 14)));
    },
    dispose() { scenery.dispose(); },
  };
}

// ============================================================================
// Scene 3: the drive to the hospital (between the courtyard and the hospital)
// ============================================================================
const ROAD_END = -128;
/** The empty street: road, kerbs, lamps, buildings, trees, wrecks, the compound gate and the hospital at its end. */
function buildStreet(k) {
  const { root, box, cyl, ball, group, mat, glow } = k;
  root.add(new THREE.HemisphereLight(0xffe8cc, 0x6a5e4c, 1.5));
  const sun = k.sunLight(0xffd29a, 4.6, [-30, 20, -60], 46);
  sun.follow(0, 0, 0);
  const sky = k.own(new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false,
    vertexShader: 'varying vec3 vP; void main(){vP=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: 'varying vec3 vP; void main(){float t=smoothstep(-0.05,0.55,normalize(vP).y);gl_FragColor=vec4(mix(vec3(1.0,0.74,0.5),vec3(0.36,0.58,0.82),t),1.0);}' }));
  const skyMesh = new THREE.Mesh(k.own(new THREE.SphereGeometry(190, 24, 14)), sky); root.add(skyMesh);
  const sunDisc = new THREE.Mesh(k.own(new THREE.SphereGeometry(6, 16, 10)), k.own(new THREE.MeshBasicMaterial({ color: 0xffe6a8, toneMapped: false })));
  sunDisc.position.set(-34, 14, -170); root.add(sunDisc);
  k.glowSprite(root, [-34, 14, -166], 90, 0xffd9a0, 0.85); k.glowSprite(root, [-34, 14, -166], 200, 0xffb87a, 0.35);
  // Lamp glow along the street so the lights read as lights.
  for (let z = 10; z > -140; z -= 14) for (const side of [-1, 1]) k.glowSprite(root, [side * 4.7, 5.0, z], 1.6, 0xffe3a8, 0.55);
  const m = {
    asphalt: k.tmat('asphalt', { repeat: [2, 100], size: 512, color: 0x2f3338 }, { roughness: 0.95 }), walk: k.tmat('pavement', { repeat: [3, 150], color: 0xa59f90 }, { roughness: 0.9 }),
    curb: mat(0xc7c1ae), line: mat(0xd8d2b4, { roughness: 0.6 }), brick: k.tmat('brick', { repeat: [14, 2], size: 256, color: 0x8a5a47 }, { roughness: 0.9 }), plaster: k.tmat('plaster', { repeat: [4, 2], color: 0xcfc4a8 }, { roughness: 0.92 }),
    dark: mat(0x1d2a30), roof: mat(0x6f4437), wood: mat(0x6a4e39), steel: mat(0x5d7076, { metalness: 0.5 }), bark: mat(0x655348), leaf: mat(0x5d8040),
    glass: mat(0x8fc0d0, { transparent: true, opacity: 0.28, roughness: 0.1, depthWrite: false }), lamp: glow(0xfff0c8, 0.8), win: glow(0xf2d68e, 0.7),
    paint: mat(0x9b2f2a, { metalness: 0.35, roughness: 0.45 }), rubber: mat(0x16191b), seat: mat(0x4a4f57), chrome: mat(0xb9c2c6, { metalness: 0.7, roughness: 0.3 }),
    head: glow(0xfff2c0, 0.0), tail: glow(0xff2a1a, 0.15), white: mat(0xe8e8df), red: glow(0xd24f4f, 0.9), warm: glow(0xffc27a, 0.9),
  };
  // ---- street: road, kerbs, sidewalks, lane marks, lamp posts, buildings ----
  box(root, [9, 0.3, 330], [0, -0.15, -80], m.asphalt);
  for (const side of [-1, 1]) {
    box(root, [0.3, 0.32, 330], [side * 4.4, 0.0, -80], m.curb);
    box(root, [6, 0.3, 330], [side * 7.6, 0.0, -80], m.walk);
  }
  box(root, [160, 0.2, 360], [0, -0.35, -80], k.tmat('grass', { repeat: [40, 90], size: 256, color: 0x4c5a3a }, { roughness: 1 }));
  for (let z = 12; z > -146; z -= 6) k.flat(root, [0.2, 0.02, 2.6], [0, 0.02, z], m.line);
  for (let z = 10; z > -140; z -= 14) {
    for (const side of [-1, 1]) {
      cyl(root, 0.08, 5.2, [side * 6.0, 2.6, z], m.steel); box(root, [1.4, 0.12, 0.12], [side * 5.35, 5.2, z], m.steel);
      box(root, [0.5, 0.14, 0.3], [side * 4.7, 5.12, z], m.lamp);
    }
  }
  const heights = [11, 15, 9, 13, 17, 10, 14];
  for (let i = 0, z = -6; z > -128; z -= 17, i++) {
    for (const side of [-1, 1]) {
      const h = heights[(i + (side > 0 ? 3 : 0)) % heights.length], x = side * 19;
      const facade = k.tmat('facade', { repeat: [1.25, h / 18], size: 512, color: i % 2 ? 0x9a6a55 : 0xcfc4a8, seed: 31 + i * 13 + (side > 0 ? 7 : 0), lit: 0.16 }, { roughness: 0.9 });
      const plain = i % 2 ? m.brick : m.plaster;
      const faces = side < 0 ? [facade, plain, m.roof, plain, plain, plain] : [plain, facade, m.roof, plain, plain, plain];
      box(root, [15, h, 15], [x, h / 2, z], faces); box(root, [15.8, 0.6, 15.8], [x, h + 0.25, z], m.roof);
      box(root, [15.3, 0.25, 15.3], [x, 3.4, z], m.curb);
    }
  }
  // Trees, litter, abandoned vehicles and a dim traffic signal: the street is empty, not unlived-in.
  for (let z = 0; z > -125; z -= 11) for (const side of [-1, 1]) {
    cyl(root, 0.22, 3.2, [side * 9.2, 1.6, z - 4], m.bark); ball(root, [1.9, 1.7, 1.9], [side * 9.2, 4.0, z - 4], m.leaf);
    ball(root, [1.3, 1.1, 1.3], [side * 9.2 + 0.7, 4.8, z - 3.6], m.leaf); ball(root, [1.2, 1.0, 1.2], [side * 9.2 - 0.6, 3.5, z - 4.4], m.leaf);
  }
  for (const [x, z, ry, color] of [[-5.6, -39, 0.22, 0x3f5f8a], [5.6, -67, -0.2, 0x7a7a2c], [-5.6, -95, 0.3, 0x5a2f2f]]) {
    const car = group(root, 'wreck', x, 0, z, ry);
    box(car, [2.0, 0.8, 4.4], [0, 0.55, 0], mat(color)); box(car, [1.7, 0.6, 2.2], [0, 1.2, 0.3], m.glass); cyl(car, 0.35, 0.25, [1.0, 0.35, 1.4], m.rubber, [0, 0, Math.PI / 2]);
  }
  for (let i = 0; i < 6; i++) box(root, [0.5, 0.02, 0.35], [(i - 3) * 1.1, 0.02, -20 - (i % 3) * 7], m.white);
  box(root, [40, 0.3, 40], [-33, -0.12, 2], mat(0x9a9482));
  box(root, [18, 7, 14], [-26, 3.5, 12], m.plaster); box(root, [18.6, 0.4, 14.6], [-26, 7.2, 12], m.roof);
  // ---- the compound gate the survivors leave through ----
  for (const [z0, z1] of [[14, 6.8], [1.2, -14]]) {
    const len = z0 - z1; box(root, [0.6, 3.4, len], [-12.6, 1.7, (z0 + z1) / 2], m.brick); box(root, [0.9, 0.22, len], [-12.6, 3.5, (z0 + z1) / 2], m.curb);
  }
  for (const z of [6.6, 1.4]) { box(root, [1.1, 4.1, 1.1], [-12.6, 2.05, z], m.brick); box(root, [1.3, 0.25, 1.3], [-12.6, 4.2, z], m.curb); cyl(root, 0.16, 0.6, [-12.6, 4.6, z], m.lamp); }
  for (let z = 1.9; z < 6.4; z += 0.3) box(root, [0.05, 2.6, 0.05], [-12.6, 1.3, z], m.steel);
  box(root, [0.1, 0.1, 4.6], [-12.6, 2.6, 4.0], m.steel);
  // ---- hospital at the end of the road ----
  const hosp = group(root, 'hospital', 0, 0, -152);
  box(hosp, [54, 18, 12], [0, 9, 0], m.plaster); box(hosp, [55, 0.7, 13], [0, 18.3, 0], m.roof);
  box(hosp, [60, 0.25, 40], [0, -0.05, 24], k.tmat('asphalt', { repeat: [10, 7], size: 512, color: 0x2f3338 }, { roughness: 0.95 }));
  for (const y of [3.6, 7.8, 12, 16]) for (let x = -23; x <= 23; x += 3.6) {
    if (Math.abs(x) < 6 && y < 6) continue;
    box(hosp, [1.7, 1.9, 0.12], [x, y, 6.05], ((Math.round(x) * 3 + Math.round(y)) % 7 === 0) ? m.win : m.dark);
  }
  box(hosp, [16, 0.7, 8], [0, 5.2, 9.6], m.roof);
  for (const x of [-7, 7]) box(hosp, [0.7, 5.2, 0.7], [x, 2.6, 13], m.curb);
  box(hosp, [15, 4.4, 0.2], [0, 2.4, 6.1], m.dark); box(hosp, [7, 3.6, 0.1], [-3.8, 2.0, 6.2], m.warm); box(hosp, [7, 3.6, 0.1], [3.8, 2.0, 6.2], m.warm);
  box(hosp, [11, 1.6, 0.4], [0, 6.6, 6.3], m.white); box(hosp, [9, 1.0, 0.1], [0, 6.6, 6.55], m.red);
  box(hosp, [1.8, 0.5, 0.12], [0, 6.6, 6.64], m.white); box(hosp, [0.5, 1.8, 0.12], [0, 6.6, 6.64], m.white);
  for (const x of [-12, 12]) { cyl(hosp, 0.16, 5.6, [x, 2.8, 14], m.steel); box(hosp, [0.9, 0.2, 0.5], [x, 5.7, 14], m.lamp); }
  const amb = group(hosp, 'ambulance', 15, 0, 14, 0.2);
  box(amb, [2.3, 1.9, 5.4], [0, 1.2, 0], m.white); box(amb, [2.34, 0.14, 4], [0, 0.95, 0], m.red); box(amb, [1.6, 0.14, 0.5], [0, 2.3, -1.4], m.dark);
  const bed = group(hosp, 'flowerbed', -12, 0, 17); box(bed, [6, 0.5, 1.8], [0, 0.25, 0], m.curb); box(bed, [5.6, 0.2, 1.4], [0, 0.55, 0], mat(0x5a4332));
  m.sun = sun;
  return m;
}

/** The sedan: body, glass, wheels, interior and two hinged doors. Faces -Z; returns its parts for animation. */
function buildCar(k, m, x) {
  const { root, box, cyl, group, mat, glow, flat } = k;
  const car = group(root, 'car', x, 0, 0);
  const paint = k.own(new THREE.MeshPhysicalMaterial({ color: 0xb02b26, metalness: 0.12, roughness: 0.38, clearcoat: 0.8, clearcoatRoughness: 0.18 }));
  const trim = mat(0x14171a, { roughness: 0.6 });
  const glass = k.own(new THREE.MeshPhysicalMaterial({ color: 0x8fb4c4, metalness: 0.1, roughness: 0.05, transparent: true, opacity: 0.32, depthWrite: false }));
  const chrome = mat(0xc9d0d4, { metalness: 0.9, roughness: 0.2 });
  const headLens = k.own(m.head);
  const tires = [];
  // Body shell: an extruded side profile with a bevel gives a smooth sedan silhouette.
  const profile = new THREE.Shape();
  profile.moveTo(-2.22, 0.34); profile.lineTo(-2.4, 0.46); profile.lineTo(-2.42, 0.74); profile.quadraticCurveTo(-2.4, 0.86, -2.16, 0.9);
  profile.quadraticCurveTo(-1.4, 0.98, -0.7, 1.03); profile.lineTo(1.1, 1.03); profile.quadraticCurveTo(1.7, 1.02, 2.2, 0.96);
  profile.quadraticCurveTo(2.42, 0.9, 2.42, 0.7); profile.lineTo(2.4, 0.46); profile.lineTo(2.22, 0.34); profile.lineTo(-2.22, 0.34);
  const shellGeometry = k.own(new THREE.ExtrudeGeometry(profile, { depth: 1.6, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.12, bevelSegments: 5, curveSegments: 14 }));
  shellGeometry.computeVertexNormals();
  const shell = new THREE.Mesh(shellGeometry, paint); shell.rotation.y = -Math.PI / 2; shell.position.set(0.8, 0, 0);
  shell.castShadow = true; shell.receiveShadow = true; car.add(shell);
  // Roof, pillars and glass: a greenhouse with real window openings.
  const roofGeometry = k.own(new THREE.ExtrudeGeometry((() => { const s = new THREE.Shape(); s.moveTo(-0.35, 0); s.lineTo(1.12, 0); s.lineTo(1.12, 0.06); s.lineTo(-0.35, 0.06); return s; })(), { depth: 1.5, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 3 }));
  const roof = new THREE.Mesh(roofGeometry, paint); roof.rotation.y = -Math.PI / 2; roof.position.set(0.75, 1.62, 0); roof.castShadow = true; car.add(roof);
  const pillar = (px, y0, z0, y1, z1, thick = 0.07) => {
    const dy = y1 - y0, dz = z1 - z0, len = Math.hypot(dy, dz);
    const mesh = box(car, [thick, len, thick], [px, (y0 + y1) / 2, (z0 + z1) / 2], paint);
    mesh.rotation.x = Math.atan2(dz, dy) * 1; return mesh;
  };
  for (const sx of [-1, 1]) {
    pillar(sx * 0.9, 1.02, -0.72, 1.64, -0.3);       // A pillar
    box(car, [0.07, 0.62, 0.08], [sx * 0.9, 1.33, 0.42], paint);   // B pillar
    pillar(sx * 0.88, 1.02, 1.5, 1.64, 1.05);        // C pillar
    box(car, [0.04, 0.5, 0.82], [sx * 0.9, 1.33, -0.0], glass); box(car, [0.04, 0.5, 0.9], [sx * 0.9, 1.33, 0.92], glass);
    // mirror, handle, headlight, tail light, wheels
    box(car, [0.1, 0.12, 0.2], [sx * 1.08, 1.08, -0.62], paint); box(car, [0.18, 0.02, 0.02], [sx * 1.0, 1.05, -0.64], trim);
    box(car, [0.03, 0.03, 0.2], [sx * 1.06, 0.98, 0.3], chrome);
    box(car, [0.4, 0.17, 0.08], [sx * 0.66, 0.78, -2.5], chrome); box(car, [0.36, 0.13, 0.09], [sx * 0.66, 0.78, -2.52], headLens);
    box(car, [0.38, 0.14, 0.06], [sx * 0.7, 0.8, 2.52], m.tail); box(car, [0.1, 0.16, 0.1], [sx * 0.98, 0.78, -2.3], mat(0xffb347, { emissive: 0xffa11a, emissiveIntensity: 0.1 }));
    for (const z of [-1.5, 1.5]) {
      // One group per wheel so the whole wheel (tyre, rim, hub, spokes) can spin; the arch trim stays on the body.
      const tire = group(car, 'tire', sx * 0.95, 0.38, z); tires.push(tire);
      cyl(tire, 0.38, 0.26, [0, 0, 0], m.rubber, [0, 0, Math.PI / 2]);
      cyl(tire, 0.25, 0.28, [0.01, 0, 0], chrome, [0, 0, Math.PI / 2]);
      cyl(tire, 0.1, 0.3, [0.03, 0, 0], trim, [0, 0, Math.PI / 2]);
      for (let a = 0; a < 5; a++) { const spoke = box(tire, [0.02, 0.4, 0.045], [0.02, 0, 0], chrome); spoke.rotation.x = a * Math.PI / 5; }
      cyl(car, 0.44, 0.1, [sx * 0.88, 0.52, z], trim, [0, 0, Math.PI / 2]);
    }
  }
  const wind = box(car, [1.74, 0.78, 0.04], [0, 1.34, -0.5], glass); wind.rotation.x = 0.58;
  const back = box(car, [1.72, 0.55, 0.04], [0, 1.32, 1.3], glass); back.rotation.x = -0.52;
  box(car, [1.5, 0.22, 0.04], [0, 0.66, -2.5], trim); box(car, [1.2, 0.07, 0.04], [0, 0.78, -2.53], chrome);
  box(car, [0.5, 0.12, 0.02], [0, 0.5, -2.55], mat(0xe8e6d8)); box(car, [0.5, 0.12, 0.02], [0, 0.5, 2.5], mat(0xe8e6d8));
  box(car, [1.9, 0.16, 0.14], [0, 0.42, -2.45], chrome); box(car, [1.9, 0.16, 0.14], [0, 0.42, 2.45], chrome);
  box(car, [1.7, 0.1, 4.4], [0, 0.3, 0], trim);
  // interior
  for (const sx of [-0.45, 0.45]) {
    box(car, [0.5, 0.16, 0.58], [sx, 0.66, 0.55], m.seat); box(car, [0.5, 0.68, 0.12], [sx, 0.98, 0.88], m.seat); box(car, [0.22, 0.2, 0.1], [sx, 1.42, 0.9], m.seat);
  }
  box(car, [0.4, 0.5, 0.7], [0, 0.66, 0.2], trim);
  box(car, [1.7, 0.28, 0.5], [0, 0.97, -0.42], trim); box(car, [1.5, 0.05, 0.3], [0, 1.13, -0.4], mat(0x252a30));
  for (let g = 0; g < 3; g++) flat(car, [0.14, 0.14, 0.02], [-0.55 + g * 0.17, 1.03, -0.18], glow(0xb7e6ff, 0.5));
  box(car, [0.2, 0.08, 0.04], [0, 1.58, -0.24], trim);
  const wheel = k.own(new THREE.Mesh(k.own(new THREE.TorusGeometry(0.17, 0.025, 10, 24)), trim)); wheel.position.set(-0.45, 1.05, -0.2); wheel.rotation.x = 1.0; car.add(wheel);
  const hub = box(car, [0.1, 0.1, 0.04], [-0.45, 1.05, -0.2], chrome); hub.rotation.x = 1.0;
  const doors = {};
  for (const [name, sx] of [['driver', -1], ['passenger', 1]]) {
    const hinge = group(car, `door-${name}`, sx * 1.0, 0, -0.52);
    box(hinge, [0.07, 0.62, 1.45], [0, 0.72, 0.72], paint); box(hinge, [0.05, 0.46, 1.25], [0, 1.28, 0.66], glass);
    box(hinge, [0.08, 0.04, 0.3], [sx * 0.04, 0.98, 1.2], chrome);
    doors[name] = hinge;
  }
  return { car, wheel, doors, roof, tires };
}

function carRide(k) {
  const { root, mat } = k;
  const m = buildStreet(k);
  const dust = k.dustMotes(90, 8, 0xfff0d0, 0.4);
  const { car, wheel, doors, tires } = buildCar(k, m, -2.2);
  const nina = k.model(root, 'human', { variant: 'medic' });
  const hero = k.model(root, 'human', { variant: 'hero' });
  for (const h of [nina, hero]) h.getObjectByName('visible-carbine').visible = false;
  // The wound in the hero's side: a dark red patch on the jacket that he presses a hand to.
  k.box(hero.userData.modelRig.body, [0.16, 0.2, 0.02], [-0.1, 1.12, 0.17], mat(0x6e1a16)).castShadow = false;
  const SEAT = { driver: [-0.45, 0.68, 0.5], passenger: [0.45, 0.68, 0.5] };
  const carBase = { x: -2.2 };
  const STOP = 138;                                          // the car stops a few steps from the hospital entrance
  const dist = (time) => STOP * smooth(span(time, 11.2, 24.4));
  const carZ = (time) => -dist(time);
  const stopZ = -STOP, entranceZ = -146.2;
  function walkTo(h, points, from, speed, time) {
    const t = Math.max(0, time - from);
    let remaining = t * speed, x = points[0][0], z = points[0][1], yaw = h.rotation.y, moving = t > 0;
    let done = false;
    for (let i = 1; i < points.length; i++) {
      const [px, pz] = points[i], len = Math.hypot(px - x, pz - z);
      yaw = Math.atan2(px - x, pz - z);
      if (remaining <= len) { x += (px - x) * remaining / len; z += (pz - z) * remaining / len; remaining = 0; break; }
      remaining -= len; x = px; z = pz; if (i === points.length - 1) { done = true; moving = false; }
    }
    return { done, moving: moving && !done, x, z, yaw };
  }
  function seat(h, name, u, slump) {
    const rig = h.userData.modelRig;
    rig.legs.forEach(({ root: leg, knee }) => { leg.rotation.x = -1.5 * u; knee.rotation.x = 1.55 * u; leg.position.y = 0.86; });
    const driver = name === 'driver';
    rig.arms.forEach(({ root: arm, elbow, side }) => {
      if (driver) { arm.rotation.set(mix(arm.rotation.x, -1.05, u), 0, side * 0.12 * u); elbow.rotation.set(mix(elbow.rotation.x, -0.55, u), 0, 0); }
      else { arm.rotation.set(mix(arm.rotation.x, -0.2, u), 0, side * 0.1 * u); elbow.rotation.set(mix(elbow.rotation.x, -1.25, u), 0, 0); }
    });
    rig.body.rotation.x += slump * u; rig.head.rotation.x += 0.25 * slump * u; rig.head.rotation.z += 0.18 * slump * u;
  }
  const doorOpen = (time, a, b, c, d) => smooth(span(time, a, b)) * (1 - smooth(span(time, c, d)));
  // After the stop: Nina steps out, runs round the back to the passenger side, and the two walk to the entrance together.
  const T_STOP = 24.4, T_NINA_OUT = 25.4, T_HERO_OUT = 27.0, T_WALK = 31.4;
  const NINA_ROUND = [[-3.8, 0.6], [-4.0, 3.4], [-0.1, 3.4], [-0.1, 0.5]];     // relative to the stopped car
  return {
    fog: { color: 0xf1cba2, near: 70, far: 300 },
    update(time, camera) {
      const z = carZ(time);
      m.sun.follow(carBase.x, 0, z);
      const speed = Math.max(0, (carZ(time - 0.05) - carZ(time + 0.05)) / 0.1);
      const braking = time > 21.5 ? smooth(span(time, 21.5, 24.0)) * (1 - smooth(span(time, 24.0, 24.6))) : 0;
      // The car sways gently, rolls on its springs and noses down when it brakes; the wheels turn with the distance travelled.
      car.position.set(carBase.x + Math.sin(time * 0.55) * 0.18 * Math.min(1, speed / 10), 0, z);
      car.rotation.y = Math.cos(time * 0.55) * 0.012 * Math.min(1, speed / 10);
      car.rotation.x = 0.022 * braking * (speed > 0.5 ? 1 : 0);
      car.rotation.z = Math.sin(time * 0.55) * 0.006 * Math.min(1, speed / 10);
      car.position.y = Math.sin(time * 38) * 0.004 * (time > 11 && time < 24.6 ? 1 : 0) + Math.sin(time * 21) * 0.01 * Math.min(1, speed / 12);
      tires.forEach((tire) => { tire.rotation.x = -dist(time) / 0.38; });
      m.head.emissiveIntensity = time > 11.0 ? 1.6 : 0; m.tail.emissiveIntensity = time > 11.0 ? 0.9 + braking * 1.2 : 0.15;
      wheel.rotation.z = -0.2 + Math.sin(time * 0.55 + 1.2) * 0.22 * Math.min(1, speed / 10);
      const cx = car.position.x;
      // Doors: Nina's opens when she arrives and again when she leaves, the passenger door for the hero both times.
      doors.driver.rotation.y = -1.15 * doorOpen(time, 5.6, 6.4, 7.8, 8.4) - 1.15 * doorOpen(time, T_NINA_OUT - 0.5, T_NINA_OUT, T_NINA_OUT + 1.6, T_NINA_OUT + 2.4);
      doors.passenger.rotation.y = 1.15 * doorOpen(time, 8.6, 9.4, 10.2, 10.8) + 1.15 * doorOpen(time, T_HERO_OUT - 0.6, T_HERO_OUT, T_HERO_OUT + 3.4, T_HERO_OUT + 4.4);
      // ---- Nina ----
      const nSeatIn = smooth(span(time, 6.2, 7.4)), nSeatOut = smooth(span(time, T_NINA_OUT, T_NINA_OUT + 0.9));
      const nSeat = nSeatIn * (1 - nSeatOut);
      const nWalkIn = walkTo(nina, [[-14.2, 3.1], [-5.8, 3.1], [-3.9, 0.9], [-3.5, 0.0]], 0.2, 1.95, time);
      const nWalkOut = walkTo(nina, NINA_ROUND.map(([x, zz]) => [carBase.x + x + 2.2, stopZ + zz]), T_NINA_OUT + 0.9, 2.2, time);
      const ninaOutside = time >= T_NINA_OUT + 0.9;
      const supporting = time >= T_WALK;
      let ninaMoving;
      if (!ninaOutside) {
        nina.position.set(mix(-3.5, carBase.x + SEAT.driver[0], nSeatIn), mix(0, SEAT.driver[1] - 0.86, nSeatIn), 0);
        const exitX = mix(carBase.x + SEAT.driver[0], carBase.x - 1.55, nSeatOut), exitZ = mix(SEAT.driver[2], 0.6, nSeatOut), exitY = mix(SEAT.driver[1] - 0.86, 0, nSeatOut);
        nina.position.x = nSeatOut > 0 ? exitX : nina.position.x; nina.position.y = nSeatOut > 0 ? exitY : nina.position.y;
        nina.position.z = (nSeatIn < 1 && nSeatOut === 0) ? nWalkIn.z : z + (nSeatOut > 0 ? exitZ : mix(0.0, SEAT.driver[2], nSeatIn));
        nina.rotation.y = nSeatIn < 1 ? mix(nWalkIn.yaw, Math.PI, nSeatIn) : Math.PI;
        if (nSeatIn === 0) nina.position.set(nWalkIn.x, 0, nWalkIn.z);
        ninaMoving = nWalkIn.moving && nSeatIn < 0.2;
      } else if (!supporting) { nina.position.set(nWalkOut.x, 0, nWalkOut.z); nina.rotation.y = nWalkOut.done ? Math.PI * 0.5 : nWalkOut.yaw; ninaMoving = nWalkOut.moving; }
      else {
        const walk = walkTo(nina, [[carBase.x + 2.2 - 0.1 + 0.55, stopZ + 0.5], [0.5, entranceZ + 0.2]], T_WALK, 0.95, time);
        nina.position.set(walk.x, 0, walk.z); nina.rotation.y = walk.yaw; ninaMoving = walk.moving;
      }
      animateHuman(nina, time, ninaMoving, { relaxed: true });
      seat(nina, 'driver', nSeat, 0);
      // ---- the hero: limps in with a hand on his side, rides, climbs out and is helped to the door ----
      const hSeatIn = smooth(span(time, 9.4, 10.5)), hSeatOut = smooth(span(time, T_HERO_OUT, T_HERO_OUT + 1.2));
      const hSeat = hSeatIn * (1 - hSeatOut);
      const hWalkIn = walkTo(hero, [[-13.4, 3.5], [-6.2, 3.5], [-4.3, 3.7], [-0.4, 3.7], [-0.4, 0.2]], 0.2, 1.55, time);
      const heroOutside = time >= T_HERO_OUT + 1.2;
      let heroMoving;
      if (!heroOutside) {
        if (hSeatIn === 0) hero.position.set(hWalkIn.x, 0, hWalkIn.z);
        else if (hSeatOut === 0) { hero.position.set(mix(-0.4, carBase.x + SEAT.passenger[0], hSeatIn), mix(0, SEAT.passenger[1] - 0.86, hSeatIn), 0); hero.position.z = z + mix(0.2, SEAT.passenger[2], hSeatIn); }
        else { hero.position.set(mix(cx + SEAT.passenger[0], cx + 1.55, hSeatOut), mix(SEAT.passenger[1] - 0.86, 0, hSeatOut), z + mix(SEAT.passenger[2], 0.55, hSeatOut)); }
        hero.rotation.y = hSeatIn === 0 ? hWalkIn.yaw : hSeatOut > 0 ? mix(Math.PI, -Math.PI * 0.5, hSeatOut) : mix(hWalkIn.yaw, Math.PI, hSeatIn);
        heroMoving = hWalkIn.moving && hSeatIn < 0.2;
      } else {
        const toDoor = walkTo(hero, [[carBase.x + 2.2 - 0.1 + 0.35 - 0.0, stopZ + 0.55], [0.0, entranceZ + 0.2]], T_WALK, 0.95, time);
        const pos = time < T_WALK ? [cx + 1.55, stopZ + 0.55] : [toDoor.x, toDoor.z];
        hero.position.set(pos[0], 0, pos[1]);
        hero.rotation.y = time < T_WALK ? -Math.PI * 0.5 : toDoor.yaw;
        heroMoving = time >= T_WALK && toDoor.moving;
      }
      animateHuman(hero, time, heroMoving, { relaxed: true });
      const rig = hero.userData.modelRig;
      const hurt = hSeatIn < 1 || heroOutside ? 1 : 0;
      if (hurt) { rig.body.rotation.z += 0.1; rig.body.rotation.x += 0.16 * (1 - hSeat); rig.arms[0].root.rotation.x = -0.55; rig.arms[0].elbow.rotation.x = -1.5; rig.head.rotation.x += 0.18; }
      seat(hero, 'passenger', hSeat, 0.3);
      if (heroOutside && time >= T_WALK) { rig.body.rotation.x = 0.2; rig.arms[0].root.rotation.set(-0.55, 0, 0.1); rig.arms[0].elbow.rotation.set(-1.5, 0, 0); }
      // Nina glances at the hero while driving; out of the car she supports him with an arm round his back.
      if (time > 11 && nSeat > 0.5) nina.userData.modelRig.head.rotation.y = Math.sin(time * 0.7) * 0.25 - 0.3;
      if (supporting) { const nr = nina.userData.modelRig; nr.arms[1].root.rotation.set(-0.9, 0, -0.5); nr.arms[1].elbow.rotation.set(-0.4, 0, 0); nr.head.rotation.y = -0.4; }
      // ---- camera ----
      const rel = (x, y, zz) => [cx + x, y, z + zz];
      let pos, look;
      const shake = time > 11 && time < 24.4 ? Math.min(1, speed / 12) * 0.006 : 0;
      if (time < 4.6) { const u = smooth(time / 4.6); pos = mixVec([-11.4, 1.2, -1.6], [-8.4, 1.45, -1.2], u); look = mixVec([-10.4, 1.1, 3.4], [-6.4, 1.0, 3.1], u); }
      else if (time < 9.8) { const u = smooth(span(time, 4.6, 9.8)); pos = mixVec([-1.2, 1.7, 7.4], [-7.0, 1.7, 6.6], u); look = mixVec([-4.2, 1.0, 1.6], [-2.4, 1.0, 1.3], u); }
      else if (time < 14) { const u = smooth(span(time, 9.8, 14)); pos = rel(...mixVec([-0.1, 1.55, -1.9], [0.25, 1.52, -1.5], u)); look = rel(...mixVec([0.0, 1.05, 0.5], [0.0, 1.15, 0.4], u)); }
      else if (time < 16.6) { const u = smooth(span(time, 14, 16.6)); pos = rel(...mixVec([-5.8, 1.1, -0.2], [-5.0, 1.0, 1.0], u)); look = rel(0, 0.9, 0.2); }
      else if (time < 18.6) { const u = smooth(span(time, 16.6, 18.6)); pos = rel(...mixVec([-2.6, 0.45, -3.4], [-2.2, 0.4, -1.4], u)); look = rel(-1.0, 0.4, 0.0); }      // low, at the wheels
      else if (time < 21.4) { const u = smooth(span(time, 18.6, 21.4)); pos = rel(...mixVec([1.6, 1.8, 7.8], [0.6, 1.4, 6.0], u)); look = rel(0, 1.1, -3); }
      else if (time < T_STOP + 1.0) { const u = smooth(span(time, 21.4, 25.4)); pos = mixVec([8, 1.7, -120], [5.0, 1.5, -131], u); look = mixVec([0, 4.0, -150], [cx, 1.2, z], 0.35 + 0.65 * smooth(span(time, 21.4, 24.4))); }
      else if (time < T_HERO_OUT + 2.6) { const u = smooth(span(time, T_STOP + 1.0, T_HERO_OUT + 2.6)); pos = mixVec([cx - 5.4, 1.5, stopZ - 1.0], [cx + 4.6, 1.6, stopZ - 2.2], u); look = [cx, 1.0, stopZ + 1.4]; }
      else if (time < T_WALK) { pos = [cx + 4.2, 1.5, stopZ + 5.2]; look = [cx + 0.6, 1.1, stopZ + 0.2]; }
      else { const u = smooth(span(time, T_WALK, 41)); pos = mixVec([-1.8, 1.55, stopZ + 4.2], [-1.0, 1.5, entranceZ + 5.4], u); look = [0.2, 1.4, entranceZ - 3.5]; }
      camera.position.set(pos[0] + Math.sin(time * 47) * shake, pos[1] + Math.sin(time * 61) * shake, pos[2]); camera.lookAt(...look);
      dust.update(time, camera);
      k.setScreen(camera, 1 - smooth(span(time, 0, 0.8)) + smooth(span(time, 39.6, 41)));
    },
    dispose() {},
  };
}

// ============================================================================
// Madness branch, scene 1: the hero drives and sees the people he killed
// ============================================================================
/** Pale, flickering apparition: every material of the model is cloned already, so changing it is safe. */
function makeGhost(model) {
  const materials = new Set();
  model.traverse((node) => { if (node.material) materials.add(node.material); });
  materials.forEach((material) => { material.transparent = true; material.depthWrite = false; material.emissive = new THREE.Color(0x6a7a8a); material.emissiveIntensity = 0.35; });
  return {
    model,
    setOpacity(value) { model.visible = value > 0.02; materials.forEach((material) => { material.opacity = clamp(value, 0, 1); }); },
  };
}
function addPistol(k, parentBone) {
  const gun = new THREE.Group(); gun.name = 'pistol';
  k.box(gun, [0.05, 0.1, 0.16], [0, -0.02, 0.1], k.mat(0x1a1d20));
  k.box(gun, [0.04, 0.05, 0.2], [0, 0.04, 0.22], k.mat(0x2a2f33, { metalness: 0.6 }));
  parentBone.add(gun); gun.position.set(0, -0.3, 0.02); gun.rotation.x = Math.PI / 2;
  gun.visible = false;
  return gun;
}

function madnessDrive(k, options) {
  const { root } = k;
  const kills = clamp(Math.round(options?.kills ?? 1), 1, 6);
  const m = buildStreet(k);
  const dust = k.dustMotes(90, 8, 0xfff0d0, 0.4);
  const sky = root.children.find((node) => node.material?.isShaderMaterial);
  const lights = root.children.filter((node) => node.isHemisphereLight || node.isDirectionalLight);
  const { car, wheel, roof } = buildCar(k, m, 1.9);
  roof.visible = false;   // first person looks out from under it; keeping it would black out the top of the view
  const hero = k.model(root, 'human', { variant: 'hero' });
  const nina = k.model(root, 'human', { variant: 'medic' });
  const carbine = hero.getObjectByName('visible-carbine'); carbine.visible = false;
  nina.getObjectByName('visible-carbine').visible = false;
  const pistol = addPistol(k, nina.userData.modelRig.arms[1].elbow);
  // Apparitions: one per person killed (up to six). The first stands in the road ahead.
  const stopZ = -118;
  const ghosts = [];
  for (let i = 0; i < kills; i++) {
    const person = k.model(root, 'human', { variant: 'infected', tint: i });
    person.getObjectByName('visible-carbine').visible = false;
    const ghost = makeGhost(person); ghost.setOpacity(0);
    const lane = i === 0;
    const side = i % 2 ? -1 : 1;
    ghosts.push({ ghost, person, lane, side, order: i, baseX: lane ? 1.9 : 1.9 + side * 5.4, baseZ: lane ? stopZ - 7.5 : stopZ + 30 - i * 11 });
  }
  const SEAT = { driver: [-0.45, 0.68, 0.5], passenger: [0.45, 0.68, 0.5] };
  const smoothStep = smooth;
  const zAt = (t) => -118 * smoothStep(t / 31) * 0 + (t < 31 ? -(120 * smoothStep(t / 31)) : -120);
  const seat = (h, name, drive, turn, glance) => {
    const rig = h.userData.modelRig;
    rig.legs.forEach(({ root: leg, knee }) => { leg.rotation.x = -1.5; knee.rotation.x = 1.55; leg.position.y = 0.86; });
    if (name === 'nina') {
      rig.arms.forEach(({ root: arm, elbow, side }) => { arm.rotation.set(-0.2, 0, side * 0.1); elbow.rotation.set(-1.25, 0, 0); });
      rig.body.rotation.y = turn; rig.head.rotation.y = glance;
    }
  };
  let lastZ = 0;
  return {
    fog: { color: 0xe9bf9a, near: 45, far: 220 },
    update(time, camera) {
      const z = zAt(time);
      m.sun.follow(1.9, 0, z);
      const speed = Math.abs(zAt(time + 0.05) - zAt(time - 0.05)) / 0.1;
      lastZ = z;
      car.position.set(1.9, Math.sin(time * 37) * 0.003 * Math.min(1, speed / 3), z);
      m.head.emissiveIntensity = 1.4;
      // The world slips toward red as the hero's grip on reality fails.
      const madness = smooth(span(time, 10, 60));
      lights.forEach((light) => { if (light.isHemisphereLight) { light.color.setRGB(1, mix(0.9, 0.45, madness), mix(0.8, 0.4, madness)); light.intensity = mix(2.6, 1.8, madness); } else light.color.setRGB(1, mix(0.84, 0.4, madness), mix(0.63, 0.3, madness)); });
      if (sky) sky.visible = true;
      // --- people in the car ---
      const dTurn = smooth(span(time, 31, 35)) * 0.0;
      const talkNina = time > 30 && time < 68;
      hero.position.set(1.9 + SEAT.driver[0], SEAT.driver[1] - 0.86, z + SEAT.driver[2]); hero.rotation.y = Math.PI;
      nina.position.set(1.9 + SEAT.passenger[0], SEAT.passenger[1] - 0.86, z + SEAT.passenger[2]); nina.rotation.y = Math.PI;
      const draw = smooth(span(time, 56.5, 59.5));
      animateHuman(hero, time, false, { viewmodel: draw > 0 });
      const hr = hero.userData.modelRig;
      hr.legs.forEach(({ root: leg, knee }) => { leg.rotation.x = -1.5; knee.rotation.x = 1.55; leg.position.y = 0.86; });
      if (draw <= 0) hr.arms.forEach(({ root: arm, elbow, side }) => { arm.rotation.set(-1.05, 0, side * 0.12); elbow.rotation.set(-0.55, 0, 0); });
      carbine.visible = draw > 0;
      hr.body.rotation.y = -1.15 * draw * smooth(span(time, 57.5, 59.5));
      animateHuman(nina, time, false, { relaxed: true });
      const aim = smooth(span(time, 61.4, 62.4));
      seat(nina, 'nina', false, 1.2 * aim, talkNina ? 0.9 + Math.sin(time * 0.8) * 0.12 : 0.2 * Math.sin(time * 0.6));
      pistol.visible = aim > 0.1;
      if (aim > 0) { const arm = nina.userData.modelRig.arms[1]; arm.root.rotation.set(-1.45 * aim, 0, 0.1); arm.elbow.rotation.set(-0.15 * aim, 0, 0); }
      // --- apparitions ---
      for (const g of ghosts) {
        const appear = g.lane ? span(time, 24.2, 26.4) : span(time, 11 + g.order * 1.8, 13 + g.order * 1.8);
        const flicker = 0.55 + 0.45 * Math.sin(time * 26 + g.order * 2.1) * Math.sin(time * 9.3 + g.order);
        const creep = g.lane ? smooth(span(time, 31, 60)) * 4.8 : smooth(span(time, 31, 62)) * 4.5;
        g.person.position.set(g.baseX + (g.lane ? 0 : -g.side * creep), 0, g.baseZ + (g.lane ? creep : 0));
        g.person.rotation.y = g.lane ? Math.sin(time * 0.5) * 0.1 : g.side > 0 ? -Math.PI / 2 : Math.PI / 2;
        animateHuman(g.person, time + g.order, false, { relaxed: true });
        g.person.userData.modelRig.head.rotation.set(0.35, 0, 0.22);
        g.ghost.setOpacity(appear * (appear < 1 ? 1 : 0.35 + 0.5 * flicker * (time > 45 ? 1.2 : 1)));
      }
      // --- camera: driver's eyes ---
      const head = new THREE.Vector3(); hero.userData.modelRig.head.getWorldPosition(head);
      hero.userData.modelRig.head.visible = false;
      const base = new THREE.Vector3(head.x, head.y + 0.03, head.z - 0.1);
      const glanceAt = smooth(span(time, 7.0, 7.8)) * (1 - smooth(span(time, 8.4, 9.2)));
      const toNina = Math.max(glanceAt, smooth(span(time, 31.6, 33)) * (1 - smooth(span(time, 66, 67))));
      const yaw = Math.PI + (-toNina * 1.1) + Math.sin(time * 0.5) * 0.02;
      const shake = (0.002 + 0.03 * madness) * (time > 30 ? 1 : 0.3);
      const pitch = -0.06 - 0.12 * smooth(span(time, 26, 31)) * (1 - smooth(span(time, 31, 33)));
      camera.position.copy(base);
      const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
      camera.position.x += Math.sin(time * 47) * shake; camera.position.y += Math.sin(time * 61) * shake;
      camera.lookAt(camera.position.x + dir.x * 10, camera.position.y + dir.y * 10, camera.position.z + dir.z * 10);
      // Brake lurch.
      if (time > 28 && time < 31.6) camera.rotateX(Math.sin(span(time, 28, 31.6) * Math.PI) * 0.05);
      // The blow from behind: the view whips forward and the picture is cut.
      const hit = span(time, 67.6, 68.0);
      if (hit > 0) { camera.rotateX(-0.6 * hit); camera.rotateZ(0.5 * hit); }
      const redness = 0.12 * smooth(span(time, 26, 36)) + 0.18 * smooth(span(time, 50, 62)) * (0.7 + 0.3 * Math.sin(time * 9));
      const dark = time >= 68 ? 1 : smooth(span(time, 0, 0.9)) < 1 ? 1 - smooth(span(time, 0, 0.9)) : 0;
      dust.update(time, camera);
      k.setScreen(camera, dark, 1, redness);
      hero.userData.modelRig.head.visible = true;
      // Behind the black: voices, a thud, the trunk lid. Nothing is shown.
    },
    dispose() {},
  };
}

// ============================================================================
// Madness branch, scene 2: waking at home, the dead man in the doorway, "it was a dream"
// ============================================================================
function bedroomShell(k, mood) {
  const { root, box, cyl, ball, group, mat, glow } = k;
  const m = {
    wood: k.tmat('wood', { repeat: [4, 4], size: 512, color: 0x6e4a32 }, { roughness: 0.75 }), woodDark: mat(0x3f2c22, { roughness: 0.6 }),
    plaster: k.tmat('plaster', { repeat: [3, 1.5], color: 0x8c8174 }, { roughness: 0.95 }), plasterDark: mat(0x5d5448),
    bedding: k.tmat('fabric', { repeat: [3, 3], color: 0xcfcabb }, { roughness: 1 }), blanket: k.tmat('fabric', { repeat: [3, 3], color: 0x4a5f72 }, { roughness: 1 }),
    rug: mat(0x7d3f3b), dark: mat(0x141a20), glass: mat(0x9fc0ff, { transparent: true, opacity: 0.25, depthWrite: false }),
    moon: glow(0xc9d8f0, 0.9), lamp: glow(0xffc27a, 0.7), bottle: mat(0x4a6a3f, { transparent: true, opacity: 0.8 }), paper: mat(0xe9e2c9),
  };
  box(root, [10.4, 0.25, 10.4], [0, -0.15, 0], m.wood);
  box(root, [10.4, 3.4, 0.3], [0, 1.7, -5.15], m.plaster); box(root, [0.3, 3.4, 10.4], [-5.15, 1.7, 0], m.plaster); box(root, [0.3, 3.4, 10.4], [5.15, 1.7, 0], m.plaster);
  box(root, [10.4, 1.0, 0.36], [0, 0.5, -5.1], m.plasterDark);
  box(root, [10.4, 0.25, 10.4], [0, 3.5, 0], m.plaster); box(root, [10.4, 0.1, 0.5], [0, 3.35, -4.9], m.woodDark);
  box(root, [4.4, 3.4, 0.3], [-3.0, 1.7, 5.15], m.plaster); box(root, [4.4, 3.4, 0.3], [3.0, 1.7, 5.15], m.plaster); box(root, [1.6, 1.1, 0.3], [0, 2.85, 5.15], m.plaster);
  box(root, [0.15, 2.3, 0.4], [-0.85, 1.15, 5.15], m.woodDark); box(root, [0.15, 2.3, 0.4], [0.85, 1.15, 5.15], m.woodDark);
  box(root, [3.2, 0.012, 2.4], [0, 0.03, 0.5], m.rug);
  const bed = group(root, 'bed', 0, 0, -1.2);
  box(bed, [1.8, 0.35, 2.4], [0, 0.45, 0], m.woodDark); box(bed, [1.7, 0.28, 2.3], [0, 0.78, 0], m.bedding);
  box(bed, [1.7, 0.12, 1.5], [0, 0.97, 0.4], m.blanket); box(bed, [0.8, 0.16, 0.45], [0, 0.97, -0.85], m.bedding); box(bed, [1.9, 1.0, 0.12], [0, 0.95, -1.25], m.woodDark);
  box(root, [0.8, 0.7, 0.8], [-1.6, 0.35, -2.2], m.woodDark); cyl(root, 0.15, 0.3, [-1.6, 0.85, -2.3], m.lamp);
  for (let i = 0; i < 3; i++) cyl(root, 0.05, 0.3, [-1.45 + i * 0.12, 0.85, -2.0], m.bottle);
  box(root, [0.3, 0.02, 0.4], [-1.9, 0.72, -2.0], m.paper);
  box(root, [2.2, 2.4, 0.9], [3.6, 1.2, -4.5], m.woodDark); box(root, [2.2, 0.9, 1.0], [-3.4, 0.45, -3.4], m.wood);
  box(root, [2.6, 1.8, 0.1], [2.5, 1.9, -5.0], mood === 'night' ? k.mat(0x0b1426) : k.mat(0xcfe3f2, { emissive: 0xaac4dc, emissiveIntensity: 0.6 }));
  box(root, [2.5, 1.7, 0.04], [2.5, 1.9, -4.94], m.glass); box(root, [0.08, 1.8, 0.14], [2.5, 1.9, -4.9], m.woodDark); box(root, [2.6, 0.08, 0.14], [2.5, 1.9, -4.9], m.woodDark);
  if (mood === 'night') ball(root, [0.4, 0.4, 0.05], [3.1, 2.4, -4.97], m.moon);
  for (let i = 0; i < 7; i++) box(root, [0.3, 0.01, 0.4], [-2.5 + (i % 4) * 0.7, 0.04, 1.6 + Math.floor(i / 4) * 0.8], m.paper);
  return m;
}

function madnessHome(k, options) {
  const dust = k.dustMotes(140, 4.5, 0xcfe0ff, 0.45);
  const { root } = k;
  const hemi = new THREE.HemisphereLight(0x6b8cc4, 0x3a3238, 2.6); root.add(hemi);
  // The window throws a shadow-casting beam across the bed: moonlight by night, a pale sun by day.
  const moon = new THREE.SpotLight(0x8fb2ff, 420, 26, 0.8, 0.7, 1.2); moon.position.set(2.5, 2.1, -4.6); moon.target.position.set(-0.6, 0.4, -1.0);
  moon.castShadow = true; moon.shadow.mapSize.set(1024, 1024); moon.shadow.bias = -0.0004; moon.shadow.radius = 3; root.add(moon, moon.target);
  const lamp = new THREE.PointLight(0xffb36a, 14, 8, 1.6); lamp.position.set(-1.6, 1.1, -2.3); root.add(lamp);
  const m = bedroomShell(k, 'night');
  const dead = k.model(root, 'human', { variant: 'infected', tint: 0 });
  dead.getObjectByName('visible-carbine').visible = false;
  const ghost = makeGhost(dead); ghost.setOpacity(0);
  dead.position.set(0, 0, 4.4); dead.rotation.y = Math.PI;
  const pale = new THREE.PointLight(0xcfe0ff, 0, 8, 1.6); pale.position.set(0, 2.2, 3.4); root.add(pale);
  // The "call Nina" ending: she comes through the door and sits up with him until the morning.
  const nina = k.model(root, 'human', { variant: 'medic' }); nina.getObjectByName('visible-carbine').visible = false; nina.visible = false;
  const NINA_PATH = [[0, 5.9], [0.6, 1.4]];
  return {
    update(time, camera) {
      const second = time >= 19;                // the real awakening in daylight
      const dayMix = smooth(span(time, 19, 19.6));
      hemi.color.setRGB(mix(0.35, 0.85, dayMix), mix(0.48, 0.88, dayMix), mix(0.69, 0.95, dayMix)); hemi.intensity = mix(2.6, 1.9, dayMix);
      moon.intensity = second ? 240 : 560; moon.color.setRGB(mix(0.56, 1, dayMix), mix(0.7, 0.93, dayMix), mix(1, 0.78, dayMix)); lamp.intensity = second ? 0 : 14;
      // Apparition: only in the first (dream) half.
      const show = span(time, 13.6, 14.6) * (1 - span(time, 17.4, 17.6));
      ghost.setOpacity(show * (0.65 + 0.35 * Math.sin(time * 21) * Math.sin(time * 6.1)));
      animateHuman(dead, time, false, { relaxed: true });
      dead.userData.modelRig.head.rotation.set(0.3, 0, 0.18);
      const walk = smooth(span(time, 14.4, 17.4)); dead.position.set(0, 0, 4.4 - walk * 1.6);
      pale.intensity = show * 12;
      const call = (options?.branch ?? 'police') === 'call';
      const ninaWalk = walkAlong(NINA_PATH, Math.max(0, (time - 37.5) * 0.9));
      nina.visible = call && time >= 37.5;
      nina.position.set(ninaWalk.x, 0, ninaWalk.z); nina.rotation.y = ninaWalk.done ? Math.PI + 0.25 : ninaWalk.yaw;
      animateHuman(nina, time, ninaWalk.moving, { relaxed: true });
      if (ninaWalk.done) { const talking = time > 42 && time < 60 ? Math.sin(time * 3.2) * 0.12 : 0; nina.userData.modelRig.arms.forEach(({ root: arm, elbow, side }) => { arm.rotation.set(-0.35 + talking * side, 0, side * 0.1); elbow.rotation.set(-0.9, 0, 0); }); nina.userData.modelRig.head.rotation.x = time > 46 && time < 50 ? 0.25 : 0; }
      let pos, look; const pulse = Math.sin(time * 5.2);
      if (!second) {
        if (time < 10.2) { const u = smooth(time / 10.2); pos = [0.05 + Math.sin(time * 0.8) * 0.03, 0.82 + pulse * 0.012, -1.9]; look = mixVec([0, 3.0, -2.6], [2.0, 1.4, -1.5], u); }
        else if (time < 13.4) { const u = smooth(span(time, 10.2, 13.4)); pos = mixVec([0.05, 0.9, -1.9], [0.05, 1.62, 0.5], u); look = mixVec([1.0, 1.1, 1.0], [0, 1.45, 5.0], u); }
        else { pos = [0.05 + Math.sin(time * 1.7) * 0.01, 1.62, 0.5]; look = [0, 1.45 + Math.sin(time * 0.6) * 0.03, 5.0]; }
        const jolt = span(time, 17.2, 17.6); if (jolt > 0) pos[1] += jolt * 0.3;
      } else {
        const u = smooth(span(time, 19.4, 20.6));
        pos = mixVec([0.05, 0.9, -1.8], [0.05, 1.3, -1.6], u); pos[1] += Math.sin(time * 6.5) * 0.01 * (1 - u);
        look = mixVec([0, 2.6, -0.5], [0.0, 1.0, 3.0], smooth(span(time, 19.4, 21)));
        if (time > 24 && !call) look = mixVec([0, 1.0, 3.0], [2.4, 1.6, -4.0], smooth(span(time, 24, 27)));
        if (call && time > 24) look = mixVec([0, 1.0, 3.0], [ninaWalk.x * 0.8, 1.25, Math.min(ninaWalk.z, 3)], smooth(span(time, 27.4, 31)));
      }
      camera.position.set(...pos); camera.lookAt(...look);
      const eyes = !second ? (time < 2.0 ? 0 : smooth(span(time, 2.0, 5.0))) : smooth(span(time, 19.2, 19.9));
      const headache = !second ? 0.12 * (0.5 + 0.5 * pulse) * smooth(span(time, 3, 5)) * (1 - smooth(span(time, 13, 14))) : 0;
      const black = time >= 17.6 && time < 19.0 ? 1 : 0;
      const out = call ? smooth(span(time, 63.6, 65.6)) : smooth(span(time, 36, 38));
      dust.update(time, camera);
      k.setScreen(camera, Math.max(black, out), Math.min(1, eyes + (black ? 1 : 0)), headache + (time > 14 && time < 17.5 ? 0.18 : 0));
    },
    dispose() {},
  };
}

// ============================================================================
// Madness branch, scene 3: the police station
// ============================================================================
/** Position along a polyline after walking `distance` metres; yaw faces the current segment. */
function walkAlong(points, distance) {
  let remaining = Math.max(0, distance), x = points[0][0], z = points[0][1], yaw = 0, done = false;
  for (let i = 1; i < points.length; i++) {
    const [px, pz] = points[i], length = Math.hypot(px - x, pz - z);
    yaw = Math.atan2(px - x, pz - z);
    if (remaining <= length) { x += (px - x) * remaining / length; z += (pz - z) * remaining / length; return { x, z, yaw, moving: distance > 0, done: false }; }
    remaining -= length; x = px; z = pz;
  }
  return { x, z, yaw, moving: false, done: true };
}

function madnessPolice(k, options) {
  const dust = k.dustMotes(140, 4.5, 0xfff0d0, 0.5);
  const { root, box, cyl, group, mat, glow } = k;
  const hemi = new THREE.HemisphereLight(0xdfe6ee, 0x544c44, 1.5); root.add(hemi);
  const key = new THREE.PointLight(0xfff0d0, 12, 16, 1.4); key.position.set(0, 3.0, 0.6); root.add(key);
  const sunBeam = new THREE.SpotLight(0xfff0cf, 140, 26, 0.7, 0.35, 1.2); sunBeam.position.set(4.3, 2.4, -5.6); sunBeam.target.position.set(0.4, 0.4, -1.2);
  sunBeam.castShadow = true; sunBeam.shadow.mapSize.set(2048, 2048); sunBeam.shadow.bias = -0.0003; sunBeam.shadow.radius = 2; root.add(sunBeam, sunBeam.target);
  const m = { tile: k.tmat('tile', { repeat: [6, 5], size: 512, color: 0x8d949a }, { roughness: 0.55 }), wall: k.tmat('plaster', { repeat: [3, 1.5], color: 0xb8b3a4 }, { roughness: 0.95 }), dado: mat(0x3f5766), desk: k.tmat('wood', { repeat: [2, 1], color: 0x6a5440 }, { roughness: 0.55 }), dark: mat(0x1d252b), metal: mat(0x59656b, { metalness: 0.5 }), paper: mat(0xe7e1cf), navy: mat(0x25364d), flag: mat(0x8a2d2d), glass: mat(0x9ec6d4, { transparent: true, opacity: 0.3, depthWrite: false }), day: glow(0xfff3d6, 0.9), chair: mat(0x3a4650) };
  box(root, [12, 0.2, 10], [0, -0.1, 0], m.tile);
  box(root, [12, 0.2, 10], [0, 3.7, 0], m.wall);
  for (const x of [-3, 3]) for (const z of [-2, 2]) k.flat(root, [1.6, 0.04, 0.5], [x, 3.57, z], m.day);
  box(root, [12, 3.6, 0.3], [0, 1.8, -5], m.wall); box(root, [12, 1.1, 0.36], [0, 0.55, -5], m.dado);
  box(root, [0.3, 3.6, 10], [-6, 1.8, 0], m.wall); box(root, [0.3, 3.6, 10], [6, 1.8, 0], m.wall); box(root, [12, 3.6, 0.3], [0, 1.8, 5], m.wall);
  // Window with blinds on the right, a board with notices on the left, a flag behind the officer.
  box(root, [2.6, 1.8, 0.1], [4.2, 2.0, -4.9], m.day); for (let y = 1.12; y < 2.95; y += 0.16) box(root, [2.7, 0.055, 0.14], [4.2, y, -4.84], m.metal);
  box(root, [2.4, 1.4, 0.06], [-3.6, 1.9, -4.9], m.dado); for (let i = 0; i < 6; i++) box(root, [0.4, 0.5, 0.02], [-4.4 + (i % 3) * 0.8, 1.6 + Math.floor(i / 3) * 0.6, -4.86], m.paper);
  box(root, [1.7, 1.1, 0.04], [0, 2.4, -4.86], m.flag); cyl(root, 0.03, 2.2, [-1.0, 1.5, -4.85], m.metal);
  const desk = group(root, 'desk', 0, 0, -1.4);
  box(desk, [3.4, 0.1, 1.5], [0, 0.95, 0], m.desk); for (const sx of [-1, 1]) box(desk, [0.12, 0.9, 1.3], [sx * 1.55, 0.45, 0], m.desk);
  box(desk, [0.6, 0.4, 0.05], [0.6, 1.25, -0.3], m.dark); box(desk, [0.5, 0.3, 0.02], [0.6, 1.25, -0.27], m.day); box(desk, [0.4, 0.02, 0.3], [-0.8, 1.01, 0.1], m.paper); box(desk, [0.4, 0.02, 0.3], [-0.55, 1.02, 0.15], m.paper);
  cyl(desk, 0.08, 0.2, [1.2, 1.1, 0.3], m.metal);
  const chairOf = (x, z, ry, parent = root) => { const c = group(parent, 'chair', x, 0, z, ry); box(c, [0.55, 0.08, 0.55], [0, 0.48, 0], m.chair); box(c, [0.55, 0.55, 0.07], [0, 0.78, -0.25], m.chair); for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(c, [0.05, 0.46, 0.05], [sx * 0.23, 0.23, sz * 0.23], m.metal); return c; };
  const heroChair = chairOf(0, 0.6, Math.PI); const officerChair = chairOf(0, -2.5, 0);
  box(root, [1.3, 2.4, 0.5], [5.0, 1.2, -3.5], m.metal); box(root, [0.9, 0.2, 0.6], [-5.0, 0.5, 3.2], m.dado);
  const hero = k.model(root, 'human', { variant: 'hero' }); hero.getObjectByName('visible-carbine').visible = false;
  const officer = k.model(root, 'human', { variant: 'civilian', tint: 1 });
  officer.getObjectByName('visible-carbine').visible = false;
  officer.getObjectByName('tailored-jacket').material.color.setHex(0x25364d);
  const badge = k.box(officer.userData.modelRig.body, [0.06, 0.07, 0.02], [0.1, 1.38, 0.17], m.day);
  const holster = k.box(officer.userData.modelRig.body, [0.09, 0.2, 0.1], [0.27, 0.9, 0.03], m.dark);
  // The officer's phone call (help ending) and the people the hero killed, waiting by the door (leave ending).
  const phone = k.box(officer.userData.modelRig.arms[0].elbow, [0.05, 0.11, 0.025], [0, -0.3, 0.03], m.dark); phone.visible = false;
  k.box(root, [1.5, 2.3, 0.05], [0, 1.15, 4.8], m.day);
  const doorGhosts = [0, 1, 2].map((i) => {
    const person = k.model(root, 'human', { variant: 'infected', tint: i });
    person.getObjectByName('visible-carbine').visible = false;
    person.position.set([-0.7, 0.7, 0][i], 0, [3.9, 3.9, 4.35][i]); person.rotation.y = Math.PI;
    const ghost = makeGhost(person); ghost.setOpacity(0); return { ghost, person };
  });
  const ghostCount = clamp(Math.round(options?.kills ?? 1), 1, 3);
  const HERO_PATH = [[0, 0.45], [-1.2, 1.7], [-0.3, 2.5]];
  const OFFICER_PATH = [[0, -2.5], [2.2, -2.4], [2.2, -0.3], [1.0, 0.2]];
  const branchLines = () => CUTSCENES['madness-police'].branches[options?.branch ?? 'gun'].subtitles;
  // speakers decide the cut
  const speakerAt = (t) => { const line = [...CUTSCENES['madness-police'].subtitles, ...branchLines()].find(({ from, to }) => t >= from && t < to); return line ? (line.text.startsWith('Я:') ? 'hero' : 'officer') : null; };
  const sit = (h) => { const rig = h.userData.modelRig; rig.legs.forEach(({ root: leg, knee }) => { leg.rotation.x = -1.5; knee.rotation.x = 1.55; leg.position.y = 0.86; }); };
  const camPos = new THREE.Vector3();
  return {
    update(time, camera) {
      const branch = options?.branch ?? 'gun';
      const after = time >= 33.4, gun = branch === 'gun', help = branch === 'help', leave = branch === 'leave';
      const talk = speakerAt(time);
      // gun: the officer rises, walks round the desk and lays a hand on the hero, who stands to meet him (the picture is cut before anything is shown).
      // help: both stay seated; the officer phones a doctor and the room fills with daylight.
      // leave: the hero stands, walks away and is stopped by the people he killed.
      let officerUp = false, officerWalk = { x: 0, z: -2.5, yaw: 0, moving: false, done: false };
      let standU = 0, heroWalk = null;
      if (after && gun) { officerUp = time >= 33.6; officerWalk = walkAlong(OFFICER_PATH, (time - 33.6) * 1.95); standU = smooth(span(time, 35.6, 36.6)); }
      if (after && leave) {
        standU = smooth(span(time, 34.0, 35.2));
        officerUp = time >= 37.4; officerWalk = walkAlong(OFFICER_PATH, Math.min(3.2, (time - 37.4) * 1.95));
        heroWalk = time >= 35.4 ? walkAlong(HERO_PATH, (time - 35.4) * 1.05) : null;
      }
      heroChair.position.z = 0.6 + 0.7 * standU; heroChair.rotation.y = Math.PI + 0.4 * standU;   // pushed back as he stands
      if (heroWalk) { hero.position.set(heroWalk.x, 0, heroWalk.z); hero.rotation.y = heroWalk.done ? 0 : heroWalk.yaw; }
      else { hero.position.set(0, -0.14 * (1 - standU), 0.6 - 0.15 * standU); hero.rotation.y = leave ? mix(Math.PI, 5.51, standU) : mix(Math.PI, 2.2, standU); }
      if (officerUp) { officer.position.set(officerWalk.x, 0, officerWalk.z); officer.rotation.y = officerWalk.done ? -1.1 : officerWalk.yaw; }
      else { officer.position.set(0, -0.14, -2.5); officer.rotation.y = 0; }
      animateHuman(hero, time, Boolean(heroWalk?.moving), { relaxed: true });
      animateHuman(officer, time, officerUp && officerWalk.moving, { relaxed: true });
      const hr = hero.userData.modelRig, or = officer.userData.modelRig;
      hr.legs.forEach(({ root: leg, knee }) => { leg.rotation.x = mix(-1.5, leg.rotation.x, standU); knee.rotation.x = mix(1.55, knee.rotation.x, standU); leg.position.y = 0.86; });
      const relief = help ? smooth(span(time, 34, 41)) : 0;
      if (!after || help) {
        hr.body.rotation.x = mix(0.28, 0.04, relief) + Math.sin(time * 0.7) * 0.02; hr.head.rotation.x = mix(0.3, -0.02, relief);
        hr.arms.forEach(({ root: arm, elbow, side }) => { arm.rotation.set(-0.6, 0, side * 0.12); elbow.rotation.set(-1.2, 0, 0); });
      } else if (gun) { hr.arms[1].root.rotation.set(-0.9 - 0.5 * standU, 0, -0.25); hr.arms[1].elbow.rotation.set(-0.5 + 0.2 * standU, 0, 0); hr.arms[0].root.rotation.set(-0.6, 0, 0.12); hr.arms[0].elbow.rotation.set(-1.2, 0, 0); }
      else if (leave) { hr.head.rotation.x = 0.1; }
      phone.visible = help && time >= 38.2 && time < 47;
      if (!officerUp) {
        sit(officer);
        const gesture = talk === 'officer' ? Math.sin(time * 3.1) * 0.15 : 0;
        or.arms.forEach(({ root: arm, elbow, side }) => { arm.rotation.set(-0.5 + gesture * side, 0, side * 0.1); elbow.rotation.set(-1.1 - gesture, 0, 0); });
        if (phone.visible) { const lift = smooth(span(time, 38.2, 39.2)); or.arms[0].root.rotation.set(-0.5 - 1.6 * lift, 0, 0.2 * lift); or.arms[0].elbow.rotation.set(-1.1 - 0.4 * lift, 0, 0); }
        or.head.rotation.y = talk === 'hero' ? Math.sin(time * 1.2) * 0.05 : Math.sin(time * 2.4) * 0.08; or.head.rotation.x = talk === 'officer' ? 0.05 : 0.12;
      } else if (officerWalk.done && gun) {
        const reach = smooth(span(time, 35.5, 36.2));
        or.arms[0].root.rotation.set(-0.9 * reach, 0, 0.3 * reach); or.arms[0].elbow.rotation.set(-0.7 * reach, 0, 0);
      }
      // Daylight rises in the help ending; the hallway grows dim and cold in the leave ending.
      const bright = help ? smooth(span(time, 36, 56)) : 0, dim = leave ? smooth(span(time, 40, 48)) : 0;
      sunBeam.intensity = mix(140, 300, bright) * (1 - 0.6 * dim); hemi.intensity = mix(1.5, 2.6, bright) * (1 - 0.45 * dim); key.intensity = 12 * (1 - 0.5 * dim) * (leave && time > 44 ? 0.75 + 0.25 * Math.sin(time * 23) : 1);
      const appear = leave ? smooth(span(time, 41.5, 44.5)) : 0;
      doorGhosts.forEach(({ ghost, person }, i) => {
        person.visible = i < ghostCount;
        animateHuman(person, time + i, false, { relaxed: true }); person.userData.modelRig.head.rotation.set(0.3, 0, 0.2);
        ghost.setOpacity(i < ghostCount ? appear * (0.45 + 0.35 * Math.sin(time * 19 + i) * Math.sin(time * 5.3 + i)) : 0);
      });
      // cameras: wide, then over the shoulder of whoever is listening, then a tight reach.
      let pos, look;
      if (time < 3) { pos = mixVec([-3.8, 1.9, 4.2], [-2.4, 1.7, 3.6], smooth(time / 3)); look = [0, 1.1, -1.2]; }
      else if (time < 33.4) {
        if (talk === 'hero') { pos = [0.7, 1.45, -4.2]; look = [0.1, 1.2, 0.6]; pos[0] += Math.sin(time * 0.4) * 0.05; }
        else if (talk === 'officer') { pos = [-0.7, 1.45, 3.2]; look = [0, 1.25, -2.5]; pos[0] += Math.sin(time * 0.4) * 0.05; }
        else { pos = [-2.8, 1.7, 3.2]; look = [0, 1.1, -1.2]; }
      } else if (gun) {
        if (time < 36.4) { const u = smooth(span(time, 33.4, 36.4)); pos = mixVec([-3.6, 1.7, 2.8], [-3.2, 1.55, 1.4], u); look = mixVec([0.4, 1.0, -1.4], [0.5, 1.1, 0.1], u); }
        else { pos = [-3.2, 1.55, 1.4]; look = [0.5, 1.1, 0.1]; }
      } else if (help) {
        if (time < 52) {
          if (talk === 'hero') { pos = [0.7, 1.45, -4.2]; look = [0.1, 1.2, 0.6]; }
          else if (talk === 'officer') { pos = [-0.7, 1.45, 3.2]; look = [0, 1.25, -2.5]; }
          else { pos = [-2.8, 1.7, 3.2]; look = [0, 1.1, -1.2]; }
        } else { const u = smooth(span(time, 52, 58)); pos = mixVec([-2.8, 1.7, 3.2], [-3.6, 1.9, 4.4], u); look = [0, 1.1, -1.2]; }
      } else {
        const follow = heroWalk ?? { x: 0, z: 0.45 };
        pos = [-3.6, 1.7, -2.4]; look = [follow.x * 0.7, 1.2, Math.max(0.3, follow.z)];
        if (time > 44) { pos = mixVec([-3.6, 1.7, -2.4], [-1.8, 1.65, -0.4], smooth(span(time, 44, 49))); look = [0, 1.3, 3.6]; }
      }
      camPos.set(...pos); camera.position.copy(camPos); camera.lookAt(...look);
      // gun: the scene is cut with no weapon shown, then silence. help: a slow fade out in the light. leave: darkness closes in.
      const fadeIn = 1 - smooth(span(time, 0, 1.2));
      const dark = gun ? (time >= 38.0 ? 1 : fadeIn) : help ? Math.max(fadeIn, smooth(span(time, 56.2, 58))) : Math.max(fadeIn, smooth(span(time, 49.5, 51.8)));
      dust.update(time, camera);
      k.setScreen(camera, dark, 1, leave ? 0.2 * smooth(span(time, 42, 50)) : 0);
    },
    dispose() {},
  };
}

// ============================================================================
// Chapter 6 ending: a clinic waiting room, the doctor's door, then waking in the dark
// ============================================================================
function clinicEnding(k) {
  const { root, box, cyl, ball, group, mat } = k;
  const dust = k.dustMotes(120, 6, 0xdfe9ee, 0.35);
  // The bedroom stands at the origin (as in the nightmare scene); the clinic is 60 m to the east.
  const bedHemi = new THREE.HemisphereLight(0x6b8cc4, 0x3a3238, 2.2); root.add(bedHemi);
  const moon = new THREE.SpotLight(0x8fb2ff, 420, 26, 0.8, 0.7, 1.2); moon.position.set(2.5, 2.1, -4.6); moon.target.position.set(-0.6, 0.4, -1.0);
  moon.castShadow = true; moon.shadow.mapSize.set(1024, 1024); moon.shadow.bias = -0.0004; root.add(moon, moon.target);
  bedroomShell(k, 'night');
  const OX = 60, c = group(root, 'clinic', OX, 0, 0);
  const m = { tile: k.tmat('tile', { repeat: [7, 6], size: 512, color: 0xb5bcbd }, { roughness: 0.45 }), wall: k.tmat('plaster', { repeat: [3, 1.5], color: 0xc9d1cf }, { roughness: 0.95 }),
    dado: mat(0x3f6b6e), seat: mat(0x3a5a6a), metal: mat(0x7a8588, { metalness: 0.5 }), wood: k.tmat('wood', { repeat: [2, 1], color: 0x8a6a4c }, { roughness: 0.6 }),
    glass: mat(0xa8d0da, { transparent: true, opacity: 0.3, depthWrite: false }), door: mat(0x5d4a3b), sign: mat(0x57c58e, { emissive: 0x2c8a5a, emissiveIntensity: 0.9 }),
    red: mat(0xd2362a, { emissive: 0xb01e14, emissiveIntensity: 1.1 }), lamp: mat(0xf2f7ff, { emissive: 0xdfeaff, emissiveIntensity: 0.9 }), plant: mat(0x3f6e3a), pot: mat(0x7a5a46) };
  box(c, [14, 0.2, 12], [0, -0.1, 0], m.tile); box(c, [14, 0.2, 12], [0, 3.5, 0], m.wall);
  box(c, [0.3, 3.4, 12], [-7, 1.7, 0], m.wall); box(c, [0.3, 3.4, 12], [7, 1.7, 0], m.wall); box(c, [14, 3.4, 0.3], [0, 1.7, 6], m.wall);
  box(c, [0.32, 1.0, 12], [-6.98, 0.5, 0], m.dado); box(c, [0.32, 1.0, 12], [6.98, 0.5, 0], m.dado); box(c, [14, 1.0, 0.32], [0, 0.5, 5.98], m.dado);
  // Back wall with the doctor's door, and a small lit office behind it.
  box(c, [5.8, 3.4, 0.3], [-3.9, 1.7, -6], m.wall); box(c, [5.8, 3.4, 0.3], [3.9, 1.7, -6], m.wall); box(c, [2.2, 1.1, 0.3], [0, 2.85, -6], m.wall);
  box(c, [14, 1.0, 0.32], [0, 0.5, -5.98], m.dado);
  box(c, [3.2, 3.4, 3.2], [0, 1.7, -9.0], mat(0x2a2623)); box(c, [2.6, 0.05, 2.6], [0, 3.3, -8.2], m.lamp);
  const officeLight = new THREE.PointLight(0xffe2b0, 14, 9, 1.6); officeLight.position.set(OX, 2.8, -8.2); root.add(officeLight);
  const doorHinge = group(c, 'office-door', -0.6, 0, -5.9);
  box(doorHinge, [1.2, 2.2, 0.08], [0.6, 1.1, 0], m.door); box(doorHinge, [0.1, 0.1, 0.12], [1.05, 1.0, 0.06], m.metal);
  box(c, [0.9, 0.3, 0.06], [0, 2.5, -5.82], m.sign);
  // Number display, wall clock and a notice board.
  box(c, [1.8, 0.5, 0.1], [3.9, 2.7, -5.85], mat(0x111418)); box(c, [1.4, 0.3, 0.04], [3.9, 2.7, -5.8], m.red);
  cyl(c, 0.35, 0.06, [-3.9, 2.7, -5.85], mat(0xf2f0e6), [Math.PI / 2, 0, 0]);
  box(c, [2.4, 1.4, 0.06], [6.9, 1.9, -1.5], mat(0x8a735a)); for (let i = 0; i < 5; i++) box(c, [0.3, 0.4, 0.02], [6.85, 1.7 + (i % 2) * 0.5, -2.1 + i * 0.5], mat(0xe9e5d3));
  // Reception on the west side, plants, and ceiling light panels.
  box(c, [1.0, 1.1, 4.4], [-5.2, 0.55, -2.4], m.wood); box(c, [1.2, 0.08, 4.6], [-5.2, 1.12, -2.4], m.metal); box(c, [0.06, 0.7, 4.4], [-4.75, 1.5, -2.4], m.glass);
  box(c, [0.5, 0.35, 0.05], [-5.4, 1.45, -3.4], mat(0x1a2026)); box(c, [0.4, 0.25, 0.02], [-5.4, 1.45, -3.37], mat(0x9ec6d4, { emissive: 0x6aa0b4, emissiveIntensity: 0.6 }));
  for (const [x, z] of [[6.2, 4.8], [-6.2, 4.8], [6.2, -4.6]]) { cyl(c, 0.3, 0.45, [x, 0.22, z], m.pot); ball(c, [0.5, 0.7, 0.5], [x, 0.9, z], m.plant); }
  const panels = [];
  for (const x of [-3.5, 3.5]) for (const z of [-3, 1, 4.6]) panels.push(k.flat(c, [1.6, 0.05, 0.6], [x, 3.4, z], m.lamp));
  const clinicHemi = new THREE.HemisphereLight(0xdfe9ee, 0x6b6a62, 1.1); clinicHemi.position.set(OX, 3, 0); root.add(clinicHemi);
  const lamps = [[OX - 3.5, 2.9, 1], [OX + 3.5, 2.9, 1], [OX, 2.9, -3.5]].map(([x, y, z]) => { const l = new THREE.PointLight(0xe8f1ff, 16, 11, 1.5); l.position.set(x, y, z); root.add(l); return l; });
  // Chairs facing the door, in two blocks with a central aisle; some are taken.
  const chairs = [];
  for (const sx of [-1, 1]) for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
    const x = sx * (1.4 + col * 0.62), z = -1.6 + row * 2.0;
    const ch = group(c, 'chair', x, 0, z, Math.PI);
    box(ch, [0.52, 0.07, 0.5], [0, 0.44, 0], m.seat); box(ch, [0.52, 0.5, 0.07], [0, 0.72, -0.24], m.seat);
    for (const a of [-1, 1]) for (const b of [-1, 1]) box(ch, [0.04, 0.42, 0.04], [a * 0.22, 0.21, b * 0.2], m.metal);
    chairs.push({ x, z });
  }
  const hold = (model) => { model.getObjectByName('visible-carbine').visible = false; return model; };
  // Waiting people: seated ones turn their heads toward the hero as he passes.
  const SEATED = [[-1, 0, 0], [-1, 2, 1], [1, 0, 2], [1, 1, 3], [1, 2, 1], [-1, 1, 3]];
  const people = SEATED.map(([sx, row, col], i) => {
    const person = hold(k.model(c, 'human', { variant: 'civilian', tint: i }));
    const x = sx * (1.4 + (col % 3) * 0.62), z = -1.6 + row * 2.0;
    person.position.set(x, -0.36, z + 0.05); person.rotation.y = Math.PI;
    const rig = person.userData.modelRig;
    rig.legs.forEach(({ root: leg, knee }) => { leg.rotation.x = -1.5; knee.rotation.x = 1.55; leg.position.y = 0.86; });
    return { person, x, z, i };
  });
  const clerk = hold(k.model(c, 'human', { variant: 'civilian', tint: 3 })); clerk.position.set(-6.0, 0, -2.4); clerk.rotation.y = Math.PI / 2;
  const doctor = hold(k.model(c, 'human', { variant: 'doctor' })); doctor.position.set(0.1, 0, -7.6); doctor.rotation.y = 0;
  const hero = hold(k.model(c, 'human', { variant: 'hero' }));
  k.box(hero.userData.modelRig.body, [0.16, 0.2, 0.02], [-0.1, 1.12, 0.17], mat(0x6e1a16)).castShadow = false;
  const HERO_PATH = [[0.5, 5.4], [0.2, 1.8], [0.1, -4.4], [0, -7.4]];
  const handOn = (rig) => { rig.body.rotation.z += 0.1; rig.body.rotation.x += 0.18; rig.arms[0].root.rotation.set(-0.55, 0, 0.1); rig.arms[0].elbow.rotation.set(-1.5, 0, 0); rig.head.rotation.x += 0.2; };
  return {
    update(time, camera) {
      const clinic = time < 13.4;
      // lights for the active room only
      bedHemi.visible = moon.visible = !clinic; clinicHemi.visible = officeLight.visible = clinic; lamps.forEach((l) => { l.visible = clinic; });
      const flicker = clinic ? (time > 9.5 && time < 11.4 ? 0.35 + 0.65 * Math.abs(Math.sin(time * 33)) : 1) : 1;
      lamps.forEach((l) => { l.intensity = 16 * flicker; });
      const w = walkAlong(HERO_PATH, Math.max(0, (time - 1.0) * 1.1));
      hero.position.set(w.x, 0, w.z); hero.rotation.y = w.yaw;
      animateHuman(hero, time, w.moving && time < 11.6, { relaxed: true }); handOn(hero.userData.modelRig);
      hero.visible = time < 11.2 || !clinic;
      // the doctor opens the door as the hero arrives, steps back, and the door shuts behind them
      const open = smooth(span(time, 8.2, 9.2)) * (1 - smooth(span(time, 10.8, 11.2)));
      doorHinge.rotation.y = 1.5 * open;
      doctor.position.z = mix(-7.6, -6.9, smooth(span(time, 8.4, 9.4))); doctor.position.x = mix(0.1, 1.0, smooth(span(time, 9.4, 10.2))); doctor.rotation.y = mix(0, -0.7, smooth(span(time, 9.4, 10.2))); animateHuman(doctor, time, false, { relaxed: true });
      doctor.userData.modelRig.arms[1].root.rotation.set(-0.9 * smooth(span(time, 8.6, 9.4)), 0, -0.2);
      doctor.visible = time < 11.0;
      animateHuman(clerk, time, false, { relaxed: true });
      people.forEach(({ person, x, z, i }) => {
        animateHuman(person, time + i, false, { relaxed: true });
        const rig = person.userData.modelRig;
        rig.legs.forEach(({ root: leg, knee }) => { leg.rotation.x = -1.5; knee.rotation.x = 1.55; leg.position.y = 0.86; });
        rig.arms.forEach(({ root: arm, elbow, side }) => { arm.rotation.set(-0.5, 0, side * 0.1); elbow.rotation.set(-1.3, 0, 0); });
        // head turns toward the hero while he is within a few metres, then looks down again; two lean aside to let him pass
        const near = clamp(1 - Math.abs(w.z - z) / 3.2, 0, 1) * smooth(span(time, 1.5, 3));
        const toward = Math.atan2(w.x - x, w.z - z) - Math.PI;
        rig.head.rotation.y = clamp((toward + Math.PI * 2) % (Math.PI * 2) > Math.PI ? toward : toward, -1, 1) * near * 0.8; rig.head.rotation.x = 0.12 - 0.1 * near;
        rig.body.rotation.z += (x < 0 ? 1 : -1) * 0.0;
      });
      // cameras
      let pos, look;
      const pulse = Math.sin(time * 5.2);
      if (clinic) {
        if (time < 4.6) { const u = smooth(time / 4.6); pos = mixVec([OX + 5.6, 1.9, 5.4], [OX + 3.6, 1.6, 3.4], u); look = [OX + 0.2, 1.1, mix(1.0, -1.2, u)]; }
        else if (time < 8.6) { const u = smooth(span(time, 4.6, 8.6)); pos = mixVec([OX - 2.4, 1.6, 4.4], [OX + 0.4, 1.55, 2.2], u); look = [OX + w.x * 0.8, 1.2, w.z - 1]; }
        else { const u = smooth(span(time, 8.6, 12.6)); pos = mixVec([OX + 1.2, 1.5, 1.0], [OX + 0.2, 1.4, -3.4], u); look = [OX + 0.0, 1.3, -6.4]; }
      } else {
        const t = time - 13.4;
        if (t < 6.4) { const u = smooth(t / 6.4); pos = [0.05 + Math.sin(time * 0.8) * 0.03, 0.82 + pulse * 0.01, -1.9]; look = mixVec([0, 3.0, -2.6], [2.0, 1.4, -1.5], u); }
        else { const u = smooth(span(t, 6.4, 9)); pos = mixVec([0.05, 0.9, -1.9], [0.05, 1.3, -1.6], u); look = mixVec([2.0, 1.4, -1.5], [0, 1.0, 3.0], u); }
      }
      camera.position.set(...pos); camera.lookAt(...look);
      // black cut at the scream, eyes opening in the bedroom, fade out at the end
      const eyes = clinic ? 1 : smooth(span(time, 14.4, 16.4));
      const dark = Math.max(clinic ? 1 - smooth(span(time, 0, 1.0)) : 0, time >= 11.9 && clinic ? 1 : 0, smooth(span(time, 28.4, 30)));
      dust.update(time, camera);
      k.setScreen(camera, dark, Math.min(1, eyes + (dark >= 1 ? 1 : 0)), clinic ? 0 : 0.1 * (0.5 + 0.5 * pulse) * (1 - smooth(span(time, 18, 21))));
    },
    dispose() {},
  };
}

// ============================================================================
// Peaceful epilogue: morning at home, Nina and the people who were calmed
// ============================================================================
function peaceDawn(k, options) {
  const { root } = k;
  const mercy = (options?.branch ?? 'alone') === 'mercy';
  const duration = cutsceneDuration('peace-dawn', options);
  const dust = k.dustMotes(120, 4.5, 0xfff0d0, 0.5);
  const hemi = new THREE.HemisphereLight(0xe3ecf7, 0x8a7a68, 2.3); root.add(hemi);
  const sun = new THREE.SpotLight(0xfff0cf, 420, 26, 0.85, 0.7, 1.2); sun.position.set(2.5, 2.1, -4.6); sun.target.position.set(-0.6, 0.4, -1.0);
  sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); sun.shadow.bias = -0.0004; sun.shadow.radius = 3; root.add(sun, sun.target);
  bedroomShell(k, 'day');
  const hold = (model) => { model.getObjectByName('visible-carbine').visible = false; return model; };
  // In this ending Nina did not survive the hospital: the visitor is Lev, the stranger who waited at the quarantine gate.
  const lev = hold(k.model(root, 'human', { variant: 'civilian', tint: 2 }));
  k.box(lev.userData.modelRig.body, [0.3, 0.36, 0.14], [0, 1.2, -0.24], k.mat(0x3a4a3a));
  const guestCount = mercy ? clamp((options?.names?.length) || 1, 1, 3) : 0;
  const GUEST_STOPS = [[-0.9, 1.6], [0.1, 2.3], [-1.7, 2.4]];
  const guests = GUEST_STOPS.slice(0, guestCount).map(([x, z], i) => ({
    model: hold(k.model(root, 'human', { variant: 'civilian', tint: i + 1 })), path: [[x * 0.4, 6.2 + i * 0.8], [x, z]],
  }));
  guests.forEach(({ model }) => { model.visible = false; });
  const LEV_PATH = [[0, 5.9], [0.7, 1.3]];
  return {
    update(time, camera) {
      const nw = walkAlong(LEV_PATH, Math.max(0, (time - 6.5) * 0.9));
      lev.position.set(nw.x, 0, nw.z); lev.rotation.y = nw.done ? Math.PI + 0.3 : nw.yaw;
      animateHuman(lev, time, nw.moving, { relaxed: true });
      if (nw.done) { const t = Math.sin(time * 3) * 0.1; lev.userData.modelRig.arms.forEach(({ root: arm, elbow, side }) => { arm.rotation.set(-0.3 + t * side, 0, side * 0.1); elbow.rotation.set(-0.8, 0, 0); }); }
      guests.forEach(({ model, path }, i) => {
        const w = walkAlong(path, Math.max(0, (time - 14.5 - i * 1.2) * 0.9));
        model.visible = time >= 14.5 + i * 1.2;
        model.position.set(w.x, 0, w.z); model.rotation.y = w.done ? Math.PI + (i - 1) * 0.25 : w.yaw;
        animateHuman(model, time + i, w.moving, { relaxed: true });
      });
      const breathe = Math.sin(time * 1.3) * 0.012;
      const pos = mixVec([0.05, 0.95, -1.8], [0.05, 1.3, -1.7], smooth(span(time, 1.5, 5)));
      pos[1] += breathe;
      const focus = nw.done ? [0.35, 1.2, 1.8] : [0, 1.3, 3.5];
      camera.position.set(...pos);
      camera.lookAt(...mixVec([0, 2.6, -0.5], focus, smooth(span(time, 1.5, 5))));
      sun.intensity = mix(260, 420, smooth(span(time, 0, 12)));
      dust.update(time, camera);
      k.setScreen(camera, Math.max(1 - smooth(span(time, 0, 1.2)), smooth(span(time, duration - 2.2, duration))), smooth(span(time, 0.8, 3.5)), 0);
    },
    dispose() {},
  };
}

// ============================================================================
// Bonus story: Lev, the stranger, walks to the quarantine hospital
// ============================================================================
function strangerStory(k) {
  const { root } = k;
  const m = buildStreet(k);
  const dust = k.dustMotes(90, 8, 0xfff0d0, 0.4);
  const lev = k.model(root, 'human', { variant: 'civilian', tint: 2 });
  lev.getObjectByName('visible-carbine').visible = false;
  k.box(lev.userData.modelRig.body, [0.3, 0.36, 0.14], [0, 1.2, -0.24], k.mat(0x3a4a3a));
  const PATH = [[-8.3, 12], [-8.3, -112]];   // far side of the pavement: the abandoned cars stand on the kerb side
  return {
    fog: { color: 0xe9bf9a, near: 45, far: 220 },
    update(time, camera) {
      const w = walkAlong(PATH, time * 2.7);
      m.sun.follow(w.x, 0, w.z);
      lev.position.set(w.x, 0, w.z); lev.rotation.y = Math.PI;
      animateHuman(lev, time, w.moving, { relaxed: true });
      let pos, look;
      if (time < 10) { pos = [w.x + 6.5, 1.5, w.z + 3]; look = [w.x, 1.3, w.z - 1.5]; }
      else if (time < 22) { pos = [w.x + 0.7, 1.75, w.z + 4.4]; look = [w.x, 1.4, w.z - 3]; }
      else if (time < 34) { pos = [w.x + 1.4, 1.1, w.z - 4.2]; look = [w.x, 1.55, w.z]; }
      else { pos = [w.x + 8, 2.4, w.z + 10]; look = [w.x, 1.4, w.z - 6]; }
      camera.position.set(...pos); camera.lookAt(...look);
      dust.update(time, camera);
      k.setScreen(camera, Math.max(1 - smooth(span(time, 0, 1.3)), smooth(span(time, 44, 46))), 1, 0);
    },
    dispose() {},
  };
}

const BUILDERS = { 'clinic-ending': clinicEnding, 'stranger': strangerStory, 'peace-dawn': peaceDawn, 'madness-drive': madnessDrive, 'madness-home': madnessHome, 'madness-police': madnessPolice,  'wake-up': wakeUp, 'boss-intro': bossIntro, 'car-ride': carRide };

/** One cutscene stage: owns its objects; update(time, camera) poses everything from the held time. */
export function createCutsceneStage(id, options = {}) {
  if (!CUTSCENES[id] || !BUILDERS[id]) throw new RangeError(`Unknown cutscene: ${id}`);
  const kit = createKit();
  const scene = BUILDERS[id](kit, options);
  kit.root.visible = false;
  return {
    root: kit.root,
    fog: scene.fog ?? null,
    get duration() { return cutsceneDuration(id, options); },
    update(time, camera) { kit.root.visible = true; scene.update(clamp(time, 0, cutsceneDuration(id, options)), camera); },
    hide() { kit.root.visible = false; kit.hideScreen(); },
    dispose() { scene.dispose?.(); kit.dispose(); },
  };
}
