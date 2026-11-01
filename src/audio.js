const MAX_VOICES = 8;
const MASTER_VOLUME = 0.32;
const SILENCE = 0.0001;
const PRIORITY = ['lose', 'scream', 'radio', 'win', 'hurt', 'dread', 'wave', 'dodge', 'shot', 'kill', 'hit'];
const COOLDOWN = { shot: 0.075, hit: 0.08, hurt: 0.2, dread: 5, kill: 0.1, wave: 0.7, dodge: 0.2, win: 1, lose: 1 };

/** Procedural, DOM-free effects. Call unlock() directly from a user action. */
export function createAudio() {
  let context = null;
  let master = null;
  let compressor = null;
  let noise = null;
  let pendingUnlock = null;
  let unlocked = false;
  let muted = false;
  let horror = false;
  let disposed = false;
  let pendingFinale = null;
  const voices = new Set();
  const lastPlayed = new Map();

  function release(voice, stop = false) {
    voices.delete(voice);
    voice.source.onended = null;
    if (stop) {
      try { voice.source.stop(); } catch { /* Already stopped. */ }
    }
    for (const node of voice.nodes) {
      try { node.disconnect(); } catch { /* A failed context may be disconnected. */ }
    }
  }

  function silence() {
    pendingFinale = null;
    if (context && master) {
      try {
        const now = context.currentTime;
        master.gain.cancelScheduledValues(now);
        master.gain.setValueAtTime(0, now);
      } catch { /* Muting must not affect the game. */ }
    }
    for (const voice of [...voices]) release(voice, true);
  }

  function restoreVolume() {
    if (!context || !master) return;
    try {
      const now = context.currentTime;
      // A terminal cue can follow silence() in the same frame, but not in the
      // same audio quantum. Cancel its later zero before restoring this level.
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(muted ? 0 : MASTER_VOLUME, now);
    } catch { /* Volume restoration is optional if audio is unavailable. */ }
  }

  function closeContext() {
    silence();
    const closing = context;
    context = master = compressor = noise = null;
    unlocked = false;
    lastPlayed.clear();
    if (!closing) return;
    try {
      closing.onstatechange = null;
      Promise.resolve(closing.close()).catch(() => {});
    } catch { /* Closing an unavailable context is harmless. */ }
  }

  function initialize() {
    const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (typeof AudioContextClass !== 'function') return false;
    context = new AudioContextClass();
    master = context.createGain();
    master.gain.value = muted ? 0 : MASTER_VOLUME;
    compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -16;
    compressor.knee.value = 10;
    compressor.ratio.value = 10;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.12;
    master.connect(compressor);
    compressor.connect(context.destination);
    noise = context.createBuffer(1, Math.ceil(context.sampleRate * 0.5), context.sampleRate);
    const data = noise.getChannelData(0);
    // Fixed noise avoids relying on random state shared with game logic.
    let seed = 1729;
    for (let i = 0; i < data.length; i += 1) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      data[i] = (seed / 4294967296) * 2 - 1;
    }
    context.onstatechange = () => {
      if (!context) return;
      if (context.state === 'running') {
        unlocked = true;
        restoreVolume();
        flushFinale();
      } else if (context.state === 'closed') {
        closeContext();
      } else {
        unlocked = false;
        // Device interruptions must not discard the pending terminal cue.
        for (const active of [...voices]) release(active, true);
      }
    };
    return true;
  }

  function flushFinale() {
    const pending = pendingFinale;
    pendingFinale = null;
    if (pending && Date.now() - pending.at < 900) play([pending.event]);
  }

  function unlock() {
    if (disposed) return Promise.resolve();
    // Retry resume synchronously for every gesture: an earlier blocked resume()
    // promise must not consume the next real click/key activation.
    try {
      if (!context && !initialize()) return Promise.resolve();
      if (context.state === 'closed') {
        closeContext();
        if (!initialize()) return Promise.resolve();
      }
      if (context.state === 'running') {
        unlocked = true;
        restoreVolume();
        flushFinale();
        return Promise.resolve();
      }
      const requestedContext = context;
      // Invoke resume synchronously here, before leaving the user gesture.
      // A throwing resume must not discard a pending finale or an otherwise
      // usable graph; the next genuine gesture gets another chance to unlock.
      let resuming;
      try { resuming = context.resume(); }
      catch { unlocked = false; return Promise.resolve(); }
      const attempt = Promise.resolve(resuming).then(() => {
        if (!disposed && context === requestedContext) {
          unlocked = context.state === 'running';
          if (unlocked) { restoreVolume(); flushFinale(); }
        }
      }).catch(() => {
        if (context === requestedContext && context.state !== 'running') {
          unlocked = false;
          for (const active of [...voices]) release(active, true);
          // Keep the short pending finale: another real gesture may still
          // resume this context before the terminal cue becomes stale.
        }
      });
      // Some autoplay policies leave resume() pending instead of rejecting it.
      // Starting the game must not wait indefinitely for permission to make sound.
      let timer;
      const timeout = new Promise(resolve => { timer = setTimeout(resolve, 250); });
      const bounded = Promise.race([attempt, timeout]);
      pendingUnlock = bounded;
      void bounded.then(() => {
        clearTimeout(timer);
        if (pendingUnlock === bounded) pendingUnlock = null;
      });
      return bounded;
    } catch {
      closeContext();
      return Promise.resolve();
    }
  }

  function setMuted(value) {
    muted = Boolean(value);
    if (muted) {
      silence();
      lastPlayed.clear();
    } else if (!disposed) restoreVolume();
  }

  function makeRoom(count, priority) {
    for (const voice of [...voices]) {
      if (voice.endsAt <= context.currentTime) release(voice, true);
    }
    if (voices.size + count <= MAX_VOICES) return true;
    const replaceable = [...voices].filter(voice => voice.priority < priority)
      .sort((a, b) => a.priority - b.priority || a.endsAt - b.endsAt);
    if (replaceable.length < voices.size + count - MAX_VOICES) return false;
    while (voices.size + count > MAX_VOICES) release(replaceable.shift(), true);
    return true;
  }

  function voice(event, priority, options) {
    const nodes = [];
    let active = null;
    try {
      const startsAt = context.currentTime + (options.delay || 0);
      const endsAt = startsAt + options.duration;
      const source = options.noise || options.buffer ? context.createBufferSource() : context.createOscillator();
      nodes.push(source);
      if (options.buffer) {
        source.buffer = options.buffer;
      } else if (options.noise) {
        source.buffer = noise;
        source.loop = options.duration > noise.duration;
      } else {
        source.type = options.wave || 'sine';
        source.frequency.setValueAtTime(options.frequency, startsAt);
        source.frequency.exponentialRampToValueAtTime(options.to || options.frequency, endsAt);
      }
      const filter = context.createBiquadFilter();
      nodes.push(filter);
      filter.type = options.noise ? 'bandpass' : 'lowpass';
      filter.frequency.setValueAtTime(options.filter || (options.noise ? 1800 : 3500), startsAt);
      filter.Q.value = options.noise ? 0.65 : 0.5;
      source.connect(filter);
      const envelope = context.createGain();
      nodes.push(envelope);
      const attack = Math.min(options.attack || 0.004, options.duration * 0.2);
      // Use the same timestamp for the whole envelope. A separate currentTime
      // read could insert a late zero after the attack if an audio quantum ticks.
      envelope.gain.setValueAtTime(0, startsAt);
      envelope.gain.linearRampToValueAtTime(options.level, startsAt + attack);
      if (options.buffer) envelope.gain.setValueAtTime(options.level, endsAt - 0.025);
      envelope.gain.exponentialRampToValueAtTime(SILENCE, endsAt - 0.002);
      envelope.gain.setValueAtTime(0, endsAt);
      filter.connect(envelope);
      if (typeof context.createStereoPanner === 'function') {
        const panner = context.createStereoPanner();
        nodes.push(panner);
        // Subtle room-space pan; no listener/camera state is required by the API.
        panner.pan.value = Math.max(-0.65, Math.min(0.65, event.x / 16));
        envelope.connect(panner);
        panner.connect(master);
      } else envelope.connect(master);
      active = { source, nodes, endsAt, priority };
      voices.add(active);
      source.onended = () => release(active);
      source.start(startsAt);
      source.stop(endsAt + 0.005);
    } catch {
      if (active) release(active, true);
      else for (const node of nodes) {
        try { node.disconnect(); } catch { /* Release a partially built voice. */ }
      }
    }
  }

  function sound(event, priority) {
    const tone = (frequency, to, duration, level, wave = 'sine', delay = 0) =>
      voice(event, priority, { frequency, to, duration, level, wave, delay });
    const burst = (duration, level, filter) =>
      voice(event, priority, { noise: true, duration, level, filter });
    switch (event.type) {
      case 'radio': // Interference only; every spoken line is a subtitle.
        burst(0.35, 0.1, 1600); tone(670, 310, 0.2, 0.06, 'triangle'); break;
      case 'scream':
        tone(920, 170, 0.95, 0.7, 'sawtooth');
        tone(710, 280, 0.85, 0.45, 'triangle'); burst(0.6, 0.35, 2600); break;
      case 'shot': // Dry crack plus low, fast body.
        burst(0.055, 0.2, 2200); tone(155, 55, 0.095, 0.22, 'triangle'); break;
      case 'hit': // Short bright tick, intentionally quieter than the gun.
        tone(1250, 560, 0.05, 0.11, 'triangle'); break;
      case 'hurt': // Low descending alarm, not another impact.
        tone(230, 65, 0.25, 0.25, 'sawtooth'); burst(0.1, 0.12, 700); break;
      case 'kill':
        tone(620, 940, 0.105, 0.1, 'triangle'); break;
      case 'dodge': // Airy sweep with a small rising pitch.
        burst(0.16, 0.14, 1100); tone(210, 650, 0.14, 0.08, 'sine'); break;
      case 'wave':
        tone(220, 220, 0.2, 0.18, 'triangle');
        tone(330, 330, 0.25, 0.17, 'triangle', 0.14); break;
      case 'win':
        [523.25, 659.25, 783.99, 1046.5].forEach((frequency, index) =>
          tone(frequency, frequency, 0.3, 0.18, 'triangle', index * 0.13)); break;
      case 'dread':
        if (horror) { burst(0.14, 0.19, 900); tone(740, 95, 0.26, 0.16, 'sawtooth'); }
        break;
      case 'lose':
        if (horror) {
          // Fast attack, bounded master/compressor: never change system volume.
          burst(0.38, 0.94, 2100);
          tone(1150, 65, 0.46, 0.72, 'sawtooth');
          tone(86, 38, 0.85, 0.58, 'triangle');
        } else [260, 196, 130].forEach((frequency, index) =>
          tone(frequency, frequency * 0.85, 0.34, 0.19, 'triangle', index * 0.18));
        break;
      default: break;
    }
  }

  function play(events) {
    if (disposed || muted || !Array.isArray(events)) return;
    if (!unlocked || !context || context.state !== 'running') {
      const finale = events.find((event) => ['lose', 'win'].includes(event?.type)
        && Number.isFinite(event.x) && Number.isFinite(event.z));
      if (finale) pendingFinale = { event: { ...finale, x: 0, z: 0 }, at: Date.now() };
      return;
    }
    try {
      const selected = new Map();
      // Coalesce a burst to one effect of each kind; never queue a noisy backlog.
      for (const event of events) {
        if (event && PRIORITY.includes(event.type) && Number.isFinite(event.x) && Number.isFinite(event.z)
          && !selected.has(event.type)) selected.set(event.type, event);
        if (selected.size === PRIORITY.length) break;
      }
      const now = context.currentTime;
      for (const type of PRIORITY) {
        const event = selected.get(type);
        if (type === 'dread' && !horror) continue;
        if (!event || now - (lastPlayed.get(type) ?? -Infinity) < COOLDOWN[type]) continue;
        const finale = type === 'win' || type === 'lose';
        if (finale) {
          silence();
          // silence() may run in a later audio quantum than `now` above.
          // Always restore after it using a fresh clock, never backdate gain.
          restoreVolume();
        }
        const count = type === 'win' ? 4 : ['lose', 'scream'].includes(type) ? 3
          : ['shot', 'hurt', 'dodge', 'wave', 'dread', 'radio'].includes(type) ? 2 : 1;
        const priority = PRIORITY.length - PRIORITY.indexOf(type);
        if (!makeRoom(count, priority)) continue;
        sound(event, priority);
        lastPlayed.set(type, now);
        if (finale) break;
      }
    } catch { /* Audio failures must never interrupt gameplay. */ }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    closeContext();
  }

  function setHorrorMode(value) { horror = Boolean(value); silence(); lastPlayed.clear(); restoreVolume(); }
  return { unlock, setMuted, setHorrorMode, play, silence, dispose };
}
