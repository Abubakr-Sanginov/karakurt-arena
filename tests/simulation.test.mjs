import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, stepGame } from '../src/simulation.js';

const IDLE = Object.freeze({ moveX: 0, moveZ: 0, aimX: 0, aimZ: 5, shoot: false, dodge: false });
const tick = (state, input = IDLE, dt = 0.05) => stepGame(state, input, dt);
const close = (actual, expected, tolerance = 1e-8) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≠ ${expected}`);

function isolated(seed = 1) {
  const state = createGame(seed);
  state.enemies = [];
  state.projectiles = [];
  state.nextWaveIn = 100;
  return state;
}

function enemyAt(state, x, z, hp = 25) {
  return { id: 9001, type: 'kara', variant: 'normal', x, z, yaw: 0, hp, maxHp: hp };
}

function assertFinitePositions(state, events) {
  for (const entity of [state.player, ...state.enemies, ...state.projectiles, ...events]) {
    assert.ok(Number.isFinite(entity.x) && Number.isFinite(entity.z), 'coordinates must stay finite');
  }
  for (const projectile of state.projectiles) {
    assert.ok(Number.isFinite(projectile.dx) && Number.isFinite(projectile.dz));
  }
}

test('same seed and same commands give identical JSON states and event streams', () => {
  const a = createGame(123456);
  const b = createGame(123456);
  assert.deepStrictEqual(a, b);
  const inputs = [
    { ...IDLE, moveX: 1, moveZ: 1, aimX: 8, aimZ: 4, shoot: true },
    { ...IDLE, moveX: -1, aimX: -7, aimZ: 3, dodge: true },
    { ...IDLE, moveZ: -1, aimX: 2, aimZ: -9, shoot: true },
    IDLE,
  ];
  for (let frame = 0; frame < 180; frame++) {
    const input = inputs[frame % inputs.length];
    const eventsA = tick(a, input, 0.016);
    const eventsB = tick(b, input, 0.016);
    assert.deepStrictEqual(eventsA, eventsB);
    assert.deepStrictEqual(a, b);
    assertFinitePositions(a, eventsA);
    assert.doesNotThrow(() => JSON.stringify(a));
    for (const event of eventsA) {
      assert.ok(['shot', 'hit', 'hurt', 'kill', 'wave', 'dodge', 'win', 'lose'].includes(event.type));
    }
  }
});

test('diagonal travel is normalized to straight travel; components are capped', () => {
  const straight = isolated();
  const diagonal = isolated();
  const oversized = isolated();
  tick(straight, { ...IDLE, moveX: 1 });
  tick(diagonal, { ...IDLE, moveX: 1, moveZ: 1 });
  tick(oversized, { ...IDLE, moveX: 100, moveZ: 0 });
  const straightDistance = Math.hypot(straight.player.x, straight.player.z);
  const diagonalDistance = Math.hypot(diagonal.player.x, diagonal.player.z);
  assert.ok(straightDistance > 0, 'movement must advance the player');
  close(diagonalDistance, straightDistance);
  close(oversized.player.x, straight.player.x);
});

test('player radius stays inside every side of the arena', () => {
  for (const [axis, sign] of [['x', 1], ['x', -1], ['z', 1], ['z', -1]]) {
    const state = isolated();
    state.player[axis] = sign * 9.4;
    const input = { ...IDLE, [axis === 'x' ? 'moveX' : 'moveZ']: sign };
    for (let frame = 0; frame < 100; frame++) tick(state, input);
    assert.ok(state.player[axis] <= 9.55 + 1e-8 && state.player[axis] >= -9.55 - 1e-8,
      `${axis} ${sign} escaped the playable area`);
  }
});

test('dt is clamped to [0, 0.05] before movement and time advance', () => {
  const normal = isolated();
  const huge = isolated();
  const zero = isolated();
  const negative = isolated();
  const input = { ...IDLE, moveX: 1 };
  tick(normal, input, 0.05);
  tick(huge, input, 10);
  tick(zero, input, 0);
  tick(negative, input, -10);
  close(huge.time, normal.time);
  close(huge.player.x, normal.player.x);
  close(negative.time, zero.time);
  close(negative.player.x, zero.player.x);
});

test('aimed shots hit and kill an isolated spider, emitting combat events', () => {
  const state = isolated();
  state.enemies = [enemyAt(state, 0, 3, 25)];
  const startingKills = state.kills;
  const startingScore = state.score;
  const events = [];
  for (let frame = 0; frame < 100 && state.enemies.length; frame++) {
    events.push(...tick(state, { ...IDLE, shoot: frame === 0 }));
  }
  assert.ok(events.some(event => event.type === 'shot'), 'shot event missing');
  assert.ok(events.some(event => event.type === 'hit'), 'hit event missing');
  assert.ok(events.some(event => event.type === 'kill'), 'kill event missing');
  assert.equal(state.enemies.length, 0);
  assert.equal(state.kills, startingKills + 1);
  assert.ok(state.score > startingScore);
});

test('held fire has a 0.18 second cooldown rather than firing every frame', () => {
  const state = isolated();
  let shots = 0;
  for (let frame = 0; frame < 10; frame++) {
    shots += tick(state, { ...IDLE, shoot: true }, 0.01).filter(event => event.type === 'shot').length;
  }
  assert.equal(shots, 1);
  for (let frame = 0; frame < 20; frame++) {
    shots += tick(state, { ...IDLE, shoot: true }, 0.01).filter(event => event.type === 'shot').length;
  }
  assert.ok(shots >= 2 && shots <= 3, `unexpected fire rate: ${shots} shots in 0.3 s`);
});

test('dodge triggers once and cannot retrigger until its two-second cooldown', () => {
  const state = isolated();
  const move = { ...IDLE, moveX: 1, dodge: true };
  assert.equal(tick(state, move).filter(event => event.type === 'dodge').length, 1);
  let extra = 0;
  for (let frame = 0; frame < 20; frame++) {
    extra += tick(state, move).filter(event => event.type === 'dodge').length;
  }
  assert.equal(extra, 0);
  let retriggered = false;
  for (let frame = 0; frame < 26; frame++) {
    if (tick(state, move).some(event => event.type === 'dodge')) retriggered = true;
  }
  assert.ok(retriggered, 'dodge should be available after two seconds');
});

test('contact damage has an invulnerability interval', () => {
  const state = isolated();
  state.enemies = [enemyAt(state, state.player.x, state.player.z, 10000)];
  const originalHp = state.player.hp;
  const first = tick(state);
  assert.ok(first.some(event => event.type === 'hurt'), 'contact should hurt');
  assert.ok(state.player.hp < originalHp);
  assert.ok(state.player.invulnerable > 0);
  const protectedHp = state.player.hp;
  let repeatedHurts = 0;
  for (let frame = 0; frame < 5; frame++) {
    state.enemies[0].x = state.player.x;
    state.enemies[0].z = state.player.z;
    repeatedHurts += tick(state).filter(event => event.type === 'hurt').length;
  }
  assert.equal(repeatedHurts, 0);
  assert.equal(state.player.hp, protectedHp);
});

function advanceUntil(state, predicate, message, maxFrames = 100) {
  const events = [];
  for (let frame = 0; frame < maxFrames && !predicate(state); frame++) {
    events.push(...tick(state));
  }
  assert.ok(predicate(state), message);
  return events;
}

test('three waves occur in order, separated by two seconds, with a final boss and victory', () => {
  const state = createGame(42);
  assert.equal(state.wave, 1);
  assert.ok(state.enemies.length > 0);
  for (const completed of [1, 2]) {
    state.enemies = [];
    const at = state.time;
    tick(state);
    assert.equal(state.wave, completed, 'wave number stays put during the break');
    advanceUntil(state, current => current.wave === completed + 1,
      `wave ${completed + 1} did not start`);
    assert.ok(state.time - at >= 1.95, 'inter-wave break must be about two seconds');
    assert.ok(state.enemies.length > 0);
  }
  assert.ok(state.enemies.some(enemy => enemy.variant === 'boss'), 'third wave needs a boss');
  state.enemies = [];
  const events = advanceUntil(state, current => current.status === 'won', 'third wave must end in victory');
  assert.ok(events.some(event => event.type === 'win'));
});

test('lethal contact causes defeat; won and lost states never change after further input', () => {
  const lost = isolated();
  lost.player.hp = 1;
  lost.enemies = [enemyAt(lost, lost.player.x, lost.player.z, 10000)];
  const defeatEvents = advanceUntil(lost, state => state.status === 'lost', 'lethal damage must defeat the player', 5);
  assert.equal(lost.player.hp, 0);
  assert.ok(defeatEvents.some(event => event.type === 'lose'));
  for (const status of ['lost', 'won']) {
    const state = status === 'lost' ? lost : isolated();
    state.status = status;
    const frozen = structuredClone(state);
    for (let frame = 0; frame < 10; frame++) {
      assert.deepStrictEqual(tick(state, { ...IDLE, moveX: 1, shoot: true, dodge: true }, 10), []);
      assert.deepStrictEqual(state, frozen, `${status} state changed after termination`);
    }
  }
});
