export const VIEW_MODES = Object.freeze([
  Object.freeze({
    id: 'top2d',
    label: '2D — вид сверху',
    description: 'Плоский вид арены сверху. WASD — движение, мышь — прицел по полу.',
  }),
  Object.freeze({
    id: 'third',
    label: 'От третьего лица',
    description: 'Исходная наклонная перспектива. Герой и ближайшие угрозы в одном кадре.',
  }),
  Object.freeze({
    id: 'first',
    label: 'От первого лица',
    description: 'Камера на уровне глаз. Мышь — обзор, WASD — движение относительно взгляда.',
  }),
]);

/** Unknown, obsolete or non-string preferences never prevent startup. */
export function normalizeViewMode(value) {
  return VIEW_MODES.some(({ id }) => id === value) ? value : 'third';
}

/** All modes feed the same XZ simulation; only first-person controls rotate. */
export function movementInWorld(mode, horizontal, vertical, yaw = 0) {
  if (mode !== 'first') return { moveX: horizontal, moveZ: vertical };
  // A survivor faces +Z at yaw=0, so screen-right is world -X.
  const length = Math.max(1, Math.hypot(horizontal, vertical));
  const forward = -vertical / length;
  const right = horizontal / length;
  return {
    moveX: Math.sin(yaw) * forward - Math.cos(yaw) * right,
    moveZ: Math.cos(yaw) * forward + Math.sin(yaw) * right,
  };
}
