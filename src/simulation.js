import { CAMPAIGN } from './campaignData.js';

// Pure XZ-plane rules. No rendering, wall clock, or module-level mutable state.
const ROOM = 10;
const PLAYER_RADIUS = 0.45;
const PLAYER_SPEED = 5;
const SHOT_DAMAGE = 25;
const SHOT_INTERVAL = 0.18;
const SHOT_SPEED = 38;
const SHOT_RADIUS = 0.1;
const SHOT_LIFE = 1.4;
const DODGE_DISTANCE = 2.8;
const DODGE_COOLDOWN = 2;
const DODGE_IMMUNITY = 0.25;
const CONTACT_IMMUNITY = 0.75;
const WAVE_BREAK = 2;
const EPSILON = 1e-9;
const INFECTED_RADIUS = 0.45;
const INFECTED_HP = 50;
const SEEN_RANGE = 5.5;
const HIT_RANGE = 7;

const SPIDERS = Object.freeze({
  normal: { radius: 0.55, speed: 1.65, hp: 50, damage: 12, points: 100 },
  runner: { radius: 0.45, speed: 2.9, hp: 25, damage: 10, points: 150 },
  tank: { radius: 0.8, speed: 1.15, hp: 100, damage: 20, points: 250 },
  boss: { radius: 1.1, speed: 1.55, hp: 650, damage: 30, points: 1500 },
});
const WAVES = [
  ['normal', 'normal', 'normal', 'normal', 'runner', 'runner'],
  ['normal', 'normal', 'normal', 'normal', 'runner', 'runner', 'runner', 'tank', 'tank'],
  ['boss', 'tank', 'tank', 'tank', 'runner', 'runner', 'runner', 'runner',
    'normal', 'normal', 'normal', 'normal'],
];

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const statsFor = (enemy) => SPIDERS[enemy.variant] || SPIDERS.normal;
const timer = (value, dt) => value - dt <= EPSILON ? 0 : value - dt;
const emit = (events, type, entity) => events.push({ type, x: entity.x, z: entity.z });

function randomFrom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(value ^ (value >>> 15), value | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

// Later waves derive their randomness from serializable state, not a hidden RNG.
function waveSeed(state, wave) {
  return Math.imul(wave, 0x9e3779b9) ^ Math.round(state.time * 1000)
    ^ Math.imul(state.kills + 1, 0x85ebca6b) ^ state.score
    ^ Math.round((state.player.x + ROOM) * 997)
    ^ Math.round((state.player.z + ROOM) * 7919);
}

function spawnWave(state, wave, seed) {
  const random = randomFrom(seed);
  state.wave = wave;
  state.nextWaveIn = 0;
  for (const [index, variant] of WAVES[wave - 1].entries()) {
    const stats = SPIDERS[variant];
    const edge = ROOM - stats.radius;
    let position;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const side = Math.floor(random() * 4);
      const along = (random() * 2 - 1) * edge;
      const candidate = side < 2
        ? { x: side === 0 ? -edge : edge, z: along }
        : { x: along, z: side === 2 ? -edge : edge };
      if (Math.hypot(candidate.x - state.player.x, candidate.z - state.player.z) < 5) continue;
      if (state.enemies.some((enemy) => Math.hypot(candidate.x - enemy.x, candidate.z - enemy.z)
        < stats.radius + statsFor(enemy).radius + 0.25)) continue;
      position = candidate;
      break;
    }
    if (!position) {
      // Bounded fallback: a farthest corner is always more than five units away.
      position = { x: state.player.x > 0 ? -edge : edge, z: state.player.z > 0 ? -edge : edge };
    }
    state.enemies.push({
      id: wave * 100 + index + 1,
      type: 'kara', variant,
      x: position.x, z: position.z,
      yaw: Math.atan2(state.player.x - position.x, state.player.z - position.z),
      hp: stats.hp, maxHp: stats.hp,
    });
  }
}

