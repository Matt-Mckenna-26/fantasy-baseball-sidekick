import { useEffect, useRef } from 'react';
import styles from './chat.module.css';

type Speck = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  rgb: [number, number, number];
  glow: number;
};

const COLORS: [number, number, number][] = [
  [248, 250, 252],
  [226, 232, 240],
  [203, 213, 225],
  [196, 181, 253],
  [165, 180, 220],
];

function spawn(width: number, height: number): Speck[] {
  const area = Math.max(1, width * height);
  const count = Math.max(90, Math.min(160, Math.round(area / 9_000)));
  const specks: Speck[] = [];
  for (let i = 0; i < count; i++) {
    const roll = Math.random();
    const r = roll > 0.92 ? 1.6 + Math.random() * 0.4 : roll > 0.55 ? 1.1 + Math.random() * 0.35 : 0.8 + Math.random() * 0.22;
    specks.push({
      x: r + Math.random() * Math.max(1, width - r * 2),
      y: r + Math.random() * Math.max(1, height - r * 2),
      vx: (Math.random() - 0.5) * 6,
      vy: (Math.random() - 0.5) * 6,
      r,
      rgb: COLORS[i % COLORS.length] ?? [226, 232, 240],
      glow: r > 1.4 ? 0.9 : r > 1.05 ? 0.72 : 0.52,
    });
  }
  return specks;
}

function drawSpeck(ctx: CanvasRenderingContext2D, speck: Speck): void {
  const [cr, cg, cb] = speck.rgb;
  const halo = speck.r * 3;
  const grad = ctx.createRadialGradient(speck.x, speck.y, 0, speck.x, speck.y, halo);
  grad.addColorStop(0, `rgba(${cr},${cg},${cb},${speck.glow * 0.35})`);
  grad.addColorStop(0.45, `rgba(${cr},${cg},${cb},0.08)`);
  grad.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(speck.x, speck.y, halo, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(speck.x, speck.y, speck.r, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(${cr},${cg},${cb},${speck.glow})`;
  ctx.fill();
}

/**
 * Slow colliding star-specks behind the whole chat surface. Canvas only — no pointer events,
 * paused when the tab is hidden, and frozen to a still field when motion is reduced.
 */
export function ChatBackdrop() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let specks: Speck[] = [];
    let width = 0;
    let height = 0;
    let raf = 0;
    let last = performance.now();
    let running = false;

    const sizeToParent = (): boolean => {
      const host = canvas.parentElement;
      if (!host) return false;
      const rect = host.getBoundingClientRect();
      const nextW = Math.max(1, Math.round(rect.width));
      const nextH = Math.max(1, Math.round(rect.height));
      if (rect.width < 2 || rect.height < 2) return false;
      if (nextW === width && nextH === height && specks.length > 0) return true;
      width = nextW;
      height = nextH;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      specks = spawn(width, height);
      return true;
    };

    const paint = (): void => {
      ctx.clearRect(0, 0, width, height);
      for (const speck of specks) drawSpeck(ctx, speck);
    };

    const step = (dt: number): void => {
      const t = performance.now() * 0.0001;
      for (const speck of specks) {
        speck.vx += Math.sin(speck.y * 0.012 + t) * 1.4 * dt;
        speck.vy += Math.cos(speck.x * 0.012 + t) * 1.4 * dt;

        const speed = Math.hypot(speck.vx, speck.vy);
        const cap = 7;
        if (speed > cap) {
          speck.vx = (speck.vx / speed) * cap;
          speck.vy = (speck.vy / speed) * cap;
        } else if (speed < 1.6) {
          speck.vx = (speck.vx / (speed || 1)) * 1.6;
          speck.vy = (speck.vy / (speed || 1)) * 1.6;
        }

        speck.x += speck.vx * dt;
        speck.y += speck.vy * dt;

        if (speck.x < speck.r) {
          speck.x = speck.r;
          speck.vx = Math.abs(speck.vx);
        } else if (speck.x > width - speck.r) {
          speck.x = width - speck.r;
          speck.vx = -Math.abs(speck.vx);
        }
        if (speck.y < speck.r) {
          speck.y = speck.r;
          speck.vy = Math.abs(speck.vy);
        } else if (speck.y > height - speck.r) {
          speck.y = height - speck.r;
          speck.vy = -Math.abs(speck.vy);
        }
      }

      for (let i = 0; i < specks.length; i++) {
        const a = specks[i];
        if (!a) continue;
        for (let j = i + 1; j < specks.length; j++) {
          const b = specks[j];
          if (!b) continue;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.hypot(dx, dy);
          const minDist = a.r + b.r + 0.6;
          if (dist >= minDist || dist === 0) continue;
          const nx = dx / dist;
          const ny = dy / dist;
          const rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
          if (rel > 0) {
            const ma = a.r * a.r;
            const mb = b.r * b.r;
            const impulse = (2 * rel) / (ma + mb);
            a.vx -= impulse * mb * nx;
            a.vy -= impulse * mb * ny;
            b.vx += impulse * ma * nx;
            b.vy += impulse * ma * ny;
          }
          const push = (minDist - dist) * 0.5;
          a.x -= nx * push;
          a.y -= ny * push;
          b.x += nx * push;
          b.y += ny * push;
        }
      }
    };

    const loop = (now: number): void => {
      if (!running) return;
      const dt = Math.min(0.032, (now - last) / 1000);
      last = now;
      step(dt);
      paint();
      raf = window.requestAnimationFrame(loop);
    };

    const start = (): void => {
      if (running || reduced.matches) return;
      running = true;
      last = performance.now();
      raf = window.requestAnimationFrame(loop);
    };

    const stop = (): void => {
      running = false;
      window.cancelAnimationFrame(raf);
    };

    const onVisibility = (): void => {
      if (document.hidden) stop();
      else if (!reduced.matches) start();
    };

    const onMotion = (): void => {
      if (reduced.matches) {
        stop();
        paint();
      } else {
        start();
      }
    };

    if (sizeToParent()) {
      paint();
      if (!reduced.matches && !document.hidden) start();
    }

    const host = canvas.parentElement;
    const ro = new ResizeObserver(() => {
      if (!sizeToParent()) return;
      paint();
      if (!running && !reduced.matches && !document.hidden) start();
    });
    if (host) ro.observe(host);
    document.addEventListener('visibilitychange', onVisibility);
    reduced.addEventListener('change', onMotion);

    return () => {
      stop();
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      reduced.removeEventListener('change', onMotion);
    };
  }, []);

  return <canvas ref={canvasRef} className={styles.backdrop} aria-hidden="true" />;
}
