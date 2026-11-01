// Run in the real Vite page's browser console while on the main menu:
// await (await import('/tests/view-modes-browser.mjs')).checkViewModeMenu()
// This is a real DOM check, not a WebGL/input/performance acceptance substitute.
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

export async function checkViewModeMenu() {
  assert(document.body.dataset.screen === 'menu', 'Start this check on the main menu');
  const errors = [];
  const onError = (event) => errors.push(event.message || String(event.reason));
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onError);
  const expected = [
    ['top2d', '2D — вид сверху'],
    ['third', 'От третьего лица'],
    ['first', 'От первого лица'],
  ];
  const initial = document.body.dataset.viewMode;
  try {
    document.getElementById('start-button').click();
    await nextFrame();
    assert(document.body.dataset.screen === 'view-picker', 'Play must open perspective selection');
    document.querySelector('[data-game-mode="campaign"]').click();
    const options = [...document.querySelectorAll('.view-picker__option')];
    assert(options.length === 3, 'Exactly three choices are required');
    for (const [id, label] of expected) {
      const button = options.find((option) => option.dataset.viewMode === id);
      assert(button?.tagName === 'BUTTON', `${id} must be a button`);
      assert(button.textContent.includes(label), `${id} has the required label`);
      button.focus();
      button.click();
      await nextFrame();
      assert(button.getAttribute('aria-pressed') === 'true', `${id} selection is announced`);
      assert(options.filter((option) => option.getAttribute('aria-pressed') === 'true').length === 1, 'Only one selection');
      assert(button.classList.contains('view-picker__option--selected'), `${id} selection is visible`);
      assert(document.body.dataset.screen === 'view-picker', 'A selection must not start combat');
      try { assert(localStorage.getItem('karakurt.viewMode') === id, 'Save the plain id, not JSON'); }
      catch (error) { if (error.name !== 'SecurityError') throw error; }
      const bounds = button.getBoundingClientRect();
      assert(bounds.width > 40 && bounds.left >= 0 && bounds.right <= innerWidth + 1, `${id} must fit the viewport`);
    }
    const first = options.find((button) => button.dataset.viewMode === 'top2d');
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    assert(document.activeElement.dataset.viewMode === 'first', 'End must focus the last option');
    document.querySelector(`[data-view-mode="${initial}"]`).click();
    document.getElementById('view-continue').click();
    await nextFrame();
    assert(document.body.dataset.screen === 'story', 'Selection confirmation opens story, not combat');
    assert(document.getElementById('campaign-title').textContent === 'Ночная палата', 'First chapter is preserved');
    document.querySelector('#campaign-panel [data-action="menu"]').click();
    await nextFrame();
    assert(errors.length === 0, `Browser errors: ${errors.join('; ')}`);
    return { passed: true, width: innerWidth, checked: expected.map(([id]) => id),
      unverified: ['Trusted keyboard activation', 'Reload', 'Blocked storage', 'Movement/aim/hits', 'Pointer Lock', 'Chapter transitions', 'Visual quality and frame timings'] };
  } finally {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onError);
  }
}

export async function checkHorrorMenu() {
  assert(document.body.dataset.screen === 'menu', 'Start on the main menu');
  document.getElementById('start-button').click();
  await nextFrame();
  document.querySelector('[data-game-mode="horror"]').click();
  await nextFrame();
  assert(document.body.dataset.viewMode === 'first', 'Horror forces eye-level camera');
  assert(document.querySelector('[data-view-mode="top2d"]').disabled, 'Top-down is unavailable in horror');
  assert(document.querySelector('[data-view-mode="third"]').disabled, 'Third-person is unavailable in horror');
  assert(document.getElementById('view-continue').disabled, 'Entry needs explicit consent');
  assert(!/паук|поражен|проигр|скример/i.test(document.getElementById('horror-warning').textContent), 'Do not spoil the surprise');
  const consent = document.getElementById('horror-consent');
  consent.checked = true;
  consent.dispatchEvent(new Event('change', { bubbles: true }));
  assert(!document.getElementById('view-continue').disabled, 'Consent enables entry');
  document.getElementById('view-continue').click();
  await nextFrame();
  assert(document.body.dataset.screen === 'story', 'Entry still waits for story confirmation');
  document.querySelector('#campaign-panel [data-action="menu"]').click();
  document.getElementById('start-button').click();
  document.querySelector('[data-game-mode="campaign"]').click();
  document.querySelector('#view-picker [data-action="menu"]').click();
  return { passed: true, unverified: ['Horror gameplay, sound and defeat', 'Dawn presentation', 'Pause/blur and Pointer Lock'] };
}

export const manualViewModeChecks = [
  'For each mode: Play → choose → reload → Play; selection persists, battle has not started.',
  'Confirm story, then combat. Use WASD, mouse, LMB/Space and Shift: movement, aim, hits, damage and waves must work.',
  'First: click canvas to lock, turn horizontally/vertically, fire again. Esc pauses once and unlocks. Resume and click to recapture.',
  'Pause/menu/blur/restart must release Pointer Lock and clear held fire/movement. Repeat the flow.',
  'Traverse all three maps in every mode; scenery changes, infected remain atmospheric; health/waves follow the same rules.',
  'At 320/390px widths, scroll menu and picker: labels/actions readable, no horizontal clipping.',
  'Use browser tooling to deny Storage getItem/setItem before navigation; all choices/story/combat still work.',
  'Inject a scene exception with working WebGL: report internal error, not unavailable WebGL. Test actual missing/lost context separately.',
  'Horror: entering forces first-person without overwriting the ordinary camera; consent required; warning must not reveal the surprise or trigger.',
  'With moderate volume, verify horror accents; mute must suppress every effect. Pause/menu stop active voices.',
  'Verify horror defeat, pause during presentation and restart; camera/resources reset, no stuck Pointer Lock.',
  'Complete final outro: hand opens door, dawn courtyard/grass/sun visible; pause freezes it; result says New part soon, with no active fourth map.',
];
