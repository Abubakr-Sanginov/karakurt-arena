import './style.css';
import { createCampaignGame, stepCampaign, advanceCampaign, nearestInfected, calmNearbyInfected } from './simulation.js';
import { CAMPAIGN } from './campaignData.js';
import { createView } from './view.js';
import { createAudio } from './audio.js';
import { VIEW_MODES, normalizeViewMode } from './viewModes.js';
import { CUTSCENES, subtitleAt, cutsceneCues, cutsceneDuration, cutsceneChoiceAt, cutsceneChoiceOptions } from './cutsceneData.js';
import { PEOPLE, namesOf, meetLine, calmLine, personInfo, WHISPERS, sanityLoss, CALM_PROMPT, cureParagraphs, outroNotes, journalLines, peacefulEnding, POLICE_ENDINGS, POLICE_CHOICES } from './story.js';

const byId = (id) => document.getElementById(id);
const canvas = byId('game-canvas');
const menu = byId('menu');
const hud = byId('hud');
const campaignPanel = byId('campaign-panel');
const campaignContinue = byId('campaign-continue');
const pauseMenu = byId('pause-menu');
const result = byId('result');
const startButton = byId('start-button');
const viewPicker = byId('view-picker');
const viewContinue = byId('view-continue');
const viewOptions = [...document.querySelectorAll('[data-view-mode]')];
const pauseButton = byId('pause-button');
const resumeButton = byId('resume-button');
const muteButton = byId('mute-button');
const notice = byId('wave-notice');
const number = new Intl.NumberFormat('ru-RU');
const MUTE_KEY = 'karakurt.audio.muted';
const VIEW_KEY = 'karakurt.viewMode';
const PRESENTATION_DURATION = { death: 3, victory: 8.5 };
const emptyPresentation = () => ({ kind: 'none', time: 0, duration: 0 });
let state = createCampaignGame({ seed: 1 });
let phase = 'menu';
let pausedPhase = 'playing';
let presentation = emptyPresentation();
let queuedEvents = [];
let view;
let audio;
let previousFrame = null;
let frameId = 0;
let noticeRemaining = 0;
let hurtRemaining = 0;
let announcedWave = '';
let failed = false;
let muted = false;
let selectedViewMode = 'third';
let lastPointerUnlock = -Infinity;
const gameMode = 'campaign';   // the saved-game format still records it; there is only one mode
let dreadRemaining = 7;
// Loaded only after the original three-map campaign; no save format or camera preference changes.
let dawnModule = null;
let dawnState = null;
let dawnLoading = false;
let dawnAction = false;
let resultCanContinue = false;
let sequelModule = null;
let sequelState = null;
let sequelLoading = false;
let safeWasOpen = false;
let progressModule = null, progressStore = null, savedProgress = null;
let startRequest = null, progressLoading = false, saveElapsed = 0;
const isDawn = () => dawnState !== null;
const effectiveViewMode = () => selectedViewMode;

const currentMap = () => CAMPAIGN[state.campaign.mapIndex];
const hasFocus = () => !document.hidden && document.hasFocus();

try { muted = localStorage.getItem(MUTE_KEY) === 'true'; } catch { /* Storage is optional. */ }
try { selectedViewMode = normalizeViewMode(localStorage.getItem(VIEW_KEY)); } catch { /* Storage is optional. */ }
try { audio = createAudio(); } catch { /* Silent play is supported without WebAudio. */ }

function updateViewChoice() {
  const activeMode = effectiveViewMode();
  for (const button of viewOptions) {
    const selected = button.dataset.viewMode === activeMode;
    button.setAttribute('aria-pressed', String(selected));
    button.classList.toggle('view-picker__option--selected', selected);
    button.querySelector('.view-picker__status').textContent = selected ? 'Выбрано' : 'Выбрать';
  }
  const mode = VIEW_MODES.find(({ id }) => id === activeMode);
  byId('view-choice-hint').textContent = `${mode.label}. Бой начнётся только после вступления и подтверждения.`;
  byId('view-hud-label').textContent = mode.label;
  byId('view-control-hint').textContent = activeMode === 'first'
    ? 'Клик — захват мыши · Мышь или стрелки — обзор · Esc — освободить и пауза'
    : 'Мышь — прицел по полу · WASD / стрелки — движение';
  document.body.dataset.viewMode = activeMode;
  document.body.dataset.gameMode = gameMode;
  canvas.setAttribute('aria-label', activeMode === 'first'
    ? 'От первого лица. Клик — захват мыши; мышь — обзор; WASD или стрелки — движение; ЛКМ или пробел — огонь; Escape — пауза.'
    : `${mode.label}. WASD или стрелки — движение; мышь — прицел по полу; ЛКМ или пробел — огонь; Escape — пауза.`);
}

function selectViewMode(value) {
  selectedViewMode = normalizeViewMode(value);
  try { localStorage.setItem(VIEW_KEY, selectedViewMode); } catch { /* Optional preference only. */ }
  view?.setViewMode(effectiveViewMode());
  updateViewChoice();
}

function openViewPicker() {
  if (!view || failed) return;
  resetView();
  setPhase('view-picker');
  viewOptions.find((button) => button.dataset.viewMode === effectiveViewMode())?.focus({ preventScroll: true });
}

// Audio failures must never stop the simulation or block a user action.
function audioCall(method, ...args) {
  try { return Promise.resolve(audio?.[method](...args)).catch(() => {}); }
  catch { return Promise.resolve(); }
}

function setVisible(element, visible) {
  element.classList.toggle('is-hidden', !visible);
  element.setAttribute('aria-hidden', String(!visible));
  element.inert = !visible;
}

function saveCheckpoint() {
  if (!progressStore || !progressModule || presentation.kind === 'cutscene') return;
  const payload = progressModule.progressPayload({ state, phase, pausedPhase, presentation, mode: gameMode, dawn: dawnState, sequel: sequelState });
  if (!payload) return;
  const outcome = progressStore.write(payload);
  if (outcome.ok) {
    savedProgress = payload;
    byId('load-progress').disabled = false;
    byId('save-status').textContent = `Автосохранение · ${progressModule.progressLabel(payload)}`;
  } else byId('save-status').textContent = outcome.error;
}

async function initializeProgress() {
  try {
    progressModule = await import('./progress.js');
    progressStore = progressModule.createProgressStore({ getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value) });
    const loaded = progressStore.read(); savedProgress = loaded.save;
    byId('load-progress').disabled = !savedProgress;
    byId('save-status').textContent = loaded.error || (savedProgress ? `Сохранено · ${progressModule.progressLabel(savedProgress)}` : 'Сохранения пока нет. Прогресс сохраняется автоматически.');
  } catch { byId('save-status').textContent = 'Автосохранение недоступно. Можно играть и выбирать главы без него.'; }
}

