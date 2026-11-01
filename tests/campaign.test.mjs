import test from 'node:test';
import assert from 'node:assert/strict';
import { CAMPAIGN } from '../src/campaignData.js';
import {
  createGame, stepGame, createCampaignGame, stepCampaign, advanceCampaign, nearestInfected, calmNearbyInfected,
} from '../src/simulation.js';

const DT = 0.05;
const EPSILON = 1e-8;
const PLAYER_RADIUS = 0.45;
const ENEMY_RADII = { normal: 0.55, runner: 0.45, tank: 0.8, boss: 1.1 };
const IDLE = Object.freeze({ moveX: 0, moveZ: 0, aimX: 0, aimZ: 5, shoot: false, dodge: false });
const ACTIVE = Object.freeze({ moveX: 1, moveZ: -1, aimX: 8, aimZ: -8, shoot: true, dodge: true });

// Like stepGame, stepCampaign mutates the supplied state and returns events, not a new state.
function tick(state, input = IDLE, dt = DT) {
  const events = stepCampaign(state, input, dt);
  assert.ok(Array.isArray(events), 'stepCampaign must return an event array');
  return events;
}

function assertCampaign(state, mapIndex, stage) {
  assert.ok(state.campaign, 'campaign metadata is required');
  assert.ok(Number.isInteger(state.campaign.mapIndex));
  assert.equal(state.campaign.mapIndex, mapIndex, 'a map was skipped or repeated');
  assert.equal(state.campaign.mapId, CAMPAIGN[mapIndex].id, 'mapId must match mapIndex');
  assert.equal(state.campaign.stage, stage);
}

function assertPosition(map, entity, radius = 0) {
  assert.ok(Number.isFinite(entity.x) && Number.isFinite(entity.z), 'finite world coordinates required');
  assert.ok(Math.abs(entity.x) + radius <= map.arena.halfWidth + EPSILON, 'entity crosses an X wall');
  assert.ok(Math.abs(entity.z) + radius <= map.arena.halfDepth + EPSILON, 'entity crosses a Z wall');
}

function assertCombatSpawns(state, map) {
  const entities = [[state.player, PLAYER_RADIUS], ...state.enemies.map(enemy => {
    assert.equal(enemy.type, 'kara', 'infected people must not become combat targets');
    assert.ok(!map.infected.some(person => person.id === enemy.id), 'infected became an enemy');
    assert.ok(Object.hasOwn(ENEMY_RADII, enemy.variant), 'unknown enemy radius');
    return [enemy, ENEMY_RADII[enemy.variant]];
  })];
  for (const [entity, radius] of entities) {
    assertPosition(map, entity, radius);
    for (const obstacle of map.obstacles) {
      assert.ok(Math.hypot(entity.x - obstacle.x, entity.z - obstacle.z) + EPSILON
        >= radius + obstacle.radius, 'combat entity spawned inside an obstacle');
    }
  }
}

// Clear enemies only. The implementation must advance every wave and finish the map itself;
// assigning wave/mapIndex/stage here would mask skipped maps or premature campaign completion.
function finishMap(state, mapIndex) {
  const map = CAMPAIGN[mapIndex];
  const seenWaves = [];
  assertCampaign(state, mapIndex, 'combat');
  assert.equal(state.wave, 1, 'each map starts with its first wave');
  for (let wave = 1; wave <= map.waves; wave += 1) {
    assertCampaign(state, mapIndex, 'combat');
    assert.equal(state.status, 'playing', 'campaign ended before the final story confirmation');
    assert.equal(state.wave, wave, 'a wave was skipped');
    assert.ok(state.enemies.length > 0, `map ${mapIndex}, wave ${wave} has no combat targets`);
    assert.equal(state.enemies.some(enemy => enemy.variant === 'boss'), map.boss && wave === map.waves,
      'boss must follow the map definition and appear only in its final wave');
    assertCombatSpawns(state, map);
    seenWaves.push(wave);
    state.enemies.length = 0;
    state.projectiles.length = 0;
    for (let frame = 0; frame < 100; frame += 1) {
      tick(state);
      assert.equal(state.campaign.mapIndex, mapIndex, 'stepCampaign must not switch maps automatically');
      assert.equal(state.campaign.mapId, map.id);
      assert.equal(state.status, 'playing', 'a cleared map is not yet the campaign victory');
      if (state.campaign.stage !== 'combat' || state.wave !== wave) break;
    }
    if (wave < map.waves) {
      assertCampaign(state, mapIndex, 'combat');
      assert.equal(state.wave, wave + 1, 'next wave did not start within five seconds');
    } else {
      assertCampaign(state, mapIndex, 'outro');
      assert.equal(state.wave, wave);
      assert.equal(state.enemies.length, 0);
    }
  }
  return seenWaves;
}

