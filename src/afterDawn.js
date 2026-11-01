// A local, deterministic continuation. Campaign save/settings and the three combat maps stay unchanged.
export const DAWN_STOPS = Object.freeze([
  Object.freeze({ id: 'power', x: -9, z: -8.5, title: 'Восстановить питание', action: 'Включить генератор',
    text: 'Резервный генератор стоит у западной стены, рядом с бочками топлива. Без него рация и ворота не работают.' }),
  Object.freeze({ id: 'radio', x: 6.9, z: -21, title: 'Выйти на связь', action: 'Настроить рацию',
    text: 'Идите к восточному посту связи. Кто-то оставил передатчик на частоте эвакуации.' }),
  Object.freeze({ id: 'gate', x: 0, z: -36, title: 'Открыть северные ворота', action: 'Открыть ворота',
    text: 'Медик Нина ждёт за северными воротами. До закрытия карантинного кольца нужно успеть вывести её к мосту.' }),
]);
export const DAWN_INTRO = Object.freeze([
  'Я закрываю дверь насосной. Солнце уже над крышами, но двор пуст: ни машин, ни спасателей. Побег из здания ещё не означает спасения.',
  'Из рации у восточного поста пробивается голос: «Я Нина, медик. Я у северных ворот. Не стреляй — они идут на звук. Включи резервное питание, и я помогу открыть путь к мосту».',
  'Теперь важнее не огонь, а связь. Найдите генератор, настройте передатчик и доберитесь до ворот. WASD / стрелки — идти, E или кнопка на экране — взаимодействовать рядом с целью. Esc — пауза.',
]);
import { moveBody } from './sequelMotion.js';
const solid = (x, z, width, depth) => ({ x, z, width, depth });
// Footprints of the courtyard set pieces. Mirror the layout built in courtyard.js.
export const DAWN_SOLIDS = Object.freeze([
  solid(0, -20, 5.0, 3.4), solid(0, -20, 3.4, 5.0), solid(0, -20, 4.4, 4.4),
  solid(-9, -14, 2.6, 5.8), solid(-9.5, -24, 4, 4), solid(-11.7, -30, 2.6, 2.6), solid(-10.8, -6.9, 1.8, 1.4),
  solid(10.5, -24, 5, 4), solid(9, -9, 5.2, 1.8), solid(9, -14.5, 5.2, 1.8),
  solid(-6, -29, 7, 0.9), solid(6, -29, 7, 0.9), solid(-5.5, -32, 0.9, 0.9), solid(5.5, -32, 0.9, 0.9),
  solid(-4.4, -15.5, 1.6, 1.6), solid(4.4, -15.5, 1.6, 1.6), solid(-4.4, -24.5, 1.6, 1.6), solid(4.4, -24.5, 1.6, 1.6),
  solid(-2, -3.2, 0.7, 0.7), solid(2, -3.2, 0.7, 0.7),
  // aftermath set pieces: burn barrel, covered bodies, toppled gurney, floodlight towers
  solid(-12.3, -19, 1.0, 1.0), solid(-6, -27.5, 2.7, 2.0), solid(-5.5, -11.5, 1.6, 1.4), solid(-12.4, -33.5, 0.9, 0.9), solid(12.4, -33.5, 0.9, 0.9),
].map(Object.freeze));
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export function createAfterDawn() {
  return { time: 0, x: 0, z: -9, yaw: Math.PI, step: 0, gate: 0, complete: false, stops: DAWN_STOPS,
    message: DAWN_STOPS[0].text };
}
export function dawnObjective(state) { return DAWN_STOPS[Math.min(state.step, DAWN_STOPS.length - 1)]; }
export function dawnCanUse(state) {
  const target = dawnObjective(state);
  return !state.complete && state.step < DAWN_STOPS.length && Math.hypot(state.x - target.x, state.z - target.z) <= 1.8;
}
export function stepAfterDawn(state, input = {}, delta = 0) {
  if (state.complete) return [];
  const dt = Number.isFinite(delta) ? clamp(delta, 0, 0.05) : 0;
  state.time += dt;
  const mx = Number.isFinite(input.moveX) ? clamp(input.moveX, -1, 1) : 0;
  const mz = Number.isFinite(input.moveZ) ? clamp(input.moveZ, -1, 1) : 0;
  const length = Math.max(1, Math.hypot(mx, mz));
  const previousZ = state.z;
  // Compound solids (fountain, ambulance, tent, guard post, beds, chicane); the walls are the x bounds.
  // Beyond the gate the lane narrows to the gate opening.
  const lane = state.z < -35.2 ? 1.85 : 13.15;
  moveBody(state, mx / length * dt * 3.3, mz / length * dt * 3.3, 0.35, DAWN_SOLIDS,
    { minX: -lane, maxX: lane, minZ: state.step >= 3 ? -41.35 : -35.15, maxZ: -3.65 });
  // The fence is solid outside the actual opening, even after the gate swings open.
  if (state.z < -35 && (Math.abs(state.x) > 1.65 || state.gate < 0.92)) state.z = Math.max(-35, previousZ);
  // Don't walk through the generator or radio table; slide around their circular footprint.
  for (const stop of DAWN_STOPS.slice(0, 2)) {
    const dx = state.x - stop.x, dz = state.z - stop.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.9) {
      state.x = stop.x + (distance > 0.00001 ? dx / distance : 0) * 0.9;
      state.z = stop.z + (distance > 0.00001 ? dz / distance : 1) * 0.9;
    }
  }
  if (mx || mz) state.yaw = Math.atan2(mx, mz);
  const events = [];
  if (input.interact && dawnCanUse(state)) {
    state.step += 1;
    state.message = state.step === 1
      ? 'Генератор заработал. В наушнике треск: «Слышу питание! Теперь настрой рацию у восточного поста». '
      : state.step === 2
        ? 'Нина: «Я здесь, живая. Нажми зелёную кнопку на северных воротах. К мосту пойдём вместе — в больницу уже нельзя». '
        : 'Створки расходятся. Идите по дорожке за ворота — Нина ждёт на другой стороне.';
    events.push({ type: state.step === 2 ? 'wave' : 'dodge', x: state.x, z: state.z });
  }
  if (state.step >= 3) {
    state.gate = Math.min(1, state.gate + dt / 2.2);
    if (state.gate < 0.92) state.z = Math.max(-35, state.z);
    if (state.z < -39 && Math.abs(state.x) < 1.65) {
      state.complete = true;
      state.message = 'Нина выходит из тени поста. «Теперь к мосту. И не оглядывайся». Впервые за ночь вы идёте не один.';
      events.push({ type: 'win', x: state.x, z: state.z });
    }
  }
  return events;
}