async function fulfillStartRequest() {
  if (progressLoading || failed) return;
  const request = startRequest;
  if (!request) return;
  startRequest = null; progressLoading = true; audioCall('unlock');
  try {
    const module = progressModule || await import('./progress.js'); progressModule = module;
    if (phase !== 'view-picker') return;
    view.setHorrorMode(false); view.setViewMode(effectiveViewMode());
    audioCall('setHorrorMode', false);
    dawnState = null; sequelState = null; safeWasOpen = false; queuedEvents = []; announcedWave = '';
    setVisible(byId('safe-panel'), false); setVisible(byId('code-journal'), false);
    presentation = emptyPresentation(); pausedPhase = 'playing'; dawnAction = false;
    if (request.type === 'load') {
      const save = request.save;
      if (!module.validProgress(save)) throw new Error('Invalid saved progress');
      state = structuredClone(save.state);
      const extra = module.restoreExtra(structuredClone(save));
      if (save.kind === 'dawn') { dawnModule = await import('./afterDawn.js'); dawnState = extra; }
      if (save.kind === 'hospital' || save.kind === 'home') {
        sequelModule = await import('./sequelFlow.js'); sequelState = extra; audioCall('setHorrorMode', true);
      }
      presentation = { ...save.presentation, ...(dawnState ? {journey:dawnState} : {}), ...(sequelState ? {sequel:sequelState} : {}) };
      resetView();
      if (save.phase === 'story') {
        if (sequelState) showSequelStory();
        else if (dawnState) showDawnStory();
        else showStory();
      } else if (save.phase === 'result') finishGame();
      else {
        pausedPhase = save.phase; setPhase('paused');
        byId('pause-description').textContent = 'Сохранение загружено. Нажмите «Продолжить», когда будете готовы.';
        resumeButton.focus({ preventScroll: true });
      }
    } else {
      const chapter = request.chapter;
      state = module.campaignAt(chapter <= 3 ? chapter : 3, chapter > 3);
      if (chapter <= 3) showStory();
      else if (chapter === 4) {
        dawnModule = await import('./afterDawn.js'); dawnState = dawnModule.createAfterDawn();
        presentation = {kind:'victory',time:8.5,duration:8.5,journey:dawnState}; audioCall('setHorrorMode',false); showDawnStory();
      } else {
        sequelModule = await import('./sequelFlow.js');
        sequelState = sequelModule.createSequel(chapter === 5 ? 'hospital' : 'home');
        presentation = {kind:'victory',time:8.5,duration:8.5,sequel:sequelState}; audioCall('setHorrorMode',true); showSequelStory();
      }
    }
    updateHud();
  } catch (error) {
    console.error('[Каракурт] Загрузка прогресса:', error);
    byId('save-status').textContent = 'Не удалось загрузить точку. Выберите главу или начните новую игру.'; returnToMenu();
  } finally { progressLoading = false; }
}

function showSequelStory() {
  const story = sequelModule.chapterStory(sequelState.chapter);
  byId('campaign-eyebrow').textContent = story.eyebrow; byId('campaign-title').textContent = story.title;
  byId('campaign-text').replaceChildren(...story.paragraphs.map(text => { const p = document.createElement('p'); p.textContent = text; return p; }));
  campaignContinue.textContent = sequelState.chapter === 'hospital' ? 'Войти в больницу →' : 'Открыть дверь дома →';
  campaignPanel.dataset.stage = sequelState.chapter; resetView(); setPhase('story'); focusPhase();
}
function showDawnStory() {
  byId('campaign-eyebrow').textContent = 'ЭТАП II · ЗА СТЕНАМИ КАРАНТИНА'; byId('campaign-title').textContent = 'Связь на рассвете';
  byId('campaign-text').replaceChildren(...dawnModule.DAWN_INTRO.map(text => { const p = document.createElement('p'); p.textContent = text; return p; }));
  campaignContinue.textContent = 'Войти во двор →'; campaignPanel.dataset.stage = 'dawn'; resetView(); setPhase('story'); focusPhase();
}

function setPhase(next) {
  phase = next;
  document.body.dataset.screen = next;
  const hasHud = next === 'playing' || next === 'presentation'
    || (next === 'paused' && pausedPhase !== 'story');
  setVisible(menu, next === 'menu');
  setVisible(viewPicker, next === 'view-picker');
  setVisible(hud, hasHud);
  setVisible(campaignPanel, next === 'story');
  setVisible(pauseMenu, next === 'paused');
  setVisible(result, next === 'result');
  hud.inert = next !== 'playing' && next !== 'presentation';
  canvas.inert = next !== 'playing';
  canvas.setAttribute('aria-hidden', String(next !== 'playing' && next !== 'presentation'));
  const dawnButton = byId('dawn-interact');
  setVisible(dawnButton, (isDawn() || Boolean(sequelState)) && next === 'playing');
  document.body.dataset.journey = isDawn() || sequelState ? 'dawn' : 'campaign';
  document.body.dataset.chapter = sequelState?.chapter || '';
  if (sequelState) updateSequelUi();
  else if (dawnState) updateDawnHud();
  previousFrame = null;
  if (next !== 'playing') {
    setVisible(notice, false);
    document.body.classList.remove('is-hurt');
  }
  saveCheckpoint();
}

function resetView() {
  view?.reset();
  // reset() also clears outcome effects; restoring the held presentation keeps
  // pause/blur from losing a completed portion of the death or victory pose.
  view?.setPresentation(presentation);
}

function focusPhase() {
  const target = phase === 'playing' ? canvas
    : phase === 'story' ? campaignContinue
      : phase === 'presentation' ? pauseButton : null;
  target?.focus({ preventScroll: true });
}

function updateMute() {
  muteButton.setAttribute('aria-pressed', String(muted));
  muteButton.setAttribute('aria-label', muted ? 'Включить звук' : 'Выключить звук');
  byId('mute-label').textContent = muted ? 'Звук: выкл.' : 'Звук: вкл.';
  audioCall('setMuted', muted);
}

