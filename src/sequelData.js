// Local continuation chapters; the original three-map campaign and saved preferences are unchanged.
export const HOSPITAL_INTRO = [
  'За воротами Нина замечает тёмное пятно на моей куртке. Боль под рёбрами уже не отпускает: в насосной меня ранили, а на адреналине я этого не понял. До моста с такой раной не дойти.',
  'В ближайшей больнице горит свет. Нина поддерживает меня у входа: «Нужны перевязка и врач. Только быстро». Внутри нас встречает один-единственный доктор. Он не отвечает на вопросы и прячет за спиной нож.',
  'WASD / стрелки — движение, мышь — прицел, ЛКМ / пробел — выстрел, E — действие рядом с целью. Доктор уже идёт к вам. Остановите его, иначе он убьёт вас. Esc — пауза.',
];
export const HOME_INTRO = [
  'Я вырываюсь из больницы один. Перед глазами всё ещё Нина и пасть огромного паука. За закрытой дверью гремят удары, а рация захлёбывается помехами: «Беги… паук… конец…».',
  'Я решаю идти домой: там осталась аптечка и охотничий сейф. Я не разобрал главное предупреждение. В полной передаче было: «Беги, он гонится. Ты должен сбежать, паук рядом, и он в твоём доме. Не иди туда, иначе тебе придёт конец».',
  'В доме уже кто-то есть. Огромный паук идёт за мной из комнаты в комнату. Сейф открывается десятью цифрами: я спрятал код пятью парами в разных комнатах. Найдите записки, соберите код по указанным позициям, введите его в сейф и заберите оружие. Потом — к входной двери.',
  'WASD / стрелки — идти, Shift — короткий спринт, E — подобрать или открыть, мышь и ЛКМ / пробел — стрелять после получения оружия. Записки сохраняются в журнале HUD. Пока вы вводите код, паук продолжает идти. Esc закрывает сейф или ставит игру на паузу.',
];
export const CODE_NOTES = Object.freeze([
  { id: 0, x: -8.4, z: 8.5, room: 'Гостиная', digits: '37', position: '1–2' },
  { id: 1, x: -8.3, z: -0.5, room: 'Кухня', digits: '04', position: '3–4' },
  { id: 2, x: -7.6, z: -11.3, room: 'Спальня', digits: '82', position: '5–6' },
  { id: 3, x: 6.0, z: -11.5, room: 'Ванная', digits: '61', position: '7–8' },
  { id: 4, x: 10.85, z: 2.5, room: 'Кабинет', digits: '95', position: '9–10' },
].map(Object.freeze));
export const SAFE_POS = Object.freeze({ x: 9.5, z: 10.4 });
export const HOME_EXIT = Object.freeze({ x: 0, z: 11 });
const rect = (x, z, width, depth) => ({ x, z, width, depth });
export const HOSPITAL_WALLS = [rect(-5.8, -6, 8.4, 0.3), rect(5.8, -6, 8.4, 0.3),
  rect(-2, -13, 0.25, 13.5), rect(2, -13, 0.25, 13.5)];

// Furniture the player, doctor and spider cannot walk through. Shots ignore these.
export const HOSPITAL_FURNITURE = Object.freeze([
  rect(-5, -3.6, 4.4, 0.8),
  ...[-1, 1].flatMap(side => [-3, 4.6, 9.5].map(z => rect(side * 5.2, z, 0.8, 0.8))),
  ...[-1, 1].flatMap(side => [6.2, 8.4].map(z => rect(side * 4.2, z, 2.6, 0.6))),
  ...[-1, 1].flatMap(side => [-2, 4, 9].flatMap(z => [rect(side * 7.3, z, 2.6, 1.5), rect(side * 7.3 + side * 0.1, z + 1.6, 0.6, 0.6)])),
  rect(4.8, -4.8, 2.0, 0.8), rect(-8.5, -4.7, 0.7, 0.7), rect(8.5, -4.7, 0.7, 0.7),
  rect(-9.1, 5.9, 1.0, 0.8), rect(8.5, 6.1, 0.8, 0.8),
  rect(-9.2, 9.7, 0.8, 0.8), rect(9.2, 9.7, 0.8, 0.8), rect(-2.6, 9.6, 0.7, 0.7), rect(2.6, 9.6, 0.7, 0.7),
  rect(-1.0, -11.5, 0.9, 2.1), rect(1.1, -15.3, 0.7, 0.7), rect(-1.4, -15.9, 0.5, 0.5),
].map(Object.freeze));
export const HOSPITAL_SOLIDS = Object.freeze([...HOSPITAL_WALLS, ...HOSPITAL_FURNITURE]);

