// Draws the animals as tiny voxel figures on top of the landscape.

import { N } from './config.js';
import { SPECIES, A } from './species.js';
import { mix, shade, rgb } from './palette.js';

const LEFT = 0.86, RIGHT = 0.72;
const K = 1.7; // drawn larger than life so they read at a glance

const COLORS = {
  otter: { body: [104, 80, 60], light: [150, 122, 94] },
  deer: { body: [184, 140, 98], light: [222, 196, 160], leg: [118, 92, 70] },
  rabbit: { body: [160, 138, 112], winter: [238, 238, 234], light: [236, 230, 220] },
  fox: { body: [212, 120, 64], light: [244, 238, 228], leg: [80, 60, 50] },
  heron: { body: [168, 176, 188], light: [236, 238, 240], leg: [118, 114, 100], beak: [214, 176, 80] },
};

function box(ctx, cx, by, hw, h, c) {
  const hh = hw / 2;
  ctx.fillStyle = rgb(shade(c, LEFT));
  ctx.beginPath();
  ctx.moveTo(cx - hw, by - h); ctx.lineTo(cx, by - h + hh); ctx.lineTo(cx, by + hh); ctx.lineTo(cx - hw, by);
  ctx.fill();
  ctx.fillStyle = rgb(shade(c, RIGHT));
  ctx.beginPath();
  ctx.moveTo(cx, by - h + hh); ctx.lineTo(cx + hw, by - h); ctx.lineTo(cx + hw, by); ctx.lineTo(cx, by + hh);
  ctx.fill();
  ctx.fillStyle = rgb(c);
  ctx.beginPath();
  ctx.moveTo(cx, by - h - hh); ctx.lineTo(cx + hw, by - h); ctx.lineTo(cx, by - h + hh); ctx.lineTo(cx - hw, by - h);
  ctx.fill();
}

function line(ctx, x1, y1, x2, y2, c, w = 0.45) {
  ctx.strokeStyle = rgb(c); ctx.lineWidth = w;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
}