function updateDawnHud() {
  if (!dawnState || !dawnModule) return;
  const target = dawnModule.dawnObjective(dawnState);
  const ready = dawnModule.dawnCanUse(dawnState);
  byId('map-label').textContent = 'ЭТАП II · СВЯЗЬ НА РАССВЕТЕ';
  byId('wave-value').textContent = `${Math.min(dawnState.step, 3)} / 3`;
  byId('wave-status').textContent = dawnState.step >= 3 ? 'Пройдите за ворота' : target.title;
  byId('dodge-label').textContent = dawnState.step >= 3 ? 'Путь открыт' : `До цели: ${Math.ceil(Math.hypot(dawnState.x - target.x, dawnState.z - target.z))} м`;
  byId('dodge-fill').style.transform = `scaleX(${dawnState.step / 3})`;
  const dawnView = VIEW_MODES.find(({ id }) => id === effectiveViewMode());
  byId('view-hud-label').textContent = `${dawnView.label} · WASD — идти${effectiveViewMode() === 'first' ? ' · Клик — захват мыши, мышь или стрелки — обзор' : ''} · E — действие`;
  byId('view-control-hint').textContent = dawnState.message;
  const button = byId('dawn-interact');
  button.disabled = !ready;
  button.textContent = dawnState.step >= 3 ? 'Идите за ворота' : ready ? `${target.action} · E` : `${target.title} · подойдите ближе`;
  canvas.setAttribute('aria-label', 'Этап II, двор. WASD или стрелки — идти; E — взаимодействовать рядом с целью; Escape — пауза.');
}

function updateSequelUi() {
  if (!sequelState || !sequelModule) return;
  sequelModule.updateSequelHud(sequelState);
  const open = phase === 'playing' && sequelState.safeOpen && !sequelState.lost;
  setVisible(byId('safe-panel'), open);
  setVisible(byId('code-journal'), sequelState.chapter === 'home');
  if (open && !safeWasOpen) {
    byId('safe-code').value = '';
    byId('safe-error').textContent = '';
    byId('safe-code').focus({ preventScroll: true });
  }
  safeWasOpen = open;
}

/**
 * The story after the courtyard when the hero has killed infected people: a drive that ends badly,
 * the nightmare at home and the police station. Everything is a cutscene; it ends on a result screen.
 */
function startMadnessEnding() {
  const kills = Math.min(6, state.infectedKills || 1);
  const chain = ['madness-drive', 'madness-home', 'madness-police'];
  // One options object for the whole chain: the police scene writes the player's answer into it.
  const options = { kills, names: namesOf(state.infectedDead), branch: null, flags: { wifeDead: state.infectedDead.includes('ward-patient-east') } };
  // Each scene may end on a question; its answer is read here and cleared so the next scene can ask its own.
  const next = (index, answer = null) => {
    if (index === 2 && answer === 'call') { showMadnessEnding('call'); return; }
    if (index < chain.length) {
      startCutscene(chain[index], () => { const given = options.branch; options.branch = null; next(index + 1, given); }, options);
    } else showMadnessEnding(answer ?? 'gun');
  };
  next(0);
}
function showJournal(lines) {
  const list = byId('result-journal');
  list.replaceChildren(...lines.map((text) => { const item = document.createElement('li'); item.textContent = text; return item; }));
  setVisible(list, lines.length > 0);
}
function showMadnessEnding(branch = 'gun') {
  sequelState = null;
  const ending = POLICE_ENDINGS[branch] ?? POLICE_ENDINGS.gun;
  byId('result-eyebrow').textContent = ending.eyebrow;
  byId('result-title').textContent = ending.title;
  byId('result-description').textContent = ending.text;
  showJournal(journalLines({ met: [...metPeople], dead: state.infectedDead, spared: state.infectedSpared || [] }));
  hideStoryOverlays();
  byId('result-score').textContent = number.format(state.score);
  byId('result-kills').textContent = number.format(state.kills);
  byId('result-wave').textContent = 'Конец';
  byId('result-time').textContent = '—';
  setVisible(byId('sequel-teaser'), false);
  setVisible(byId('dawn-continue'), false);
  setVisible(byId('chapter-retry'), false);
  resultCanContinue = false;
  resetView();
  setPhase('result');
  focusPhase();
}

async function openSequelStory(chapter) {
  if (sequelLoading || failed || phase !== 'result') return;
  sequelLoading = true;
  const button = byId('dawn-continue'); button.disabled = true;
  const expectedState = sequelState;
  const retry = Boolean(sequelState?.lost);
  if (chapter === 'hospital' && !retry && (state.infectedKills || 0) > 0) {
    sequelLoading = false; button.disabled = false;
    startMadnessEnding();
    return;
  }
  audioCall('unlock');
  try {
    const module = await import('./sequelFlow.js');
    if (phase !== 'result' || sequelState !== expectedState) return;
    sequelModule = module;
    const story = module.chapterStory(chapter);
    sequelState = story.state; dawnState = null; safeWasOpen = false;
    presentation = { kind: 'victory', time: 8.5, duration: 8.5, sequel: sequelState };
    audioCall('silence'); audioCall('setHorrorMode', true);
    byId('campaign-eyebrow').textContent = story.eyebrow;
    byId('campaign-title').textContent = story.title;
    const paragraphs = chapter === 'hospital' ? [...story.paragraphs, ...cureParagraphs((state.infectedSpared || []).length)] : story.paragraphs;
    byId('campaign-text').replaceChildren(...paragraphs.map(text => {
      const paragraph = document.createElement('p'); paragraph.textContent = text; return paragraph;
    }));
    campaignContinue.textContent = chapter === 'hospital' ? 'Войти в больницу →' : 'Открыть дверь дома →';
    campaignPanel.dataset.stage = chapter;
    const showCard = () => { resetView(); setPhase('story'); focusPhase(); };
    if (chapter === 'hospital' && !retry) startCutscene('car-ride', showCard); else showCard();
  } catch (error) {
    console.error('[Каракурт] Ошибка загрузки главы:', error);
    byId('result-description').textContent = 'Глава не загрузилась. Нажмите продолжение ещё раз.';
  } finally { sequelLoading = false; button.disabled = false; }
}

