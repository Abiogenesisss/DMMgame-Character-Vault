const clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, n));
function keys(points: number[][], time: number, fallback: number) {
  if (!points?.length) return fallback;
  if (time <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) if (time <= points[i][0]) {
    const a = points[i - 1], b = points[i], duration = b[0] - a[0], t = duration ? (time - a[0]) / duration : 1;
    if (a[3] == null || b[2] == null) return a[1];
    return (2 * t ** 3 - 3 * t ** 2 + 1) * a[1] + (t ** 3 - 2 * t ** 2 + t) * a[3] * duration
      + (-2 * t ** 3 + 3 * t ** 2) * b[1] + (t ** 3 - t ** 2) * b[2] * duration;
  }
  return points.at(-1)[1];
}
export function sampleCurve(c: any, time = 0, random = .5, fallback = 0): number {
  if (!c) return fallback;
  if (c.mode === 1) return c.max * keys(c.b, time, 1);
  if (c.mode === 2) return c.max * (keys(c.a, time, 1) * (1 - random) + keys(c.b, time, 1) * random);
  if (c.mode === 3) return c.min + (c.max - c.min) * random;
  return c.max;
}
function gradient(g, time) {
  const interpolate = (pairs, component, fallback) => {
    if (!pairs?.length) return fallback;
    const value = p => component ? p[1][component] : p[1];
    if (time <= pairs[0][0]) return value(pairs[0]);
    for (let i = 1; i < pairs.length; i++) if (time <= pairs[i][0]) {
      const t = (time - pairs[i - 1][0]) / (pairs[i][0] - pairs[i - 1][0] || 1); return value(pairs[i - 1]) * (1 - t) + value(pairs[i]) * t;
    }
    return value(pairs.at(-1));
  };
  return { r: interpolate(g?.rgb, 'r', 1), g: interpolate(g?.rgb, 'g', 1), b: interpolate(g?.rgb, 'b', 1), a: interpolate(g?.alpha, null, 1) };
}
export function sampleColor(c, time = 0, random = .5) {
  if (!c) return { r: 1, g: 1, b: 1, a: 1 };
  if (c.mode === 0) return c.max;
  if (c.mode === 1 || c.mode === 4) return gradient(c.b, c.mode === 4 ? random : time);
  const a = c.mode === 2 ? c.min : gradient(c.a, time), b = c.mode === 2 ? c.max : gradient(c.b, time);
  return Object.fromEntries(['r', 'g', 'b', 'a'].map(key => [key, a[key] * (1 - random) + b[key] * random]));
}
const noise = (id: number, salt: number) => { const n = Math.sin(id * 127.1 + salt * 311.7) * 43758.5453; return n - Math.floor(n); };
export class ParticleEffect {
  canvas = document.createElement('canvas');
  context: CanvasRenderingContext2D;
  images = new Map<string, HTMLImageElement>();
  tinted = new Map<string, HTMLCanvasElement>();
  particles: any[] = [];
  emitters: any[] = [];
  frame: number;
  elapsed = 0;
  last = 0;
  serial = 0;
  tintBytes = 0;
  destroyed = false;
  pending = new Set<() => void>();
  constructor(public host: HTMLElement, public data: any, public asset: (f: string) => string) {
    this.canvas.width = 1280; this.canvas.height = 720; this.canvas.className = 'twinkle-particles'; this.context = this.canvas.getContext('2d'); host.append(this.canvas);
    this.emitters = (data.emitters || []).slice(0, 100).map((e, i) => ({ ...e, index: i, count: 0, delayTime: sampleCurve(e.delay), cycle: -1 }));
  }
  async load() {
    await Promise.all([...new Set<string>(this.emitters.map(e => e.texture.file))].map(file => new Promise<void>((resolve, reject) => {
      const img = new Image(), cancel = () => { img.onload = img.onerror = null; img.src = ''; resolve(); };
      this.pending.add(cancel); this.images.set(file, img);
      img.onload = () => { this.pending.delete(cancel); resolve(); }; img.onerror = () => { this.pending.delete(cancel); reject(new Error('演出贴图读取失败。')); }; img.src = this.asset(file);
    })));
    if (!this.destroyed && this.context) this.frame = requestAnimationFrame(t => this.tick(t));
  }
  remaining() { return Math.max(0, ...this.emitters.map(e => e.delayTime + e.duration + Math.max(e.lifetime.min, e.lifetime.max) - this.elapsed)) * 1000; }
  emit(e, time) {
    if (this.particles.length >= 1800 || this.particles.filter(p => p.e === e).length >= e.max) return;
    const id = ++this.serial, r = noise(id, 0), angle = noise(id, 1) * Math.PI * 2;
    const shape = e.shape, radius = shape.enabled ? (shape.radius?.value || 0) * Math.sqrt(noise(id, 2)) : 0;
    const box = [5, 8, 9].includes(shape.type);
    const x = shape.enabled ? box ? (noise(id, 3) - .5) * shape.m_Scale.x : Math.cos(angle) * radius : 0;
    const y = shape.enabled ? box ? (noise(id, 4) - .5) * shape.m_Scale.y : Math.sin(angle) * radius : 0;
    const speed = sampleCurve(e.speed, time, r), life = Math.max(.01, sampleCurve(e.lifetime, time, r));
    this.particles.push({ e, r, age: 0, life, x: x + (shape.m_Position?.x || 0), y: y + (shape.m_Position?.y || 0),
      vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, size: sampleCurve(e.size, time, r), sizeY: sampleCurve(e.sizeY, time, r, sampleCurve(e.size, time, r)),
      rotation: sampleCurve(e.rotation, time, r), color: sampleColor(e.color, time, r) });
  }
  tick(now: number) {
    if (this.destroyed) return;
    const dt = this.last ? Math.min(.05, (now - this.last) / 1000) : 0; this.last = now; const previous = this.elapsed; this.elapsed += dt;
    for (const e of this.emitters) {
      const elapsed = this.elapsed - e.delayTime; if (elapsed < 0 || (!e.loop && elapsed > e.duration)) continue;
      const duration = Math.max(.01, e.duration), cycle = Math.floor(elapsed / duration), local = elapsed % duration;
      const before = cycle === e.cycle ? Math.max(0, previous - e.delayTime) % duration : -.001; e.cycle = cycle;
      e.count += Math.max(0, sampleCurve(e.rate, local / duration)) * dt;
      let count = Math.floor(e.count); e.count -= count;
      for (const b of e.bursts) for (let i = 0; i < Math.min(50, b.cycles || 1); i++) {
        const at = b.time + i * b.interval; if (at > before && at <= local && noise(cycle + i, e.index) <= b.probability) count += sampleCurve(b.count);
      }
      for (let i = 0; i < Math.min(300, count); i++) this.emit(e, local / duration);
    }
    const ctx = this.context; ctx.clearRect(0, 0, 1280, 720);
    this.particles = this.particles.filter(p => (p.age += dt) < p.life);
    for (const p of this.particles) {
      const e = p.e, time = p.age / p.life, c = sampleColor(e.colorOverLife, time, p.r), size = sampleCurve(e.sizeOverLife, time, p.r, 1);
      p.vx += sampleCurve(e.force[0], time, p.r) * dt; p.vy += (sampleCurve(e.force[1], time, p.r) - sampleCurve(e.gravity, time, p.r) * 9.81) * dt;
      p.x += (p.vx + sampleCurve(e.velocity[0], time, p.r)) * dt; p.y += (p.vy + sampleCurve(e.velocity[1], time, p.r)) * dt;
      p.rotation += sampleCurve(e.rotationOverLife, time, p.r) * dt;
      const color = ['r', 'g', 'b'].map(k => Math.round(clamp(p.color[k] * c[k] * e.tint[k]) * 15) * 17);
      const img = this.images.get(e.texture.file); if (!img?.naturalWidth) continue;
      const key = e.texture.file + ':' + color.join(), source = this.tinted.get(key) || (() => {
        if (color.every(n => n === 255) || this.tintBytes + img.naturalWidth * img.naturalHeight * 4 > 16 * 1024 ** 2) return img;
        const canvas = document.createElement('canvas'); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
        const context = canvas.getContext('2d'); if (!context) return img;
        context.drawImage(img, 0, 0); context.globalCompositeOperation = 'multiply'; context.fillStyle = `rgb(${color.join(',')})`; context.fillRect(0, 0, canvas.width, canvas.height); context.globalCompositeOperation = 'destination-in'; context.drawImage(img, 0, 0);
        this.tinted.set(key, canvas); this.tintBytes += canvas.width * canvas.height * 4; return canvas;
      })();
      const [x, y, sx, sy, angle] = e.pose; ctx.save(); ctx.translate(640 + x * 100, 360 - y * 100); ctx.rotate(-angle); ctx.scale(sx, sy);
      ctx.translate(p.x * 100, -p.y * 100); ctx.rotate(-p.rotation); ctx.globalAlpha = clamp(p.color.a * c.a * e.tint.a); ctx.globalCompositeOperation = e.additive ? 'lighter' : 'source-over';
      const width = Math.max(.1, p.size * size * 100), height = Math.max(.1, p.sizeY * size * 100 * e.stretch);
      if (e.sheet) {
        const { cols, rows } = e.sheet, index = Math.floor((sampleCurve(e.sheet.start, 0, p.r) + sampleCurve(e.sheet.frame, time, p.r) * e.sheet.cycles) * cols * rows) % (cols * rows), w = img.naturalWidth / cols, h = img.naturalHeight / rows;
        ctx.drawImage(source, index % cols * w, Math.floor(index / cols) * h, w, h, -width / 2, -height / 2, width, height);
      } else ctx.drawImage(source, -width / 2, -height / 2, width, height);
      ctx.restore();
    }
    if (this.particles.length || this.emitters.some(e => e.loop) || this.remaining() > 0) this.frame = requestAnimationFrame(t => this.tick(t));
  }
  destroy() { this.destroyed = true; cancelAnimationFrame(this.frame); for (const resolve of this.pending) resolve(); this.pending.clear(); this.images.clear(); this.tinted.clear(); this.particles = []; this.canvas.remove(); }
}
