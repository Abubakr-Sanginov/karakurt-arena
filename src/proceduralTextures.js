import * as THREE from 'three';

// Procedural canvas textures for cutscenes: no image files are loaded. Every texture is created from a
// seeded generator, so a given scene always looks the same. Returns null where no canvas exists (tests).
function canvasOf(size) {
  if (typeof document === 'undefined' || !document.createElement) return null;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext?.('2d');
  return context ? { canvas, context } : null;
}
function random(seed) {
  let a = seed >>> 0;
  return () => { a += 0x6d2b79f5; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const shade = (hex, amount) => {
  const c = new THREE.Color(hex);
  c.offsetHSL(0, 0, amount);
  return `#${c.getHexString()}`;
};
function speckle(context, size, rnd, base, count, spread, alpha = 0.18, max = 3) {
  for (let i = 0; i < count; i++) {
    context.fillStyle = shade(base, (rnd() - 0.5) * spread);
    context.globalAlpha = alpha * (0.4 + rnd() * 0.8);
    const w = 1 + rnd() * max;
    context.fillRect(rnd() * size, rnd() * size, w, 1 + rnd() * max);
  }
  context.globalAlpha = 1;
}

const PAINTERS = {
  asphalt(context, size, rnd, { color = 0x34373b } = {}) {
    context.fillStyle = shade(color, 0); context.fillRect(0, 0, size, size);
    speckle(context, size, rnd, color, size * 40, 0.22, 0.5, 2);
    context.strokeStyle = 'rgba(8,9,10,.55)'; context.lineWidth = 1.2;
    for (let i = 0; i < 5; i++) {
      let x = rnd() * size, y = rnd() * size; context.beginPath(); context.moveTo(x, y);
      for (let s = 0; s < 6; s++) { x += (rnd() - 0.5) * 70; y += (rnd() - 0.2) * 60; context.lineTo(x, y); }
      context.stroke();
    }
    for (let i = 0; i < 6; i++) { context.fillStyle = 'rgba(10,10,12,.18)'; context.beginPath(); context.ellipse(rnd() * size, rnd() * size, 14 + rnd() * 28, 8 + rnd() * 16, rnd() * 3, 0, Math.PI * 2); context.fill(); }
  },
  pavement(context, size, rnd, { color = 0xa59f90 } = {}) {
    context.fillStyle = shade(color, 0); context.fillRect(0, 0, size, size);
    const cells = 4, cell = size / cells;
    for (let y = 0; y < cells; y++) for (let x = 0; x < cells; x++) { context.fillStyle = shade(color, (rnd() - 0.5) * 0.07); context.fillRect(x * cell, y * cell, cell, cell); }
    speckle(context, size, rnd, color, size * 30, 0.2, 0.5, 2);
    context.strokeStyle = 'rgba(40,36,30,.55)'; context.lineWidth = 2.2;
    for (let i = 0; i <= cells; i++) { context.beginPath(); context.moveTo(i * cell, 0); context.lineTo(i * cell, size); context.stroke(); context.beginPath(); context.moveTo(0, i * cell); context.lineTo(size, i * cell); context.stroke(); }
  },
  brick(context, size, rnd, { color = 0x8a5a47 } = {}) {
    context.fillStyle = '#4a3a32'; context.fillRect(0, 0, size, size);
    const rows = 16, bw = size / 6, bh = size / rows;
    for (let r = 0; r < rows; r++) for (let c = -1; c < 7; c++) {
      const x = c * bw + (r % 2 ? bw / 2 : 0);
      context.fillStyle = shade(color, (rnd() - 0.5) * 0.12); context.fillRect(x + 1, r * bh + 1, bw - 2, bh - 2);
    }
    speckle(context, size, rnd, color, size * 14, 0.25, 0.35, 2);
  },
  plaster(context, size, rnd, { color = 0xcfc4a8 } = {}) {
    context.fillStyle = shade(color, 0); context.fillRect(0, 0, size, size);
    for (let i = 0; i < 40; i++) { context.fillStyle = shade(color, (rnd() - 0.5) * 0.06); context.globalAlpha = 0.25; context.beginPath(); context.ellipse(rnd() * size, rnd() * size, 20 + rnd() * 60, 10 + rnd() * 40, rnd() * 3, 0, Math.PI * 2); context.fill(); }
    context.globalAlpha = 1; speckle(context, size, rnd, color, size * 16, 0.18, 0.4, 2);
    const stain = context.createLinearGradient(0, size * 0.6, 0, size); stain.addColorStop(0, 'rgba(60,50,40,0)'); stain.addColorStop(1, 'rgba(60,50,40,.22)');
    context.fillStyle = stain; context.fillRect(0, size * 0.6, size, size * 0.4);
  },
  facade(context, size, rnd, { color = 0xcfc4a8, lit = 0.18 } = {}) {
    PAINTERS.plaster(context, size, rnd, { color });
    const cols = 4, rows = 6, cw = size / cols, rh = size / rows;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const x = c * cw + cw * 0.2, y = r * rh + rh * 0.18, w = cw * 0.6, h = rh * 0.62;
      context.fillStyle = 'rgba(30,26,22,.85)'; context.fillRect(x - 3, y - 3, w + 6, h + 6);
      const on = rnd() < lit;
      const glass = context.createLinearGradient(x, y, x, y + h);
      if (on) { glass.addColorStop(0, '#f6d98d'); glass.addColorStop(1, '#c79a54'); } else { glass.addColorStop(0, '#2c3b48'); glass.addColorStop(1, '#101820'); }
      context.fillStyle = glass; context.fillRect(x, y, w, h);
      context.fillStyle = 'rgba(20,18,16,.8)'; context.fillRect(x + w / 2 - 1.5, y, 3, h); context.fillRect(x, y + h * 0.45, w, 3);
      if (!on) { context.fillStyle = 'rgba(180,200,220,.12)'; context.fillRect(x, y, w * 0.4, h * 0.5); }
      context.fillStyle = shade(color, -0.12); context.fillRect(x - 6, y + h + 3, w + 12, 5);
    }
  },
  wood(context, size, rnd, { color = 0x6e4a32 } = {}) {
    const planks = 8, ph = size / planks;
    for (let p = 0; p < planks; p++) {
      context.fillStyle = shade(color, (rnd() - 0.5) * 0.1); context.fillRect(0, p * ph, size, ph);
      for (let g = 0; g < 14; g++) { context.strokeStyle = shade(color, (rnd() - 0.5) * 0.16); context.globalAlpha = 0.5; context.lineWidth = 1; context.beginPath(); const y = p * ph + rnd() * ph; context.moveTo(0, y); context.bezierCurveTo(size * 0.3, y + (rnd() - 0.5) * 6, size * 0.6, y + (rnd() - 0.5) * 6, size, y + (rnd() - 0.5) * 4); context.stroke(); }
      context.globalAlpha = 1; context.fillStyle = 'rgba(15,10,6,.7)'; context.fillRect(0, p * ph, size, 2); context.fillRect((rnd() * 0.8 + 0.1) * size, p * ph, 2, ph);
    }
  },
  tile(context, size, rnd, { color = 0x8d949a } = {}) {
    const n = 4, c = size / n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { context.fillStyle = shade(color, ((x + y) % 2 ? -0.05 : 0.03) + (rnd() - 0.5) * 0.02); context.fillRect(x * c, y * c, c, c); }
    speckle(context, size, rnd, color, size * 14, 0.14, 0.4, 2);
    context.strokeStyle = 'rgba(30,34,38,.7)'; context.lineWidth = 2;
    for (let i = 0; i <= n; i++) { context.beginPath(); context.moveTo(i * c, 0); context.lineTo(i * c, size); context.stroke(); context.beginPath(); context.moveTo(0, i * c); context.lineTo(size, i * c); context.stroke(); }
  },
  concrete(context, size, rnd, { color = 0x5a6569 } = {}) {
    context.fillStyle = shade(color, 0); context.fillRect(0, 0, size, size);
    for (let i = 0; i < 60; i++) { context.fillStyle = shade(color, (rnd() - 0.5) * 0.08); context.globalAlpha = 0.3; context.beginPath(); context.ellipse(rnd() * size, rnd() * size, 10 + rnd() * 50, 8 + rnd() * 36, rnd() * 3, 0, Math.PI * 2); context.fill(); }
    context.globalAlpha = 1; speckle(context, size, rnd, color, size * 30, 0.2, 0.5, 2);
    context.strokeStyle = 'rgba(15,18,20,.5)'; context.lineWidth = 1.5; context.strokeRect(0, 0, size, size);
  },
  grass(context, size, rnd, { color = 0x4c5a3a } = {}) {
    context.fillStyle = shade(color, 0); context.fillRect(0, 0, size, size);
    speckle(context, size, rnd, color, size * 90, 0.3, 0.55, 3);
  },
  fabric(context, size, rnd, { color = 0x4a5f72 } = {}) {
    context.fillStyle = shade(color, 0); context.fillRect(0, 0, size, size);
    for (let i = 0; i < size; i += 3) { context.fillStyle = shade(color, (rnd() - 0.5) * 0.06); context.globalAlpha = 0.5; context.fillRect(i, 0, 1, size); context.fillRect(0, i, size, 1); }
    context.globalAlpha = 1;
  },
};

/** kind: asphalt | pavement | brick | plaster | facade | wood | tile | concrete | grass | fabric. Returns null without a canvas. */
export function proceduralTexture(kind, options = {}) {
  const painter = PAINTERS[kind];
  const size = options.size ?? 256;
  const surface = painter ? canvasOf(size) : null;
  if (!surface) return null;
  painter(surface.context, size, random(options.seed ?? kind.length * 7919), options);
  const texture = new THREE.CanvasTexture(surface.canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  const [rx, ry] = options.repeat ?? [1, 1];
  texture.repeat.set(rx, ry);
  return texture;
}