async function openDawnStory() {
  if (sequelState?.complete && sequelState.chapter === 'hospital') return openSequelStory('home');
  if (dawnState?.complete) return openSequelStory('hospital');
  if (dawnLoading || failed) return;
  dawnLoading = true;
  const button = byId('dawn-continue');
  button.disabled = true;
  button.textContent = 'Загрузка продолжения…';
  audioCall('unlock');
  try {
    const module = await import('./afterDawn.js');
    if (phase !== 'result' || !resultCanContinue) return;
    dawnModule = module;
    dawnState = module.createAfterDawn();
    presentation = { kind: 'victory', time: 8.5, duration: 8.5, journey: dawnState };
    audioCall('silence');
    audioCall('setHorrorMode', false);
    byId('campaign-eyebrow').textContent = 'ЭТАП II · ЗА СТЕНАМИ КАРАНТИНА';
    byId('campaign-title').textContent = 'Связь на рассвете';
    byId('campaign-text').replaceChildren(...module.DAWN_INTRO.map(text => {
      const paragraph = document.createElement('p'); paragraph.textContent = text; return paragraph;
    }));
    campaignContinue.textContent = 'Войти во двор →';
    campaignPanel.dataset.stage = 'dawn';
    resetView();
    setPhase('story');
    focusPhase();
  } catch (error) {
    console.error('[Каракурт] Не удалось загрузить продолжение:', error);
    byId('result-description').textContent = 'Продолжение не загрузилось. Попробуйте ещё раз; результат побега сохранён на этом экране.';
  } finally {
    dawnLoading = false;
    button.disabled = false;
    button.textContent = 'Продолжить · этап II →';
  }
}

function updateHud() {
  if (sequelState) { updateSequelUi(); return; }
  if (isDawn()) { updateDawnHud(); return; }
  const player = state.player;
  const health = Math.max(0, Math.min(player.maxHp, player.hp));
  const ratio = player.maxHp > 0 ? health / player.maxHp : 0;
  byId('health-value').textContent = Math.ceil(health);
  byId('health-meter').setAttribute('aria-valuenow', String(Math.ceil(health)));
  byId('health-meter').setAttribute('aria-valuemax', String(player.maxHp));
  byId('health-fill').style.transform = `scaleX(${ratio})`;
  hud.classList.toggle('hud--critical', ratio <= 0.3);
  const map = currentMap();
  byId('map-label').textContent = `Карта ${state.campaign.mapIndex + 1} / ${CAMPAIGN.length} · волна`;
  byId('map-label').title = map.title;
  byId('wave-value').textContent = `${state.wave} / ${map.waves}`;
  byId('wave-status').textContent = presentation.kind !== 'none'
    ? presentation.kind === 'death' ? 'Связь теряется…' : 'Выход найден.'
    : state.nextWaveIn > 0 ? `Передышка: ${Math.ceil(state.nextWaveIn)} с`
      : `Целей: ${state.enemies.length}`;
  byId('score-value').textContent = number.format(state.score);
  byId('kills-value').textContent = number.format(state.kills);
  const cooldown = Math.max(0, player.dodgeCooldown);
  byId('dodge-label').textContent = cooldown > 0 ? `Рывок: ${cooldown.toFixed(1).replace('.', ',')} с` : 'Рывок готов';
  byId('dodge-fill').style.transform = `scaleX(${Math.max(0, Math.min(1, 1 - cooldown / 2))})`;
}

function announceWave() {
  if (phase !== 'playing' || state.campaign.stage !== 'combat' || state.wave < 1) return;
  const key = `${state.campaign.mapId}:${state.wave}`;
  if (announcedWave === key) return;
  announcedWave = key;
  const map = currentMap();
  noticeRemaining = 2.4;
  byId('notice-title').textContent = `Волна ${state.wave} из ${map.waves}`;
  byId('notice-description').textContent = map.boss && state.wave === map.waves
    ? 'Матка перекрыла выход. Не стойте на месте.'
    : state.wave > 1 ? 'Они стали быстрее. Берегите рывок.' : `${map.title}. Держите дистанцию.`;
  setVisible(notice, true);
}

function showStory() {
  const { mapIndex, stage } = state.campaign;
  const map = currentMap();
  const intro = stage === 'intro';
  const notes = intro ? [] : outroNotes(mapIndex, { spared: state.infectedSpared || [], dead: state.infectedDead || [] });
  byId('campaign-eyebrow').textContent = `ГЛАВА ${mapIndex + 1} / ${CAMPAIGN.length} · ${intro ? 'ВСТУПЛЕНИЕ' : 'ПУТЬ СВОБОДЕН'}`;
  byId('campaign-title').textContent = map.title;
  byId('campaign-text').replaceChildren(...[...(intro ? map.intro : map.outro), ...notes].map((text) => {
    const paragraph = document.createElement('p');
    paragraph.textContent = text;
    return paragraph;
  }));
  campaignContinue.textContent = intro ? 'Начать зачистку →'
    : mapIndex + 1 < CAMPAIGN.length ? 'К следующей карте →' : 'Выйти навстречу рассвету →';
  campaignPanel.dataset.stage = stage;
  noticeRemaining = 0;
  hurtRemaining = 0;
  resetView();
  setPhase('story');
  updateHud();
  focusPhase();
}

function startGame() {
  if (startRequest) { void fulfillStartRequest(); return; }
  if (!view || failed) return;
  view.setHorrorMode(false);
  view.setViewMode(effectiveViewMode());
  audioCall('setHorrorMode', false);
  dreadRemaining = 7;
  dawnState = null;
  sequelState = null;
  safeWasOpen = false;
  setVisible(byId('safe-panel'), false);
  setVisible(byId('code-journal'), false);
  dawnAction = false;
  resultCanContinue = false;
  updateViewChoice();
  state = createCampaignGame({ seed: 1 });
  resetStory();
  presentation = emptyPresentation();
  queuedEvents = [];
  announcedWave = '';
  pausedPhase = 'playing';
  showStory();
  // Unlock inside the click handler; audio must never delay the first story card.
  audioCall('unlock');
}

// ---- The hero's reaction to killing an infected person ----
const bark = byId('bark');
let barkRemaining = 0;
const BARK_FIRST = 'Что я сделал? Нет, нет, нет… Я убил его.';
const BARK_AGAIN = 'Зачем я ещё раз убил? Я с ума схожу?';
function showLine(text, seconds = 5) {
  bark.textContent = text;
  barkRemaining = seconds;
  setVisible(bark, true);
}
function showBark(count, id) {
  const name = PEOPLE[id]?.name ?? '';
  showLine((count <= 1 ? BARK_FIRST : BARK_AGAIN) + (name ? ` (${name})` : ''), 5.2);
}