function assertStoryFrozen(original) {
  const state = structuredClone(original);
  state.player.hp = 40;
  state.player.fireCooldown = 0.12;
  state.player.dodgeCooldown = 0.4;
  state.player.invulnerable = 0.1;
  state.enemies = [{
    id: 900001, type: 'kara', variant: 'normal', x: state.player.x, z: state.player.z,
    yaw: 0, hp: 1000, maxHp: 1000,
  }];
  state.projectiles = [{ id: 900002, x: state.player.x, z: state.player.z, dx: 1, dz: 0, life: 1 }];
  // Check both residual combat entities and an empty arena whose wave countdown is about to expire.
  for (const empty of [false, true]) {
    if (empty) { state.enemies = []; state.projectiles = []; }
    state.nextWaveIn = 0.01;
    const snapshot = structuredClone(state);
    for (let frame = 0; frame < 70; frame += 1) {
      assert.deepStrictEqual(tick(state, ACTIVE), [], 'story cards must not emit combat events');
      assert.deepStrictEqual(state, snapshot, `${state.campaign.stage} allows combat or time to advance`);
    }
  }
}

test('CAMPAIGN defines exactly three complete, distinct maps with valid world-space data', () => {
  assert.ok(Array.isArray(CAMPAIGN));
  assert.equal(CAMPAIGN.length, 3, 'missing map: the campaign requires three maps');
  assert.deepStrictEqual(CAMPAIGN.map(map => map.waves), [2, 2, 3]);
  assert.deepStrictEqual(CAMPAIGN.map(map => map.boss), [false, false, true]);
  assert.equal(new Set(CAMPAIGN.map(map => map.id)).size, 3, 'map ids must be unique');
  assert.equal(new Set(CAMPAIGN.map(map => map.title)).size, 3, 'map titles must be distinct');
  for (const map of CAMPAIGN) {
    for (const field of ['id', 'title']) {
      assert.equal(typeof map[field], 'string');
      assert.ok(map[field].trim().length > 0, `empty ${field}`);
    }
    for (const [field, min, max] of [['intro', 2, 3], ['outro', 1, 2]]) {
      assert.ok(Array.isArray(map[field]), `${field} must be paragraphs`);
      assert.ok(map[field].length >= min && map[field].length <= max);
      for (const paragraph of map[field]) {
        assert.equal(typeof paragraph, 'string');
        assert.ok(paragraph.trim().length > 0);
        assert.match(paragraph, /[А-Яа-яЁё]/u, 'story must contain Russian text');
      }
    }
    for (const axis of ['halfWidth', 'halfDepth']) {
      assert.ok(Number.isFinite(map.arena?.[axis]) && map.arena[axis] > PLAYER_RADIUS);
    }
    assert.ok(Number.isInteger(map.waves) && map.waves > 0);
    assert.equal(typeof map.boss, 'boolean');
    for (const field of ['obstacles', 'props', 'infected']) assert.ok(Array.isArray(map[field]), field);
    assert.ok(map.props.length > 0, 'each location needs scenery');
    assert.ok(map.infected.length > 0, 'each location needs atmospheric infected people');
    for (const obstacle of map.obstacles) {
      assert.ok(Number.isFinite(obstacle.radius) && obstacle.radius > 0);
      assertPosition(map, obstacle, obstacle.radius);
      assert.ok(Math.abs(obstacle.x) + obstacle.radius < map.arena.halfWidth, 'obstacle needs a wall margin');
      assert.ok(Math.abs(obstacle.z) + obstacle.radius < map.arena.halfDepth, 'obstacle needs a wall margin');
      assert.ok(Math.hypot(obstacle.x, obstacle.z) > obstacle.radius + PLAYER_RADIUS,
        'the player spawn at the center must be free');
    }
    for (const entity of [...map.props, ...map.infected]) {
      assertPosition(map, entity);
      assert.ok(Math.abs(entity.x) < map.arena.halfWidth && Math.abs(entity.z) < map.arena.halfDepth,
        'decorations need a wall margin');
      assert.ok(Number.isFinite(entity.rotation), 'rotation must be a finite radian value');
      assert.ok(Math.hypot(entity.x, entity.z) > PLAYER_RADIUS, 'decorations obstruct the spawn center');
    }
    for (const prop of map.props) assert.ok(['crate', 'bed', 'lamp'].includes(prop.kind));
    for (const person of map.infected) {
      assert.equal(typeof person.id, 'string');
      assert.ok(person.id.trim().length > 0);
    }
    assert.equal(new Set(map.infected.map(person => person.id)).size, map.infected.length);
    for (const color of ['floor', 'wall', 'fog']) {
      assert.ok(Number.isInteger(map.palette?.[color]) && map.palette[color] >= 0
        && map.palette[color] <= 0xffffff, `${color} must be an integer RGB color`);
    }
  }
});

