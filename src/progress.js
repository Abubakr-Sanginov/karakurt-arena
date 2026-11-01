import { CAMPAIGN } from './campaignData.js';
import { createAfterDawn } from './afterDawn.js';
import { createSequel } from './sequel.js';
export { campaignAt } from './progressSession.js';
export { progressPayload } from './progressPayload.js';
const KEY = 'karakurt.progress.v1';
const number = (value, min = -1000, max = 100000000) => Number.isFinite(value) && value >= min && value <= max;
const numericShape = (value, template) => value && Object.entries(template).every(([key, item]) =>
  typeof item === 'number' ? number(value[key]) : typeof item === 'boolean' ? typeof value[key] === 'boolean' : true);
const point = value => value && number(value.x, -1000, 1000) && number(value.z, -1000, 1000);
const stages = ['doctor', 'nina', 'retreat', 'barricade', 'hunt', 'ending'];
/** localStorage is untrusted: reject malformed/outdated saves instead of feeding them into simulation. */
export function validProgress(save) {
  if (!save || save.version !== 1 || !['campaign', 'horror'].includes(save.mode)
    || !['campaign', 'dawn', 'hospital', 'home'].includes(save.kind)
    || !['story', 'playing', 'presentation', 'result'].includes(save.phase) || !number(save.savedAt, 0, 1e16)) return false;
  const state = save.state;
  if (!state || !point(state.player) || !number(state.time, 0, 1e9)
    || !number(state.score, 0) || !number(state.kills, 0) || !number(state.wave, 1, 3)
    || !number(state.campaignSeed) || !number(state.campaignMapTime, 0) || !number(state.nextWaveIn, 0, 10)
    || !['playing', 'won'].includes(state.status) || !Array.isArray(state.enemies) || state.enemies.length > 100
    || !Array.isArray(state.projectiles) || state.projectiles.length > 250) return false;
  const playerKeys = ['yaw', 'hp', 'maxHp', 'fireCooldown', 'dodgeCooldown', 'invulnerable'];
  if (!playerKeys.every(key => number(state.player[key])) || state.player.hp <= 0 || state.player.hp > 100 || state.player.maxHp !== 100) return false;
  const campaign = state.campaign, map = CAMPAIGN[campaign?.mapIndex];
  if (!Number.isInteger(campaign?.mapIndex) || !map || campaign.mapId !== map.id
    || !['intro','combat','outro','complete'].includes(campaign.stage)) return false;
  if (save.kind === 'campaign' && (Math.abs(state.player.x) > map.arena.halfWidth
    || Math.abs(state.player.z) > map.arena.halfDepth)) return false;
  if (campaign.stage === 'complete' && (campaign.mapIndex !== 2 || state.status !== 'won')) return false;
  if (save.kind !== 'campaign' && campaign.stage !== 'complete') return false;
  if (!state.enemies.every(e => point(e) && ['normal','runner','tank','boss'].includes(e.variant)
    && ['id','yaw','hp','maxHp'].every(k => number(e[k])) && e.hp > 0 && e.maxHp <= 650)) return false;
  if (!state.projectiles.every(p => point(p) && ['id','dx','dz','life'].every(k => number(p[k])))) return false;
  if (save.kind === 'dawn') {
    const dawn = save.extra;
    if (!numericShape(dawn, createAfterDawn()) || !point(dawn) || !Number.isInteger(dawn.step) || dawn.step < 0 || dawn.step > 3
      || dawn.gate < 0 || dawn.gate > 1 || typeof dawn.message !== 'string' || dawn.message.length > 2000) return false;
  } else if (save.kind === 'hospital' || save.kind === 'home') {
    const extra = save.extra, template = createSequel(save.kind);
    if (!numericShape(extra,template) || extra.chapter !== save.kind || !stages.includes(extra.stage)
      || !numericShape(extra.player,template.player) || !point(extra.player) || extra.player.hp <= 0 || extra.player.hp > 100
      || !numericShape(extra.spider,template.spider) || !point(extra.spider)
      || !numericShape(extra.doctor,template.doctor) || !point(extra.doctor)
      || !Array.isArray(extra.notes) || extra.notes.length > 5 || !extra.notes.every(id=>Number.isInteger(id)&&id>=0&&id<5)
      || new Set(extra.notes).size !== extra.notes.length
      || typeof extra.deathCause !== 'string' || !['', 'doctor', 'spider'].includes(extra.deathCause)
      || (save.kind === 'hospital' ? !['doctor','nina','retreat','barricade'].includes(extra.stage) : !['hunt','ending'].includes(extra.stage))
      || Math.abs(extra.player.x) > 12 || extra.player.z < (save.kind === 'hospital' ? -20 : -12) || extra.player.z > 12
      || extra.spider.hp < 0 || extra.spider.hp > 300 || extra.doctor.hp < 0 || extra.doctor.hp > 90
      || extra.door < 0 || extra.door > 100 || extra.stamina < 0 || extra.stamina > 1
      || typeof extra.message !== 'string' || extra.message.length > 2000 || extra.lost) return false;
  }
  const presentation = save.presentation;
  return presentation && ['none','victory'].includes(presentation.kind) && number(presentation.time,0,30)
    && number(presentation.duration,0,30) && presentation.time <= presentation.duration;
}
export function createProgressStore(storage) {
  return {
    read() {
      try {
        const raw = storage.getItem(KEY);
        if (!raw) return { save: null, error: '' };
        if (raw.length > 250000) return { save: null, error: 'Сохранение слишком большое.' };
        const save = JSON.parse(raw);
        return validProgress(save) ? { save, error: '' } : { save: null, error: 'Сохранение повреждено или относится к другой версии.' };
      } catch { return { save: null, error: 'Не удалось прочитать сохранение. Игра доступна без него.' }; }
    },
    write(save) {
      if (!validProgress(save)) return { ok: false, error: 'Текущий кадр не сохранён; предыдущая точка продолжения не изменена.' };
      try { storage.setItem(KEY, JSON.stringify(save)); return { ok: true, error: '' }; }
      catch { return { ok: false, error: 'Браузер запретил сохранение или хранилище заполнено.' }; }
    },
  };
}
export function progressLabel(save) {
  return save.kind === 'campaign' ? `Глава ${save.state.campaign.mapIndex+1} · ${CAMPAIGN[save.state.campaign.mapIndex].title}`
    : save.kind === 'dawn' ? 'Глава 4 · Связь на рассвете' : save.kind === 'hospital' ? 'Глава 5 · Больница' : 'Глава 6 · Дом';
}
export function restoreExtra(save) {
  if (save.kind === 'campaign') return null;
  const extra = Object.assign(save.kind === 'dawn' ? createAfterDawn() : createSequel(save.kind), save.extra);
  if (save.kind === 'dawn') extra.stops = createAfterDawn().stops;
  else { extra.safeOpen = false; extra.spider.route = []; extra.spider.goal = -1; }
  return extra;
}