// ---- Story systems of the combat chapters: who the infected were, calming them, and a mind that slips after a kill ----
let metPeople = new Set();
let epiloguePlayed = false, clinicPlayed = false;
let whisperRemaining = 18;
const sanityOverlay = byId('sanity');
const calmPrompt = byId('calm-prompt');
function hideStoryOverlays() {
  setVisible(sanityOverlay, false); setVisible(calmPrompt, false);
  calmPrompt.textContent = '';
}
function resetStory() {
  metPeople = new Set(); epiloguePlayed = false; clinicPlayed = false; whisperRemaining = 18; hideStoryOverlays();
}
function updateStoryOverlays(dt) {
  const map = currentMap();
  const near = nearestInfected(state, map, 3.4);
  if (near && !metPeople.has(near.id) && barkRemaining <= 0) { metPeople.add(near.id); showLine(meetLine(near.id), 5.5); }
  const reachable = nearestInfected(state, map, 2.6);
  const prompt = reachable ? `${CALM_PROMPT} · ${personInfo(reachable.id).name}` : '';
  if (calmPrompt.textContent !== prompt) { calmPrompt.textContent = prompt; setVisible(calmPrompt, Boolean(prompt)); }
  const loss = sanityLoss(state.infectedKills);
  setVisible(sanityOverlay, loss > 0);
  if (loss > 0) {
    sanityOverlay.style.setProperty?.('--sanity', String(0.3 + 0.6 * loss));
    whisperRemaining -= dt;
    if (whisperRemaining <= 0 && barkRemaining <= 0 && state.infectedDead.length) {
      const dead = state.infectedDead;
      const pick = Math.floor(state.time) % dead.length;
      showLine(WHISPERS[Math.floor(state.time / 7) % WHISPERS.length](personInfo(dead[pick]).name), 4.8);
      audioCall('play', [{ type: 'dread', x: state.player.x, z: state.player.z }]);
      whisperRemaining = 26 - 14 * loss;
    }
  }
}
document.addEventListener('keydown', (event) => {
  if (event.code !== 'KeyE' || event.repeat || phase !== 'playing' || sequelState || isDawn()) return;
  if (['INPUT', 'TEXTAREA', 'BUTTON'].includes(event.target?.tagName)) return;
  const calmed = calmNearbyInfected(state, currentMap());
  if (!calmed) return;
  event.preventDefault();
  showLine(calmLine(calmed.id), 6);
});
function clearBark() { barkRemaining = 0; bark.textContent = ''; setVisible(bark, false); }

// ---- Cutscenes: a timed, skippable scene with subtitles that runs inside the 'presentation' phase ----
let cutsceneDone = null;
const previewParams = typeof URLSearchParams === 'function' && typeof location !== 'undefined'
  ? new URLSearchParams(location.search) : new Map();
const previewHold = previewParams.has('hold');
let cutsceneReturn = null;
const cutsceneSkip = byId('cutscene-skip');
let choiceOpen = false;
const choiceBox = byId('cutscene-choice');
function clearCutsceneUi() {
  delete document.body.dataset.cutscene;
  setVisible(byId('cutscene'), false);
  byId('cutscene-subtitle').textContent = '';
  choiceOpen = false; choiceBox.replaceChildren(); setVisible(choiceBox, false);
}
/** The scene waits here until the player answers; the answer is stored in the scene options (options.branch). */
function openChoice() {
  if (choiceOpen) return;
  choiceOpen = true;
  choiceBox.replaceChildren(...cutsceneChoiceOptions(presentation.id).map(({ id, label }) => {
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = label; button.dataset.choice = id;
    button.addEventListener('click', () => pickChoice(id));
    return button;
  }));
  setVisible(choiceBox, true);
  choiceBox.querySelector('button')?.focus({ preventScroll: true });
}
function pickChoice(id) {
  if (!choiceOpen || presentation.kind !== 'cutscene') return;
  presentation.options.branch = id;
  presentation.duration = cutsceneDuration(presentation.id, presentation.options);
  choiceOpen = false; choiceBox.replaceChildren(); setVisible(choiceBox, false);
  focusPhase();
}
const choicePending = () => presentation.kind === 'cutscene' && cutsceneChoiceAt(presentation.id) !== null && !presentation.options.branch;
function startCutscene(id, done, options = {}) {
  if (!CUTSCENES[id] || !view || failed) { done?.(); return; }
  audioCall('unlock');
  cutsceneDone = done;
  cutsceneReturn = presentation;
  presentation = { kind: 'cutscene', id, time: 0, duration: CUTSCENES[id].duration, options };
  clearBark();
  noticeRemaining = 0; hurtRemaining = 0;
  document.body.dataset.cutscene = id;
  setVisible(byId('cutscene'), true);
  resetView();
  setPhase('presentation');
  updateCutsceneUi();
  focusPhase();
}
function updateCutsceneUi() {
  if (presentation.kind !== 'cutscene') return;
  byId('cutscene-subtitle').textContent = subtitleAt(presentation.id, presentation.time, presentation.options);
}
function endCutscene() {
  if (presentation.kind !== 'cutscene') return;
  const done = cutsceneDone;
  const back = cutsceneReturn ?? emptyPresentation();
  cutsceneDone = null; cutsceneReturn = null;
  clearCutsceneUi();
  presentation = back;
  resetView();
  done?.();
}
function skipCutscene() {
  if (phase !== 'presentation' || presentation.kind !== 'cutscene') return;
  if (choiceOpen) return;
  // A scene with a decision cannot be skipped past it: skipping jumps to the question.
  if (choicePending()) { presentation.time = Math.max(presentation.time, cutsceneChoiceAt(presentation.id)); openChoice(); return; }
  endCutscene();
}
cutsceneSkip.addEventListener('click', skipCutscene);
document.addEventListener('keydown', (event) => {
  if (phase === 'presentation' && presentation.kind === 'cutscene' && !event.repeat && (event.code === 'Enter' || event.code === 'Space')) {
    event.preventDefault(); skipCutscene();
  }
});

function beginPresentation(kind) {
  // Own the terminal cue here, not only in a transient simulation event array.
  // unlock may recover an interrupted device; audio retains only this short-lived cue.
  audioCall('unlock');
  audioCall('play', [{ type: kind === 'death' ? 'lose' : 'win', x: 0, z: 0 }]);
  presentation = { kind, time: 0, duration: PRESENTATION_DURATION[kind] };
  noticeRemaining = 0;
  hurtRemaining = 0;
  resetView();
  setPhase('presentation');
  updateHud();
  focusPhase();
}

function continueCampaign() {
  if (phase !== 'story' || !hasFocus() || failed) return;
  if (sequelState) {
    resetView(); setPhase('playing'); updateSequelUi(); focusPhase(); audioCall('unlock'); return;
  }
  if (isDawn()) {
    resetView();
    setPhase('playing');
    updateDawnHud();
    focusPhase();
    audioCall('unlock');
    return;
  }
  const wasIntro = state.campaign.stage === 'intro';
  advanceCampaign(state);
  if (state.campaign.stage === 'complete') {
    beginPresentation('victory');
  } else if (state.campaign.stage === 'combat') {
    const begin = () => {
      resetView();
      setPhase('playing');
      updateHud();
      announceWave();
      focusPhase();
    };
    const scene = wasIntro ? { 0: 'wake-up', 2: 'boss-intro' }[state.campaign.mapIndex] : null;
    if (scene) startCutscene(scene, begin); else begin();
  } else showStory();
  audioCall('unlock');
}