test('campaign exports are separate from the legacy API and start at the first intro', () => {
  for (const fn of [createGame, stepGame, createCampaignGame, stepCampaign, advanceCampaign]) {
    assert.equal(typeof fn, 'function');
  }
  const state = createCampaignGame({ seed: 42 });
  assertCampaign(state, 0, 'intro');
  assert.equal(state.status, 'playing');
  assert.equal(state.score, 0);
  assert.equal(state.player.hp, state.player.maxHp);
  assert.ok(state.player.maxHp > 0);
  assert.doesNotThrow(() => JSON.stringify(state));
  assert.equal(state.enemies.length, 0, 'the intro must not start combat targets');
  assert.equal(state.projectiles.length, 0);
  assertCampaign(createCampaignGame(), 0, 'intro');
  assert.deepStrictEqual(createCampaignGame(), createCampaignGame({ seed: 1 }));
});

test('campaign combat mutates state, returns events and keeps the existing world-point input format', () => {
  const state = createCampaignGame({ seed: 10 });
  advanceCampaign(state);
  assertCampaign(state, 0, 'combat');
  state.enemies = [];
  state.nextWaveIn = 100;
  const startX = state.player.x;
  const startTime = state.time;
  const input = Object.freeze({ ...IDLE, moveX: 1, aimX: startX + 4, aimZ: state.player.z + 3, shoot: true });
  const inputBefore = { ...input };
  const events = tick(state, input);
  assert.notStrictEqual(events, state);
  assert.ok(state.time > startTime && state.player.x > startX, 'state must change in place');
  assert.ok(events.some(event => event.type === 'shot'));
  const expectedYaw = Math.atan2(input.aimX - state.player.x, input.aimZ - state.player.z);
  assert.ok(Math.abs(state.player.yaw - expectedYaw) < EPSILON, 'aimX/aimZ are a target point, not a vector');
  assert.deepStrictEqual(input, inputBefore, 'simulation must not consume or mutate input');
  assert.ok(tick(state, Object.freeze({ ...IDLE, moveX: 1, dodge: true }))
    .some(event => event.type === 'dodge'));
});