// Earliest intersection of a swept point and a circle, including initial overlap.
function circleHit(x0, z0, x1, z1, radius) {
  const c = x0 * x0 + z0 * z0 - radius * radius;
  if (c <= 0) return 0;
  const dx = x1 - x0;
  const dz = z1 - z0;
  const a = dx * dx + dz * dz;
  if (a <= EPSILON * EPSILON) return Infinity;
  const b = x0 * dx + z0 * dz;
  const discriminant = b * b - a * c;
  if (discriminant < 0) return Infinity;
  const fraction = (-b - Math.sqrt(discriminant)) / a;
  return fraction >= 0 && fraction <= 1 ? fraction : Infinity;
}

// Everything solid for walking: cover, beds, crates, lamp bases and the infected bystanders.
// Shots still use map.obstacles only, so scenery never changes what a bullet can hit.
const solidCache = new WeakMap();
let activeDead = null;
function movementSolids(map) {
  let solids = solidCache.get(map);
  if (solids) return solids;
  solids = [...map.obstacles];
  for (const prop of map.props || []) {
    const sin = Math.sin(prop.rotation || 0), cos = Math.cos(prop.rotation || 0);
    if (prop.kind === 'bed') {
      for (const along of [-0.62, 0.62]) solids.push({ x: prop.x + sin * along, z: prop.z + cos * along, radius: 0.72 });
    } else if (prop.kind === 'crate') solids.push({ x: prop.x, z: prop.z, radius: 0.68 });
    else if (prop.kind === 'lamp') solids.push({ x: prop.x, z: prop.z, radius: 0.3 });
  }
  for (const person of map.infected || []) solids.push({ x: person.x, z: person.z, radius: 0.42, infectedId: person.id });
  solidCache.set(map, solids);
  return solids;
}
function livingSolids(map) {
  const all = movementSolids(map);
  return activeDead && activeDead.size ? all.filter((solid) => !solid.infectedId || !activeDead.has(solid.infectedId)) : all;
}

function mapPositionIsClear(map, x, z, radius) {
  if (Math.abs(x) > map.arena.halfWidth - radius
    || Math.abs(z) > map.arena.halfDepth - radius) return false;
  return livingSolids(map).every((obstacle) => Math.hypot(x - obstacle.x, z - obstacle.z)
    >= obstacle.radius + radius);
}

// Deterministic bounded search, also used if an obstacle covers the preferred start.
function safeMapPosition(map, preferred, radius, occupied = []) {
  const edgeX = map.arena.halfWidth - radius;
  const edgeZ = map.arena.halfDepth - radius;
  const origin = { x: clamp(preferred.x, -edgeX, edgeX), z: clamp(preferred.z, -edgeZ, edgeZ) };
  const clear = (point) => mapPositionIsClear(map, point.x, point.z, radius)
    && occupied.every((other) => Math.hypot(point.x - other.x, point.z - other.z)
      >= radius + other.radius);
  if (clear(origin)) return origin;
  let best;
  let nearest = Infinity;
  const columns = Math.ceil(edgeX * 4);
  const rows = Math.ceil(edgeZ * 4);
  for (let row = 0; row <= rows; row += 1) {
    for (let column = 0; column <= columns; column += 1) {
      const candidate = { x: -edgeX + 2 * edgeX * column / columns,
        z: -edgeZ + 2 * edgeZ * row / rows };
      const distance = Math.hypot(candidate.x - origin.x, candidate.z - origin.z);
      if (distance < nearest && clear(candidate)) { best = candidate; nearest = distance; }
    }
  }
  if (!best) throw new RangeError(`No safe spawn in campaign map ${map.id}`);
  return best;
}

function firstObstacleHit(map, x0, z0, x1, z1, radius, solids = map.obstacles) {
  let result = { fraction: Infinity, obstacle: null };
  for (const obstacle of solids) {
    const offsetX = x0 - obstacle.x;
    const offsetZ = z0 - obstacle.z;
    const size = obstacle.radius + radius;
    // Touching a surface does not block motion away from it (or along its tangent).
    if (Math.abs(Math.hypot(offsetX, offsetZ) - size) <= EPSILON
      && offsetX * (x1 - x0) + offsetZ * (z1 - z0) >= 0) continue;
    const hit = circleHit(offsetX, offsetZ, x1 - obstacle.x, z1 - obstacle.z, size);
    if (hit < result.fraction) result = { fraction: hit, obstacle };
  }
  return result;
}

