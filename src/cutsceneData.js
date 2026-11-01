// Cutscene timing and subtitles. Pure data: no Three.js, DOM or clocks, so main.js can read it without loading any 3D code.
export const CUTSCENES = Object.freeze({
  'wake-up': Object.freeze({
    duration: 15,
    subtitles: Object.freeze([
      { from: 2.4, to: 5.6, text: 'Холодный пол. Гудит аварийный свет. Где я?..' },
      { from: 6.0, to: 9.0, text: 'Рядом люди. Те самые, с кем я пережил ночь. Они не отвечают.' },
      { from: 9.6, to: 12.6, text: 'Что-то скребётся за дверью. Надо вставать.' },
      { from: 12.8, to: 14.8, text: 'Карабин всё ещё здесь. Хорошо.' },
    ]),
  }),
  'boss-intro': Object.freeze({
    duration: 14,
    subtitles: Object.freeze([
      { from: 0.8, to: 3.8, text: 'Насосы замолкли. Слишком тихо.' },
      { from: 4.4, to: 7.4, text: 'Пол дрожит. Из-под труб что-то поднимается.' },
      { from: 8.2, to: 11.2, text: 'Матка. Она закрыла собой выход.' },
      { from: 11.4, to: 13.6, text: 'Другого пути нет. Стреляй и не стой на месте.' },
    ]),
  }),
  'car-ride': Object.freeze({
    duration: 26,
    subtitles: Object.freeze([
      { from: 0.6, to: 4.0, text: 'Нина: «Машина у обочины, ключ в замке. Повезло. Держись за меня».' },
      { from: 5.0, to: 8.4, text: 'Нина: «До больницы минут десять. Только не отключайся».' },
      { from: 9.4, to: 12.4, text: 'Я: «Улицы пустые… Ни машин, ни людей».' },
      { from: 13.0, to: 16.4, text: 'Нина: «Это хуже, чем толпа. Они ушли на звук. Куда-то».' },
      { from: 18.0, to: 21.4, text: 'Вдали горит свет. Только в одном здании — в больнице.' },
      { from: 23.0, to: 25.4, text: 'Нина: «Приехали. Идём быстро и тихо».' },
    ]),
  }),
  // ---- Bonus story: who the stranger is (menu button). Lev Vetrov, the ambulance driver whose wife Lena waited in ward 3. ----
  'stranger': Object.freeze({
    duration: 46,
    subtitles: Object.freeze([
      { from: 2.0, to: 6.2, text: 'Лев: «Меня зовут Лев Ветров. Я водитель скорой. Двенадцать лет вожу людей в больницы».' },
      { from: 6.8, to: 11.0, text: 'Лев: «В ту ночь мою жену Лену положили в третью палату. „Просто обследование“, сказали».' },
      { from: 11.6, to: 15.6, text: 'Лев: «Потом закрыли карантин. Меня не пустили. Телефон молчал трое суток».' },
      { from: 16.2, to: 20.2, text: 'Лев: «Я шёл пешком через весь город. Пустые улицы. Ни машин, ни людей».' },
      { from: 20.8, to: 25.0, text: 'Лев: «У поста связи я встретил Нину. Она сказала, что внутри остались выжившие».' },
      { from: 25.6, to: 29.8, text: 'Лев: «Я ждал у ворот. Если Лена жива, она выйдет. Если нет, я хотя бы увижу её».' },
      { from: 30.4, to: 34.6, text: 'Лев: «Утром вышел человек с карабином. Он был не в себе. Рядом с ним шла Нина».' },
      { from: 35.2, to: 39.6, text: 'Лев: «Я не знал, что он сделал внутри. Я знал одно: он не должен причинить вред Нине».' },
      { from: 40.2, to: 45.0, text: 'Лев: «Я пошёл за их машиной. Что было дальше, ты уже видел».' },
    ]),
  }),
  // ---- Story branch when the hero has killed infected people (see main.js startMadnessEnding) ----
  'madness-drive': Object.freeze({
    duration: 80,
    cues: Object.freeze([
      { at: 12.0, type: 'dread' }, { at: 19.5, type: 'dread' }, { at: 24.5, type: 'dread' }, { at: 45.0, type: 'dread' },
      { at: 58.6, type: 'scream' }, { at: 67.85, type: 'hit' }, { at: 67.95, type: 'hurt' }, { at: 76.2, type: 'hit' },
    ]),
    subtitles: Object.freeze([
      { from: 0.8, to: 4.2, text: 'Нина: «Дорога свободна. Держись правее, мост уже близко».' },
      { from: 4.6, to: 7.6, text: 'Я: «Сколько мы уже едем?.. Кажется, целую ночь».' },
      { from: 8.0, to: 10.8, text: 'Нина: «Ты просто устал. Смотри на дорогу».' },
      { from: 12.2, to: 15.0, text: 'Я: «Там кто-то стоит…»' },
      { from: 15.6, to: 18.6, text: 'Я: «Нет. Показалось. Никого нет».' },
      { from: 19.7, to: 22.8, text: 'Я: «Опять они. Все, кого я…»' },
      { from: 22.9, to: 24.5, text: '«{n0}…» — шепчет голос из пустоты.' },
      { from: 24.6, to: 28.4, text: 'Я: «{n0}. Он стоит прямо на дороге».' },
      { from: 28.6, to: 31.8, text: 'Я: «Это ты, {n0}? Прости… Прости меня!»' },
      { from: 32.0, to: 34.8, text: 'Нина: «Зачем ты остановился?»' },
      { from: 35.2, to: 38.6, text: 'Я: «Ты не видишь? Они стоят на дороге. Те, кого я убил».' },
      { from: 39.0, to: 42.2, text: 'Я: «Я стрелял в людей, Нина. Они не двигались. Они просто стояли».' },
      { from: 42.8, to: 46.8, text: 'Нина: «Это уже не были люди. Их убийство — ничего страшного».' },
      { from: 47.2, to: 50.0, text: 'Я: «Ты врёшь. Ты говоришь так, чтобы я замолчал».' },
      { from: 50.4, to: 54.8, text: 'Нина: «Они бы стали пауками. Ты спас нас всех. Дыши. Просто дыши».' },
      { from: 55.2, to: 58.2, text: 'Я: «Они шепчут. Они говорят, что ты тоже…»' },
      { from: 58.6, to: 61.2, text: 'Я: «ТЫ. ТЫ ТОЖЕ ПАУК».' },
      { from: 61.6, to: 65.4, text: 'Нина: «Ты с ума сходишь? Опусти оружие, иначе я выстрелю!»' },
      { from: 65.8, to: 67.7, text: 'Я: «Ты не человек…»' },
      { from: 69.0, to: 72.0, text: 'Незнакомец: «Готово. Он бы убил нас обоих».', unless: 'wifeDead' },
      { from: 69.0, to: 72.0, text: 'Лев: «Это ты убил Лену. Я видел тебя в карантине. Больше ты никого не тронешь».', if: 'wifeDead' },
      { from: 72.4, to: 75.6, text: 'Нина: «Вяжи руки, быстрее. Пока не очнулся».' },
      { from: 76.4, to: 79.6, text: 'Нина: «В багажник. Довезём, а там решим».' },
    ]),
  }),
  // Peaceful epilogue after the last chapter. options.branch is 'mercy' (somebody was calmed) or 'alone' (nobody was).
  'peace-dawn': Object.freeze({
    duration: 36,
    defaultBranch: 'alone',
    cues: Object.freeze([]),
    subtitles: Object.freeze([]),
    branches: Object.freeze({
      mercy: Object.freeze({
        duration: 44, cues: Object.freeze([{ at: 18.0, type: 'win' }]),
        subtitles: Object.freeze([
          { from: 36.0, to: 42.0, text: 'Лев: «Лена в больнице, она узнала меня. Спасибо, что не выстрелил. Я теперь твой должник».', if: 'wifeSpared' },
          { from: 3.0, to: 6.4, text: 'Утро. Впервые за много дней я просыпаюсь без кошмара.' },
          { from: 7.4, to: 11.0, text: 'Нина: «Тебе звонили из карантина. Те, кого ты успокоил, пришли в себя».' },
          { from: 12.0, to: 15.6, text: 'Нина: «{list}. Они спрашивают, кто к ним подошёл».' },
          { from: 18.4, to: 22.0, text: '{n0}: «Спасибо, что не выстрелил».' },
          { from: 23.0, to: 27.0, text: 'Я: «Я помню ваши бейджи. Я боялся, что опоздаю».' },
          { from: 28.0, to: 32.0, text: 'Нина: «Ты не опоздал. Идём, нас ждёт завтрак. И весь город».' },
          { from: 34.0, to: 42.0, text: 'Ночь закончилась. Не для всех, но для тех, кого мы не бросили.' },
        ]),
      }),
      alone: Object.freeze({
        duration: 36, cues: Object.freeze([]),
        subtitles: Object.freeze([
          { from: 3.0, to: 6.4, text: 'Утро. Я проснулся, но тишина в доме слишком громкая.' },
          { from: 7.4, to: 11.0, text: 'Нина: «Из карантина новости. Те, кто стоял у стен, всё ещё там».' },
          { from: 12.0, to: 15.6, text: 'Я: «Я мог подойти. Положить руку на плечо. Хотя бы одному».' },
          { from: 16.6, to: 20.6, text: 'Нина: «Ты выжил и никого не убил. Это уже много. Но можно вернуться».' },
          { from: 21.6, to: 25.6, text: 'Я: «Тогда пойдём. Пока они ещё стоят».' },
          { from: 27.0, to: 34.0, text: 'Дверь открыта. Ночь закончилась, но дорога назад ещё есть.' },
        ]),
      }),
    }),
  }),
  'madness-home': Object.freeze({
    duration: 38,
    defaultBranch: 'police',
    choice: Object.freeze({ at: 27.4, options: Object.freeze([
      { id: 'police', label: 'Пойти в полицию и всё рассказать' },
      { id: 'call', label: 'Позвонить Нине' },
    ]) }),
    branches: Object.freeze({
      police: Object.freeze({
        duration: 38, cues: Object.freeze([]),
        subtitles: Object.freeze([{ from: 27.4, to: 31.6, text: 'Я: «Мне это надоело. Хватит. Я пойду в полицию и расскажу всё».' }]),
      }),
      call: Object.freeze({
        duration: 66, cues: Object.freeze([{ at: 37.0, type: 'hit' }]),
        subtitles: Object.freeze([
          { from: 27.4, to: 31.0, text: 'Я: «Нет. Не полиция. Мне нужна Нина».' },
          { from: 31.6, to: 35.4, text: 'Нина: «Алло? Это ты? Не клади трубку. Я еду».' },
          { from: 38.0, to: 41.0, text: 'Нина: «Открывай. Я знала, что ты позвонишь».' },
          { from: 42.0, to: 46.0, text: 'Нина: «Я тоже убивала. Тех, кто стоял у стен. Каждую ночь вижу их лица».' },
          { from: 46.6, to: 49.6, text: 'Я: «Ты?.. Ты тоже?»' },
          { from: 50.2, to: 54.4, text: 'Нина: «Мы не пауки. Мы люди, которые выжили. Давай вспоминать их вместе».' },
          { from: 55.0, to: 59.0, text: 'Я: «{list}. Давай начнём с них».' },
          { from: 60.0, to: 65.0, text: 'Мы просидели до утра. Кошмары не прошли, но теперь их двое на двоих.' },
        ]),
      }),
    }),
    cues: Object.freeze([{ at: 14.0, type: 'dread' }, { at: 17.5, type: 'scream' }, { at: 19.2, type: 'hurt' }]),
    subtitles: Object.freeze([
      { from: 3.6, to: 6.8, text: 'Я: «Голова раскалывается… Где я?»' },
      { from: 7.2, to: 9.8, text: 'Я: «Дома. Никого нет. Ни Нины, ни…»' },
      { from: 10.4, to: 12.8, text: 'Я: «Тихо. Слишком тихо».' },
      { from: 14.0, to: 17.2, text: '«Ты убил меня, — шепчет {n0}. — Ты убил меня».' },
      { from: 19.8, to: 22.4, text: 'Я: «Это был сон…»' },
      { from: 23.0, to: 26.8, text: 'Я: «Десятая ночь подряд. Такие кошмары снятся мне уже десять дней».' },
    ]),
  }),
  'madness-police': Object.freeze({
    duration: 54,
    // At this moment the scene stops and the player answers; the answer picks the rest of the scene (main.js).
    defaultBranch: 'gun',
    choice: Object.freeze({ at: 33.4, options: Object.freeze([
      { id: 'help', label: 'Рассказать всё и попросить помощи' },
      { id: 'leave', label: 'Молча уйти' },
      { id: 'gun', label: 'Не выдержать' },
    ]) }),
    branches: Object.freeze({
      gun: Object.freeze({
        duration: 54, cues: Object.freeze([{ at: 38.3, type: 'shot' }]),
        subtitles: Object.freeze([{ from: 35.6, to: 37.6, text: 'Полицейский: «Эй! Что вы делаете?!»' }]),
      }),
      help: Object.freeze({
        duration: 58, cues: Object.freeze([]),
        subtitles: Object.freeze([
          { from: 34.0, to: 37.6, text: 'Я: «Нет… Я не хочу так. Мне нужна помощь. Пожалуйста».' },
          { from: 38.2, to: 42.0, text: 'Полицейский: «Тише. Дышите. Садитесь. Я позвоню врачу, вас выслушают».' },
          { from: 42.8, to: 46.6, text: 'Я: «Я назову их всех: {list}. Я должен помнить».' },
          { from: 47.2, to: 51.0, text: 'Полицейский: «Запишите это. Это начало. Вы не один».' },
          { from: 52.0, to: 57.0, text: 'Прошло несколько недель. Кошмары реже. Имена я не забуду, но теперь не боюсь их вспоминать.' },
        ]),
      }),
      leave: Object.freeze({
        duration: 52, cues: Object.freeze([{ at: 44.5, type: 'dread' }]),
        subtitles: Object.freeze([
          { from: 34.0, to: 37.0, text: 'Я: «Нет. Я справлюсь сам. Простите».' },
          { from: 37.6, to: 40.8, text: 'Полицейский: «Постойте! Вам нельзя одному. Вернитесь!»' },
          { from: 42.0, to: 44.6, text: 'Я: «Они идут за мной… Шаги. Все эти шаги».' },
          { from: 45.6, to: 49.0, text: '«Не уходи, — шепчет {n0}. — Мы здесь».' },
        ]),
      }),
    }),
    cues: Object.freeze([]),
    subtitles: Object.freeze([
      { from: 3.0, to: 7.0, text: 'Я: «Я хочу сделать заявление. Я убил людей: {list}. Они стояли и не двигались».' },
      { from: 7.6, to: 11.0, text: 'Полицейский: «Спокойно. Вы поступили правильно. Заражённых положено уничтожать».' },
      { from: 11.6, to: 14.8, text: 'Я: «Они приходят ко мне каждую ночь. Я вижу их лица…»' },
      { from: 15.4, to: 19.0, text: 'Полицейский: «Это стресс. Вы выжили и защитили людей. Вы всё сделали правильно».' },
      { from: 19.6, to: 22.0, text: 'Я: «Правильно?..»' },
      { from: 22.6, to: 26.8, text: 'Полицейский: «Нам передали список пропавших из карантина: {list}. Они числились заражёнными. Вы не виноваты».' },
      { from: 27.0, to: 30.4, text: 'Я: «Он не понимает. Никто не поймёт».' },
      { from: 31.2, to: 34.0, text: 'Я: «Простите меня…»' },
    ]),
  }),
});

