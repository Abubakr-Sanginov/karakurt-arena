const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export function moveBody(body, dx, dz, radius, walls, bounds) {
  const blocked = (x, z) => walls.some(wall => x + radius > wall.x - wall.width / 2
    && x - radius < wall.x + wall.width / 2 && z + radius > wall.z - wall.depth / 2
    && z - radius < wall.z + wall.depth / 2);
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.15));
  for (let i = 0; i < steps; i++) {
    const x = clamp(body.x + dx / steps, bounds.minX + radius, bounds.maxX - radius);
    if (!blocked(x, body.z)) body.x = x;
    const z = clamp(body.z + dz / steps, bounds.minZ + radius, bounds.maxZ - radius);
    if (!blocked(body.x, z)) body.z = z;
  }
}
export function clearLine(x, z, tx, tz, walls, margin = 0) {
  const distance = Math.hypot(tx - x, tz - z), steps = Math.max(1, Math.ceil(distance / 0.12));
  for (let i = 0; i <= steps; i++) {
    const px = x + (tx - x) * i / steps, pz = z + (tz - z) * i / steps;
    if (walls.some(w => Math.abs(px - w.x) < w.width / 2 + margin && Math.abs(pz - w.z) < w.depth / 2 + margin)) return false;
  }
  return true;
}
// Grid navigation over the solids inflated by the spider radius: a 0.4 m flood fill finds the way
// through any floor plan, then the path is string-pulled so the spider cuts corners cleanly.
const CELL = 0.4, SPIDER_RADIUS = 0.95, REPATH = 0.2;
const navCache = new WeakMap(), paths = new WeakMap();
function navGrid(walls, bounds, radius) {
  let cache = navCache.get(walls);
  if (!cache) navCache.set(walls, cache = new Map());
  const key = `${radius}:${bounds.minX},${bounds.maxX},${bounds.minZ},${bounds.maxZ}`;
  let grid = cache.get(key);
  if (grid) return grid;
  const columns = Math.round((bounds.maxX - bounds.minX) / CELL), rows = Math.round((bounds.maxZ - bounds.minZ) / CELL);
  const blocked = new Uint8Array(columns * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) {
    const x = bounds.minX + (c + 0.5) * CELL, z = bounds.minZ + (r + 0.5) * CELL;
    const outside = x < bounds.minX + radius || x > bounds.maxX - radius
      || z < bounds.minZ + radius || z > bounds.maxZ - radius;
    blocked[r * columns + c] = outside || walls.some(w => x + radius > w.x - w.width / 2 && x - radius < w.x + w.width / 2
      && z + radius > w.z - w.depth / 2 && z - radius < w.z + w.depth / 2) ? 1 : 0;
  }
  grid = { columns, rows, blocked, minX: bounds.minX, minZ: bounds.minZ };
  cache.set(key, grid);
  return grid;
}
const cellOf = (grid, x, z) => ({ c: clamp(Math.floor((x - grid.minX) / CELL), 0, grid.columns - 1), r: clamp(Math.floor((z - grid.minZ) / CELL), 0, grid.rows - 1) });
function nearestFree(grid, x, z) {
  const origin = cellOf(grid, x, z);
  for (let ring = 0; ring < 8; ring++) {
    let best = -1, bestDistance = Infinity;
    for (let r = origin.r - ring; r <= origin.r + ring; r++) for (let c = origin.c - ring; c <= origin.c + ring; c++) {
      if (r < 0 || c < 0 || r >= grid.rows || c >= grid.columns || grid.blocked[r * grid.columns + c]) continue;
      const distance = Math.hypot(c - origin.c, r - origin.r);
      if (distance < bestDistance) { bestDistance = distance; best = r * grid.columns + c; }
    }
    if (best >= 0) return best;
  }
  return -1;
}
function findPath(grid, from, to) {
  const start = nearestFree(grid, from.x, from.z), goal = nearestFree(grid, to.x, to.z);
  if (start < 0 || goal < 0) return [];
  const previous = new Int32Array(grid.columns * grid.rows).fill(-2), queue = [start];
  previous[start] = -1;
  for (let head = 0; head < queue.length && previous[goal] === -2; head++) {
    const node = queue[head], c = node % grid.columns, r = (node - c) / grid.columns;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = c + dc, nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= grid.columns || nr >= grid.rows) continue;
      const next = nr * grid.columns + nc;
      if (previous[next] !== -2 || grid.blocked[next]) continue;
      previous[next] = node; queue.push(next);
    }
  }
  if (previous[goal] === -2) return [];
  const path = [];
  for (let node = goal; node !== -1; node = previous[node]) {
    const c = node % grid.columns, r = (node - c) / grid.columns;
    path.push({ x: grid.minX + (c + 0.5) * CELL, z: grid.minZ + (r + 0.5) * CELL });
  }
  return path.reverse();
}
/** Greedy-free pursuit around any layout. radius is the chaser's body size (spider 0.95, doctor 0.3). */
export function chaseHome(spider, player, speed, dt, walls, bounds, radius = SPIDER_RADIUS) {
  let target = player;
  if (!clearLine(spider.x, spider.z, player.x, player.z, walls, radius)) {
    const memory = paths.get(spider) || { path: [], timer: 0 };
    memory.timer -= dt;
    if (memory.timer <= 0 || !memory.path.length) {
      memory.path = findPath(navGrid(walls, bounds, radius), spider, player); memory.timer = REPATH;
    }
    paths.set(spider, memory);
    // String pulling: aim at the furthest visible waypoint among the next few.
    target = memory.path[memory.path.length - 1] || player;
    for (let i = Math.min(memory.path.length - 1, 14); i >= 0; i--) {
      if (clearLine(spider.x, spider.z, memory.path[i].x, memory.path[i].z, walls, radius - 0.04)) { target = memory.path[i]; break; }
      if (i === 0) target = memory.path[0];
    }
  } else paths.delete(spider);
  const dx = target.x - spider.x, dz = target.z - spider.z, distance = Math.hypot(dx, dz);
  if (distance > 0.001) {
    spider.yaw = Math.atan2(dx, dz);
    const travel = Math.min(distance, speed * dt);
    moveBody(spider, dx / distance * travel, dz / distance * travel, radius, walls, bounds);
  }
}
