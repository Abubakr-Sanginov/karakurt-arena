import { createSequel, HOSPITAL_INTRO, HOME_INTRO } from './sequel.js';
export { createSequel, stepSequel, sequelUse } from './sequel.js';
export { updateSequelHud } from './sequelUI.js';
export function chapterStory(chapter) {
  return { state: createSequel(chapter), title: chapter === 'hospital' ? 'Нужна помощь' : 'Не возвращайся домой',
    eyebrow: chapter === 'hospital' ? 'ЭТАП III · БОЛЬНИЦА' : 'ЭТАП IV · ДОМ',
    paragraphs: chapter === 'hospital' ? HOSPITAL_INTRO : HOME_INTRO };
}
