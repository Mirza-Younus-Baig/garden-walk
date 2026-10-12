import * as THREE from 'three';

/**
 * What the TV shows when it is on: a gentle birthday slideshow, drawn live on a canvas.
 * Four scenes cross-fade every few seconds. Kept warm and friendly: wishes, a cake, the
 * night sky, her name.
 */

const W = 1024, H = 576;

export class TvShow {
  texture: THREE.CanvasTexture;
  /** average colour of the frame, for the light the screen throws on the room */
  glow = new THREE.Color('#ffd6e4');
  private c: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private acc = 0;
  private t = 0;
  private stars: Array<[number, number, number]> = [];
  private confetti: Array<{ x: number; y: number; v: number; r: number; c: string; s: number }> = [];

  constructor(private name: string) {
    this.c = document.createElement('canvas');
    this.c.width = W; this.c.height = H;
    this.ctx = this.c.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.c);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    for (let i = 0; i < 120; i++) this.stars.push([Math.random() * W, Math.random() * H * 0.75, Math.random()]);
    const cols = ['#f6a6bf', '#ffd59e', '#a8dcc9', '#c7b3f2', '#9fcdf2'];
    for (let i = 0; i < 70; i++) this.confetti.push({ x: Math.random() * W, y: Math.random() * H, v: 30 + Math.random() * 60, r: Math.random() * 6, c: cols[i % cols.length], s: 4 + Math.random() * 6 });
    this.draw();
  }

  /** advance; redraws at ~24 fps */
  update(dt: number) {
    this.t += dt; this.acc += dt;
    if (this.acc < 1 / 24) return;
    this.acc = 0;
    this.draw();
    this.texture.needsUpdate = true;
  }

  private draw() {
    const ctx = this.ctx, t = this.t;
    const SCENE = 6;
    const k = t / SCENE, i = Math.floor(k) % 4, f = k - Math.floor(k);
    // cross-fade over the last 0.8 s of each scene
    const fadeIn = Math.min(1, f * SCENE / 0.8);
    this.scene((i + 3) % 4, t);
    ctx.globalAlpha = fadeIn;
    this.scene(i, t);
    ctx.globalAlpha = 1;
    // vignette and a faint scanline sheen so it reads as a screen
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.65);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const tints = ['#ffc7d6', '#c9d8ff', '#ffe1b0', '#d7c7ff'];
    this.glow.set(tints[i]).lerp(new THREE.Color(tints[(i + 3) % 4]), 1 - fadeIn);
  }

  private scene(i: number, t: number) {
    const ctx = this.ctx;
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (i === 0) {
      // her name, with confetti falling
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, '#ffd1dc'); g.addColorStop(1, '#ffe9c7');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      for (const p of this.confetti) {
        const y = (p.y + t * p.v) % (H + 20) - 10;
        ctx.save(); ctx.translate(p.x + Math.sin(t * 2 + p.r) * 10, y); ctx.rotate(t * 2 + p.r);
        ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore();
      }
      ctx.fillStyle = '#7a3e57';
      ctx.font = '600 54px Fredoka, sans-serif';
      ctx.fillText('Happy Birthday', W / 2, H * 0.36);
      ctx.font = '700 150px "Dancing Script", cursive';
      ctx.fillStyle = '#c2456f';
      const bob = Math.sin(t * 2) * 6;
      ctx.fillText(this.name, W / 2, H * 0.62 + bob, W * 0.9);
    } else if (i === 1) {
      // a cake with candles that flicker
      ctx.fillStyle = '#2b2140'; ctx.fillRect(0, 0, W, H);
      const cx = W / 2, cy = H * 0.66;
      ctx.fillStyle = '#5a3424'; ctx.fillRect(cx - 170, cy - 70, 340, 130);
      ctx.fillStyle = '#3a2016'; ctx.beginPath(); ctx.ellipse(cx, cy - 70, 170, 26, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#f6a6bf'; ctx.fillRect(cx - 170, cy - 10, 340, 12);
      for (let k = 0; k < 5; k++) {
        const x = cx - 120 + k * 60;
        ctx.fillStyle = ['#f7a8c0', '#9fd3f2', '#fbe18a', '#a9e5c4', '#cdb4f5'][k];
        ctx.fillRect(x - 6, cy - 140, 12, 70);
        const fl = 1 + 0.1 * Math.sin(t * 13 + k * 2);
        const g = ctx.createRadialGradient(x, cy - 160, 2, x, cy - 160, 40);
        g.addColorStop(0, 'rgba(255,220,140,0.9)'); g.addColorStop(1, 'rgba(255,180,80,0)');
        ctx.fillStyle = g; ctx.fillRect(x - 40, cy - 200, 80, 80);
        ctx.fillStyle = '#ffd36b'; ctx.beginPath(); ctx.ellipse(x, cy - 158, 7, 16 * fl, 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = '#ffe7f0'; ctx.font = '600 52px Fredoka, sans-serif';
      ctx.fillText('Make a wish ✨', W / 2, H * 0.18);
    } else if (i === 2) {
      // night sky, a shooting star every few seconds
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#0d1236'); g.addColorStop(1, '#4a3f7a');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      for (const [x, y, s] of this.stars) { ctx.globalAlpha *= 1; ctx.fillStyle = `rgba(255,248,230,${0.4 + 0.6 * Math.abs(Math.sin(t * (1 + s) + s * 9))})`; ctx.fillRect(x, y, 2 + s * 2, 2 + s * 2); }
      const sk = (t % 3) / 3;
      ctx.strokeStyle = `rgba(255,255,255,${Math.sin(sk * Math.PI)})`; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(150 + sk * 600, 60 + sk * 160); ctx.lineTo(90 + sk * 600, 40 + sk * 160); ctx.stroke();
      ctx.fillStyle = '#fff3d6'; ctx.font = '600 48px Fredoka, sans-serif';
      ctx.fillText('May all your wishes come true', W / 2, H * 0.78);
    } else {
      // three little wishes on cards
      ctx.fillStyle = '#f3ecff'; ctx.fillRect(0, 0, W, H);
      const wishes = [['More laughter', '#ffd1dc'], ['Big adventures', '#d7f0e6'], ['Cosy days', '#ffe9c7']];
      wishes.forEach(([txt, col], k) => {
        const x = W * (0.2 + k * 0.3), y = H * 0.52 + Math.sin(t * 1.6 + k) * 10;
        ctx.save(); ctx.translate(x, y); ctx.rotate(Math.sin(k * 2.3) * 0.08);
        ctx.fillStyle = 'rgba(0,0,0,0.08)'; ctx.fillRect(-120, -86, 248, 180);
        ctx.fillStyle = col; ctx.fillRect(-124, -90, 248, 180);
        ctx.fillStyle = '#5b4a6b'; ctx.font = '600 34px Fredoka, sans-serif'; ctx.fillText(txt, 0, 0);
        ctx.restore();
      });
      ctx.fillStyle = '#6d5a8a'; ctx.font = '700 64px "Dancing Script", cursive';
      ctx.fillText('for the year ahead', W / 2, H * 0.16);
    }
    ctx.restore();
  }
}