/** The scene after the choice. Without an answer (previews, skipped scenes) the scene plays the hardest ending. */
const branchOf = (id, options) => {
  const scene = CUTSCENES[id];
  return scene?.branches ? scene.branches[options?.branch] ?? scene.branches[scene.defaultBranch] : null;
};

export function cutsceneCues(id, options) { return [...(CUTSCENES[id]?.cues ?? []), ...(branchOf(id, options)?.cues ?? [])]; }

export function cutsceneDuration(id, options) { return branchOf(id, options)?.duration ?? CUTSCENES[id]?.duration ?? 0; }

/** The pause where the player decides, or null. */
export function cutsceneChoiceAt(id) { return CUTSCENES[id]?.choice?.at ?? null; }

/** The answers offered at that pause. */
export function cutsceneChoiceOptions(id) { return CUTSCENES[id]?.choice?.options ?? []; }

/** Fills {n0}..{n5} (names of the dead, in order) and {list} (up to four names) into a subtitle. */
export function fillNames(text, names = []) {
  const list = names.length ? names.slice(0, 4).join(', ') + (names.length > 4 ? ' и другие' : '') : 'те, кого я помню';
  return text.replace(/\{n([0-9])\}/g, (_, index) => names[Number(index)] ?? names[0] ?? 'он').replace('{list}', list);
}

export function subtitleAt(id, time, options) {
  const scene = CUTSCENES[id];
  const lines = [...(scene?.subtitles ?? []), ...(branchOf(id, options)?.subtitles ?? [])];
  const shown = lines.filter((line) => (!line.if || options?.flags?.[line.if]) && (!line.unless || !options?.flags?.[line.unless]));
  const line = shown.find(({ from, to }) => time >= from && time < to);
  return line ? fillNames(line.text, options?.names) : '';
}
