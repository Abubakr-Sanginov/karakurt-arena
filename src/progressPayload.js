// Keep saved data plain and small. Input state, AudioNodes, scene models and a typed safe code are never saved.
export function progressPayload({ state, phase, pausedPhase, presentation, mode, dawn, sequel }) {
  const actualPhase = phase === 'paused' ? pausedPhase : phase;
  if (!['playing','story','presentation','result'].includes(actualPhase) || state.status === 'lost'
    || sequel?.lost || presentation.kind === 'death') return null;
  return { version: 1, savedAt: Date.now(), mode, phase: actualPhase,
    kind: sequel?.chapter || (dawn ? 'dawn' : 'campaign'), state: structuredClone(state),
    extra: sequel ? structuredClone(sequel) : dawn ? structuredClone(dawn) : null,
    presentation: { kind: presentation.kind, time: presentation.time, duration: presentation.duration } };
}