// Swept circles stop dashes at the first obstacle instead of tunnelling through it.
// The unused component slides along its tangent, so walking around cover is smooth.
function moveInMap(entity, dx, dz, radius, map) {
  if (!mapPositionIsClear(map, entity.x, entity.z, radius)) {
    Object.assign(entity, safeMapPosition(map, entity, radius));
  }
  const edgeX = map.arena.halfWidth - radius;
  const edgeZ = map.arena.halfDepth - radius;
  for (let iteration = 0; iteration < 4; iteration += 1) {
    dx = clamp(entity.x + dx, -edgeX, edgeX) - entity.x;
    dz = clamp(entity.z + dz, -edgeZ, edgeZ) - entity.z;
    const distance = Math.hypot(dx, dz);
    if (distance <= EPSILON) break;
    const { fraction, obstacle } = firstObstacleHit(map, entity.x, entity.z,
      entity.x + dx, entity.z + dz, radius, livingSolids(map));
    if (!obstacle) { entity.x += dx; entity.z += dz; break; }
    const travel = Math.max(0, fraction - 1e-6 / distance);
    entity.x += dx * travel;
    entity.z += dz * travel;
    dx *= 1 - travel;
    dz *= 1 - travel;
    const length = Math.hypot(entity.x - obstacle.x, entity.z - obstacle.z);
    const nx = (entity.x - obstacle.x) / length;
    const nz = (entity.z - obstacle.z) / length;
    const inward = dx * nx + dz * nz;
    if (inward < 0) { dx -= nx * inward; dz -= nz * inward; }
  }
  // Protect the invariant against round-off at intersecting surfaces and walls.
  if (!mapPositionIsClear(map, entity.x, entity.z, radius)) {
    Object.assign(entity, safeMapPosition(map, entity, radius));
  }
}

function moveCampaignEnemy(enemy, player, travel, distance, map) {
  const radius = statsFor(enemy).radius;
  let dx = (player.x - enemy.x) / distance;
  let dz = (player.z - enemy.z) / distance;
  const block = firstObstacleHit(map, enemy.x, enemy.z,
    player.x, player.z, radius + 0.05, livingSolids(map));
  if (block.obstacle) {
    const nx = enemy.x - block.obstacle.x;
    const nz = enemy.z - block.obstacle.z;
    const length = Math.hypot(nx, nz);
    // A stable ID breaks exact head-on ties without hidden navigation state.
    const cross = nx * dz - nz * dx;
    const side = Math.abs(cross) > EPSILON ? Math.sign(cross) : enemy.id % 2 ? 1 : -1;
    dx += -nz / length * side * 1.5;
    dz += nx / length * side * 1.5;
    const direction = Math.hypot(dx, dz);
    dx /= direction;
    dz /= direction;
  }
  moveInMap(enemy, dx * travel, dz * travel, radius, map);
}