function pauseGame(automatic = false) {
  if (phase !== 'playing' && phase !== 'presentation' && phase !== 'story') return;
  pausedPhase = phase;
  dawnAction = false;
  resetView();
  noticeRemaining = 0;
  hurtRemaining = 0;
  const ending = pausedPhase === 'presentation';
  byId('pause-description').textContent = automatic
    ? `Окно потеряло фокус. ${ending ? 'Анимация остановлена' : 'Игра остановлена'} — продолжите, когда будете готовы.`
    : ending ? 'Финальная сцена на паузе. После продолжения вы увидите её до конца.'
      : 'Игра на паузе. Переведите дыхание и возвращайтесь.';
  setPhase('paused');
  audioCall('silence');
  if (hasFocus()) resumeButton.focus({ preventScroll: true });
}

function resumeGame() {
  if (phase !== 'paused' || !hasFocus() || failed) return;
  resetView();
  setPhase(pausedPhase);
  focusPhase();
  audioCall('unlock');
}

function returnToMenu() {
  cutsceneDone = null; cutsceneReturn = null;
  if (presentation.kind === 'cutscene') presentation = emptyPresentation();
  clearCutsceneUi();
  saveCheckpoint();
  startRequest = null;
  dawnState = null;
  sequelState = null;
  safeWasOpen = false;
  setVisible(byId('safe-panel'), false);
  setVisible(byId('code-journal'), false);
  dawnAction = false;
  resultCanContinue = false;
  audioCall('setHorrorMode', false);
  updateViewChoice();
  audioCall('silence');
  presentation = emptyPresentation();
  queuedEvents = [];
  resetView();
  state = createCampaignGame({ seed: 1 });
  resetStory();
  noticeRemaining = 0;
  hurtRemaining = 0;
  setPhase('menu');
  startButton.focus({ preventScroll: true });
}

function finishGame() {
  // The peaceful ending first plays its epilogue: morning, Nina, and the people who were calmed.
  if (sequelState?.complete && !sequelState.lost && sequelState.chapter === 'home' && !epiloguePlayed) {
    epiloguePlayed = true;
    const spared = state.infectedSpared || [];
    startCutscene('peace-dawn', finishGame, { kills: 0, names: namesOf(spared), branch: spared.length ? 'mercy' : 'alone', flags: { wifeSpared: spared.includes('ward-patient-east') } });
    return;
  }
  const won = sequelState ? sequelState.complete && !sequelState.lost : state.campaign.stage === 'complete';
  byId('result-eyebrow').textContent = won ? 'ПОБЕДА / ПОБЕГ ЗАВЕРШЁН' : 'ПОРАЖЕНИЕ / СВЯЗЬ ПОТЕРЯНА';
  byId('result-title').textContent = won ? 'Снаружи светает.' : 'Их было больше.';
  resultCanContinue = won && !isDawn() && !sequelState;
  const nextChapter = dawnState?.complete || (sequelState?.complete && sequelState.chapter === 'hospital');
  setVisible(byId('sequel-teaser'), resultCanContinue);
  setVisible(byId('dawn-continue'), resultCanContinue || Boolean(nextChapter));
  byId('dawn-continue').textContent = nextChapter
    ? sequelState ? 'Продолжить · домой →' : 'Продолжить · больница →' : 'Продолжить · этап II →';
  setVisible(byId('chapter-retry'), Boolean(sequelState?.lost));
  byId('result-description').textContent = won
    ? 'Дверь насосной закрылась за спиной. На улице светает, но из рации у поста связи доносится живой голос. Продолжите путь: этап II — «Связь на рассвете».'
    : `Побег оборвался: ${currentMap().title}. Держите дистанцию, обходите препятствия и берегите рывок. Новая попытка начнётся с палаты.`;
  byId('result-score').textContent = number.format(state.score);
  byId('result-kills').textContent = number.format(state.kills);
  byId('result-wave').textContent = `${state.campaign.mapIndex + 1} / ${CAMPAIGN.length}`;
  const seconds = Math.max(0, Math.floor(state.time));
  byId('result-time').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  if (dawnState?.complete) {
    byId('result-eyebrow').textContent = 'ЭТАП II / СВЯЗЬ ВОССТАНОВЛЕНА';
    byId('result-title').textContent = 'Теперь вы не один.';
    byId('result-description').textContent = dawnState.message;
    byId('result-wave').textContent = 'II · 3 / 3';
  }
  if (sequelState) {
    byId('result-eyebrow').textContent = sequelState.lost ? 'ПОБЕГ ОБОРВАЛСЯ' : sequelState.chapter === 'hospital' ? 'БОЛЬНИЦА ПОЗАДИ' : 'КОНЕЦ';
    byId('result-title').textContent = sequelState.lost ? 'Не успели.' : sequelState.chapter === 'hospital' ? 'Домой. Несмотря ни на что.' : 'Ночь не закончилась.';
    byId('result-description').textContent = sequelState.message;
    byId('result-wave').textContent = sequelState.chapter === 'hospital' ? 'III' : 'IV';
  }
  hideStoryOverlays();
  showJournal([]);
  if (sequelState?.complete && !sequelState.lost && sequelState.chapter === 'home') {
    const spared = state.infectedSpared || [];
    const ending = peacefulEnding(spared.length);
    byId('result-title').textContent = ending.title;
    byId('result-description').textContent = `${sequelState.message} ${ending.text}`;
    showJournal(journalLines({ met: [...metPeople], dead: state.infectedDead, spared }));
  }
  result.dataset.outcome = won ? 'won' : 'lost';
  setPhase('result');
  byId('restart-button').focus({ preventScroll: true });
}

