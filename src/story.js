// Story data shared by the game and the cutscenes. Pure data and helpers: no Three.js, DOM or clocks.
// Every infected bystander of chapters 1-3 was a person with a name. The hero meets them, may calm or kill them,
// and the names come back in the madness ending (apparitions, the police list) and on the final card.
export const PEOPLE = Object.freeze({
  'ward-patient-west': { name: 'Игорь Савельев', role: 'санитар', note: 'На бейдже: «Смена 3». В кармане детский рисунок: «Папа, возвращайся».' },
  'ward-patient-east': { name: 'Лена Ветрова', role: 'пациентка из третьей палаты', note: 'На запястье больничный браслет. Она сидела у окна и всю ночь ждала мужа.' },
  'ward-patient-door': { name: 'Артём Горин', role: 'курьер', note: 'Привёз лекарства за час до карантина. Сумка с накладными так и осталась на плече.' },
  'ward-patient-window': { name: 'Роза Мирзоева', role: 'медсестра', note: 'Она делилась со мной водой. На халате пятно от чая и надпись «Роза, ночная смена».' },
  'corridor-water-carrier': { name: 'Павел Дымов', role: 'студент-практикант', note: 'Повязка на руке. Он первым вызвался разносить воду.' },
  'corridor-orderly': { name: 'Виктор Алёшин', role: 'охранник', note: 'Ключи на поясе, а на брелоке фото дочери. Он держал дверь до последнего.' },
  'corridor-watchman': { name: 'Анна Крылова', role: 'врач-лаборант', note: 'В нагрудном кармане блокнот: «Лекарство есть. Нужно только успеть».' },
  'pump-mechanic': { name: 'Фёдор Носов', role: 'механик насосной', note: 'Гаечный ключ так и в руке. Он чинил насосы, пока не слёг.' },
  'pump-medic': { name: 'Оксана Рябова', role: 'фельдшер', note: 'Красный крест на рукаве. Она до конца сидела с тяжелобольными.' },
  'pump-straggler': { name: 'Михаил Орлов', role: 'пациент', note: 'Шёл вместе с нашей группой. Всё спрашивал, жива ли его мама.' },
});

export const PEOPLE_COUNT = Object.keys(PEOPLE).length;

export function personInfo(id) { return PEOPLE[id] ?? { name: 'Неизвестный', role: 'человек', note: '' }; }

/** The text shown when the hero first stands next to somebody: who they were. */
export function meetLine(id) {
  const person = personInfo(id);
  return `${person.name}, ${person.role}. ${person.note}`;
}

/** Names of the first `count` dead, in the order they died, for the cutscenes. */
export function namesOf(ids = [], count = ids.length) {
  return ids.slice(0, count).map((id) => personInfo(id).name);
}

/** What the apparitions say to the hero, one line per person. */
export function visionLine(id) {
  const person = personInfo(id);
  return `«${person.name}», — шепчет кто-то за спиной.`;
}

/** Whispers while the hero's mind slips after the first kill. Cycled with the dead person's name. */
export const WHISPERS = Object.freeze([
  (name) => `Шёпот за спиной: «${name}…»`,
  (name) => `Мне показалось, что ${name} стоит у стены и смотрит на меня.`,
  (name) => `Я слышу голос: «Ты убил меня, ${name.split(' ')[0]}», — но это моя голова.`,
  (name) => `Руки дрожат. Перед глазами лицо: ${name}.`,
]);

/** 0 to 1: how badly the hero's mind has slipped. Drives the screen effect and the whispers. */
export function sanityLoss(kills) { return Math.max(0, Math.min(1, (kills || 0) / 4)); }

export const CALM_PROMPT = 'Успокоить · E';
export function calmLine(id) {
  const person = personInfo(id);
  return `Я кладу руку на плечо. ${person.name} перестаёт скрести пол и смотрит на меня почти осмысленно.`;
}

/** The hospital doctor's news, depending on whom the hero spared. Returned as extra intro paragraphs. */
export function cureParagraphs(spared = 0) {
  if (spared > 0) {
    return [
      `Рация потрескивает: «Не стреляйте в заражённых. Первые сутки болезнь обратима. Те, кого вы успокоили, ещё могут вернуться». Я думаю о ${spared === 1 ? 'человеке, которого' : 'людях, которых'} оставил живыми, и впервые за ночь дышу ровно.`,
    ];
  }
  return [
    'Рация потрескивает: «Первые сутки болезнь обратима». Я никого не тронул в карантине, но и не пытался помочь им. Остаётся надеяться, что те, кто стоял у стен, дождутся врачей.',
  ];
}