function advanceProjectiles(state, dt, previousEnemies, events, map = null) {
  const halfWidth = map ? map.arena.halfWidth - SHOT_RADIUS : ROOM;
  const halfDepth = map ? map.arena.halfDepth - SHOT_RADIUS : ROOM;
  for (let index = state.projectiles.length - 1; index >= 0; index -= 1) {
    const shot = state.projectiles[index];
    if (shot.life <= 0 || Math.abs(shot.x) > halfWidth || Math.abs(shot.z) > halfDepth) {
      state.projectiles.splice(index, 1);
      continue;
    }
    const duration = Math.min(dt, shot.life);
    const dx = shot.dx * SHOT_SPEED * duration;
    const dz = shot.dz * SHOT_SPEED * duration;
    let boundary = 1;
    if (shot.x + dx > halfWidth) boundary = Math.min(boundary, (halfWidth - shot.x) / dx);
    if (shot.x + dx < -halfWidth) boundary = Math.min(boundary, (-halfWidth - shot.x) / dx);
    if (shot.z + dz > halfDepth) boundary = Math.min(boundary, (halfDepth - shot.z) / dz);
    if (shot.z + dz < -halfDepth) boundary = Math.min(boundary, (-halfDepth - shot.z) / dz);
    let blocked = false;
    if (map) {
      const hit = firstObstacleHit(map, shot.x, shot.z,
        shot.x + dx * boundary, shot.z + dz * boundary, SHOT_RADIUS);
      if (hit.obstacle) { boundary *= hit.fraction; blocked = true; }
    }
    const endX = shot.x + dx * boundary;
    const endZ = shot.z + dz * boundary;
    const enemyFraction = duration * boundary / dt;
    let target = -1;
    let nearest = blocked ? 1 : Infinity;
    for (let enemyIndex = 0; enemyIndex < state.enemies.length; enemyIndex += 1) {
      const enemy = state.enemies[enemyIndex];
      const previous = previousEnemies.get(enemy.id) || enemy;
      const enemyX = previous.x + (enemy.x - previous.x) * enemyFraction;
      const enemyZ = previous.z + (enemy.z - previous.z) * enemyFraction;
      const hit = circleHit(shot.x - previous.x, shot.z - previous.z,
        endX - enemyX, endZ - enemyZ, statsFor(enemy).radius + SHOT_RADIUS);
      if (hit < nearest) {
        nearest = hit;
        target = enemyIndex;
      }
    }
    // Infected bystanders are shootable: two hits kill. A nearer enemy or cover still takes the shot first.
    let victim = null;
    if (map) {
      for (const person of map.infected || []) {
        if (shot.aimed !== person.id || state.infectedDead.includes(person.id) || state.infectedSpared.includes(person.id)) continue;
        const hit = circleHit(shot.x - person.x, shot.z - person.z, endX - person.x, endZ - person.z, INFECTED_RADIUS + SHOT_RADIUS);
        if (hit < nearest) { nearest = hit; victim = person; target = -1; }
      }
    }
    if (victim) {
      shot.x += (endX - shot.x) * nearest;
      shot.z += (endZ - shot.z) * nearest;
      emit(events, 'hit', shot);
      const hp = (state.infectedHp[victim.id] ?? INFECTED_HP) - SHOT_DAMAGE;
      if (hp <= 0) {
        state.infectedDead.push(victim.id);
        state.infectedKills += 1;
        delete state.infectedHp[victim.id];
        events.push({ type: 'infected-kill', id: victim.id, x: victim.x, z: victim.z, count: state.infectedKills });
      } else state.infectedHp[victim.id] = hp;
      shot.life = 0;
    } else if (target !== -1) {
      const enemy = state.enemies[target];
      shot.x += (endX - shot.x) * nearest;
      shot.z += (endZ - shot.z) * nearest;
      emit(events, 'hit', shot);
      enemy.hp = Math.max(0, enemy.hp - SHOT_DAMAGE);
      if (enemy.hp === 0) {
        state.kills += 1;
        state.score += statsFor(enemy).points;
        emit(events, 'kill', enemy);
        state.enemies.splice(target, 1);
      }
    } else {
      shot.x = endX;
      shot.z = endZ;
    }
    shot.life = Math.max(0, shot.life - duration);
    if (victim || target !== -1 || shot.life <= EPSILON || boundary < 1 || blocked) {
      state.projectiles.splice(index, 1);
    }
  }
}

function initialState() {
  return {
    status: 'playing', time: 0, wave: 1, score: 0, kills: 0,
    player: {
      x: 0, z: 0, yaw: 0, hp: 100, maxHp: 100,
      fireCooldown: 0, dodgeCooldown: 0, invulnerable: 0,
    },
    enemies: [], projectiles: [], nextWaveIn: 0,
    // Infected bystanders can be shot. Who died is remembered for the whole run: it decides how the story ends.
    infectedDead: [], infectedHp: {}, infectedKills: 0,
    // Bystanders the hero calmed instead: shots pass them by and the ending remembers it.
    infectedSpared: [],
    // Bystanders the hero has walked up to (within SEEN_RANGE); nobody out of sight can be hit by a stray shot.
    infectedSeen: [],
  };
}

export function createGame(seed = 1) {
  const state = initialState();
  spawnWave(state, 1, finite(seed, 1));
  return state;
}

