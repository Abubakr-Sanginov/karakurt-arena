import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { registerInfectedFactory } from './models.js';

// "Animated Characters Survivors" by Kenney (CC0, www.kenney.nl): a rigged character with idle and run clips and four skins.
// Loaded in the background; until it is ready (or if files are missing) models.js keeps using its own procedural humans.
const SKINS = ['zombieA', 'zombieC', 'survivorMaleB', 'survivorFemaleA'];
const RAW_HEIGHT = 376.5;     // the FBX is authored in centimetres
const HEIGHT = 1.78;
let prefab = null, loading = null;

export function assetHumansReady() { return prefab !== null; }

export function preloadAssetHumans(base = new URL('models/survivors/', document.baseURI).href) {
  if (loading) return loading;
  loading = (async () => {
    const loader = new FBXLoader();
    const [model, idle, run] = await Promise.all([
      loader.loadAsync(base + 'Model/characterMedium.fbx'),
      loader.loadAsync(base + 'Animations/idle.fbx'),
      loader.loadAsync(base + 'Animations/run.fbx'),
    ]);
    const textureLoader = new THREE.TextureLoader();
    const textures = {};
    await Promise.all(SKINS.map(async (name) => {
      const texture = await textureLoader.loadAsync(`${base}Skins/${name}.png`);
      texture.colorSpace = THREE.SRGBColorSpace; textures[name] = texture;
    }));
    // Each FBX holds a T-pose clip and the real animation; take the real one.
    const last = (file) => file.animations.find((clip) => !/targeting|tpose/i.test(clip.name)) || file.animations[file.animations.length - 1];
    prefab = { model, clips: { idle: last(idle), run: last(run) }, textures };
    registerInfectedFactory(createAssetPerson, animateAssetPerson);
    return true;
  })().catch((error) => { console.warn('[Каракурт] Модели людей не загрузились, остаются встроенные:', error?.message || error); loading = null; return false; });
  return loading;
}

function dummy(name) { const node = new THREE.Object3D(); node.name = name; return node; }

/** A person from the pack, wearing the infected skin by default. Exposes the same modelRig contract as the built-in human (as inert pivots). */
function createAssetPerson(options = {}) {
  if (!prefab) return null;
  const skin = SKINS[(options.tint | 0) % 2];
  const group = new THREE.Group(); group.name = 'human-survivor'; group.userData.variant = options.variant || 'infected';
  const model = cloneSkinned(prefab.model);
  model.scale.setScalar(HEIGHT / RAW_HEIGHT);
  model.traverse((node) => {
    if (!node.isMesh) return;
    node.material = new THREE.MeshStandardMaterial({ map: prefab.textures[skin], roughness: 0.85 });
    node.castShadow = true; node.receiveShadow = true; node.frustumCulled = false;
  });
  group.add(model);
  const mixer = new THREE.AnimationMixer(model);
  const idle = mixer.clipAction(prefab.clips.idle), run = mixer.clipAction(prefab.clips.run);
  idle.play(); run.play(); run.setEffectiveWeight(0);
  // Scenes written for the built-in rig poke at these pivots; here they simply do nothing.
  const body = dummy('human-upper-body'), head = dummy('human-head');
  const legs = [-1, 1].map((side) => ({ root: dummy('leg'), knee: dummy('knee'), side }));
  const arms = [-1, 1].map((side) => ({ root: dummy('arm'), elbow: dummy('elbow'), side }));
  const gun = dummy('visible-carbine'); group.add(body, head, gun);
  group.userData.asset = { model, mixer, idle, run, skin };
  group.userData.modelRig = { kind: 'human', body, head, legs, arms, gun };
  return group;
}

/** Deterministic from held time: one mixer, idle or run, slightly hunched when infected. */
function animateAssetPerson(group, time, moving) {
  const asset = group.userData.asset;
  if (!asset) return;
  asset.idle.setEffectiveWeight(moving ? 0 : 1); asset.run.setEffectiveWeight(moving ? 1 : 0);
  asset.mixer.setTime(Number.isFinite(time) ? Math.max(0, time) : 0);
  const sick = asset.skin.startsWith('zombie');
  asset.model.rotation.x = sick ? 0.12 + Math.sin(time * 0.9) * 0.025 : 0;
  asset.model.rotation.z = sick ? Math.sin(time * 0.6) * 0.04 : 0;
}

/** Swap the skin of a person made by createAssetPerson: a calmed infected turns into an ordinary survivor. */
export function setAssetSkin(group, skin) {
  const asset = group?.userData?.asset;
  if (!asset || !prefab || asset.skin === skin || !prefab.textures[skin]) return;
  asset.skin = skin;
  group.traverse((node) => { if (node.isMesh && node.material) { node.material.map = prefab.textures[skin]; node.material.needsUpdate = true; } });
}
