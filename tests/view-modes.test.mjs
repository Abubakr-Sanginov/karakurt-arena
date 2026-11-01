import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { VIEW_MODES, normalizeViewMode, movementInWorld } from '../src/viewModes.js';
import { createCampaignScenery, animateHumanOutcome } from '../src/campaignVisuals.js';
import { createView } from '../src/view.js';
import { createDawnEpilogue } from '../src/epilogue.js';
import { PerspectiveCamera, Box3 } from 'three';
import { createAudio } from '../src/audio.js';
import { CAMPAIGN } from '../src/campaignData.js';
import { createCampaignGame, stepCampaign, advanceCampaign, nearestInfected, calmNearbyInfected } from '../src/simulation.js';
import { CUTSCENES, subtitleAt, cutsceneCues, cutsceneDuration, cutsceneChoiceAt, cutsceneChoiceOptions, fillNames } from '../src/cutsceneData.js';
import * as story from '../src/story.js';
import { createCutsceneStage } from '../src/cutsceneScenes.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8').replace(/^import .*;\r?$/gm, '');

// A DOM/view double exercises main's transitions and storage failures, NOT WebGL.
function mainHarness({ stored, storageFails = false, renderFails = false, step = stepCampaign, search = '' } = {}) {
  const calls = [], frames = [], errors = [], saved = new Map([['karakurt.viewMode', stored]]);
  let document;
  class Element {
    constructor(id) {
      this.id = id;
      this.dataset = {};
      this.attrs = {};
      this.style = {};
      this.listeners = {};
      this.textContent = '';
      const classes = new Set();
      this.classList = {
        contains: (name) => classes.has(name),
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name),
        toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
      };
    }
    setAttribute(name, value) { this.attrs[name] = value; }
    getAttribute(name) { return this.attrs[name]; }
    addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
    emit(type, extra = {}) {
      const event = { target: this, preventDefault() {}, ...extra };
      for (const handler of this.listeners[type] || []) handler(event);
    }
    focus() { document.activeElement = this; }
    querySelector() { return this.status ||= new Element('status'); }
    querySelectorAll() { return this.id === 'view-picker' ? [...options, ...gameOptions, elements['view-continue']] : []; }
    contains(element) { return this.querySelectorAll().includes(element); }
    closest() { return null; }
    replaceChildren(...children) { this.children = children; }
  }
  const elements = Object.fromEntries([...html.matchAll(/\bid="([^"]+)"/g)].map(([, id]) => [id, new Element(id)]));
  const options = VIEW_MODES.map(({ id }) => Object.assign(new Element(id), { dataset: { viewMode: id } }));
  const gameOptions = ['campaign', 'horror'].map((id) => Object.assign(new Element(id), { dataset: { gameMode: id } }));
  document = Object.assign(new Element('document'), {
    body: new Element('body'), hidden: false, hasFocus: () => true,
    getElementById: (id) => elements[id], createElement: () => new Element('p'),
    querySelectorAll: (selector) => selector === '[data-view-mode]' ? options
      : selector === '[data-game-mode]' ? gameOptions : [],
  });
  const view = Object.fromEntries(['reset', 'setPresentation', 'setViewMode', 'setHorrorMode', 'dispose'].map((name) => [name,
    (...args) => calls.push([name, ...args])]));
  view.sampleInput = () => ({ moveX: 0, moveZ: 0, aimX: 0, aimZ: 8 });
  view.render = (state) => {
    if (renderFails) throw new ReferenceError('Synthetic scene fault');
    calls.push(['render', structuredClone(state)]);
  };
  vm.runInNewContext(main, {
    document, window: new Element('window'), localStorage: {
      getItem(key) { if (storageFails) throw new Error('Storage denied'); return saved.get(key); },
      setItem(key, value) { if (storageFails) throw new Error('Quota exceeded'); saved.set(key, value); },
    },
    createCampaignGame, stepCampaign: step, advanceCampaign, CAMPAIGN, VIEW_MODES, normalizeViewMode, CUTSCENES, subtitleAt, cutsceneCues,
    nearestInfected, calmNearbyInfected, cutsceneDuration, cutsceneChoiceAt, cutsceneChoiceOptions, ...story, URLSearchParams, location: { search },
    createView: () => view, createAudio: () => ({}), Intl, Promise,
    requestAnimationFrame: (fn) => { frames.push(fn); return frames.length; }, cancelAnimationFrame() {},
    console: { error: (...args) => errors.push(args) },
  });
  return { elements, options, gameOptions, calls, errors, saved, document,
    frame() { const callback = frames.shift(); assert.ok(callback, 'animation frame scheduled'); callback(16); },
  };
}