test('every map requires intro -> combat -> outro confirmation, with victory only after the last outro', () => {
  const state = createCampaignGame({ seed: 42 });
  const visited = [];
  for (let mapIndex = 0; mapIndex < CAMPAIGN.length; mapIndex += 1) {
    assertCampaign(state, mapIndex, 'intro');
    assert.equal(state.status, 'playing');
    visited.push(state.campaign.mapId);
    assertStoryFrozen(state);
    advanceCampaign(state);
    assertCampaign(state, mapIndex, 'combat');
    const inCombat = structuredClone(state);
    advanceCampaign(state);
    assert.deepStrictEqual(state, inCombat, 'advanceCampaign must not skip combat');
    assert.deepStrictEqual(finishMap(state, mapIndex),
      Array.from({ length: CAMPAIGN[mapIndex].waves }, (_, index) => index + 1));
    assertStoryFrozen(state);
    const waiting = structuredClone(state);
    for (let frame = 0; frame < 100; frame += 1) assert.deepStrictEqual(tick(state, ACTIVE), []);
    assert.deepStrictEqual(state, waiting, 'outro needs explicit confirmation, not a timed transition');
    advanceCampaign(state);
    if (mapIndex < CAMPAIGN.length - 1) {
      assertCampaign(state, mapIndex + 1, 'intro');
      assert.equal(state.status, 'playing', 'an intermediate map must not end the campaign');
      assert.equal(state.enemies.length, 0, 'the next intro must not start combat');
    } else {
      assertCampaign(state, mapIndex, 'complete');
      assert.equal(state.status, 'won');
    }
  }
  assert.deepStrictEqual(visited, CAMPAIGN.map(map => map.id), 'every declared map must be visited in order');
  assert.equal(visited.length, 3);
  assertStoryFrozen(state);
  const complete = structuredClone(state);
  advanceCampaign(state);
  assert.deepStrictEqual(state, complete, 'completed campaign must not loop or create another map');
  for (let frame = 0; frame < 70; frame += 1) assert.deepStrictEqual(tick(state, ACTIVE), []);
  assert.deepStrictEqual(state, complete);
});

test('earned score survives every map transition while health, projectiles and combat timers reset', () => {
  const state = createCampaignGame({ seed: 73 });
  advanceCampaign(state);
  // A real one-shot kill establishes earned points without relying on enemy counts or point values.
  // Keep the generated first wave for the subsequent full-map progression check.
  const firstWave = structuredClone(state.enemies);
  state.enemies = [{
    id: 900101, type: 'kara', variant: 'normal', x: state.player.x, z: state.player.z,
    yaw: 0, hp: 25, maxHp: 25,
  }];
  const earned = tick(state, { ...IDLE, shoot: true });
  assert.equal(state.enemies.length, 0, 'the overlapping shot must kill the target before contact');
  assert.ok(earned.some(event => event.type === 'kill'));
  assert.ok(state.score > 0);
  const score = state.score;
  state.enemies = firstWave;
  state.nextWaveIn = 0;
  for (let mapIndex = 0; mapIndex < CAMPAIGN.length; mapIndex += 1) {
    if (mapIndex > 0) advanceCampaign(state);
    finishMap(state, mapIndex);
    assert.equal(state.score, score);
    state.player.hp = Math.min(17, state.player.maxHp - 1);
    state.player.fireCooldown = 0.15;
    state.player.dodgeCooldown = 1.4;
    state.player.invulnerable = 0.6;
    state.projectiles = [{ id: 900103, x: state.player.x, z: state.player.z, dx: 1, dz: 0, life: 1 }];
    advanceCampaign(state);
    assert.equal(state.score, score, 'earned score must not reset or inflate on transition');
    if (mapIndex < CAMPAIGN.length - 1) {
      assertCampaign(state, mapIndex + 1, 'intro');
      assert.equal(state.player.hp, state.player.maxHp, 'the next map restores health');
      assert.equal(state.player.fireCooldown, 0);
      assert.equal(state.player.dodgeCooldown, 0);
      assert.equal(state.player.invulnerable, 0);
      assert.equal(state.nextWaveIn, 0);
      assert.equal(state.enemies.length, 0);
      assert.equal(state.projectiles.length, 0, 'shots from the previous map must be removed');
      assertCombatSpawns(state, CAMPAIGN[mapIndex + 1]);
    } else assertCampaign(state, mapIndex, 'complete');
  }
});