function failGame(error) {
  if (failed) return;
  failed = true;
  // Log the original exception before UI/reset work, which can fail independently.
  console.error('[Каракурт] Ошибка игрового экрана:', error);
  cancelAnimationFrame(frameId);
  try { view?.reset(); } catch { /* The renderer may already be unavailable. */ }
  audioCall('silence');
  setPhase('menu');
  startButton.disabled = true;
  const message = byId('error-message');
  message.textContent = error?.code === 'WEBGL_UNAVAILABLE'
    ? 'Браузер не предоставил WebGL 2, необходимый для игры. Проверьте настройки графики браузера или попробуйте другой современный браузер.'
    : error?.code === 'WEBGL_CONTEXT_LOST'
      ? 'Связь с 3D-экраном потеряна. Обновите страницу, чтобы запустить игру заново.'
      : 'Игровой экран остановлен из-за внутренней ошибки. Обновите страницу. Технические подробности записаны в консоли.';
  setVisible(message, true);
}

function frame(now) {
  // Both clocks reset on transitions; neither simulation nor presentation catches up after a hidden tab.
  const dt = previousFrame === null ? 0 : Math.max(0, Math.min(0.05, (now - previousFrame) / 1000));
  previousFrame = now;
  let events = [];
  try {
    if (!hasFocus()) pauseGame(true);
    if (barkRemaining > 0) { barkRemaining -= dt; if (barkRemaining <= 0 || phase !== 'playing') clearBark(); }
    if (phase !== 'playing' && !(sanityOverlay.classList.contains('is-hidden') && calmPrompt.classList.contains('is-hidden'))) hideStoryOverlays();
    if (phase === 'playing' || phase === 'presentation') {
      events = queuedEvents;
      queuedEvents = [];
    }
    if (phase === 'playing' && sequelState) {
      const input = view.sampleJourneyInput(); input.interact ||= dawnAction; dawnAction = false;
      events.push(...sequelModule.stepSequel(sequelState, input, dt));
      audioCall('play', events); updateSequelUi();
      // The last scene of chapter 6 (clinic, the doctor's door, waking in the dark) is a staged cutscene, not the in-engine one.
      if (sequelState.stage === 'ending' && sequelState.chapter === 'home' && !clinicPlayed) {
        clinicPlayed = true;
        startCutscene('clinic-ending', () => { sequelState.complete = true; sequelState.message = 'КОНЕЦ. Ночь не закончилась.'; finishGame(); });
      }
      if (sequelState.complete || (sequelState.lost && sequelState.deathTime >= 3.2)) finishGame();
    } else if (phase === 'playing' && isDawn()) {
      const input = view.sampleJourneyInput();
      input.interact ||= dawnAction;
      dawnAction = false;
      events.push(...dawnModule.stepAfterDawn(dawnState, input, dt));
      audioCall('play', events);
      updateDawnHud();
      if (dawnState.complete) finishGame();
    } else if (phase === 'playing') {
      events.push(...stepCampaign(state, view.sampleInput(), dt));
      for (const event of events) {
        if (event.type === 'infected-kill') { showBark(event.count, event.id); audioCall('play', [{ type: 'dread', x: event.x, z: event.z }]); }
      }
      if (state.status === 'lost') beginPresentation('death');
      else if (state.campaign.stage === 'complete') beginPresentation('victory');
      else if (state.campaign.stage !== 'combat') showStory();
      if (phase === 'playing') {
        announceWave();
        if (events.some((event) => event.type === 'hurt')) hurtRemaining = 0.24;
        hurtRemaining = Math.max(0, hurtRemaining - dt);
        document.body.classList.toggle('is-hurt', hurtRemaining > 0);
        noticeRemaining = Math.max(0, noticeRemaining - dt);
        if (noticeRemaining === 0) setVisible(notice, false);
      }
      if (phase === 'playing') updateStoryOverlays(dt);
      updateHud();
    } else if (phase === 'presentation') {
      // The terminal state is not stepped. Only the unpaused foreground presentation advances.
      const heldTime = presentation.time;
      if (!previewHold && !choiceOpen) presentation.time = Math.min(presentation.duration, presentation.time + dt);
      if (presentation.kind === 'cutscene') {
        const stopAt = choicePending() ? cutsceneChoiceAt(presentation.id) : null;
        if (stopAt !== null && heldTime < stopAt && presentation.time >= stopAt) { presentation.time = stopAt; openChoice(); }
        for (const cue of cutsceneCues(presentation.id, presentation.options)) {
          if (heldTime < cue.at && presentation.time >= cue.at) audioCall('play', [{ type: cue.type, x: 0, z: 0 }]);
        }
      }
    }
    // The presentation owns its cues. Do not replay a simulation finale or
    // overlap the terminal attack with residual combat sounds after resume().
    audioCall('play', presentation.kind === 'none' ? events : []);
    view.setPresentation(presentation);
    view.render(state, events, phase === 'playing' || phase === 'presentation' ? dt : 0);
    // Render the final pose before opening the result, and retain it behind the dialog.
    if (phase === 'presentation' && presentation.kind === 'cutscene') {
      updateCutsceneUi();
      if (presentation.time >= presentation.duration) endCutscene();
    } else if (phase === 'presentation' && presentation.time >= presentation.duration) finishGame();
    if (phase === 'playing' || phase === 'presentation') {
      saveElapsed += dt;
      if (saveElapsed >= 1.5) { saveElapsed = 0; saveCheckpoint(); }
    }
  } catch (error) {
    failGame(error);
    return;
  }
  frameId = requestAnimationFrame(frame);
}

