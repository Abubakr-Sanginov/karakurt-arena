import * as THREE from 'three';
import { createRoom, createHuman, createSpider, animateHuman, animateSpider, animateSpiderDeath, animateSpiderStrike, SPIDER_DEATH_SECONDS } from './models.js';
import { CAMPAIGN } from './campaignData.js';
import { createCampaignScenery, animateHumanOutcome } from './campaignVisuals.js';
import { normalizeViewMode, movementInWorld } from './viewModes.js';
import { createCutsceneStage } from './cutsceneScenes.js';
import { createDawnEpilogue } from './epilogue.js';
import { createSequelView } from './sequelView.js';

const CONTROL_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight',
  'Space', 'ShiftLeft', 'ShiftRight',
]);
const OVERLAYS = ['menu', 'view-picker', 'pause-menu', 'result', 'campaign-panel'];
const UI_SELECTOR = 'button, a, input, textarea, select, [contenteditable="true"], [role="button"], [role="dialog"]';
const CAMERA_BACK = new THREE.Vector3(0.37, 0.852, 0.37).normalize();
const CAMERA_RIGHT = new THREE.Vector3(CAMERA_BACK.z, 0, -CAMERA_BACK.x).normalize();
const CAMERA_UP = new THREE.Vector3().crossVectors(CAMERA_BACK, CAMERA_RIGHT).normalize();
const DOWN = new THREE.Vector3(0, -1, 0);
const clamp = THREE.MathUtils.clamp;
const DEFAULT_ARENA = { halfWidth: 10, halfDepth: 10 };
const DEFAULT_BACKGROUND = 0x101b23;
const DEFAULT_EXPOSURE = 1.12;
const ease = (value) => { const t = clamp(value, 0, 1); return t * t * (3 - 2 * t); };

function interactive(target) {
  return Boolean(target && typeof target.closest === 'function' && target.closest(UI_SELECTOR));
}

function menuVisible() {
  return OVERLAYS.some((id) => {
    const element = document.getElementById(id);
    return element && !element.hidden && !element.classList.contains('is-hidden')
      && element.getAttribute('aria-hidden') !== 'true';
  });
}