function spawnCampaignWave(state, wave, seed, map) {
  const random = randomFrom(seed);
  const variants = WAVES[Math.min(wave, WAVES.length) - 1].filter((variant) => variant !== 'boss');
  if (map.boss && wave === map.waves) variants.unshift('boss');
  state.wave = wave;
  state.nextWaveIn = 0;
  for (const [index, variant] of variants.entries()) {
    const stats = SPIDERS[variant];
    const edgeX = map.arena.halfWidth - stats.radius;
    const edgeZ = map.arena.halfDepth - stats.radius;
    const occupied = [
      { x: state.player.x, z: state.player.z, radius: Math.max(PLAYER_RADIUS, 5 - stats.radius) },
      ...state.enemies.map((enemy) => ({ x: enemy.x, z: enemy.z,
        radius: statsFor(enemy).radius + 0.25 })),
    ];
    let position;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const side = Math.floor(random() * 4);
      const candidate = side < 2
        ? { x: side === 0 ? -edgeX : edgeX, z: (random() * 2 - 1) * edgeZ }
        : { x: (random() * 2 - 1) * edgeX, z: side === 2 ? -edgeZ : edgeZ };
      if (!mapPositionIsClear(map, candidate.x, candidate.z, stats.radius)) continue;
      if (occupied.some((other) => Math.hypot(candidate.x - other.x, candidate.z - other.z)
        < stats.radius + other.radius)) continue;
      position = candidate;
      break;
    }
    if (!position) {
      position = safeMapPosition(map, {
        x: state.player.x > 0 ? -edgeX : edgeX,
        z: state.player.z > 0 ? -edgeZ : edgeZ,
      }, stats.radius, occupied);
    }
    state.enemies.push({
      id: (state.campaign.mapIndex + 1) * 10000 + wave * 100 + index + 1,
      type: 'kara', variant, x: position.x, z: position.z,
      yaw: Math.atan2(state.player.x - position.x, state.player.z - position.z),
      hp: stats.hp, maxHp: stats.hp,
    });
  }
}

function prepareCampaignMap(state, mapIndex) {
  const map = CAMPAIGN[mapIndex];
  const position = safeMapPosition(map, { x: 0, z: 0 }, PLAYER_RADIUS);
  state.campaign = { mapIndex, stage: 'intro', mapId: map.id };
  state.status = 'playing';
  Object.assign(state.player, position, {
    yaw: 0, hp: state.player.maxHp,
    fireCooldown: 0, dodgeCooldown: 0, invulnerable: 0,
  });
  state.enemies = [];
  state.projectiles = [];
  state.wave = 1;
  state.nextWaveIn = 0;
  state.campaignMapTime = 0;
}

/** Start a separate campaign; story screens never advance combat or its clocks. */
export function createCampaignGame({ seed = 1 } = {}) {
  const state = initialState();
  state.campaignSeed = finite(seed, 1);
  prepareCampaignMap(state, 0);
  return state;
}

/** Confirm a story card in place. Other stages and terminal defeats are unchanged. */
export function advanceCampaign(state) {
  if (state.status !== 'playing' || !state.campaign) return state;
  const campaign = state.campaign;
  if (campaign.stage === 'intro') {
    campaign.stage = 'combat';
    const seed = state.campaignSeed ^ Math.imul(campaign.mapIndex, 0x9e3779b9);
    spawnCampaignWave(state, 1, seed, CAMPAIGN[campaign.mapIndex]);
  } else if (campaign.stage === 'outro') {
    if (campaign.mapIndex + 1 < CAMPAIGN.length) prepareCampaignMap(state, campaign.mapIndex + 1);
    else { campaign.stage = 'complete'; state.status = 'won'; }
  }
  return state;
}

/** Match stepGame: mutate state, return events, and leave input untouched. */
export function stepCampaign(state, input = {}, dt = 0) {
  if (state.status !== 'playing' || state.campaign?.stage !== 'combat') return [];
  return stepSimulation(state, input, dt, CAMPAIGN[state.campaign.mapIndex]);
}