startButton.addEventListener('click', () => { startRequest = null; openViewPicker(); });
byId('load-progress').addEventListener('click', () => {
  if (!savedProgress || failed) return;
  startRequest = { type: 'load', save: structuredClone(savedProgress) }; openViewPicker();
});
byId('chapter-start').addEventListener('click', () => {
  startRequest = { type: 'chapter', chapter: Math.max(1, Math.min(6, Number(byId('chapter-select').value) || 1)) }; openViewPicker();
});
viewContinue.addEventListener('click', startGame);
for (const button of viewOptions) {
  button.addEventListener('click', () => selectViewMode(button.dataset.viewMode));
  button.addEventListener('keydown', (event) => {
    const available = viewOptions.filter((option) => !option.disabled);
    const index = available.indexOf(button);
    let next;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % available.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index + available.length - 1) % available.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = available.length - 1;
    else return;
    event.preventDefault();
    selectViewMode(available[next].dataset.viewMode);
    available[next].focus({ preventScroll: true });
  });
}
// Re-arm WebAudio on real gameplay gestures after autoplay/device interruptions.
canvas.addEventListener('pointerdown', () => { if (phase === 'playing') audioCall('unlock'); });
document.addEventListener('keydown', (event) => {
  if (phase === 'playing' && !event.repeat && !event.ctrlKey && !event.metaKey
    && ['Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight'].includes(event.code)) audioCall('unlock');
});
canvas.addEventListener('karakurt:pointer-unlocked', () => {
  if (phase !== 'playing') return;
  lastPointerUnlock = Date.now();
  pauseGame();
});
byId('dawn-continue').addEventListener('click', openDawnStory);
byId('dawn-interact').addEventListener('click', () => {
  if (phase !== 'playing' || (!isDawn() && !sequelState)) return;
  dawnAction = true;
  audioCall('unlock');
  canvas.focus({ preventScroll: true });
});
byId('chapter-retry').addEventListener('click', () => { if (sequelState?.lost) openSequelStory(sequelState.chapter); });
function closeSafe() {
  if (!sequelState) return;
  sequelState.safeOpen = false; updateSequelUi(); view.reset(); view.setPresentation(presentation);
  canvas.focus({ preventScroll: true });
}
byId('safe-close').addEventListener('click', closeSafe);
byId('safe-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (phase !== 'playing' || !sequelState?.safeOpen) return;
  const opened = sequelModule.sequelUse(sequelState, byId('safe-code').value.trim());
  byId('safe-error').textContent = opened ? '' : sequelState.message;
  updateSequelUi();
  if (opened) { audioCall('play', [{ type: 'wave', x: 0, z: 0 }]); canvas.focus({ preventScroll: true }); }
});
campaignContinue.addEventListener('click', continueCampaign);
resumeButton.addEventListener('click', resumeGame);
pauseButton.addEventListener('click', () => pauseGame());
document.querySelectorAll('[data-action="restart"]').forEach((button) => button.addEventListener('click', startGame));
document.querySelectorAll('[data-action="menu"]').forEach((button) => button.addEventListener('click', returnToMenu));
muteButton.addEventListener('click', () => {
  muted = !muted;
  try { localStorage.setItem(MUTE_KEY, String(muted)); } catch { /* Storage is optional. */ }
  updateMute();
  if (!muted) audioCall('unlock');
  focusPhase();
});

document.addEventListener('keydown', (event) => {
  if (event.code === 'Escape' && !event.repeat) {
    if (phase === 'playing' && sequelState?.safeOpen) { closeSafe(); event.preventDefault(); return; }
    if (phase === 'playing' || phase === 'presentation' || phase === 'story') pauseGame();
    else if (phase === 'paused' && Date.now() - lastPointerUnlock >= 250) resumeGame();
    else if (phase === 'view-picker') returnToMenu();
    else return;
    event.preventDefault();
  }
  // Keep keyboard focus inside an open story, pause, or result dialog.
  if (event.key === 'Tab' && ['view-picker', 'story', 'paused', 'result'].includes(phase)) {
    const dialog = phase === 'view-picker' ? viewPicker
      : phase === 'story' ? campaignPanel : phase === 'paused' ? pauseMenu : result;
    const buttons = [...dialog.querySelectorAll('button:not(:disabled), input:not(:disabled)')]
      .filter((element) => !element.closest('.is-hidden, [inert]'));
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
      last.focus();
      event.preventDefault();
    } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
      first.focus();
      event.preventDefault();
    }
  }
});

function handleFocusLoss() {
  previousFrame = null;
  if (phase === 'playing' || phase === 'presentation' || phase === 'story') pauseGame(true);
  else resetView();
}

window.addEventListener('blur', handleFocusLoss);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) handleFocusLoss();
});
canvas.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  failGame(Object.assign(new Error('WebGL context lost'), { code: 'WEBGL_CONTEXT_LOST' }));
});
window.addEventListener('pagehide', (event) => {
  saveCheckpoint();
  if (event.persisted) { pauseGame(true); return; }
  cancelAnimationFrame(frameId);
  view?.dispose();
  audioCall('dispose');
});

byId('stranger-button').addEventListener('click', () => { if (phase === 'menu') startCutscene('stranger', returnToMenu); });
// Secret ending: click the SHARROWKIN credit in the menu footer. A joke ending, nothing is stored.
{
  const secret = byId('secret'), line = byId('secret-line'), found = byId('secret-found'), back = byId('secret-back');
  let timers = [];
  const close = () => { timers.forEach((id) => globalThis.clearTimeout?.(id)); timers = []; setVisible(secret, false); line.textContent = ''; found.textContent = ''; back.classList.remove('is-ready'); byId('secret-link').focus?.(); };
  byId('secret-link').addEventListener('click', () => {
    if (phase !== 'menu') return;
    audioCall('silence');
    line.textContent = ''; found.textContent = '';
    setVisible(secret, true);
    const speech = 'Sharrowkin: «Твой проект не принят, и Jam отменён. Я захватил доступ к компьютеру админа, и теперь я хозяин. Ты ничего не получишь».';
    let shown = 0;
    const type = () => {
      shown = Math.min(speech.length, shown + 2);
      line.textContent = speech.slice(0, shown);
      if (shown < speech.length) timers.push(globalThis.setTimeout(type, 55));
      else {
        timers.push(globalThis.setTimeout(() => { found.textContent = 'Вы открыли секретную концовку'; }, 900));
        timers.push(globalThis.setTimeout(() => back.classList.add('is-ready'), 2200));
      }
    };
    timers.push(globalThis.setTimeout(type, 1200));
    back.focus?.();
  });
  back.addEventListener('click', close);
  document.addEventListener('keydown', (event) => { if (event.code === 'Escape' && secret.classList.contains('is-hidden') === false) close(); });
}

setPhase('menu');
updateMute();
updateViewChoice();
void initializeProgress();
try {
  view = createView(canvas);
  view.setViewMode(selectedViewMode);
  frameId = requestAnimationFrame(frame);
} catch (error) {
  failGame(error);
}

// Preview helper: open the page with ?cutscene=wake-up | boss-intro | car-ride to watch a scene directly.
{
  // ?madness=3 plays the whole bad ending as if three infected had been killed.
  const madness = Number(previewParams.get('madness'));
  if (madness > 0) requestAnimationFrame(() => {
    state.infectedKills = madness; state.infectedDead = Object.keys(PEOPLE).slice(0, madness);
    startMadnessEnding();
  });
  const preview = previewParams.get('cutscene');
  if (preview && CUTSCENES[preview]) requestAnimationFrame(() => {
    const kills = Number(previewParams.get('kills')) || 1;
    startCutscene(preview, returnToMenu, { kills, names: namesOf(Object.keys(PEOPLE), kills), branch: previewParams.get('branch') || null });
    const at = Number(previewParams.get('t'));
    if (Number.isFinite(at) && at > 0) presentation.time = Math.min(at, cutsceneDuration(preview, presentation.options));
  });
}