test('perspective contract is exact, defaults safely, and is immutable', () => {
  assert.deepEqual(VIEW_MODES.map(({ id }) => id), ['top2d', 'third', 'first']);
  assert.deepEqual(VIEW_MODES.map(({ label }) => label), ['2D — вид сверху', 'От третьего лица', 'От первого лица']);
  for (const mode of VIEW_MODES) {
    assert.ok(mode.description.length > 12);
    assert.equal(normalizeViewMode(mode.id), mode.id);
    assert.ok(Object.isFrozen(mode));
  }
  for (const bad of [null, undefined, '', 'FIRST', '2d', 0, {}, [], '__proto__']) {
    assert.equal(normalizeViewMode(bad), 'third');
  }
});

test('first-person movement follows the look direction with normalized diagonal travel', () => {
  const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`);
  for (const mode of ['top2d', 'third']) assert.deepEqual(movementInWorld(mode, 1, -1, 1.2), { moveX: 1, moveZ: -1 });
  const forward = movementInWorld('first', 0, -1, Math.PI / 2);
  close(forward.moveX, 1); close(forward.moveZ, 0);
  const right = movementInWorld('first', 1, 0, 0);
  close(right.moveX, -1); close(right.moveZ, 0);
  for (let yaw = -Math.PI; yaw <= Math.PI; yaw += 0.2) {
    const { moveX, moveZ } = movementInWorld('first', 1, -1, yaw);
    close(Math.hypot(moveX, moveZ), 1);
  }
});

test('every chapter builds full data-driven scenery, stays atmospheric, pauses and disposes once', () => {
  for (const map of CAMPAIGN) {
    const snapshot = structuredClone(map);
    const scenery = createCampaignScenery(map);
    assert.equal(scenery.root.name, `campaign-${map.id}`);
    const resources = new Set();
    let instances = 0;
    scenery.root.traverse((node) => {
      if (node.geometry) resources.add(node.geometry);
      for (const material of [node.material].flat().filter(Boolean)) resources.add(material);
      if (node.isInstancedMesh) { instances += node.count; resources.add(node); }
    });
    assert.ok(instances > 100, 'architecture and floor are batched, not an empty substitute');
    map.props.forEach(({ kind }) => assert.ok(scenery.root.getObjectByName(`prop-${kind}`)));
    map.obstacles.forEach((cover, index) => {
      const visual = scenery.root.getObjectByName(`cover-${index}`);
      assert.equal(visual.position.x, cover.x); assert.equal(visual.position.z, cover.z);
      assert.equal(visual.userData.collisionRadius, cover.radius);
    });
    for (const person of map.infected) {
      const root = scenery.root.getObjectByName(`infected-${person.id}`);
      assert.equal(root.userData.atmosphericOnly, true);
      const original = root.children[0].quaternion.clone();
      scenery.update(0);
      assert.ok(original.angleTo(root.children[0].quaternion) < 1e-7, 'zero dt must freeze scenery');
      scenery.update(0.05);
      assert.equal(root.position.x, person.x); assert.equal(root.position.z, person.z);
    }
    scenery.setViewMode('first');
    assert.equal(scenery.root.getObjectByName('first-person-near-walls').visible, true);
    scenery.setViewMode('top2d');
    assert.equal(scenery.root.getObjectByName('first-person-near-walls').visible, false);
    const disposed = new Map();
    resources.forEach((resource) => resource.addEventListener('dispose', () => disposed.set(resource, (disposed.get(resource) || 0) + 1)));
    scenery.dispose(); scenery.dispose(); scenery.update(0.05);
    assert.equal(scenery.root.children.length, 0);
    assert.equal(disposed.size, resources.size);
    disposed.forEach((count) => assert.equal(count, 1));
    assert.deepEqual(map, snapshot, 'view must not modify campaign data');
  }
});

test('real modules preserve exports and WebGL failure has a precise code', () => {
  assert.equal(typeof createView, 'function');
  assert.equal(typeof animateHumanOutcome, 'function');
  assert.throws(() => createView({ getContext: () => null }), { code: 'WEBGL_UNAVAILABLE' });
});

test('main applies the saved mode before any rendered frame and waits for both confirmations', () => {
  const app = mainHarness({ stored: 'first' });
  assert.ok(app.calls.some(([name, id]) => name === 'setViewMode' && id === 'first'));
  app.frame();
  assert.equal(app.calls.find(([name]) => name === 'render')[1].campaign.stage, 'intro');
  app.elements['start-button'].emit('click');
  assert.equal(app.document.body.dataset.screen, 'view-picker');
  app.options[0].emit('click'); app.frame();
  assert.equal(app.saved.get('karakurt.viewMode'), 'top2d');
  assert.equal(app.document.body.dataset.screen, 'view-picker');
  app.elements['view-continue'].emit('click'); app.frame();
  assert.equal(app.document.body.dataset.screen, 'story');
  app.elements['campaign-continue'].emit('click'); app.frame();
  assert.equal(app.document.body.dataset.screen, 'presentation', 'the wake-up cutscene plays before the first fight');
  assert.equal(app.document.body.dataset.cutscene, 'wake-up');
  app.document.emit('keydown', { code: 'Enter', repeat: false }); app.frame();
  assert.equal(app.document.body.dataset.screen, 'playing');
  assert.equal(app.document.body.dataset.cutscene, undefined);
  const latest = app.calls.filter(([name]) => name === 'render').at(-1)[1];
  assert.equal(latest.campaign.stage, 'combat');
  assert.equal(latest.player.hp, 100);
  assert.ok(latest.enemies.length > 0);
});

test('keyboard selection survives reload; storage denial never blocks the story', () => {
  const app = mainHarness();
  app.elements['start-button'].emit('click');
  app.options[1].emit('keydown', { key: 'ArrowRight' });
  assert.equal(app.options[2].attrs['aria-pressed'], 'true');
  assert.equal(app.document.activeElement, app.options[2]);
  const reloaded = mainHarness({ stored: app.saved.get('karakurt.viewMode') });
  assert.equal(reloaded.document.body.dataset.viewMode, 'first');
  const denied = mainHarness({ storageFails: true });
  assert.equal(denied.document.body.dataset.viewMode, 'third');
  denied.elements['start-button'].emit('click');
  denied.options[0].emit('click');
  denied.elements['view-continue'].emit('click'); denied.frame();
  assert.equal(denied.document.body.dataset.screen, 'story');
  assert.equal(denied.errors.length, 0);
});

test('escaping a captured mouse pauses once without immediately resuming', () => {
  const app = mainHarness({ stored: 'first' });
  app.elements['start-button'].emit('click');
  app.elements['view-continue'].emit('click');
  app.elements['campaign-continue'].emit('click');
  assert.equal(app.document.body.dataset.screen, 'presentation');
  app.document.emit('keydown', { code: 'Space', repeat: false });
  assert.equal(app.document.body.dataset.screen, 'playing');
  app.elements['game-canvas'].emit('karakurt:pointer-unlocked');
  assert.equal(app.document.body.dataset.screen, 'paused');
  app.document.emit('keydown', { code: 'Escape', repeat: false });
  assert.equal(app.document.body.dataset.screen, 'paused', 'same Escape must not resume');
  app.elements['resume-button'].emit('click');
  assert.equal(app.document.body.dataset.screen, 'playing');
});

test('dawn epilogue has grass and architecture, derives its camera from held time and disposes', () => {
  const epilogue = createDawnEpilogue();
  const camera = new PerspectiveCamera(64, 1, 0.08, 220);
  assert.equal(epilogue.root.getObjectByName('courtyard-instanced-grass').count, 1800);
  assert.ok(epilogue.root.getObjectByName('batched-courtyard-fixtures'));
  epilogue.update(2, 6.8, camera);
  assert.ok(epilogue.root.getObjectByName('opening-exit-door').rotation.y < 0, 'door actually opens');
  const held = camera.position.clone();
  epilogue.update(2, 6.8, camera);
  assert.ok(camera.position.equals(held), 'held presentation time must freeze camera');
  epilogue.update(6.8, 6.8, camera);
  assert.ok(camera.position.z < 0, 'final camera leaves the doorway');
  assert.ok([camera.position.x, camera.position.y, camera.position.z].every(Number.isFinite));
  epilogue.dispose(); epilogue.dispose();
  assert.equal(epilogue.root.children.length, 0);
});

test('horror defeat is louder in the bounded audio graph and mute suppresses it', async () => {
  // Audio graph double checks gain routing, not subjective/device loudness.
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
  const peaks = [], masters = [];
  let started = 0;
  const param = () => ({ value: 0, cancelScheduledValues() {}, setValueAtTime() {},
    exponentialRampToValueAtTime() {}, linearRampToValueAtTime(value) { peaks.push(value); } });
  const node = () => ({ gain: param(), frequency: param(), Q: param(), pan: param(),
    connect() {}, disconnect() {}, start() { started += 1; }, stop() {} });
  class FakeAudioContext {
    constructor() { this.state = 'running'; this.currentTime = 1; this.sampleRate = 1000; this.destination = {}; }
    createGain() { const result = node(); masters.push(result); return result; }
    createDynamicsCompressor() { return { ...node(), threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() }; }
    createBuffer(channels, length) { return { getChannelData: () => new Float32Array(length) }; }
    createBufferSource() { return node(); }
    createOscillator() { return node(); }
    createBiquadFilter() { return node(); }
    createStereoPanner() { return node(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
  }
  let audio;
  try {
    Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: FakeAudioContext });
    audio = createAudio();
    await audio.unlock();
    audio.play([{ type: 'lose', x: 0, z: 0 }]);
    const normalPeak = Math.max(...peaks);
    peaks.length = 0;
    audio.setHorrorMode(true);
    audio.play([{ type: 'lose', x: 0, z: 0 }]);
    assert.ok(Math.max(...peaks) > normalPeak * 2, 'horror hit must stand out from ordinary defeat');
    assert.ok(masters[0].gain.value <= 0.32, 'master level is not bypassed');
    audio.setMuted(true);
    const before = started;
    audio.play([{ type: 'lose', x: 0, z: 0 }, { type: 'dread', x: 0, z: 0 }]);
    assert.equal(started, before, 'mute must suppress even the strongest effect');
  } finally {
    audio?.dispose();
    if (descriptor) Object.defineProperty(globalThis, 'AudioContext', descriptor);
    else delete globalThis.AudioContext;
  }
});

test('a JavaScript render error is not reported as missing WebGL', () => {
  const app = mainHarness({ renderFails: true });
  app.frame();
  assert.equal(app.elements['start-button'].disabled, true);
  assert.match(app.elements['error-message'].textContent, /внутренней ошибки/);
  assert.doesNotMatch(app.elements['error-message'].textContent, /не предоставил WebGL|ускорени/);
  assert.equal(app.errors.length, 1, 'original exception remains available in console');
});

test('cutscenes: data is consistent and every stage builds, poses all through its length and disposes', () => {
  assert.deepEqual(Object.keys(CUTSCENES).sort(), ['boss-intro', 'car-ride', 'clinic-ending', 'madness-drive', 'madness-home', 'madness-police', 'peace-dawn', 'stranger', 'wake-up']);
  for (const [id, scene] of Object.entries(CUTSCENES)) {
    assert.ok(scene.duration > 5, id);
    assert.equal(cutsceneDuration(id), scene.duration);
    let last = 0;
    for (const line of scene.subtitles) {
      if (line.if) continue;
      assert.ok(line.from >= last && line.to > line.from && line.to <= scene.duration, `${id}: subtitle timing`);
      assert.ok(line.text.length > 5);
      assert.equal(subtitleAt(id, (line.from + line.to) / 2), fillNames(line.text));
      last = line.to;
    }
    assert.equal(subtitleAt(id, scene.duration), '');
    const stage = createCutsceneStage(id);
    const camera = new PerspectiveCamera(58, 16 / 9, 0.08, 500);
    for (let t = 0; t <= scene.duration; t += 0.5) {
      stage.update(t, camera);
      assert.ok([camera.position.x, camera.position.y, camera.position.z].every(Number.isFinite), `${id}@${t}: camera`);
    }
    // Held time freezes the pose: a paused cutscene shows the same frame.
    stage.update(5, camera); const held = camera.position.clone(); stage.update(5, camera);
    assert.ok(camera.position.equals(held), `${id}: deterministic from held time`);
    stage.dispose();
    assert.equal(stage.root.children.length, 0);
  }
  assert.throws(() => createCutsceneStage('missing'), RangeError);
});

test('car ride: the survivors end seated in the car, which stops in front of the hospital', () => {
  const stage = createCutsceneStage('car-ride');
  const camera = new PerspectiveCamera(58, 16 / 9, 0.08, 500);
  const car = () => stage.root.getObjectByName('car');
  stage.update(0, camera);
  assert.ok(Math.abs(car().position.z) < 1e-6, 'parked at the start');
  stage.update(24.8, camera);
  assert.ok(car().position.z < -132 && car().position.z > -144, `car stopped by the hospital entrance, z=${car().position.z}`);
  stage.update(30.9, camera); const stopped = car().position.z; stage.update(31, camera);
  assert.ok(Math.abs(car().position.z - stopped) < 1e-6, 'does not roll on after stopping');
  stage.dispose();
});

test('killing infected makes the hero react aloud: first a shock, then doubt about his sanity', () => {
  const kills = [];
  const app = mainHarness({ stored: 'third', step: (state, input, dt) => { const next = kills.splice(0); return next; } });
  app.elements['start-button'].emit('click');
  app.elements['view-continue'].emit('click');
  app.elements['campaign-continue'].emit('click');
  app.document.emit('keydown', { code: 'Enter', repeat: false });
  assert.equal(app.document.body.dataset.screen, 'playing');
  kills.push({ type: 'infected-kill', id: 'a', x: 0, z: 0, count: 1 });
  app.frame();
  assert.equal(app.elements.bark.textContent, 'Что я сделал? Нет, нет, нет… Я убил его.');
  assert.equal(app.elements.bark.classList.contains('is-hidden'), false);
  kills.push({ type: 'infected-kill', id: 'b', x: 0, z: 0, count: 2 });
  app.frame();
  assert.equal(app.elements.bark.textContent, 'Зачем я ещё раз убил? Я с ума схожу?');
});

test('cutscene collisions: the cars never meet other cars and nobody walks through the police desk', () => {
  const camera = new PerspectiveCamera(58, 16 / 9, 0.08, 500);
  for (const id of ['car-ride', 'madness-drive']) {
    const stage = createCutsceneStage(id);
    for (let t = 0; t <= CUTSCENES[id].duration; t += 0.5) {
      stage.update(t, camera);
      stage.root.updateMatrixWorld(true);
      const car = stage.root.getObjectByName('car');
      const mine = new Box3().setFromObject(car).expandByScalar(-0.1);
      stage.root.traverse((node) => {
        if (node.name !== 'wreck') return;
        const other = new Box3().setFromObject(node);
        const overlapX = mine.min.x < other.max.x && mine.max.x > other.min.x, overlapZ = mine.min.z < other.max.z && mine.max.z > other.min.z;
        assert.ok(!(overlapX && overlapZ), `${id}@${t}: the moving car overlaps a parked one`);
      });
    }
    stage.dispose();
  }
  const stage = createCutsceneStage('madness-police');
  for (let t = 0; t <= CUTSCENES['madness-police'].duration; t += 0.25) {
    stage.update(t, camera);
    stage.root.updateMatrixWorld(true);
    stage.root.traverse((node) => {
      if (node.name !== 'human-survivor') return;
      const x = node.position.x, z = node.position.z;
      const insideDesk = Math.abs(x) < 1.7 && z > -2.15 && z < -0.65;
      assert.ok(!insideDesk, `police@${t}: a person stands inside the desk at ${x.toFixed(2)}, ${z.toFixed(2)}`);
    });
  }
  stage.dispose();
});

test('story: every infected bystander has a name, and the names fill the subtitles', () => {
  const ids = CAMPAIGN.flatMap((map) => map.infected.map((person) => person.id));
  assert.equal(ids.length, 10);
  assert.deepEqual([...ids].sort(), Object.keys(story.PEOPLE).sort(), 'every infected id has a person and vice versa');
  const names = ids.map((id) => story.personInfo(id).name);
  assert.equal(new Set(names).size, names.length, 'names are unique');
  assert.equal(fillNames('«{n0}» и {n1}. {list}', ['Игорь', 'Лена']), '«Игорь» и Лена. Игорь, Лена');
  assert.equal(fillNames('{n1}', ['Игорь']), 'Игорь', 'a missing second name falls back to the first');
  assert.match(fillNames('{list}'), /помню/, 'without names the subtitle still reads');
  assert.equal(story.sanityLoss(0), 0);
  assert.equal(story.sanityLoss(99), 1);
  assert.ok(story.cureParagraphs(2)[0].includes('обратима'));
  assert.ok(story.peacefulEnding(0).title !== story.peacefulEnding(3).title);
});

test('police ending: three answers, three different scenes, nobody walks through the desk in any of them', () => {
  const camera = new PerspectiveCamera(58, 16 / 9, 0.08, 500);
  assert.equal(cutsceneChoiceAt('madness-police'), 33.4);
  assert.equal(cutsceneChoiceAt('wake-up'), null);
  const durations = {};
  for (const branch of ['gun', 'help', 'leave']) {
    const options = { kills: 3, names: ['Игорь', 'Лена', 'Артём'], branch };
    durations[branch] = cutsceneDuration('madness-police', options);
    assert.ok(durations[branch] > 40);
    assert.match(subtitleAt('madness-police', 36.5, options), /\S/, `${branch}: a line is spoken right after the choice`);
    const stage = createCutsceneStage('madness-police', options);
    for (let t = 0; t <= durations[branch]; t += 0.25) {
      stage.update(t, camera);
      stage.root.updateMatrixWorld(true);
      assert.ok([camera.position.x, camera.position.y, camera.position.z].every(Number.isFinite), `${branch}@${t}: camera`);
      stage.root.traverse((node) => {
        if (node.name !== 'human-survivor' || !node.visible) return;
        const insideDesk = Math.abs(node.position.x) < 1.7 && node.position.z > -2.15 && node.position.z < -0.65;
        assert.ok(!insideDesk, `${branch}@${t}: a person stands inside the desk`);
      });
    }
    stage.dispose();
  }
  assert.ok(new Set(Object.values(durations)).size === 3, 'each branch has its own length');
  assert.deepEqual(cutsceneCues('madness-police', { branch: 'gun' }).map((cue) => cue.type), ['shot']);
  assert.deepEqual(cutsceneCues('madness-police', { branch: 'help' }), [], 'the helping ending has no shot');
  assert.match(subtitleAt('madness-police', 44, { branch: 'help', names: ['Игорь', 'Лена'] }), /Игорь, Лена/);
});

test('police choice: skipping jumps to the question, the answer sets the ending and its length', () => {
  const app = mainHarness({ stored: 'third', search: '?madness=2' });
  app.frame(); app.frame();
  const lastPresentation = () => [...app.calls].reverse().find(([name]) => name === 'setPresentation')?.[1];
  assert.equal(lastPresentation().id, 'madness-drive');
  const skip = () => app.document.emit('keydown', { code: 'Enter', repeat: false });
  skip(); app.frame();
  assert.equal(lastPresentation().id, 'madness-home');
  skip(); app.frame();
  const choiceBox = app.elements['cutscene-choice'];
  assert.equal(choiceBox.children.length, 2, 'the home scene asks: police or Nina');
  choiceBox.children.find((button) => button.dataset.choice === 'police').emit('click'); app.frame();
  skip(); app.frame();
  assert.equal(lastPresentation().id, 'madness-police');
  const choice = app.elements['cutscene-choice'];
  assert.equal(choice.classList.contains('is-hidden'), true, 'no choice at the start of the scene');
  skip(); app.frame();
  assert.equal(choice.classList.contains('is-hidden'), false, 'skipping stops at the question');
  assert.equal(choice.children.length, 3);
  assert.ok(Math.abs(lastPresentation().time - 33.4) < 1e-6);
  skip(); app.frame();
  assert.equal(lastPresentation().id, 'madness-police', 'Enter cannot dismiss the question');
  choice.children.find((button) => button.dataset.choice === 'help').emit('click');
  app.frame();
  const picked = lastPresentation();
  assert.equal(picked.options.branch, 'help');
  assert.equal(picked.duration, 58);
  assert.equal(choice.classList.contains('is-hidden'), true);
  skip(); app.frame();
  assert.equal(app.elements['result-title'].textContent, 'Рассвет.');
  assert.match(app.elements['result-eyebrow'].textContent, /ПОМОЩЬ/);
});

test('new endings: calling Nina and the peaceful epilogue both build, play through and end on their own cards', () => {
  const camera = new PerspectiveCamera(58, 16 / 9, 0.08, 500);
  for (const [id, branch] of [['madness-home', 'call'], ['peace-dawn', 'mercy'], ['peace-dawn', 'alone']]) {
    const options = { kills: 2, names: ['Игорь', 'Лена', 'Артём'], branch };
    const duration = cutsceneDuration(id, options);
    assert.ok(duration > 30, id + ':' + branch);
    const stage = createCutsceneStage(id, options);
    for (let t = 0; t <= duration; t += 0.5) {
      stage.update(t, camera);
      assert.ok([camera.position.x, camera.position.y, camera.position.z].every(Number.isFinite), id + ':' + branch + '@' + t);
    }
    assert.ok([2, 3, 4, 5, 6].some((back) => subtitleAt(id, duration - back, options)), id + ":" + branch + " ends on a line");
    stage.dispose();
  }
  assert.ok(story.POLICE_ENDINGS.call.title && story.POLICE_ENDINGS.call.text.length > 40);
  const app = mainHarness({ stored: 'third', search: '?madness=2' });
  app.frame(); app.frame();
  const lastPresentation = () => [...app.calls].reverse().find(([name]) => name === 'setPresentation')?.[1];
  const skip = () => app.document.emit('keydown', { code: 'Enter', repeat: false });
  skip(); app.frame(); skip(); app.frame();
  app.elements['cutscene-choice'].children.find((button) => button.dataset.choice === 'call').emit('click'); app.frame();
  assert.equal(lastPresentation().duration, 66);
  skip(); app.frame();
  assert.equal(app.elements['result-title'].textContent, 'Двое в тишине.', 'calling Nina skips the police station');
});

test('the stranger: his story plays, and his lines change with what happened to his wife', () => {
  const dead = { names: ['Лена Ветрова'], branch: 'gun', flags: { wifeDead: true } };
  assert.match(subtitleAt('madness-drive', 70, dead), /убил Лену/);
  assert.match(subtitleAt('madness-drive', 70, { names: ['Игорь'], flags: {} }), /убил нас обоих/);
  assert.match(subtitleAt('peace-dawn', 38, { branch: 'mercy', names: ['Лена'], flags: { wifeSpared: true } }), /Лена среди них/);
  assert.match(subtitleAt('peace-dawn', 38, { branch: 'mercy', names: ['Лена'], flags: {} }), /Ночь закончилась/);
  const app = mainHarness({ stored: 'third' });
  app.elements['stranger-button'].emit('click');
  const shown = [...app.calls].reverse().find(([name]) => name === 'setPresentation')?.[1];
  assert.equal(shown?.id, 'stranger');
});

test('the stranger walks past the abandoned cars, never through them', () => {
  const camera = new PerspectiveCamera(58, 16 / 9, 0.08, 500);
  const stage = createCutsceneStage('stranger');
  for (let t = 0; t <= CUTSCENES.stranger.duration; t += 0.25) {
    stage.update(t, camera);
    stage.root.updateMatrixWorld(true);
    const wrecks = [], people = [];
    stage.root.traverse((node) => { if (node.name === 'wreck') wrecks.push(node); if (node.name === 'human-survivor') people.push(node); });
    for (const person of people) for (const wreck of wrecks) {
      const a = new Box3().setFromObject(wreck), x = person.position.x, z = person.position.z;
      assert.ok(!(x > a.min.x - 0.35 && x < a.max.x + 0.35 && z > a.min.z - 0.35 && z < a.max.z + 0.35), `stranger@${t}: walks through a car at ${x.toFixed(1)}, ${z.toFixed(1)}`);
    }
  }
  stage.dispose();
});

test('one person killed: the madness scenes speak in the singular, several: in the plural', () => {
  const one = { names: ['Игорь Савельев'], branch: 'gun', flags: { one: true } }, many = { names: ['Игорь', 'Лена'], branch: 'gun', flags: { one: false } };
  assert.match(subtitleAt('madness-drive', 40, one), /человека.*Он не двигался/);
  assert.match(subtitleAt('madness-drive', 40, many), /в людей.*Они не двигались/);
  assert.match(subtitleAt('madness-drive', 20.5, one), /Опять он/);
  assert.match(subtitleAt('madness-police', 5, one), /Я убил человека/);
  assert.match(subtitleAt('madness-police', 5, many), /Я убил людей/);
  assert.match(subtitleAt('madness-police', 44, { branch: 'help', names: ['Игорь'], flags: { one: true } }), /назову его/);
});