test('lethal campaign contact keeps the existing lost terminal state, without advancing the story', () => {
  const state = createCampaignGame({ seed: 11 });
  advanceCampaign(state);
  state.player.hp = 1;
  state.player.invulnerable = 0;
  state.enemies = [{
    id: 900201, type: 'kara', variant: 'normal', x: state.player.x, z: state.player.z,
    yaw: 0, hp: 10000, maxHp: 10000,
  }];
  const events = tick(state);
  assert.equal(state.status, 'lost');
  assert.equal(state.player.hp, 0);
  assert.ok(events.some(event => event.type === 'lose'));
  assertCampaign(state, 0, 'combat');
  const lost = structuredClone(state);
  advanceCampaign(state);
  for (let frame = 0; frame < 70; frame += 1) assert.deepStrictEqual(tick(state, ACTIVE), []);
  assert.deepStrictEqual(state, lost, 'presentation must not resume the terminal simulation');
  const restarted = createCampaignGame({ seed: 11 });
  assertCampaign(restarted, 0, 'intro');
  assert.equal(restarted.score, 0);
  assert.equal(restarted.player.hp, restarted.player.maxHp);
  assert.equal(restarted.projectiles.length, 0);
});

test('campaign seed and existing input stay deterministic after serializable state cloning', () => {
  const a = createCampaignGame({ seed: 123456 });
  const b = JSON.parse(JSON.stringify(a));
  const commands = [IDLE, { ...IDLE, moveX: 1, aimX: 7, aimZ: 2, shoot: true },
    { ...IDLE, moveZ: -1, aimX: -5, aimZ: 3, dodge: true }];
  advanceCampaign(a);
  advanceCampaign(b);
  assert.deepStrictEqual(a, b);
  for (let frame = 0; frame < 30; frame += 1) {
    const input = commands[frame % commands.length];
    assert.deepStrictEqual(tick(a, input, 0.016), tick(b, input, 0.016));
    assert.deepStrictEqual(a, b);
  }
  for (let mapIndex = 0; mapIndex < CAMPAIGN.length; mapIndex += 1) {
    finishMap(a, mapIndex);
    finishMap(b, mapIndex);
    assert.deepStrictEqual(a, b);
    advanceCampaign(a);
    advanceCampaign(b);
    assert.deepStrictEqual(a, b);
    if (mapIndex < CAMPAIGN.length - 1) { advanceCampaign(a); advanceCampaign(b); }
  }
});

test('ordinary createGame/stepGame still run three waves and terminate without campaign metadata', () => {
  const state = createGame(42);
  assert.equal(Object.hasOwn(state, 'campaign'), false, 'campaign must be opt-in');
  assert.equal(state.status, 'playing');
  const events = stepGame(state, { ...IDLE, moveX: 1, shoot: true, dodge: true }, DT);
  assert.ok(Array.isArray(events));
  assert.ok(events.some(event => event.type === 'shot'));
  assert.ok(events.some(event => event.type === 'dodge'));
  assert.ok(state.time > 0 && state.player.x > 0);
  state.projectiles = [];
  const allEvents = [];
  for (let wave = 1; wave <= 3; wave += 1) {
    assert.equal(state.wave, wave);
    assert.ok(state.enemies.length > 0);
    assert.equal(state.enemies.some(enemy => enemy.variant === 'boss'), wave === 3);
    state.enemies = [];
    for (let frame = 0; frame < 100; frame += 1) {
      allEvents.push(...stepGame(state, IDLE, DT));
      if (state.wave !== wave || state.status !== 'playing') break;
    }
    assert.equal(state.status, wave === 3 ? 'won' : 'playing');
    assert.equal(Object.hasOwn(state, 'campaign'), false);
  }
  assert.ok(allEvents.some(event => event.type === 'win'));
  const won = structuredClone(state);
  assert.deepStrictEqual(stepGame(state, ACTIVE, 10), []);
  assert.deepStrictEqual(state, won);
  const lost = createGame(1);
  lost.player.hp = 1;
  lost.enemies = [{ id: 900301, type: 'kara', variant: 'normal', x: 0, z: 0, yaw: 0, hp: 1000, maxHp: 1000 }];
  assert.ok(stepGame(lost, IDLE, DT).some(event => event.type === 'lose'));
  assert.equal(lost.status, 'lost');
});