/** The nearest bystander still standing (neither shot nor calmed) within `range` of the hero, or null. */
export function nearestInfected(state, map, range = 3) {
  let best = null, bestDistance = range;
  for (const person of map?.infected || []) {
    if (state.infectedDead?.includes(person.id) || state.infectedSpared?.includes(person.id)) continue;
    const distance = Math.hypot(person.x - state.player.x, person.z - state.player.z);
    if (distance <= bestDistance) { best = person; bestDistance = distance; }
  }
  return best;
}

/** Calm the nearest bystander instead of shooting. Returns an event, or null if nobody is close enough. */
export function calmNearbyInfected(state, map, range = 2.6) {
  if (state.status !== 'playing' || state.campaign?.stage !== 'combat') return null;
  const person = nearestInfected(state, map, range);
  if (!person) return null;
  state.infectedSpared ||= [];
  state.infectedSpared.push(person.id);
  return { type: 'infected-calm', id: person.id, x: person.x, z: person.z, count: state.infectedSpared.length };
}

/** Advance the serializable state; rendering, input devices and clocks live outside. */
export function stepGame(state, input = {}, dt = 0) {
  return stepSimulation(state, input, dt);
}

function stepSimulation(state, input, dt, map = null) {
  if (state.status !== 'playing') return [];
  state.infectedDead ||= []; state.infectedHp ||= {}; state.infectedKills ||= 0; state.infectedSpared ||= []; state.infectedSeen ||= [];
  activeDead = new Set(state.infectedDead);
  dt = clamp(finite(dt), 0, 0.05);
  if (dt === 0) return [];
  const events = [];
  const player = state.player;
  if (map ? state.campaignMapTime === 0 : state.time === 0) emit(events, 'wave', player);
  state.time += dt;
  if (map) state.campaignMapTime += dt;
  player.fireCooldown = timer(player.fireCooldown, dt);
  player.dodgeCooldown = timer(player.dodgeCooldown, dt);
  player.invulnerable = timer(player.invulnerable, dt);

  for (const person of map?.infected || []) {
    if (!state.infectedSeen.includes(person.id) && Math.hypot(person.x - player.x, person.z - player.z) < SEEN_RANGE) state.infectedSeen.push(person.id);
  }
  let moveX = clamp(finite(input?.moveX), -1, 1);
  let moveZ = clamp(finite(input?.moveZ), -1, 1);
  const movement = Math.hypot(moveX, moveZ);
  if (movement > 1) { moveX /= movement; moveZ /= movement; }
  const edge = ROOM - PLAYER_RADIUS;
  if (map) moveInMap(player, moveX * PLAYER_SPEED * dt, moveZ * PLAYER_SPEED * dt, PLAYER_RADIUS, map);
  else {
    player.x = clamp(player.x + moveX * PLAYER_SPEED * dt, -edge, edge);
    player.z = clamp(player.z + moveZ * PLAYER_SPEED * dt, -edge, edge);
  }
  const aimX = finite(input?.aimX, player.x + Math.sin(player.yaw) * 8) - player.x;
  const aimZ = finite(input?.aimZ, player.z + Math.cos(player.yaw) * 8) - player.z;
  if (Math.hypot(aimX, aimZ) > EPSILON) player.yaw = Math.atan2(aimX, aimZ);

  if (input?.dodge && player.dodgeCooldown === 0) {
    const length = Math.hypot(moveX, moveZ);
    const dx = length > EPSILON ? moveX / length : Math.sin(player.yaw);
    const dz = length > EPSILON ? moveZ / length : Math.cos(player.yaw);
    if (map) moveInMap(player, dx * DODGE_DISTANCE, dz * DODGE_DISTANCE, PLAYER_RADIUS, map);
    else {
      player.x = clamp(player.x + dx * DODGE_DISTANCE, -edge, edge);
      player.z = clamp(player.z + dz * DODGE_DISTANCE, -edge, edge);
    }
    player.dodgeCooldown = DODGE_COOLDOWN;
    player.invulnerable = Math.max(player.invulnerable, DODGE_IMMUNITY);
    emit(events, 'dodge', player);
  }

  if (input?.shoot && player.fireCooldown === 0) {
    const dx = Math.sin(player.yaw);
    const dz = Math.cos(player.yaw);
    // IDs derive only from the saved state, including for sub-millisecond steps.
    const id = state.projectiles.reduce((next, shot) => Math.max(next, shot.id + 1),
      Math.max(1, Math.round(state.time * 1000000)));
    const muzzleX = player.x + dx * (PLAYER_RADIUS + SHOT_RADIUS);
    const muzzleZ = player.z + dz * (PLAYER_RADIUS + SHOT_RADIUS);
    // Cover between the player's centre and muzzle must not be skipped on spawn.
    if (!map || !firstObstacleHit(map, player.x, player.z, muzzleX, muzzleZ, SHOT_RADIUS).obstacle) {
      // Only a shot aimed straight at a bystander can hurt them: if a spider stands on the same line the shot is
      // meant for it, so stray bullets never kill people by accident.
      const alongRay = (x, z) => { const rx = x - player.x, rz = z - player.z; return { along: rx * dx + rz * dz, side: Math.abs(rx * dz - rz * dx) }; };
      const spiderOnLine = state.enemies.some((enemy) => { const r = alongRay(enemy.x, enemy.z); return r.along > 0 && r.side < 2.4; });
      const aimed = spiderOnLine ? null : (map?.infected || []).find((person) => {
        if (state.infectedDead.includes(person.id) || state.infectedSpared.includes(person.id) || !state.infectedSeen.includes(person.id)) return false;
        const r = alongRay(person.x, person.z); return r.along > 0.3 && r.along < HIT_RANGE && r.side < 0.5;
      })?.id ?? null;
      state.projectiles.push({ id, x: muzzleX, z: muzzleZ, dx, dz, life: SHOT_LIFE, aimed });
    }
    player.fireCooldown = SHOT_INTERVAL;
    emit(events, 'shot', player);
  }

  const previousEnemies = new Map();
  for (const enemy of state.enemies) {
    if (map && !mapPositionIsClear(map, enemy.x, enemy.z, statsFor(enemy).radius)) {
      Object.assign(enemy, safeMapPosition(map, enemy, statsFor(enemy).radius));
    }
    previousEnemies.set(enemy.id, { x: enemy.x, z: enemy.z });
    const stats = statsFor(enemy);
    const dx = player.x - enemy.x;
    const dz = player.z - enemy.z;
    const distance = Math.hypot(dx, dz);
    if (distance > EPSILON) {
      enemy.yaw = Math.atan2(dx, dz);
      const travel = Math.min(stats.speed * dt, Math.max(0, distance - stats.radius - PLAYER_RADIUS));
      if (map) moveCampaignEnemy(enemy, player, travel, distance, map);
      else { enemy.x += dx / distance * travel; enemy.z += dz / distance * travel; }
    }
    if (!map) {
      const limit = ROOM - stats.radius;
      enemy.x = clamp(enemy.x, -limit, limit);
      enemy.z = clamp(enemy.z, -limit, limit);
    }
  }
  advanceProjectiles(state, dt, previousEnemies, events, map);

  for (const enemy of state.enemies) {
    if (player.invulnerable > 0) break;
    const stats = statsFor(enemy);
    if (Math.hypot(enemy.x - player.x, enemy.z - player.z) <= stats.radius + PLAYER_RADIUS + EPSILON) {
      player.hp = Math.max(0, player.hp - stats.damage);
      player.invulnerable = CONTACT_IMMUNITY;
      emit(events, 'hurt', player);
    }
  }
  if (player.hp === 0) {
    state.status = 'lost';
    emit(events, 'lose', player);
    return events;
  }

  if (state.enemies.length === 0) {
    if (map && state.wave === map.waves) {
      state.campaign.stage = 'outro';
      state.nextWaveIn = 0;
      state.projectiles = [];
    } else if (!map && state.wave === WAVES.length) {
      state.status = 'won';
      emit(events, 'win', player);
    } else if (state.nextWaveIn > 0) {
      state.nextWaveIn = timer(state.nextWaveIn, dt);
      if (state.nextWaveIn === 0) {
        const wave = state.wave + 1;
        if (map) spawnCampaignWave(state, wave, waveSeed(state, wave), map);
        else spawnWave(state, wave, waveSeed(state, wave));
        emit(events, 'wave', player);
      }
    } else state.nextWaveIn = WAVE_BREAK;
  }
  return events;
}