// Floor plan of the house, x east / z south. A six-metre central hall with the entry foyer at its
// south end; living, kitchen and bedroom on the west; gun room, study and bathroom on the east.
// Every doorway is 3 m wide so the giant spider fits, and each side has a loop through two rooms.
export const HOME_ROOM_DEFS = Object.freeze([
  { name: 'Гостиная', x0: -12, x1: -3, z0: 3, z1: 12 },
  { name: 'Кухня', x0: -12, x1: -3, z0: -4, z1: 3 },
  { name: 'Спальня', x0: -12, x1: -3, z0: -12, z1: -4 },
  { name: 'Прихожая', x0: -3, x1: 3, z0: 6, z1: 12 },
  { name: 'Холл', x0: -3, x1: 3, z0: -12, z1: 6 },
  { name: 'Оружейная', x0: 3, x1: 12, z0: 7, z1: 12 },
  { name: 'Кабинет', x0: 3, x1: 12, z0: -1, z1: 7 },
  { name: 'Ванная', x0: 3, x1: 12, z0: -12, z1: -1 },
]);
export const HOME_ROOMS = HOME_ROOM_DEFS.map(room => room.name);
export const SAFE_CODE = CODE_NOTES.map(note => note.digits).join('');
export const RADIO_BROKEN = ['Беги…', '…паук…', '…конец…'];
const T = 0.24;
// axis 'z': wall runs along z at x=c; axis 'x': wall runs along x at z=c.
export const HOME_PARTITIONS = Object.freeze([
  { axis: 'z', c: -3, from: -12, to: 12, doors: [[6.2, 9.2], [-1.6, 1.4], [-9.2, -6.2]] },
  { axis: 'z', c: 3, from: -12, to: 12, doors: [[7.9, 10.9], [1.2, 4.2], [-9, -6]] },
  { axis: 'x', c: 3, from: -12, to: -3, doors: [[-8, -5]] },
  { axis: 'x', c: -4, from: -12, to: -3, doors: [[-8.2, -5.2]] },
  { axis: 'x', c: 7, from: 3, to: 12, doors: [[7.5, 10.5]] },
  { axis: 'x', c: -1, from: 3, to: 12, doors: [[7.5, 10.5]] },
]);
export const HOME_WALLS = [];
for (const part of HOME_PARTITIONS) {
  const cuts = [...part.doors].sort((p, q) => p[0] - q[0]);
  let cursor = part.from;
  for (const [a, b] of [...cuts, [part.to, part.to]]) {
    if (a - cursor > 0.01) {
      const mid = (cursor + a) / 2, length = a - cursor;
      HOME_WALLS.push(part.axis === 'z' ? rect(part.c, mid, T, length) : rect(mid, part.c, length, T));
    }
    cursor = b;
  }
}
// Furniture blocks walking but not line of sight for shots.
export const HOME_FURNITURE = Object.freeze([
  rect(-11.2, 8.5, 1.3, 3.8), rect(-8.4, 8.5, 1.8, 1.1), rect(-10.4, 3.8, 2.6, 0.55), rect(-6.8, 11.0, 1.4, 1.4),
  rect(-11.4, -0.5, 1.2, 6.2), rect(-8.3, -0.5, 3.2, 1.2),
  rect(-9.9, -10.5, 2.4, 2.8), rect(-11.5, -6.5, 1.0, 3.0), rect(-7.8, -11.4, 0.8, 0.8),
  rect(6.0, -11.5, 2.8, 0.7), rect(10.6, -10.6, 2.6, 1.3),
  rect(11.2, 2.5, 1.3, 3.2), rect(5.2, 6.5, 3.2, 0.6), rect(11.5, -0.4, 0.9, 0.9),
  rect(11.45, 9.5, 0.8, 4.0), rect(-5, -0.5, 1.8, 1.1), rect(5.5, 11.3, 3.0, 1.0), rect(0, -10.9, 3.0, 2.2),
].map(Object.freeze));
export const HOME_SOLIDS = Object.freeze([...HOME_WALLS, ...HOME_FURNITURE]);
export function roomIndex(x, z) {
  const found = HOME_ROOM_DEFS.findIndex(room => x >= room.x0 && x < room.x1 && z >= room.z0 && z < room.z1);
  return found < 0 ? 4 : found;
}