export function drawCreatures(r, ctx, alpha, time) {
  const w = r.world, buf = r.front;
  const yf = w.cal.yearFrac;
  const winter = yf > 0.73 || yf < 0.04;
  const list = [];
  for (const a of w.animals) {
    const x = a.px + (a.x - a.px) * alpha, y = a.py + (a.y - a.py) * alpha;
    const [di, dj] = r.toDisplay(x, y);
    const k = Math.round(y) * N + Math.round(x);
    const surf = buf.surf[k];
    const sx = r.originX + (di - dj) * 6;
    const sy = r.originY + (di + dj) * 3 - surf * 5;
    const [hx, hy] = r.dir(Math.cos(a.heading), Math.sin(a.heading));
    let fx = (hx - hy), fy = (hx + hy) * 0.5;
    const fl = Math.hypot(fx, fy) || 1;
    fx /= fl; fy /= fl;
    list.push({ a, sx, sy, fx, fy, depth: di + dj, k });
  }
  list.sort((p, q) => p.depth - q.depth);
  r.animalScreen = list;

  for (const it of list) {
    const { a, sx, fx, fy, k } = it;
    ctx.save();
    ctx.translate(sx * (1 - K), it.sy * (1 - K));
    ctx.scale(K, K);
    let { sy } = it;
    const S = SPECIES[a.sp];
    const C = COLORS[a.sp];
    const young = (w.minute - a.born) / (28 * 1440) < S.adult;
    const sc = young ? 0.65 : 1;
    const inWater = w.water[k] > 0.25 && !w.ice[k];
    const moving = Math.hypot(a.x - a.px, a.y - a.py) > 0.02;
    const bob = moving ? Math.abs(Math.sin(time * (a.pose === 'run' ? 14 : 8) + a.id)) * 0.5 : 0;
    const lift = a.flying ? 16 : 0;

    // Shadow
    ctx.fillStyle = 'rgba(30,40,40,0.18)';
    ctx.beginPath(); ctx.ellipse(sx, sy, 2.2 * sc, 1.0 * sc, 0, 0, Math.PI * 2); ctx.fill();
    if (r.selected === a.id) {
      ctx.strokeStyle = 'rgba(255,236,170,0.9)'; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.ellipse(sx, sy, 4, 2, 0, 0, Math.PI * 2); ctx.stroke();
    }
    sy -= bob + lift;

    if (a.sp === 'otter') {
      if (inWater) {
        if (a.pose === 'dive' && Math.sin(time * 1.3 + a.id * 3) > 0.2) {
          ctx.strokeStyle = 'rgba(240,250,252,0.6)'; ctx.lineWidth = 0.4;
          ctx.beginPath(); ctx.ellipse(sx, sy, 1.6, 0.8, 0, 0, Math.PI * 2); ctx.stroke();
          { ctx.restore(); continue; }
        }
        if (moving) {
          ctx.strokeStyle = 'rgba(240,250,252,0.55)'; ctx.lineWidth = 0.4;
          ctx.beginPath();
          ctx.moveTo(sx - fx * 4 - fy * 2, sy - fy * 4 + fx * 1); ctx.lineTo(sx - fx * 1, sy - fy * 1);
          ctx.lineTo(sx - fx * 4 + fy * 2, sy - fy * 4 - fx * 1);
          ctx.stroke();
        }
        ctx.fillStyle = rgb(C.body);
        ctx.beginPath(); ctx.ellipse(sx - fx * 0.6, sy - fy * 0.6, 1.9 * sc, 0.85 * sc, Math.atan2(fy, fx), 0, Math.PI * 2); ctx.fill();
        if (a.pose === 'sleep') { // floating on its back
          ctx.fillStyle = rgb(C.light);
          ctx.beginPath(); ctx.ellipse(sx - fx * 0.6, sy - fy * 0.6 - 0.2, 1.1 * sc, 0.45 * sc, Math.atan2(fy, fx), 0, Math.PI * 2); ctx.fill();
        } else box(ctx, sx + fx * 1.4 * sc, sy + fy * 1.4 * sc, 0.7 * sc, 0.9 * sc, C.body);
      } else if (a.pose === 'sleep') {
        box(ctx, sx, sy, 1.3 * sc, 0.8 * sc, C.body);
      } else {
        const hop = a.pose === 'play' ? Math.abs(Math.sin(time * 10 + a.id)) * 1.2 : 0;
        box(ctx, sx - fx * 1.2 * sc, sy - fy * 1.2 * sc - hop, 0.8 * sc, 0.8 * sc, C.body);
        box(ctx, sx, sy - hop, 0.9 * sc, 1.0 * sc, C.body);
        box(ctx, sx + fx * 1.3 * sc, sy + fy * 1.3 * sc - hop, 0.7 * sc, 1.2 * sc, C.light);
      }
    } else if (a.sp === 'deer') {
      const legH = 2 * sc;
      if (a.pose === 'sleep') { box(ctx, sx, sy, 1.5 * sc, 1.1 * sc, C.body); box(ctx, sx + fx * 1.5 * sc, sy + fy * 1.5 * sc, 0.6 * sc, 1.8 * sc, C.body); { ctx.restore(); continue; } }
      const step = moving ? Math.sin(time * 9 + a.id) * 0.6 : 0;
      line(ctx, sx - fx * 1, sy - fy * 1, sx - fx * 1 + step, sy - fy * 1 - legH, C.leg);
      line(ctx, sx + fx * 1, sy + fy * 1, sx + fx * 1 - step, sy + fy * 1 - legH, C.leg);
      box(ctx, sx, sy - legH, 1.4 * sc, 1.4 * sc, young ? mix(C.body, C.light, 0.25) : C.body);
      const headDown = a.pose === 'eat';
      const hx = sx + fx * 1.9 * sc, hy = sy + fy * 1.9 * sc - legH - (headDown ? -1.4 : 1.6) * sc;
      box(ctx, hx, hy, 0.6 * sc, 1.0 * sc, C.body);
      if (!young && a.sex === 'm' && !headDown) { line(ctx, hx - 0.4, hy - 1, hx - 0.9, hy - 2.4, C.leg, 0.35); line(ctx, hx + 0.4, hy - 1, hx + 0.9, hy - 2.4, C.leg, 0.35); }
    } else if (a.sp === 'rabbit') {
      const c = winter ? C.winter : C.body;
      const hop = moving ? Math.abs(Math.sin(time * 12 + a.id)) * 1.1 : 0;
      box(ctx, sx, sy - hop, 0.75 * sc, a.pose === 'sleep' ? 0.6 : 0.8 * sc, c);
      if (a.pose !== 'sleep') {
        const ex = sx + fx * 0.5, ey = sy + fy * 0.5 - 0.8 * sc - hop;
        line(ctx, ex - 0.2, ey, ex - 0.4, ey - 1.4 * sc, c, 0.35);
        line(ctx, ex + 0.2, ey, ex + 0.1, ey - 1.4 * sc, c, 0.35);
      }
      ctx.fillStyle = rgb(C.light); ctx.fillRect(sx - fx * 0.8 - 0.3, sy - fy * 0.8 - 0.8 - hop, 0.6, 0.6);
    } else if (a.sp === 'fox') {
      if (a.pose === 'sleep') { box(ctx, sx, sy, 1.2 * sc, 0.8 * sc, C.body); ctx.fillStyle = rgb(C.light); ctx.fillRect(sx + 0.6, sy - 0.6, 0.7, 0.5); { ctx.restore(); continue; } }
      const pounce = a.pose === 'pounce' ? Math.max(0, Math.sin(time * 3 + a.id)) * 1.6 : 0;
      line(ctx, sx - fx * 0.8, sy - fy * 0.8, sx - fx * 0.8, sy - fy * 0.8 - 1, C.leg);
      line(ctx, sx + fx * 0.8, sy + fy * 0.8, sx + fx * 0.8, sy + fy * 0.8 - 1, C.leg);
      box(ctx, sx - fx * 2.1 * sc, sy - fy * 2.1 * sc - 0.9, 0.55 * sc, 0.6 * sc, C.body);
      ctx.fillStyle = rgb(C.light); ctx.fillRect(sx - fx * 2.7 * sc - 0.3, sy - fy * 2.7 * sc - 1.2, 0.6, 0.5);
      box(ctx, sx, sy - 1 - pounce, 1.0 * sc, 0.9 * sc, C.body);
      box(ctx, sx + fx * 1.3 * sc, sy + fy * 1.3 * sc - 1.3 - pounce, 0.6 * sc, 0.9 * sc, C.body);
    } else if (a.sp === 'heron') {
      if (a.flying) {
        const flap = Math.sin(time * 7 + a.id) * 2.2;
        ctx.fillStyle = 'rgba(30,40,40,0.12)';
        ctx.beginPath(); ctx.ellipse(sx, sy + lift, 2.5, 1, 0, 0, Math.PI * 2); ctx.fill();
        line(ctx, sx - 3.2, sy - flap, sx, sy, C.body, 0.8);
        line(ctx, sx + 3.2, sy - flap, sx, sy, C.body, 0.8);
        box(ctx, sx, sy + 0.5, 0.6, 0.8, C.body);
        line(ctx, sx + fx * 0.6, sy + fy * 0.6, sx + fx * 2.2, sy + fy * 2.2 - 0.3, C.light, 0.45);
        { ctx.restore(); continue; }
      }
      const legH = 2.6 * sc;
      line(ctx, sx - 0.3, sy, sx - 0.3, sy - legH, C.leg, 0.35);
      line(ctx, sx + 0.3, sy, sx + 0.3, sy - legH, C.leg, 0.35);
      box(ctx, sx, sy - legH, 0.8 * sc, 1.4 * sc, C.body);
      const stalk = a.pose === 'stalk';
      const nx = sx + fx * (stalk ? 1.6 : 0.6), ny = sy - legH - 1.4 * sc - (stalk ? 0.6 : 2.2);
      line(ctx, sx + fx * 0.4, sy - legH - 1.2 * sc, nx, ny, C.light, 0.5);
      box(ctx, nx, ny, 0.4, 0.6, C.light);
      line(ctx, nx + fx * 0.3, ny - 0.3, nx + fx * 1.6, ny + fy * 1.6 - 0.1, C.beak, 0.35);
    }
    ctx.restore();
  }
}