test('infected bystanders can be shot: two hits kill, kills are remembered, the dead stop blocking', () => {
  const state = createCampaignGame({ seed: 1 });
  advanceCampaign(state);
  state.enemies.length = 0; state.nextWaveIn = 99;
  const person = CAMPAIGN[0].infected[0];
  const events = [];
  const fire = (frames) => {
    for (let i = 0; i < frames; i += 1) {
      state.player.x = person.x + 4; state.player.z = person.z;
      events.push(...stepCampaign(state, { aimX: person.x, aimZ: person.z, shoot: true, moveX: 0, moveZ: 0 }, 0.033));
    }
  };
  fire(8);
  assert.equal(state.infectedKills, 0, 'one hit does not kill');
  assert.ok(state.infectedHp[person.id] > 0);
  fire(40);
  assert.equal(state.infectedKills, 1);
  assert.deepEqual(state.infectedDead, [person.id]);
  const kills = events.filter((event) => event.type === 'infected-kill');
  assert.equal(kills.length, 1);
  assert.equal(kills[0].id, person.id); assert.equal(kills[0].count, 1);
  // The dead person no longer blocks movement and cannot be killed twice.
  state.player.x = person.x + 0.5; state.player.z = person.z;
  stepCampaign(state, { moveX: -1, moveZ: 0, aimX: 0, aimZ: 0 }, 0.05);
  assert.ok(state.player.x < person.x + 0.5, 'walks through where the body is');
  fire(30);
  assert.equal(state.infectedKills, 1);
});

test('infected bystanders can be calmed instead: only when close, shots then pass them by, and it is remembered', () => {
  const state = createCampaignGame({ seed: 1 });
  advanceCampaign(state);
  state.enemies.length = 0; state.nextWaveIn = 99;
  const map = CAMPAIGN[0], person = map.infected[0];
  state.player.x = person.x + 6; state.player.z = person.z;
  assert.equal(calmNearbyInfected(state, map), null, 'too far to calm');
  assert.equal(nearestInfected(state, map, 3), null);
  state.player.x = person.x + 1.5;
  assert.equal(nearestInfected(state, map, 3).id, person.id);
  const event = calmNearbyInfected(state, map);
  assert.equal(event.type, 'infected-calm'); assert.equal(event.id, person.id); assert.equal(event.count, 1);
  assert.deepEqual(state.infectedSpared, [person.id]);
  assert.equal(calmNearbyInfected(state, map), null, 'a calmed person is not calmed twice');
  state.player.x = person.x + 4; state.player.z = person.z;
  for (let i = 0; i < 40; i += 1) stepCampaign(state, { aimX: person.x, aimZ: person.z, shoot: true, moveX: 0, moveZ: 0 }, 0.033);
  assert.equal(state.infectedKills, 0, 'shots pass a calmed person');
  assert.deepEqual(state.infectedDead, []);
});

test('stray bullets never kill bystanders: a spider on the line of fire takes the shot', () => {
  const state = createCampaignGame({ seed: 1 });
  advanceCampaign(state);
  const person = CAMPAIGN[0].infected[0];
  state.nextWaveIn = 99;
  state.enemies = [{ id: 900401, type: 'kara', variant: 'tank', x: person.x - 5, z: person.z, yaw: 0, hp: 9999, maxHp: 9999 }];
  for (let i = 0; i < 60; i += 1) {
    state.player.x = person.x + 4; state.player.z = person.z;
    stepCampaign(state, { aimX: person.x - 5, aimZ: person.z, shoot: true, moveX: 0, moveZ: 0 }, 0.033);
  }
  assert.equal(state.infectedKills, 0);
});