/** Rendering and device input only. State is never mutated by the view. */
export function createView(canvas) {
  if (!canvas || typeof canvas.getContext !== 'function') {
    throw new Error('Не найден холст игры. Перезагрузите страницу и попробуйте снова.');
  }
  const contextOptions = { antialias: true, alpha: false, powerPreference: 'high-performance' };
  let context;
  try {
    context = canvas.getContext('webgl2', contextOptions);
  } catch (cause) {
    throw Object.assign(new Error('WebGL 2 context creation failed', { cause }), { code: 'WEBGL_UNAVAILABLE' });
  }
  if (!context) {
    throw Object.assign(new Error('The browser did not provide a WebGL 2 context'), { code: 'WEBGL_UNAVAILABLE' });
  }
  // Once a context exists, renderer/scene errors are programming or runtime errors,
  // not evidence that WebGL or hardware acceleration has been disabled.
  const renderer = new THREE.WebGLRenderer({ canvas, context, ...contextOptions });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = DEFAULT_EXPOSURE;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(DEFAULT_BACKGROUND);
  scene.fog = new THREE.Fog(DEFAULT_BACKGROUND, 48, 100);
  const perspectiveCamera = new THREE.PerspectiveCamera(44, 1, 0.08, 220);
  const topCamera = new THREE.OrthographicCamera(-12, 12, 12, -12, 0.1, 220);
  topCamera.up.set(0, 0, -1);
  let camera = perspectiveCamera;
  let viewMode = 'third';
  // Chapter 6 (the house) is third person only; the chosen perspective is parked here and restored afterwards.
  let parkedViewMode = null;
  let horror = false;
  let epilogue = null;
  let sequelView = null;
  const chapterPointer = { x: 0, y: 0, valid: false, shoot: false };
  const chapterLook = { x: 0, y: 0, valid: false };
  let chapterLookOwner = null;
  const chapterAim = new THREE.Vector3();
  const dawnKeys = new Set();
  let dawnInteract = false;
  let dawnLastX = 0, dawnLastZ = -9;
  let dawnWalking = false;
  let lookYaw = 0;
  let chapterMode = 'third';
  let lookPitch = -0.32;
  let lookReady = false;
  let lockActive = false;
  let lockRequested = false;
  let pointerLockAttempt = 0;
  const focus = new THREE.Vector3(0, 0.65, 0);
  const desiredFocus = focus.clone();
  const scratch = new THREE.Vector3();
  const muzzle = new THREE.Vector3();
  const lampPosition = new THREE.Vector3();
  const cinematicTarget = new THREE.Vector3();
  const cinematicBack = new THREE.Vector3();
  const cinematicRight = new THREE.Vector3();
  const cinematicUp = new THREE.Vector3();
  const deathDirection = new THREE.Vector3();
  const bodyCenter = new THREE.Vector3();
  const mouthPosition = new THREE.Vector3();
  const deathBounds = new THREE.Box3();
  const viewTarget = new THREE.Vector3();
  let cameraDistance = 33;
  let cameraReady = false;
  let activeMap = null;
  let scenery = null;
  let arena = DEFAULT_ARENA;
  let presentation = { kind: 'none', time: 0, duration: 1 };
  let presentationCameraReady = false;
  const deathOrigin = new THREE.Vector3();
  let deathHeading = 0;
  scene.add(camera);

  // Model resources can be shared between spiders and the room. Ref-count them
  // instead of disposing a shared geometry/material when a single enemy dies.
  const resourceRefs = new Map();
  const modelResources = new WeakMap();
  const owned = new Set();
  const own = (resource) => { owned.add(resource); return resource; };
  function retainModel(root) {
    const resources = new Set();
    root.traverse((object) => {
      if (object.geometry) resources.add(object.geometry);
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (!material) continue;
        resources.add(material);
        for (const value of Object.values(material)) if (value?.isTexture) resources.add(value);
      }
      // Instanced meshes also own GPU instance buffers, independent of geometry.
      if (object.isInstancedMesh) resources.add(object);
    });
    for (const resource of resources) resourceRefs.set(resource, (resourceRefs.get(resource) || 0) + 1);
    modelResources.set(root, resources);
    return root;
  }
  function releaseModel(root) {
    root.removeFromParent();
    for (const resource of modelResources.get(root) || []) {
      const count = resourceRefs.get(resource) - 1;
      if (count > 0) resourceRefs.set(resource, count);
      else { resourceRefs.delete(resource); resource.dispose?.(); }
    }
    modelResources.delete(root);
  }

  const room = retainModel(createRoom());
  const human = retainModel(createHuman());
  const scareSpider = retainModel(createSpider('boss'));
  scareSpider.name = 'horror-defeat-spider';
  scareSpider.visible = false;
  // Cinematic jaws belong to this view, not the shared combat spider assets.
  const maw = new THREE.Mesh(own(new THREE.SphereGeometry(1, 24, 16, Math.PI, Math.PI)),
    own(new THREE.MeshStandardMaterial({ color: 0x080306, roughness: 1, side: THREE.BackSide })));
  maw.name = 'devouring-maw';
  // An open cavity, not a solid ball drawn over the survivor. Its +Z opening
  // faces the victim; view transforms this socket to world coordinates below.
  maw.position.set(0, 0.16, 0.34); maw.scale.set(0.13, 0.14, 0.13);
  scareSpider.add(maw);
  const mouthRim = new THREE.Mesh(own(new THREE.TorusGeometry(1, 0.12, 8, 24)),
    own(new THREE.MeshStandardMaterial({ color: 0x4b2229, roughness: 0.65 })));
  mouthRim.name = 'devouring-mouth-rim';
  mouthRim.position.copy(maw.position); mouthRim.scale.set(0.13, 0.14, 0.1);
  scareSpider.add(mouthRim);
  const jawMaterial = own(new THREE.MeshStandardMaterial({ color: 0xb6a993, roughness: 0.44 }));
  const jawGeometry = own(new THREE.ConeGeometry(0.036, 0.28, 8));
  const jaws = [-1, 1].map((side) => {
    const jaw = new THREE.Mesh(jawGeometry, jawMaterial);
    jaw.position.set(side * 0.15, 0.16, 0.36); jaw.rotation.z = side * 0.5;
    scareSpider.add(jaw); return jaw;
  });
  const scareLight = new THREE.PointLight(0xffbbaa, 0, 8, 1.5);
  scene.add(scareSpider, scareLight);
  const playerAnchor = new THREE.Group();
  playerAnchor.add(human);
  scene.add(room, playerAnchor);
  const muzzleSocket = human.getObjectByName('muzzle');
  const lampSocket = human.getObjectByName('flashlight');
  const enemies = new Map();
  const STRIKE_RANGE = { normal: 0.55, runner: 0.45, tank: 0.8, boss: 1.1 };
  const dyingSpiders = [];
  function clearDying() { while (dyingSpiders.length) releaseModel(dyingSpiders.pop().model); }
  const projectiles = new Map();
  const effects = [];
  const listeners = [];
  const keys = new Set();
  const raycaster = new THREE.Raycaster();
  const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const pointerNDC = new THREE.Vector2();
  const aim = new THREE.Vector3(0, 0, 8);
  const pointer = { x: 0, y: 0, valid: false, shooting: false, id: null };
  let dodgeQueued = false;
  let lastState = null;
  let disposed = false;
  let contextLost = false;
  let width = 0;
  let height = 0;
  let pixelRatio = 0;
  let clock = 0;
  let shake = 0;
  let damageFlash = 0;
  let dodgeGlow = 0;
  let ghostTimer = 0;
  let muzzleGlow = 0;
  let lastPlayerX = 0;
  let lastPlayerZ = 0;
  const originalCursor = canvas.style.cursor;
  const originalTouchAction = canvas.style.touchAction;
  canvas.style.touchAction = 'none';

  function clearInput() {
    dawnKeys.clear();
    dawnInteract = false;
    chapterPointer.shoot = false;
    keys.clear();
    pointer.shooting = false;
    pointer.id = null;
    pointer.valid = false;
    dodgeQueued = false;
  }
  function releasePointerLock() {
    // Invalidate pending promises too: a late request must not capture a menu.
    pointerLockAttempt += 1;
    lockRequested = false;
    lockActive = false;
    if (document.pointerLockElement === canvas) {
      try { document.exitPointerLock?.(); } catch { /* Browser may already be exiting. */ }
    }
    delete canvas.dataset.pointerLock;
  }
  function suspendInput() { clearInput(); releasePointerLock(); }
  function requestPointerLock(soft = false) {
    if (lockRequested || document.pointerLockElement === canvas || !canvas.requestPointerLock) return;
    lockRequested = true;
    const attempt = ++pointerLockAttempt;
    try {
      const pending = canvas.requestPointerLock();
      Promise.resolve(pending).then(() => {
        if (attempt !== pointerLockAttempt) {
          if (!lookAllowed() || viewMode !== 'first') releasePointerLock();
          return;
        }
        lockRequested = false;
        if (!lookAllowed() || viewMode !== 'first') releasePointerLock();
      }).catch(() => {
        if (attempt !== pointerLockAttempt) return;
        lockRequested = false;
        if (!soft) canvas.dataset.pointerLock = 'unavailable';
      });
    } catch {
      lockRequested = false;
      if (!soft) canvas.dataset.pointerLock = 'unavailable';
    }
  }
  function ensureLook() {
    if (lookReady) return;
    lookYaw = lastState?.player.yaw || 0;
    lookPitch = -0.32;
    lookReady = true;
  }
  function inputAllowed() {
    return !disposed && !contextLost && !document.hidden && presentation.kind === 'none'
      && (!lastState || lastState.status === 'playing')
      && (!lastState?.campaign || lastState.campaign.stage === 'combat') && !menuVisible();
  }
  function listen(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    listeners.push(() => target.removeEventListener(type, handler, options));
  }
  function constrainAim() {
    if (!activeMap) return;
    const x = clamp(lastState?.player.x || 0, -arena.halfWidth, arena.halfWidth);
    const z = clamp(lastState?.player.z || 0, -arena.halfDepth, arena.halfDepth);
    const dx = aim.x - x;
    const dz = aim.z - z;
    let reach = 1;
    // Clip the ray from the player, not X/Z independently: the aim direction
    // must not bend when the pointer is outside a long or narrow arena.
    if (aim.x > arena.halfWidth && dx > 0) reach = Math.min(reach, (arena.halfWidth - x) / dx);
    if (aim.x < -arena.halfWidth && dx < 0) reach = Math.min(reach, (-arena.halfWidth - x) / dx);
    if (aim.z > arena.halfDepth && dz > 0) reach = Math.min(reach, (arena.halfDepth - z) / dz);
    if (aim.z < -arena.halfDepth && dz < 0) reach = Math.min(reach, (-arena.halfDepth - z) / dz);
    aim.set(x + dx * reach, 0, z + dz * reach);
  }
  function readAim() {
    if (viewMode === 'first') {
      ensureLook();
      const player = lastState?.player;
      // Pitch is visual only: every perspective fires into the shared XZ rules.
      // Keep this world point far away: simulation moves before resolving yaw.
      // Clipping it to the nearby wall would bend a first-person shot while strafing.
      aim.set((player?.x || 0) + Math.sin(lookYaw) * 10000, 0,
        (player?.z || 0) + Math.cos(lookYaw) * 10000);
      return;
    }
    if (!pointer.valid) {
      const player = lastState?.player;
      aim.set((player?.x || 0) + Math.sin(player?.yaw || 0) * 8, 0,
        (player?.z || 0) + Math.cos(player?.yaw || 0) * 8);
      constrainAim();
      return;
    }
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    pointerNDC.set((pointer.x - rect.left) / rect.width * 2 - 1,
      -(pointer.y - rect.top) / rect.height * 2 + 1);
    camera.updateMatrixWorld();
    raycaster.setFromCamera(pointerNDC, camera);
    if (raycaster.ray.intersectPlane(floor, scratch)) aim.copy(scratch);
    constrainAim();
  }
  function sampleInput() {
    if (!inputAllowed()) {
      clearInput();
      readAim();
      return { moveX: 0, moveZ: 0, aimX: aim.x, aimZ: aim.z, shoot: false, dodge: false };
    }
    resize();
    readAim();
    const down = (...codes) => codes.some((code) => keys.has(code)) ? 1 : 0;
    const turnKeys = viewMode === 'first';
    const movement = movementInWorld(viewMode,
      down('KeyD', ...(turnKeys ? [] : ['ArrowRight'])) - down('KeyA', ...(turnKeys ? [] : ['ArrowLeft'])),
      down('KeyS', ...(turnKeys ? [] : ['ArrowDown'])) - down('KeyW', ...(turnKeys ? [] : ['ArrowUp'])), lookYaw);
    const input = {
      ...movement,
      aimX: aim.x, aimZ: aim.z,
      shoot: pointer.shooting || keys.has('Space'), dodge: dodgeQueued,
    };
    dodgeQueued = false;
    return input;
  }

  function lookAllowed() { return inputAllowed() || dawnInputAllowed(); }
  function ensureChapterLook() {
    const owner = presentation.sequel || presentation.journey;
    if (lookReady && chapterLookOwner === owner) return;
    chapterLookOwner = owner;
    lookYaw = presentation.sequel ? presentation.sequel.player.yaw : presentation.journey?.yaw ?? 0;
    lookPitch = -0.32;
    lookReady = true;
  }
  function dawnInputAllowed() {
    return Boolean((presentation.journey || presentation.sequel) && !presentation.journey?.complete
      && !presentation.sequel?.complete && !presentation.sequel?.lost && !disposed && !contextLost
      && !document.hidden && !menuVisible());
  }
  listen(window, 'keydown', (event) => {
    if (!dawnInputAllowed() || interactive(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight'].includes(event.code)) {
      event.preventDefault();
      if (!event.repeat || dawnKeys.has(event.code)) dawnKeys.add(event.code);
      if (viewMode === 'first' && document.pointerLockElement !== canvas && canvas.dataset.pointerLock !== 'unavailable') requestPointerLock(true);
    }
    if (event.code === 'KeyE' && !event.repeat) { event.preventDefault(); dawnInteract = true; }
  });
  listen(window, 'keyup', (event) => dawnKeys.delete(event.code));
  listen(canvas, 'pointermove', (event) => {
    if (!presentation.sequel || !dawnInputAllowed()) return;
    chapterPointer.x = event.clientX; chapterPointer.y = event.clientY; chapterPointer.valid = true;
  });
  listen(canvas, 'contextmenu', (event) => { if (viewMode === 'first') event.preventDefault(); });
  listen(canvas, 'pointerdown', (event) => {
    if (!dawnInputAllowed() || event.button !== 0) return;
    canvas.focus({ preventScroll: true });
    if (viewMode === 'first' && document.pointerLockElement !== canvas
      && canvas.requestPointerLock && canvas.dataset.pointerLock !== 'unavailable') { requestPointerLock(); return; }
    if (!presentation.sequel) return;
    chapterPointer.x = event.clientX; chapterPointer.y = event.clientY;
    chapterPointer.valid = true; chapterPointer.shoot = true;
    canvas.focus({ preventScroll: true });
  });
  listen(window, 'pointerup', () => { chapterPointer.shoot = false; });

  listen(window, 'keydown', (event) => {
    if (!CONTROL_KEYS.has(event.code) || !inputAllowed() || interactive(event.target)
      || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
    // After a blur, repeated keydowns must not re-arm a key that is still held.
    if (event.repeat && !keys.has(event.code)) return;
    event.preventDefault();
    if ((event.code === 'ShiftLeft' || event.code === 'ShiftRight') && !event.repeat
      && !keys.has('ShiftLeft') && !keys.has('ShiftRight')) dodgeQueued = true;
    keys.add(event.code);
    if (viewMode === 'first' && document.pointerLockElement !== canvas && canvas.dataset.pointerLock !== 'unavailable') requestPointerLock(true);
  });
  listen(window, 'keyup', (event) => { keys.delete(event.code); });
  listen(canvas, 'pointerdown', (event) => {
    if (event.button !== 0 || event.isPrimary === false || !inputAllowed()) return;
    event.preventDefault();
    canvas.focus({ preventScroll: true });
    if (viewMode === 'first' && document.pointerLockElement !== canvas
      && canvas.requestPointerLock && canvas.dataset.pointerLock !== 'unavailable') {
      requestPointerLock();
      // Clicking to capture the mouse does not fire a stray first shot.
      return;
    }
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    pointer.valid = true;
    pointer.shooting = true;
    pointer.id = event.pointerId;
  });
  listen(window, 'pointermove', (event) => {
    // Continuation chapters own their input. Arena mouse cleanup must not erase
    // held Space/WASD while aiming in a temporary third-person presentation.
    if (presentation.journey || presentation.sequel) {
      if (viewMode === 'first' && dawnInputAllowed()) {
        ensureChapterLook();
        if (document.pointerLockElement === canvas) {
          lookYaw -= (event.movementX || 0) * 0.0026;
          lookPitch = clamp(lookPitch - (event.movementY || 0) * 0.0022, -1.35, 1.1);
        } else if (event.target === canvas) {
          if (chapterLook.valid && (event.buttons & 2)) {
            lookYaw -= (event.clientX - chapterLook.x) * 0.004;
            lookPitch = clamp(lookPitch - (event.clientY - chapterLook.y) * 0.003, -1.35, 1.1);
          }
          chapterLook.x = event.clientX; chapterLook.y = event.clientY; chapterLook.valid = true;
        }
      }
      return;
    }
    if (viewMode === 'first') {
      if (document.pointerLockElement === canvas && inputAllowed()) {
        ensureLook();
        lookYaw -= (event.movementX || 0) * 0.0026;
        lookPitch = clamp(lookPitch - (event.movementY || 0) * 0.0022, -1.35, 1.1);
        if ((event.buttons & 1) === 0) pointer.shooting = false;
      } else if (event.target === canvas && inputAllowed()) {
        // Some browsers/embedded frames deny Pointer Lock; retain usable mouse look.
        ensureLook();
        if (pointer.valid && (event.buttons & 2)) {
          lookYaw -= (event.clientX - pointer.x) * 0.004;
          lookPitch = clamp(lookPitch - (event.clientY - pointer.y) * 0.003, -1.35, 1.1);
        }
        pointer.x = event.clientX;
        pointer.y = event.clientY;
        pointer.valid = true;
      }
      return;
    }
    if (event.isPrimary === false || (event.target !== canvas && !pointer.shooting)) return;
    if (!inputAllowed()) { clearInput(); return; }
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    pointer.valid = true;
    if ((event.buttons & 1) === 0) pointer.shooting = false;
  });
  listen(document, 'pointerlockchange', () => {
    const nowLocked = document.pointerLockElement === canvas;
    const wasLocked = lockActive;
    lockActive = nowLocked;
    if (nowLocked && (!lookAllowed() || viewMode !== 'first')) { releasePointerLock(); return; }
    if (!nowLocked && wasLocked) {
      clearInput();
      if (lookAllowed() && viewMode === 'first') {
        canvas.dispatchEvent(new Event('karakurt:pointer-unlocked'));
      }
    }
  });
  listen(window, 'pointerup', (event) => {
    if (event.button === 0 && (pointer.id === null || event.pointerId === pointer.id)) {
      pointer.shooting = false;
      pointer.id = null;
    }
  });
  listen(window, 'pointercancel', clearInput);
  listen(window, 'blur', suspendInput);
  listen(canvas, 'blur', () => { if (!inputAllowed()) suspendInput(); else clearInput(); });
  listen(document, 'visibilitychange', () => { if (document.hidden) suspendInput(); });
  listen(document, 'focusin', (event) => { if (interactive(event.target)) suspendInput(); });
  listen(canvas, 'webglcontextlost', (event) => {
    event.preventDefault();
    contextLost = true;
    suspendInput();
  });
  listen(canvas, 'webglcontextrestored', () => { contextLost = false; resize(); });

  const ambient = new THREE.HemisphereLight(0xb1d1ed, 0x473027, 1.36);
  const moon = new THREE.DirectionalLight(0xc1d9ff, 2.65);
  moon.position.set(-5, 18, -8);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  Object.assign(moon.shadow.camera, { left: -19, right: 19, top: 19, bottom: -19, near: 0.5, far: 65 });
  moon.shadow.camera.updateProjectionMatrix();
  moon.shadow.bias = -0.0003;
  moon.shadow.normalBias = 0.035;
  moon.shadow.radius = 3;
  const warm = new THREE.PointLight(0xffb36c, 56, 19, 2);
  warm.position.set(-10.5, 3, 3.2);
  const rim = new THREE.PointLight(0x75ccdb, 45, 24, 2);
  rim.position.set(8, 5, -7);
  const flashlight = new THREE.SpotLight(0xffe2af, 29, 18, 0.4, 0.72, 1.6);
  const muzzleLight = new THREE.PointLight(0xffbc66, 0, 4, 2);
  scene.add(ambient, moon, warm, rim, flashlight, flashlight.target, muzzleLight);
  const victoryLight = new THREE.PointLight(0xffe1a0, 0, 22, 1.6);
  const victoryRim = new THREE.PointLight(0x8ff5dc, 0, 18, 1.7);
  victoryLight.visible = false;
  victoryRim.visible = false;
  scene.add(victoryLight, victoryRim);

  function releaseScenery() {
    if (!scenery) return;
    scenery.root.removeFromParent();
    scenery.dispose();
    scenery = null;
  }
  function syncEnvironment(state) {
    const map = state.campaign ? CAMPAIGN[state.campaign.mapIndex] ?? null : null;
    if (activeMap === map) return;
    // Construct first so a failure leaves the previous scene available for cleanup.
    // Scenery owns and disposes its resources; do not ref-count them twice.
    const nextScenery = map ? createCampaignScenery(map) : null;
    releaseScenery();
    clearCombatEffects();
    clearInput();
    for (const entry of enemies.values()) releaseModel(entry.model);
    enemies.clear();
    clearDying();
    activeMap = map;
    scenery = nextScenery;
    arena = map?.arena || DEFAULT_ARENA;
    room.visible = !map;
    if (scenery) { scene.add(scenery.root); scenery.setViewMode(viewMode); scenery.setHorrorMode(horror); }
    lookReady = false;
    scene.background.setHex(map?.palette.fog ?? DEFAULT_BACKGROUND);
    scene.fog.color.copy(scene.background);
    warm.position.set(map ? -arena.halfWidth * 0.7 : -10.5, 3,
      map ? arena.halfDepth * 0.3 : 3.2);
    rim.position.set(map ? arena.halfWidth * 0.7 : 8, 5,
      map ? -arena.halfDepth * 0.65 : -7);
    const span = Math.max(arena.halfWidth, arena.halfDepth) + 9;
    Object.assign(moon.shadow.camera, { left: -span, right: span, top: span, bottom: -span,
      far: Math.max(65, span * 3) });
    moon.shadow.camera.updateProjectionMatrix();
    cameraReady = false;
    presentationCameraReady = false;
    width = 0;
  }

  const projectileGeometry = own(new THREE.CapsuleGeometry(0.045, 0.52, 2, 5));
  projectileGeometry.rotateX(Math.PI / 2);
  const projectileMaterial = own(new THREE.MeshBasicMaterial({ color: 0xffdf94, toneMapped: false }));
  const trailMaterial = own(new THREE.MeshBasicMaterial({
    color: 0xff9f42, transparent: true, opacity: 0.3, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false,
  }));
  const sparkGeometry = own(new THREE.IcosahedronGeometry(0.065, 0));
  const ringGeometry = own(new THREE.RingGeometry(0.79, 1, 48));
  const ghostGeometry = own(new THREE.CapsuleGeometry(0.22, 0.72, 3, 8));
  const flashGeometry = own(new THREE.OctahedronGeometry(0.18, 0));
  const flashMaterial = own(new THREE.MeshBasicMaterial({
    color: 0xffe9b2, transparent: true, opacity: 0, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false,
  }));
  const flashMesh = new THREE.Mesh(flashGeometry, flashMaterial);
  scene.add(flashMesh);

  // A faint local beam gives the flashlight volume without textures/postprocessing.
  const coneGeometry = own(new THREE.ConeGeometry(1.65, 6.5, 18, 1, true));
  coneGeometry.rotateX(-Math.PI / 2);
  coneGeometry.translate(0, 0, 3.25);
  const coneMaterial = own(new THREE.MeshBasicMaterial({
    color: 0xffdd9c, transparent: true, opacity: 0.035, depthWrite: false,
    side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false,
  }));
  const beam = new THREE.Mesh(coneGeometry, coneMaterial);
  scene.add(beam);

  const reticle = new THREE.Group();
  const reticleMaterial = own(new THREE.MeshBasicMaterial({
    color: 0xffc580, transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false,
  }));
  const reticleRing = new THREE.Mesh(ringGeometry, reticleMaterial);
  reticleRing.rotation.x = -Math.PI / 2;
  reticleRing.scale.setScalar(0.23);
  reticle.add(reticleRing);
  const tickGeometry = own(new THREE.BoxGeometry(0.13, 0.014, 0.022));
  for (let i = 0; i < 4; i += 1) {
    const tick = new THREE.Mesh(tickGeometry, reticleMaterial);
    const angle = i * Math.PI / 2;
    tick.position.set(Math.cos(angle) * 0.32, 0, Math.sin(angle) * 0.32);
    tick.rotation.y = -angle;
    reticle.add(tick);
  }
  scene.add(reticle);
  const haloMaterial = own(new THREE.MeshBasicMaterial({
    color: 0x83e6e7, transparent: true, opacity: 0.2, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false,
  }));
  const halo = new THREE.Mesh(ringGeometry, haloMaterial);
  halo.rotation.x = -Math.PI / 2;
  halo.scale.setScalar(0.55);
  scene.add(halo);
  const celebrationPositions = new Float32Array(36 * 3);
  const celebrationGeometry = own(new THREE.BufferGeometry());
  celebrationGeometry.setAttribute('position', new THREE.BufferAttribute(celebrationPositions, 3));
  const celebrationMaterial = own(new THREE.PointsMaterial({
    color: 0xffe6a6, size: 0.09, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  }));
  const celebration = new THREE.Points(celebrationGeometry, celebrationMaterial);
  celebration.frustumCulled = false;
  celebration.visible = false;
  scene.add(celebration);

  // A camera-space translucent plane is a damage flash, not a DOM overlay.
  const damageMaterial = own(new THREE.MeshBasicMaterial({
    color: 0xa31e23, transparent: true, opacity: 0, depthTest: false,
    depthWrite: false, toneMapped: false,
  }));
  const damagePlane = new THREE.Mesh(own(new THREE.PlaneGeometry(2, 2)), damageMaterial);
  damagePlane.position.z = -0.5;
  damagePlane.renderOrder = 1000;
  damagePlane.frustumCulled = false;
  camera.add(damagePlane);
  const outcomeMaterial = own(new THREE.MeshBasicMaterial({
    color: 0x030409, transparent: true, opacity: 0, depthTest: false,
    depthWrite: false, toneMapped: false,
  }));
  const outcomePlane = new THREE.Mesh(damagePlane.geometry, outcomeMaterial);
  outcomePlane.position.z = -0.5;
  outcomePlane.renderOrder = 1001;
  outcomePlane.frustumCulled = false;
  outcomePlane.visible = false;
  camera.add(outcomePlane);
  scene.add(topCamera);
  // Terminal poses keep their existing cinematic perspective in every mode.
  function activateCamera() {
    camera = viewMode === 'top2d' && presentation.kind === 'none' ? topCamera : perspectiveCamera;
    perspectiveCamera.fov = presentation.kind === 'victory' ? 64
      : viewMode === 'first' && presentation.kind === 'none' ? 76 : 44;
    camera.add(damagePlane, outcomePlane);
    scenery?.setViewMode(presentation.kind === 'none' ? viewMode : 'third');
    width = 0;
    resize();
  }
  const eyePoint = new THREE.Vector3();
  /** First person looks out of the survivor's own head (hidden): look down to see chest, hands, carbine and boots. */
  function placeEye(yaw) {
    playerAnchor.rotation.y = yaw;
    playerAnchor.updateMatrixWorld(true);
    human.userData.modelRig.head.getWorldPosition(eyePoint);
    eyePoint.x += Math.sin(yaw) * 0.09; eyePoint.z += Math.cos(yaw) * 0.09; eyePoint.y += 0.03;
    return eyePoint;
  }
  function useCamera(next) {
    if (camera === next) return;
    camera = next;
    camera.add(damagePlane, outcomePlane);
    width = 0;
    resize();
  }
  /** Continuation chapters honour the chosen perspective while playable; cutscenes keep the staged camera. */
  function applyChapterCamera(live, x, z) {
    const mode = live ? viewMode : 'third';
    if (mode === 'first') {
      useCamera(perspectiveCamera);
      ensureChapterLook();
      if (perspectiveCamera.fov !== 76) { perspectiveCamera.fov = 76; perspectiveCamera.updateProjectionMatrix(); }
      const eye = placeEye(lookYaw);
      perspectiveCamera.position.copy(eye);
      perspectiveCamera.lookAt(eye.x + Math.sin(lookYaw) * Math.cos(lookPitch) * 10, eye.y + Math.sin(lookPitch) * 10,
        eye.z + Math.cos(lookYaw) * Math.cos(lookPitch) * 10);
      perspectiveCamera.updateMatrixWorld();
      human.visible = true;
      human.userData.modelRig.head.visible = false;
      human.userData.viewmodel = true;
    } else if (mode === 'top2d') {
      useCamera(topCamera);
      topCamera.position.set(x, 35, z);
      topCamera.lookAt(x, 0, z);
      topCamera.updateMatrixWorld();
    } else {
      useCamera(perspectiveCamera);
      if (!presentation.sequel && perspectiveCamera.fov !== 64) { perspectiveCamera.fov = 64; perspectiveCamera.updateProjectionMatrix(); }
    }
    if (mode !== 'first') human.userData.viewmodel = false;
    chapterMode = mode;
  }
  function setViewMode(mode) {
    if (disposed) return;
    const next = horror ? 'first' : normalizeViewMode(mode);
    if (parkedViewMode !== null) { parkedViewMode = next; return; }
    if (next === viewMode) return;
    suspendInput();
    viewMode = next;
    activateCamera();
    lookReady = false;
    cameraReady = false;
    presentationCameraReady = false;
  }

  function applyLighting() {
    renderer.toneMappingExposure = horror ? 0.76 : DEFAULT_EXPOSURE;
    ambient.intensity = horror ? 0.14 : 1.36;
    moon.intensity = horror ? 0.24 : 2.65;
    warm.intensity = horror ? 8 : 56;
    rim.intensity = horror ? 5 : 45;
    flashlight.intensity = horror ? 25 : 29;
    scenery?.setHorrorMode(horror);
  }
  function setHorrorMode(enabled) {
    if (disposed) return;
    horror = Boolean(enabled);
    if (horror) setViewMode('first');
    applyLighting();
  }
  function clearOutcomeVisuals() {
    animateHumanOutcome(human, { kind: 'none', time: 0, duration: 1 });
    human.position.set(0, 0, 0);
    human.scale.setScalar(1);
    applyLighting();
    scareSpider.visible = false;
    maw.scale.set(0.13, 0.14, 0.13);
    mouthRim.scale.set(0.13, 0.14, 0.1);
    jaws.forEach((jaw, index) => { const side = index ? 1 : -1;
      jaw.position.x = side * 0.15; jaw.rotation.set(0, 0, side * 0.5);
    });
    scareLight.intensity = 0;
    if (epilogue) epilogue.root.visible = false;
    sequelView?.hide();
    human.getObjectByName('visible-carbine').visible = true;
    victoryLight.visible = false;
    victoryRim.visible = false;
    victoryLight.intensity = 0;
    victoryRim.intensity = 0;
    outcomeMaterial.opacity = 0;
    outcomePlane.visible = false;
    celebration.visible = false;
    celebrationMaterial.opacity = 0;
    halo.visible = true;
  }

  /** Presentation time is owned by main.js, including pause and terminal frames. */
  function setPresentation(value = {}) {
    if (disposed) return;
    const isCutscene = value.kind === 'cutscene' && typeof value.id === 'string';
    const kind = isCutscene ? 'victory' : value.kind === 'death' || value.kind === 'victory' ? value.kind : 'none';
    const cutsceneId = isCutscene ? value.id : null;
    const duration = Number.isFinite(value.duration) && value.duration > 0 ? value.duration : 1;
    const time = Number.isFinite(value.time) ? clamp(value.time, 0, duration) : 0;
    const restarted = kind !== presentation.kind || time < presentation.time || cutsceneId !== (presentation.cutscene ?? null);
    if (restarted) {
      clearOutcomeVisuals();
      presentationCameraReady = false;
      if (kind !== 'none') suspendInput();
    }
    const kindChanged = kind !== presentation.kind || cutsceneId !== (presentation.cutscene ?? null);
    presentation = { kind, time, duration, journey: kind === 'victory' && !cutsceneId ? value.journey ?? null : null,
      sequel: kind === 'victory' && !cutsceneId ? value.sequel ?? null : null, cutscene: cutsceneId,
      cutsceneOptions: cutsceneId ? value.options ?? {} : null };
    const houseChapter = presentation.sequel?.chapter === 'home';
    if (houseChapter && parkedViewMode === null) {
      parkedViewMode = viewMode;
      if (viewMode !== 'third') { suspendInput(); viewMode = 'third'; lookReady = false; cameraReady = false; activateCamera(); }
    } else if (!houseChapter && parkedViewMode !== null) {
      const restore = parkedViewMode;
      parkedViewMode = null;
      if (restore !== viewMode) { suspendInput(); viewMode = restore; lookReady = false; cameraReady = false; activateCamera(); }
    }
    if (kindChanged) activateCamera();
    if (kind === 'none' && restarted) cameraReady = false;
  }

  /** First-person keyboard look (works without Pointer Lock): arrow keys turn, WASD moves. */
  function keyTurn(dt) {
    if (viewMode !== 'first') return;
    const chapter = presentation.journey || presentation.sequel;
    if (chapter ? !dawnInputAllowed() : !inputAllowed()) return;
    const held = chapter ? dawnKeys : keys;
    const yaw = (held.has('ArrowLeft') ? 1 : 0) - (held.has('ArrowRight') ? 1 : 0);
    const pitch = (held.has('ArrowUp') ? 1 : 0) - (held.has('ArrowDown') ? 1 : 0);
    if (!yaw && !pitch) return;
    if (chapter) ensureChapterLook(); else ensureLook();
    lookYaw += yaw * dt * 2.2;
    lookPitch = clamp(lookPitch + pitch * dt * 1.4, -1.35, 1.1);
  }
  function resize() {
    if (disposed) return;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width || canvas.clientWidth || 1));
    const h = Math.max(1, Math.round(rect.height || canvas.clientHeight || 1));
    const ratio = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    if (width === w && height === h && pixelRatio === ratio) return;
    width = w;
    height = h;
    pixelRatio = ratio;
    renderer.setPixelRatio(ratio);
    renderer.setSize(w, h, false);
    perspectiveCamera.aspect = w / h;
    perspectiveCamera.updateProjectionMatrix();
    const aspect = w / h;
    const span = Math.max(7, 7 / aspect);
    topCamera.left = -span * aspect;
    topCamera.right = span * aspect;
    topCamera.top = span;
    topCamera.bottom = -span;
    topCamera.updateProjectionMatrix();
    const halfHeight = camera === topCamera ? span * 2 :
      Math.tan(THREE.MathUtils.degToRad(perspectiveCamera.fov / 2)) * 0.51;
    damagePlane.scale.set(halfHeight * aspect, halfHeight, 1);
    outcomePlane.scale.copy(damagePlane.scale);
  }
  listen(window, 'resize', resize);
  const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
  resizeObserver?.observe(canvas);

  function transientMaterial(color, opacity = 1) {
    return new THREE.MeshBasicMaterial({
      color, transparent: true, opacity, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false,
    });
  }
  function retireEffect(index) {
    const effect = effects[index];
    effect.object.removeFromParent();
    effect.material.dispose();
    effects.splice(index, 1);
  }
  function addEffect(effect) {
    // Cap burst geometry even if many enemies die in one frame.
    if (effects.length >= 150) retireEffect(0);
    effects.push(effect);
    scene.add(effect.object);
  }
  function ring(x, z, color, radius = 0.3, growth = 3, life = 0.36) {
    const material = transientMaterial(color, 0.75);
    const object = new THREE.Mesh(ringGeometry, material);
    object.position.set(x, 0.045, z);
    object.rotation.x = -Math.PI / 2;
    object.scale.setScalar(radius);
    addEffect({ kind: 'ring', object, material, life, maxLife: life, radius, growth });
  }
  function sparks(x, y, z, color, count, speed = 2.8) {
    for (let i = 0; i < count; i += 1) {
      const material = transientMaterial(color);
      const object = new THREE.Mesh(sparkGeometry, material);
      object.position.set(x, y, z);
      const angle = i * 2.39996 + clock * 4;
      const velocity = new THREE.Vector3(Math.sin(angle) * speed * (0.5 + (i % 3) * 0.2),
        1 + (i % 4) * 0.55, Math.cos(angle) * speed * (0.6 + (i % 2) * 0.3));
      const life = 0.22 + (i % 4) * 0.055;
      addEffect({ kind: 'spark', object, material, life, maxLife: life, velocity });
    }
  }
  function ghost() {
    const material = transientMaterial(0x8beef1, 0.27);
    const object = new THREE.Mesh(ghostGeometry, material);
    object.position.set(playerAnchor.position.x, 0.85, playerAnchor.position.z);
    object.rotation.y = playerAnchor.rotation.y;
    const life = 0.22;
    addEffect({ kind: 'ghost', object, material, life, maxLife: life });
  }
  function updateEffects(dt) {
    for (let i = effects.length - 1; i >= 0; i -= 1) {
      const effect = effects[i];
      effect.life -= dt;
      if (effect.life <= 0) { retireEffect(i); continue; }
      const progress = 1 - effect.life / effect.maxLife;
      effect.material.opacity = (1 - progress) * (effect.kind === 'ghost' ? 0.27 : 0.8);
      if (effect.kind === 'ring') effect.object.scale.setScalar(effect.radius + progress * effect.growth);
      if (effect.kind === 'spark') {
        effect.velocity.addScaledVector(DOWN, dt * 8);
        effect.object.position.addScaledVector(effect.velocity, dt);
        effect.object.rotation.x += dt * 8;
        effect.object.rotation.z += dt * 6;
        effect.object.scale.setScalar(1 - progress * 0.65);
      }
    }
  }

  function syncEnemies(state, dt) {
    const alive = new Set();
    for (const enemy of state.enemies) {
      alive.add(enemy.id);
      let entry = enemies.get(enemy.id);
      if (entry && entry.variant !== enemy.variant) {
        releaseModel(entry.model);
        enemies.delete(enemy.id);
        entry = null;
      }
      if (!entry) {
        const model = retainModel(createSpider(enemy.variant));
        entry = { model, variant: enemy.variant, x: enemy.x, z: enemy.z, born: state.time, strike: 0 };
        enemies.set(enemy.id, entry);
        scene.add(model);
        if (dt > 0) { ring(enemy.x, enemy.z, 0x9a58c4, 0.4, 2.2, 0.7); sparks(enemy.x, 0.2, enemy.z, 0x7d4aa8, 6, 1.8); }
      }
      const moving = dt > 0 && Math.hypot(enemy.x - entry.x, enemy.z - entry.z) > 0.0001;
      // Emerge from the floor after spawning; snap forward with the front legs when the player is in reach.
      const rise = ease((state.time - entry.born) / 0.7);
      entry.model.position.set(enemy.x, -(1 - rise) * 1.1, enemy.z);
      entry.model.rotation.y = enemy.yaw;
      animateSpider(entry.model, state.time + enemy.id * 0.23, moving || rise < 1);
      const reachRange = (STRIKE_RANGE[enemy.variant] ?? 1.0) + 0.45 + 0.55;
      const near = Math.hypot(enemy.x - state.player.x, enemy.z - state.player.z) < reachRange && rise >= 1;
      entry.strike += ((near ? 1 : 0) - entry.strike) * Math.min(1, dt * 12);
      if (entry.strike > 0.01) {
        animateSpiderStrike(entry.model, state.time, entry.strike * (0.55 + 0.45 * Math.sin(state.time * 11 + enemy.id)), 0);
        entry.struck = true;
      } else if (entry.struck) { animateSpiderStrike(entry.model, state.time, 0, 0); entry.struck = false; }
      entry.x = enemy.x;
      entry.z = enemy.z;
    }
    for (const [id, entry] of enemies) {
      if (!alive.has(id)) { dyingSpiders.push({ model: entry.model, age: 0 }); enemies.delete(id); }
    }
  }
  function updateDying(dt, flat, hidden) {
    for (let i = dyingSpiders.length - 1; i >= 0; i -= 1) {
      const dying = dyingSpiders[i];
      dying.age += dt;
      if (dying.age >= SPIDER_DEATH_SECONDS) { releaseModel(dying.model); dyingSpiders.splice(i, 1); continue; }
      animateSpiderDeath(dying.model, dying.age);
      const size = dying.model.userData.modelRig.style.size;
      dying.model.scale.y = size * (flat ? 0.22 : 1);
      dying.model.visible = !hidden;
    }
  }
  function syncProjectiles(state) {
    const alive = new Set();
    for (const projectile of state.projectiles) {
      alive.add(projectile.id);
      let object = projectiles.get(projectile.id);
      if (!object) {
        object = new THREE.Group();
        object.add(new THREE.Mesh(projectileGeometry, projectileMaterial));
        const trail = new THREE.Mesh(projectileGeometry, trailMaterial);
        trail.scale.set(1.9, 1.9, 1.8);
        trail.position.z = -0.35;
        object.add(trail);
        projectiles.set(projectile.id, object);
        scene.add(object);
      }
      object.position.set(projectile.x, 0.68, projectile.z);
      object.rotation.y = Math.atan2(projectile.dx, projectile.dz);
    }
    for (const [id, object] of projectiles) {
      if (!alive.has(id)) { object.removeFromParent(); projectiles.delete(id); }
    }
  }

  function updateDeathPose(state) {
    if (!presentationCameraReady) {
      // Stage the oversized attacker inside the existing room. Only this visual
      // anchor moves; terminal simulation coordinates and saved yaw are untouched.
      deathOrigin.set(clamp(state.player.x, -arena.halfWidth + 8.3, arena.halfWidth - 3.5), 0,
        clamp(state.player.z, -arena.halfDepth + 3.5, arena.halfDepth - 8.3));
      deathHeading = -Math.PI / 4;
      deathDirection.set(Math.sin(deathHeading), 0, Math.cos(deathHeading));
      presentationCameraReady = true;
    }
    const t = presentation.time / presentation.duration;
    const approach = ease(t / 0.46);
    const swallow = ease((t - 0.52) / 0.3);
    const opening = ease(t / 0.2) * (1 - ease((t - 0.75) / 0.13));
    playerAnchor.position.copy(deathOrigin);
    playerAnchor.rotation.set(0, deathHeading, 0);
    scareSpider.visible = true;
    scareSpider.scale.setScalar(6.2);
    scareSpider.position.copy(deathOrigin).addScaledVector(deathDirection, 7 - approach * 2.7);
    scareSpider.rotation.set(0, deathHeading + Math.PI, 0);
    animateSpider(scareSpider, presentation.time * 1.35, t < 0.46);
    // Rear up, hammer the front legs over the prey, then heave the abdomen while chewing.
    const reach = ease((t - 0.36) / 0.1) * (1 - ease((t - 0.8) / 0.12));
    const chew = ease((t - 0.62) / 0.1) * (1 - ease((t - 0.93) / 0.07));
    animateSpiderStrike(scareSpider, presentation.time, reach, chew);
    const chomp = Math.sin(presentation.time * 19) * 0.5 + 0.5;
    maw.scale.set(0.13 + (opening + chew * chomp * 0.6) * 0.05, 0.14 + (opening + chew * chomp * 0.7) * 0.04, 0.13);
    mouthRim.scale.set(maw.scale.x, maw.scale.y, 0.1);
    jaws.forEach((jaw, index) => {
      const side = index ? 1 : -1;
      jaw.position.x = side * (0.13 + opening * 0.08);
      jaw.rotation.set(Math.PI, 0, side * (0.18 + (opening + chew * chomp * 0.5) * 0.5));
    });
    // Resolve both sockets in the same anchor space. Shrinking around the body
    // centre then pulling into the open cavity avoids an offset caused by yaw.
    playerAnchor.updateMatrixWorld(true);
    scareSpider.updateMatrixWorld(true);
    const rig = human.getObjectByName('human-rig');
    rig.localToWorld(bodyCenter.set(0, 1.02, 0));
    maw.localToWorld(mouthPosition.set(0, 0, -0.58));
    playerAnchor.worldToLocal(bodyCenter);
    playerAnchor.worldToLocal(mouthPosition);
    const scale = 1 - swallow * 0.92;
    human.scale.setScalar(scale);
    human.position.copy(mouthPosition).sub(bodyCenter).multiplyScalar(swallow)
      .addScaledVector(bodyCenter, 1 - scale);
    // Prey is lifted off the floor and dragged head-first, struggling, into the maw.
    const hoist = ease((t - 0.44) / 0.12);
    human.position.y += Math.sin(swallow * Math.PI) * 0.45 + hoist * 0.3 * (1 - swallow);
    human.rotation.set(0, 0, Math.sin(presentation.time * 31) * 0.1 * hoist * (1 - swallow));
    human.visible = swallow < 1;
  }

  function updateDeathCamera() {
    // Fit the actual giant's legs and a full survivor, including portrait screens.
    // The +X/+Z cutaway side is intentionally retained to avoid far-wall occlusion.
    deathBounds.setFromObject(scareSpider);
    deathBounds.expandByPoint(scratch.copy(deathOrigin).addScalar(-1.4).setY(0));
    deathBounds.expandByPoint(scratch.copy(deathOrigin).addScalar(1.8).setY(2.25));
    deathBounds.getCenter(cinematicTarget);
    cinematicBack.set(0.62, 0.54, 0.62).normalize();
    cinematicRight.set(cinematicBack.z, 0, -cinematicBack.x).normalize();
    cinematicUp.crossVectors(cinematicBack, cinematicRight).normalize();
    const halfFov = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    let distance = 6;
    for (const x of [deathBounds.min.x, deathBounds.max.x]) {
      for (const y of [deathBounds.min.y, deathBounds.max.y]) {
        for (const z of [deathBounds.min.z, deathBounds.max.z]) {
          scratch.set(x, y, z).sub(cinematicTarget);
          const depth = scratch.dot(cinematicBack);
          distance = Math.max(distance,
            depth + (Math.abs(scratch.dot(cinematicRight)) + 0.5) / (halfFov * camera.aspect * 0.88),
            depth + (Math.abs(scratch.dot(cinematicUp)) + 0.5) / (halfFov * 0.88));
        }
      }
    }
    camera.position.copy(cinematicTarget).addScaledVector(cinematicBack, distance);
    camera.lookAt(cinematicTarget);
    camera.updateMatrixWorld();
    scene.fog.near = Math.max(48, distance + 12);
    scene.fog.far = Math.max(100, distance + 60);
  }

  let cutsceneStage = null, cutsceneStageId = null, fogBackup = null;
  function updateCutscene() {
    if (cutsceneStage && cutsceneStageId !== presentation.cutscene) {
      cutsceneStage.dispose(); cutsceneStage = null; cutsceneStageId = null;
    }
    if (!presentation.cutscene) return false;
    if (!cutsceneStage) {
      cutsceneStage = createCutsceneStage(presentation.cutscene, presentation.cutsceneOptions); cutsceneStageId = presentation.cutscene;
      scene.add(cutsceneStage.root);
    }
    if (epilogue) epilogue.root.visible = false;
    sequelView?.hide();
    useCamera(perspectiveCamera);
    if (perspectiveCamera.fov !== 58) { perspectiveCamera.fov = 58; perspectiveCamera.updateProjectionMatrix(); }
    cutsceneStage.update(presentation.time, perspectiveCamera);
    human.visible = false;
    const fog = cutsceneStage.fog;
    if (!fogBackup) fogBackup = scene.fog.color.clone();
    if (fog) { scene.fog.color.setHex(fog.color); scene.fog.near = fog.near; scene.fog.far = fog.far; }
    else { scene.fog.near = 400; scene.fog.far = 900; }
    return true;
  }

  function updateCamera(state, dt) {
    const player = state.player;
    if (cutsceneStage && !presentation.cutscene) { cutsceneStage.hide(); if (fogBackup) { scene.fog.color.copy(fogBackup); fogBackup = null; } }
    if (presentation.kind === 'victory') {
      if (updateCutscene()) return;
      if (presentation.sequel) {
        if (!sequelView) { sequelView = createSequelView(); scene.add(sequelView.root); }
        if (epilogue) epilogue.root.visible = false;
        sequelView.update(presentation.sequel, perspectiveCamera, playerAnchor, dt);
        const q = presentation.sequel;
        applyChapterCamera(!q.complete && !q.lost && !['nina', 'ending'].includes(q.stage), q.player.x, q.player.z);
        scene.fog.near = 80; scene.fog.far = 140;
        return;
      }
      sequelView?.hide();
      if (!epilogue) { epilogue = createDawnEpilogue(); scene.add(epilogue.root); }
      if (presentation.journey) {
        const journey = presentation.journey;
        if (dt > 0) dawnWalking = Math.hypot(journey.x - dawnLastX, journey.z - dawnLastZ) > 0.00001;
        epilogue.updateJourney(journey, perspectiveCamera, playerAnchor, dawnWalking);
        dawnLastX = journey.x; dawnLastZ = journey.z;
        applyChapterCamera(!journey.complete, journey.x, journey.z);
      } else { useCamera(perspectiveCamera); chapterMode = 'third'; epilogue.update(presentation.time, presentation.duration, perspectiveCamera, playerAnchor); }
      scene.fog.near = 110;
      scene.fog.far = 180;
      return;
    }
    if (presentation.kind === 'death') {
      updateDeathCamera();
      return;
    }
    if (viewMode === 'top2d' && presentation.kind === 'none') {
      camera.position.set(player.x, 35, player.z);
      camera.lookAt(player.x, 0, player.z);
      camera.updateMatrixWorld();
      scene.fog.near = 48;
      scene.fog.far = 100;
      cameraReady = true;
      return;
    }
    if (viewMode === 'first' && presentation.kind === 'none') {
      ensureLook();
      const eye = placeEye(lookYaw);
      camera.position.copy(eye);
      viewTarget.set(eye.x + Math.sin(lookYaw) * Math.cos(lookPitch) * 10,
        eye.y + Math.sin(lookPitch) * 10,
        eye.z + Math.cos(lookYaw) * Math.cos(lookPitch) * 10);
      camera.lookAt(viewTarget);
      camera.updateMatrixWorld();
      scene.fog.near = 21;
      scene.fog.far = 49;
      cameraReady = true;
      return;
    }
    // Bias the view toward nearby attackers, never toward distant spawn points.
    let threatX = 0;
    let threatZ = 0;
    let total = 0;
    for (const enemy of state.enemies) {
      const distance = Math.hypot(enemy.x - player.x, enemy.z - player.z);
      if (distance > 10) continue;
      const weight = (10 - distance) / 10;
      threatX += (enemy.x - player.x) * weight;
      threatZ += (enemy.z - player.z) * weight;
      total += weight;
    }
    const follow = activeMap ? 0.72 : 0.3;
    const limitX = activeMap ? Math.max(0, arena.halfWidth - 1.4) : 3;
    const limitZ = activeMap ? Math.max(0, arena.halfDepth - 1.4) : 3;
    desiredFocus.set(clamp(player.x * follow + threatX / Math.max(1, total) * 0.1, -limitX, limitX),
      0.65, clamp(player.z * follow + threatZ / Math.max(1, total) * 0.1, -limitZ, limitZ));
    if (!cameraReady) focus.copy(desiredFocus);
    else focus.lerp(desiredFocus, 1 - Math.exp(-dt * 3.5));
    // Keep a useful local floor area visible even in a long, narrow arena.
    const halfFov = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    let needed = 19;
    const fit = (x, y, z, margin) => {
      scratch.set(x, y, z).sub(focus);
      const depth = scratch.dot(CAMERA_BACK);
      needed = Math.max(needed,
        depth + (Math.abs(scratch.dot(CAMERA_RIGHT)) + margin) / (halfFov * camera.aspect * 0.86),
        depth + (Math.abs(scratch.dot(CAMERA_UP)) + margin) / (halfFov * 0.86));
    };
    if (activeMap) {
      for (const x of [-1, 1]) for (const z of [-1, 1]) {
        fit(clamp(player.x + x * Math.min(3.2, arena.halfWidth), -arena.halfWidth, arena.halfWidth), 0,
          clamp(player.z + z * Math.min(3.2, arena.halfDepth), -arena.halfDepth, arena.halfDepth), 0.4);
      }
    }
    fit(player.x, 2.2, player.z, 1.8);
    fit(player.x, 0, player.z, 1.8);
    for (const enemy of state.enemies) {
      const distance = Math.hypot(enemy.x - player.x, enemy.z - player.z);
      if (distance <= 10) fit(enemy.x, 0.8, enemy.z, enemy.variant === 'boss' ? 1.6 : 0.8);
    }
    // Zoom out immediately to preserve framing after resize; ease back inward.
    if (!cameraReady || needed > cameraDistance) cameraDistance = needed;
    else cameraDistance += (needed - cameraDistance) * (1 - Math.exp(-dt * 2));
    viewTarget.copy(focus);
    camera.position.copy(focus).addScaledVector(CAMERA_BACK, cameraDistance);
    presentationCameraReady = false;
    if (shake > 0) {
      camera.position.x += Math.sin(clock * 79) * shake;
      camera.position.z += Math.cos(clock * 91) * shake;
    }
    const distance = camera.position.distanceTo(viewTarget);
    const far = Math.max(220, distance + 60);
    if (camera.far !== far) { camera.far = far; camera.updateProjectionMatrix(); }
    scene.fog.near = Math.max(48, distance + 16);
    scene.fog.far = Math.max(100, distance + 65);
    camera.lookAt(viewTarget);
    camera.updateMatrixWorld();
    cameraReady = true;
  }

  function updatePresentationVisuals(state) {
    if (presentation.kind === 'none') return;
    if (presentation.kind === 'victory') {
      renderer.toneMappingExposure = DEFAULT_EXPOSURE;
      ambient.intensity = 0;
      moon.intensity = 0;
      warm.intensity = 0;
      rim.intensity = 0;
      muzzleLight.intensity = 0;
      outcomePlane.visible = false;
      celebration.visible = false;
      halo.visible = false;
      beam.visible = false;
      flashlight.visible = false;
      return;
    }
    if (presentation.kind === 'death') {
      const t = presentation.time / presentation.duration;
      halo.visible = false; beam.visible = false; flashlight.visible = false;
      renderer.toneMappingExposure = horror ? 1.04 : DEFAULT_EXPOSURE;
      ambient.intensity = horror ? 0.44 : 1.36;
      moon.intensity = horror ? 0.9 : 2.65;
      scareLight.position.copy(deathOrigin).add(scratch.set(1.5, 4, 2.5));
      scareLight.intensity = 85;
      outcomeMaterial.opacity = ease((t - 0.88) / 0.12) * 0.96;
      outcomePlane.visible = outcomeMaterial.opacity > 0;
      return;
    }
    const progress = presentation.time / presentation.duration;
    const dying = presentation.kind === 'death';
    const amount = ease(progress / 0.7);
    if (dying) {
      renderer.toneMappingExposure = DEFAULT_EXPOSURE * (1 - amount * 0.45);
      ambient.intensity = 1.36 * (1 - amount * 0.48);
      moon.intensity = 2.65 * (1 - amount * 0.58);
      warm.intensity = 56 * (1 - amount * 0.66);
      rim.intensity = 45 * (1 - amount * 0.66);
      flashlight.intensity = 29 * (1 - ease(progress / 0.38));
      // Darken late enough that the body is visibly on the floor first.
      outcomeMaterial.opacity = ease((progress - 0.56) / 0.44) * 0.86;
      outcomePlane.visible = outcomeMaterial.opacity > 0;
    } else {
      renderer.toneMappingExposure = DEFAULT_EXPOSURE + amount * 0.19;
      ambient.intensity = 1.55 + amount * 0.55;
      const flourish = 1 + Math.sin(progress * Math.PI * 4) * 0.08 * amount;
      victoryLight.visible = true;
      victoryRim.visible = true;
      victoryLight.position.set(state.player.x - 2.2, 4.3, state.player.z + 2.4);
      victoryRim.position.set(state.player.x + 2.7, 2.8, state.player.z - 2.1);
      victoryLight.intensity = amount * 78 * flourish;
      victoryRim.intensity = amount * 58;
      celebration.position.set(state.player.x, 0, state.player.z);
      const rise = ease((progress - 0.1) / 0.65);
      for (let i = 0; i < celebrationPositions.length / 3; i += 1) {
        const angle = i * 2.39996 + progress * 0.9;
        const radius = 0.7 + (i % 6) * 0.34 + rise * 0.65;
        celebrationPositions[i * 3] = Math.cos(angle) * radius;
        celebrationPositions[i * 3 + 1] = 0.2 + ((i * 7) % 13) * 0.1 + rise * (1 + (i % 5) * 0.3);
        celebrationPositions[i * 3 + 2] = Math.sin(angle) * radius;
      }
      celebrationGeometry.attributes.position.needsUpdate = true;
      celebrationMaterial.opacity = ease(progress / 0.24) * 0.75;
      celebration.visible = true;
    }
    halo.visible = !dying;
    if (!dying) {
      haloMaterial.color.setHex(0xb9f6cf);
      haloMaterial.opacity = 0.24 + amount * 0.18;
      halo.scale.setScalar(0.6 + amount * 0.35);
    }
  }

  function updateWeapon() {
    playerAnchor.updateMatrixWorld(true);
    if (muzzleSocket) muzzleSocket.getWorldPosition(muzzle);
    else muzzle.set(0.15, 1.1, 1.25).applyMatrix4(human.matrixWorld);
    if (lampSocket) lampSocket.getWorldPosition(lampPosition);
    else lampPosition.set(-0.12, 1.05, 0.75).applyMatrix4(human.matrixWorld);
    flashlight.position.copy(lampPosition);
    const yaw = playerAnchor.rotation.y;
    flashlight.target.position.set(lampPosition.x + Math.sin(yaw) * 9, 0,
      lampPosition.z + Math.cos(yaw) * 9);
    flashlight.target.updateMatrixWorld();
    beam.position.copy(lampPosition);
    beam.lookAt(flashlight.target.position);
    flashMesh.position.copy(muzzle);
    flashMesh.rotation.set(clock * 31, yaw, clock * 43);
    flashMesh.scale.set(0.8, 0.8, 1.8);
    flashMaterial.opacity = Math.min(1, muzzleGlow * 15);
    flashMesh.visible = muzzleGlow > 0;
    muzzleLight.position.copy(muzzle);
    muzzleLight.intensity = muzzleGlow * 320;
  }

  function playEvents(events) {
    for (const event of events) {
      if (!Number.isFinite(event.x) || !Number.isFinite(event.z)) continue;
      switch (event.type) {
        case 'shot':
          muzzleGlow = 0.065;
          sparks(muzzle.x, muzzle.y, muzzle.z, 0xffcf79, 3, 1.1);
          break;
        case 'hit':
          sparks(event.x, 0.45, event.z, 0xffb75d, 8);
          ring(event.x, event.z, 0xff9654, 0.12, 0.75, 0.18);
          break;
        case 'infected-kill':
          sparks(event.x, 0.9, event.z, 0xa83228, 14, 2.6);
          ring(event.x, event.z, 0x7a1f1a, 0.3, 1.8, 1.1);
          break;
        case 'kill':
          sparks(event.x, 0.55, event.z, 0xe85e4a, 18, 3.6);
          sparks(event.x, 0.3, event.z, 0x6aa84f, 8, 2.2);
          ring(event.x, event.z, 0xdc5d48, 0.35, 1.3, 0.4);
          ring(event.x, event.z, 0x8a2f2a, 0.2, 2.6, 0.9);
          break;
        case 'hurt':
          damageFlash = 0.32;
          shake = Math.max(shake, 0.13);
          ring(event.x, event.z, 0xff615c, 0.35, 1.1, 0.3);
          break;
        case 'dodge':
          dodgeGlow = 0.26;
          ghostTimer = 0;
          ring(event.x, event.z, 0x86edf0, 0.38, 1.7, 0.32);
          ghost();
          break;
        case 'wave':
          ring(event.x, event.z, 0xf5be76, 1.1, 5.3, 0.8);
          break;
        case 'win':
          ring(event.x, event.z, 0xb8f5ca, 0.7, 6, 1.2);
          sparks(event.x, 1, event.z, 0xb8f5ca, 24, 4.5);
          break;
        case 'lose':
          damageFlash = 0.5;
          shake = 0.19;
          ring(event.x, event.z, 0xef5a52, 0.8, 3, 0.7);
          break;
        default: break;
      }
    }
  }

  function clearCombatEffects() {
    for (let i = effects.length - 1; i >= 0; i -= 1) retireEffect(i);
    for (const object of projectiles.values()) object.removeFromParent();
    projectiles.clear();
    damageFlash = 0;
    dodgeGlow = 0;
    muzzleGlow = 0;
    ghostTimer = 0;
    shake = 0;
    damageMaterial.opacity = 0;
    damagePlane.visible = false;
    flashMaterial.opacity = 0;
    flashMesh.visible = false;
    muzzleLight.intensity = 0;
    reticle.visible = false;
    halo.scale.setScalar(0.54);
    haloMaterial.color.setHex(0xf4c18a);
    haloMaterial.opacity = 0.19;
  }

  function reset() {
    if (disposed) return;
    suspendInput();
    clearCombatEffects();
    clearOutcomeVisuals();
    // Keep the presentation/camera snapshot: main restores its held time on pause.
    // A different kind or an earlier time in setPresentation starts a new capture.
    cameraReady = false;
    canvas.style.cursor = originalCursor;
    // reset is also used on pause/blur: don't destroy the persistent scenery.
    for (const entry of enemies.values()) entry.model.visible = true;
    clearDying();
  }

  function render(state, events = [], dt = 0) {
    if (disposed || contextLost || !state) return;
    dt = Number.isFinite(dt) ? clamp(dt, 0, 0.05) : 0;
    if (lastState && (state !== lastState || state.time < clock - 0.1)) { reset(); lookReady = false; }
    const moving = lastState === state && dt > 0
      && Math.hypot(state.player.x - lastPlayerX, state.player.z - lastPlayerZ) > 0.0001;
    lastState = state;
    clock = state.time;
    lastPlayerX = state.player.x;
    lastPlayerZ = state.player.z;
    syncEnvironment(state);
    keyTurn(dt);
    scenery?.syncInfected(state.infectedDead || [], state.infectedSpared || []);
    scenery?.update(dt);
    resize();
    updateEffects(dt);
    damageFlash = Math.max(0, damageFlash - dt);
    muzzleGlow = Math.max(0, muzzleGlow - dt);
    dodgeGlow = Math.max(0, dodgeGlow - dt);
    shake *= Math.exp(-dt * 18);
    playerAnchor.position.set(state.player.x, 0, state.player.z);
    playerAnchor.rotation.y = state.player.yaw;
    // Restore outcome-only transforms before applying ordinary locomotion.
    // Outcome poses are then derived from main's time, never integrated by view.
    animateHumanOutcome(human, { kind: 'none' });
    animateHuman(human, state.time, moving, presentation.kind === 'none' ? {
      recoil: ease(clamp(muzzleGlow / 0.065, 0, 1)), hurt: ease(clamp(damageFlash / 0.32, 0, 1)),
      dash: ease(clamp(dodgeGlow / 0.26, 0, 1)), viewmodel: viewMode === 'first',
    } : undefined);
    if (presentation.kind === 'death') animateHumanOutcome(human, presentation);
    const flat = viewMode === 'top2d' && presentation.kind === 'none';
    const firstPerson = viewMode === 'first' && presentation.kind === 'none';
    // Full-body rig would put the near plane inside the face/vest; hide it only at eye level.
    const dawn = presentation.kind === 'victory';
    human.visible = true;
    human.userData.modelRig.head.visible = !firstPerson;
    room.visible = !activeMap && !dawn;
    if (scenery) scenery.root.visible = !dawn;
    human.scale.set(1, flat ? 0.22 : 1, 1);
    human.position.set(0, 0, 0);
    human.rotation.set(0, 0, 0);
    scenery?.root.scale.set(1, flat ? 0.22 : 1, 1);
    syncEnemies(state, dt);
    for (const entry of enemies.values()) {
      const size = entry.model.userData.modelRig.style.size;
      entry.model.scale.y = size * (flat ? 0.22 : 1);
      entry.model.visible = !dawn && presentation.kind !== 'death';
    }
    updateDying(dt, flat, dawn || presentation.kind === 'death');
    if (presentation.kind === 'none') syncProjectiles(state);
    if (presentation.kind === 'death') updateDeathPose(state);
    updateCamera(state, dt);
    updateWeapon();
    playEvents(events);
    updateWeapon();
    if (dodgeGlow > 0) {
      ghostTimer -= dt;
      if (ghostTimer <= 0) { ghost(); ghostTimer = 0.045; }
    }
    halo.position.set(state.player.x, 0.025, state.player.z);
    halo.scale.setScalar(0.54 + dodgeGlow * 0.8);
    haloMaterial.color.setHex(dodgeGlow > 0 ? 0x9bf6ff : state.player.invulnerable > 0 ? 0xff8b76 : 0xf4c18a);
    haloMaterial.opacity = dodgeGlow > 0 ? 0.5
      : state.player.invulnerable > 0 ? 0.3 + Math.sin(state.time * 25) * 0.15 : 0.19;
    damageMaterial.opacity = Math.min(0.22, damageFlash * 0.6);
    damagePlane.visible = damageFlash > 0;
    beam.visible = state.player.hp > 0;
    flashlight.visible = state.player.hp > 0 || presentation.kind === 'death';
    updatePresentationVisuals(state);
    if (!inputAllowed()) {
      if (!dawnInputAllowed()) clearInput();
      if (document.pointerLockElement === canvas || lockRequested) releasePointerLock();
    }
    readAim();
    // Eye-level shots still follow the same horizontal simulation. Project that
    // world target rather than drawing a misleading fixed crosshair at pitched centre.
    if (firstPerson) reticle.position.set(state.player.x + Math.sin(lookYaw) * 8,
      0.68, state.player.z + Math.cos(lookYaw) * 8);
    else reticle.position.set(aim.x, 0.035, aim.z);
    if (firstPerson) {
      reticle.quaternion.copy(camera.quaternion);
      reticle.rotateX(Math.PI / 2);
    } else reticle.rotation.set(0, 0, 0);
    reticle.visible = inputAllowed() && (pointer.valid || firstPerson);
    if ((presentation.sequel || presentation.journey) && dawnInputAllowed() && chapterMode === 'first' && !presentation.sequel?.safeOpen) {
      const pp = presentation.sequel ? presentation.sequel.player : presentation.journey;
      reticle.position.set(pp.x + Math.sin(lookYaw) * 8, 0.68, pp.z + Math.cos(lookYaw) * 8);
      reticle.quaternion.copy(camera.quaternion); reticle.rotateX(Math.PI / 2); reticle.visible = true;
    } else if (presentation.sequel && dawnInputAllowed() && chapterPointer.valid && chapterMode !== 'first'
      && !presentation.sequel.safeOpen && !['nina', 'ending'].includes(presentation.sequel.stage)) {
      reticle.position.set(chapterAim.x, 0.04, chapterAim.z); reticle.rotation.set(0, 0, 0); reticle.visible = true;
    }
    // First person never shows the system cursor (it is steered by mouse motion); other views keep the crosshair.
    canvas.style.cursor = viewMode === 'first' && (inputAllowed() || dawnInputAllowed()) ? 'none'
      : inputAllowed() ? 'crosshair' : originalCursor;
    renderer.render(scene, camera);
  }

  function dispose() {
    if (disposed) return;
    reset();
    disposed = true;
    for (const remove of listeners) remove();
    listeners.length = 0;
    resizeObserver?.disconnect();
    for (const entry of enemies.values()) releaseModel(entry.model);
    enemies.clear();
    clearDying();
    releaseModel(human);
    releaseModel(room);
    releaseModel(scareSpider);
    epilogue?.dispose();
    epilogue = null;
    cutsceneStage?.dispose();
    cutsceneStage = null;
    sequelView?.dispose();
    sequelView = null;
    releaseScenery();
    for (const resource of owned) resource.dispose();
    owned.clear();
    moon.shadow.dispose();
    scene.clear();
    renderer.renderLists.dispose();
    renderer.dispose();
    canvas.style.cursor = originalCursor;
    canvas.style.touchAction = originalTouchAction;
    lastState = null;
  }

  applyLighting();
  resize();
  flashMesh.visible = false;
  reticle.visible = false;
  damagePlane.visible = false;
  /** Rebuild the scenery on the next frame (used when the loaded 3D people arrive after the menu scene was already built). */
  function refreshScenery() { if (!disposed) activeMap = undefined; }
  return { sampleInput, render, setPresentation, setViewMode, setHorrorMode, reset, dispose, refreshScenery,
    sampleJourneyInput() {
      if (!dawnInputAllowed()) return { moveX: 0, moveZ: 0, interact: false };
      const down = (...codes) => codes.some(code => dawnKeys.has(code)) ? 1 : 0;
      if (viewMode === 'first') ensureChapterLook();
      const arrows = viewMode !== 'first';
      const horizontal = down('KeyD', ...(arrows ? ['ArrowRight'] : [])) - down('KeyA', ...(arrows ? ['ArrowLeft'] : [])), vertical = down('KeyS', ...(arrows ? ['ArrowDown'] : [])) - down('KeyW', ...(arrows ? ['ArrowUp'] : []));
      const input = { ...movementInWorld(viewMode, horizontal, vertical, lookYaw), interact: dawnInteract,
        sprint: dawnKeys.has('ShiftLeft') || dawnKeys.has('ShiftRight'),
        shoot: dawnKeys.has('Space') || chapterPointer.shoot };
      if (presentation.sequel && viewMode === 'first') {
        ensureChapterLook();
        const p = presentation.sequel.player;
        input.aimX = p.x + Math.sin(lookYaw) * 10000; input.aimZ = p.z + Math.cos(lookYaw) * 10000;
      } else if (presentation.sequel && chapterPointer.valid) {
        const rect = canvas.getBoundingClientRect();
        pointerNDC.set((chapterPointer.x - rect.left) / rect.width * 2 - 1,
          -(chapterPointer.y - rect.top) / rect.height * 2 + 1);
        camera.updateMatrixWorld(); raycaster.setFromCamera(pointerNDC, camera);
        if (raycaster.ray.intersectPlane(floor, scratch)) { input.aimX = scratch.x; input.aimZ = scratch.z; chapterAim.copy(scratch); }
      }
      dawnInteract = false;
      return input;
    },
  };
}
