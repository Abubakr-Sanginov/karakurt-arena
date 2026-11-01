import { CODE_NOTES, SAFE_CODE, SAFE_POS, HOME_EXIT, HOME_WALLS, HOME_SOLIDS, HOSPITAL_WALLS, HOSPITAL_SOLIDS, RADIO_BROKEN } from './sequelData.js';
import { moveBody, clearLine, chaseHome } from './sequelMotion.js';
export { HOSPITAL_INTRO, HOME_INTRO } from './sequelData.js';
const HOME_SPIDER_WAKE = 15;
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const near = (a, x, z, distance = 1.9) => Math.hypot(a.x - x, a.z - z) < distance;
export function createSequel(chapter = 'hospital') {
  return { chapter, stage: chapter === 'hospital' ? 'doctor' : 'hunt', time: 0, sceneTime: 0,
    player: { x: 0, z: chapter === 'hospital' ? 8 : 9, yaw: Math.PI, hp: 64, invulnerable: 0 },
    doctor: { x: 0, z: 0, yaw: 0, hp: 90, attack: 0 },
    spider: { x: 8, z: -9, yaw: 0, hp: 300, stun: 0, goal: -1, route: [] },
    notes: [], safeOpen: false, weapon: false, cooldown: 0, stamina: 1,
    door: 100, radioIndex: 0, complete: false, lost: false, shotFlash: 0, deathTime: 0, deathCause: '',
    message: chapter === 'hospital' ? 'Доктор достал нож. Не подпускайте его; цельтесь мышью и стреляйте.'
      : 'Шорох за стеной: паук проснётся через несколько секунд. Найдите пять записок и сейф в юго-восточной комнате.' };
}
export function sequelUse(state, code = null) {
  const p = state.player;
  if (state.lost || state.complete) return false;
  if (state.chapter === 'hospital') {
    if (state.stage === 'retreat' && p.z < -6.5 && near(p, 0, -8, 1.9)) {
      state.stage = 'barricade'; state.sceneTime = 0;
      state.message = 'Дверь закрыта. Паук бьёт с другой стороны. Бегите к выходу в дальнем конце коридора!';
      return true;
    }
    return false;
  }
  if (state.stage !== 'hunt') return false;
  const note = CODE_NOTES.find(note => !state.notes.includes(note.id) && near(p, note.x, note.z));
  if (note) {
    state.notes.push(note.id);
    state.message = `${note.room}: цифры ${note.position} — ${note.digits}. Записано в журнал.`;
    return true;
  }
  if (!state.weapon && near(p, SAFE_POS.x, SAFE_POS.z)) {
    if (code === null) { state.safeOpen = true; state.message = 'Введите десять цифр. Паук не ждёт — при опасности закройте панель и бегите.'; return true; }
    if (typeof code === 'string' && /^\d{10}$/.test(code) && code === SAFE_CODE) {
      state.safeOpen = false; state.weapon = true;
      state.message = 'Сейф открыт. Оружие у вас. Остановите паука, затем уходите через входную дверь.';
      return true;
    }
    state.message = 'Код неверный. Введите десять цифр в порядке позиций на записках.';
  }
  return false;
}
function damage(state, amount, events, source = 'spider', immunity = 1) {
  if (state.player.invulnerable > 0) return;
  state.player.hp = Math.max(0, state.player.hp - amount); state.player.invulnerable = immunity;
  events.push({ type: 'hurt', x: state.player.x, z: state.player.z });
  if (!state.player.hp) {
    state.lost = true; state.safeOpen = false; state.deathTime = 0; state.deathCause = source;
    state.message = source === 'doctor' ? 'Доктор оказался быстрее. Нож не оставил шанса.' : 'Паук настиг вас. Побег оборвался.';
    events.push({ type: source === 'doctor' ? 'scream' : 'lose', x: 0, z: 0 });
  }
}
export function stepSequel(state, input = {}, delta = 0) {
  const dt = Number.isFinite(delta) ? clamp(delta, 0, 0.05) : 0;
  if (state.lost) { state.deathTime = Math.min(3.2, (state.deathTime || 0) + dt); return []; }
  if (state.complete) return [];
  state.time += dt; state.sceneTime += dt;
  state.cooldown = Math.max(0, state.cooldown - dt); state.shotFlash = Math.max(0, state.shotFlash - dt);
  state.player.invulnerable = Math.max(0, state.player.invulnerable - dt);
  const events = [], p = state.player, hospital = state.chapter === 'hospital';
  const cinematic = ['nina', 'ending'].includes(state.stage);
  if (!cinematic && !state.safeOpen) {
    const x = Number.isFinite(input.moveX) ? clamp(input.moveX, -1, 1) : 0;
    const z = Number.isFinite(input.moveZ) ? clamp(input.moveZ, -1, 1) : 0;
    const length = Math.max(1, Math.hypot(x, z));
    const sprint = !hospital && input.sprint && state.stamina > 0.05 && (x || z);
    state.stamina = clamp(state.stamina + (sprint ? -0.4 : 0.22) * dt, 0, 1);
    const speed = hospital ? 3.5 : sprint ? 5.1 : 3.5;
    const bounds = hospital ? { minX: -9.5, maxX: 9.5, minZ: state.stage === 'barricade' ? -20 : state.stage === 'retreat' ? -9 : -5.2, maxZ: state.stage === 'barricade' ? -6.6 : 10.5 }
      : { minX: -12, maxX: 12, minZ: -12, maxZ: 12 };
    moveBody(p, x / length * speed * dt, z / length * speed * dt, 0.3,
      hospital ? HOSPITAL_SOLIDS : HOME_SOLIDS, bounds);
    if (Number.isFinite(input.aimX) && Number.isFinite(input.aimZ)) p.yaw = Math.atan2(input.aimX - p.x, input.aimZ - p.z);
    else if (x || z) p.yaw = Math.atan2(x, z);
  }
  const armed = (hospital && state.stage === 'doctor') || (!hospital && state.weapon);
  const target = hospital ? state.doctor : state.spider;
  if (!cinematic && armed && input.shoot && state.cooldown === 0 && target.hp > 0 && !state.safeOpen) {
    state.cooldown = 0.24; state.shotFlash = 0.07; events.push({ type: 'shot', x: p.x, z: p.z });
    const dx = target.x - p.x, dz = target.z - p.z, distance = Math.hypot(dx, dz);
    const alignment = (dx * Math.sin(p.yaw) + dz * Math.cos(p.yaw)) / Math.max(0.001, distance);
    if (alignment > Math.cos(hospital ? 0.22 : 0.3)
      && clearLine(p.x, p.z, target.x, target.z, hospital ? HOSPITAL_WALLS : HOME_WALLS)) {
      target.hp = Math.max(0, target.hp - (hospital ? 30 : 38)); target.stun = 0.45;
      events.push({ type: target.hp ? 'hit' : 'kill', x: target.x, z: target.z });
    }
  }
  if (hospital) {
    if (state.stage === 'doctor') {
      const d = state.doctor, dx = p.x - d.x, dz = p.z - d.z, distance = Math.hypot(dx, dz);
      d.yaw = Math.atan2(dx, dz); d.attack = Math.max(0, d.attack - dt);
      if (d.hp <= 0) { state.stage = 'nina'; state.sceneTime = 0; state.message = 'Нина: «Тут, видимо, все с ума сошли…»'; }
      else {
        chaseHome(d, p, 2.05, dt, HOSPITAL_SOLIDS, { minX: -9, maxX: 9, minZ: -5, maxZ: 10 }, 0.3);
        d.yaw = Math.atan2(dx, dz);
        if (distance < 1.05 && d.attack === 0) { damage(state, 24, events, 'doctor'); d.attack = 1; }
      }
    } else if (state.stage === 'nina') {
      if (state.sceneTime > 2.2 && state.sceneTime - dt <= 2.2) events.push({ type: 'lose', x: 0, z: 0 });
      if (state.sceneTime > 2.2) state.message = 'Слишком поздно. Огромный паук схватил Нину. К служебной двери — сейчас!';
      if (state.sceneTime >= 6.4) { state.stage = 'retreat'; state.sceneTime = 0; state.spider.x = 3; state.spider.z = -2;
        state.message = 'Нина исчезла в пасти. Бегите через северный проём и нажмите E с другой стороны двери.'; }
    } else if (state.stage === 'retreat') {
      const s = state.spider, dx = p.x - s.x, dz = p.z - s.z, distance = Math.hypot(dx, dz); s.yaw = Math.atan2(dx, dz);
      chaseHome(s, p, 1.65, dt, HOSPITAL_SOLIDS, { minX: -9, maxX: 9, minZ: -8, maxZ: 10 }, 0.8);
      if (distance < 1.6) damage(state, 28, events);
      if (input.interact) sequelUse(state);
    } else if (state.stage === 'barricade') {
      const before = state.door; state.door = Math.max(0, 100 - state.sceneTime * 5);
      if (Math.floor(before / 9) !== Math.floor(state.door / 9)) events.push({ type: 'hurt', x: 0, z: -6 });
      for (const [cue, clip] of [[0.15, 'radio-run'], [1.25, 'radio-spider'], [2.4, 'radio-end']]) {
        if (state.sceneTime >= cue && state.sceneTime - dt < cue) events.push({ type: 'radio', clip, x: 0, z: 0 });
      }
      const index = Math.min(2, Math.floor(state.sceneTime / 1.2)); state.radioIndex = index;
      state.message = `Рация: «${RADIO_BROKEN[index]}» Помехи. Нужна помощь. Выход — в конце коридора.`;
      if (p.z < -18) { state.complete = true; state.message = 'Я выбрался через служебный ход. Дома есть аптечка и сейф. Я иду туда, не разобрав предупреждение рации.'; }
      else if (state.door <= 0) { state.lost = true; state.deathCause = 'spider'; state.deathTime = 0; state.message = 'Дверь не выдержала. Вы не успели покинуть коридор.'; events.push({ type: 'lose', x: 0, z: 0 }); }
    }
  } else if (state.stage === 'hunt') {
    const s = state.spider; s.stun = Math.max(0, s.stun - dt);
    if (s.hp > 0) {
      // The spider sleeps for the first seconds, then hunts at walking pace (the player outruns it);
      // while the safe keypad is open it crawls, so there is time to type the ten digits.
      const awake = state.time > HOME_SPIDER_WAKE;
      if (awake) chaseHome(s, p, s.stun > 0 ? .45 : state.safeOpen ? .55 : 2.05, dt, HOME_SOLIDS, { minX: -12, maxX: 12, minZ: -12, maxZ: 12 });
      if (awake && near(p, s.x, s.z, 1.35)) damage(state, 20, events, 'spider', 1.8);
    } else {
      state.safeOpen = false;
      state.message = 'Паук мёртв. Рана горит, трудно дышать. Срочно в больницу — входная дверь на юге.';
      if (near(p, HOME_EXIT.x, HOME_EXIT.z, 1.5) && input.interact) { state.stage = 'ending'; state.sceneTime = 0; }
    }
    if (input.interact) sequelUse(state);
  } else if (state.stage === 'ending') {
    const t = state.sceneTime;
    state.message = t < 4 ? 'Другая больница. В приёмной очередь. «Пожалуйста, мне срочно… рана…»'
      : t < 8 ? '«Проходите. Вам сейчас нужнее». Люди расступаются, пропуская вас к доктору.'
        : t < 11 ? 'Дверь кабинета закрывается. КРИК.'
          : t < 15 ? 'Я просыпаюсь в своей комнате. Глубокая ночь. Это был сон?..' : '…';
    if (t >= 8.8 && t - dt < 8.8) events.push({ type: 'scream', x: 0, z: 0 });
    if (t >= 15 && t - dt < 15) events.push({ type: 'lose', x: 0, z: 0 });
    if (t >= 17) { state.complete = true; state.message = 'КОНЕЦ. Ночь не закончилась.'; }
  }
  return events;
}