/** Summary lines for the result screen: who was met, who was spared, who died. */
export function journalLines({ met = [], dead = [], spared = [] } = {}) {
  return met.map((id) => {
    const person = personInfo(id);
    const fate = dead.includes(id) ? 'погиб от моей руки' : spared.includes(id) ? 'успокоен и жив' : 'остался в карантине';
    return `${person.name}, ${person.role} — ${fate}`;
  });
}

/** The peaceful ending card, varied by mercy. */
export function peacefulEnding(spared = 0) {
  if (spared >= 6) return { title: 'Ночь закончилась. Не для всех, но для многих.', text: 'Лекарство ещё далеко, но люди, которых вы не бросили, ждут врачей. Рассвет над карантином — их рассвет тоже.' };
  if (spared > 0) return { title: 'Ночь не закончилась. Но не для всех.', text: 'Вы помогли тем, кому можно было помочь. Это немного, но теперь у кого-то есть шанс вернуться домой.' };
  return { title: 'Ночь не закончилась.', text: 'Вы никого не убили, но и не спасли. Имена остались на бейджах: возможно, не поздно вернуться и узнать, как они.' };
}

/** What the madness ending says about the ending reached at the police station. */
export const POLICE_ENDINGS = Object.freeze({
  gun: {
    eyebrow: 'КОНЕЦ', title: 'Тишина.',
    text: 'Он убивал, потому что боялся, и не смог жить с тем, что сделал. Игра закончилась. Если вам или кому-то рядом тяжело, пожалуйста, обратитесь за помощью: к близким, в экстренную службу (112) или на местную линию психологической поддержки. Вы не одни.',
  },
  help: {
    eyebrow: 'КОНЕЦ · ПОМОЩЬ', title: 'Рассвет.',
    text: 'Он назвал имена вслух. Это не вернуло никого из убитых, но в тот день он впервые не остался с ними один. Лечение будет долгим. Каждое утро он записывает по одному имени, чтобы помнить, а не бояться.',
  },
  call: {
    eyebrow: 'КОНЕЦ · ДВОЕ', title: 'Двое в тишине.',
    text: 'Он позвонил Нине, а не в полицию. Она призналась, что тоже стреляла в тех, кто стоял у стен. Кошмары не ушли, но теперь они делят их на двоих и по утрам вспоминают имена. Это не искупление, но это начало.',
  },
  leave: {
    eyebrow: 'КОНЕЦ · ЭХО', title: 'Тишина идёт следом.',
    text: 'Он ушёл молча. Имена остались с ним, и шаги в пустом коридоре звучат слишком громко. Дверь участка ещё открыта: вернуться и рассказать всё можно в любой день. Если вам тяжело, поговорите с близкими или позвоните на линию поддержки (112).',
  },
});

/** Choices at the police station. Pure data; main.js shows them and stores the answer in the cutscene options. */
export const POLICE_CHOICES = Object.freeze([
  { id: 'help', label: 'Рассказать всё и попросить помощи' },
  { id: 'leave', label: 'Молча уйти' },
  { id: 'gun', label: 'Не выдержать' },
]);

/** Extra paragraphs on the chapter-outro cards, by what the hero has done so far (mapIndex 0-2). */
export function outroNotes(mapIndex, { spared = [], dead = [] } = {}) {
  const lines = [];
  if (mapIndex === 0 && !spared.length && !dead.length) lines.push('Те, у стен, так и не двинулись. Я зачем-то запомнил их бейджи. Может, с ними можно просто поговорить? Стоит подойти и положить руку на плечо (E).');
  if (spared.length && !dead.length) lines.push('На плече всё ещё чувствуется тепло чужой руки. Страшно, но я не жалею, что не нажал на спуск.');
  if (dead.length === 1) lines.push(`${personInfo(dead[0]).name} лежит там, где упал. Я стараюсь не оборачиваться.`);
  if (dead.length > 1) lines.push(`Я убил ${dead.length}. Я помню их имена: ${namesOf(dead, 3).join(', ')}. Руки не слушаются.`);
  if (mapIndex === 2 && spared.length >= 3) lines.push('Рация на поясе хрипит голосом Нины: «Я слышала, ты никого не тронул. Спасибо. Жду во дворе».');
  return lines;
}
