// Isometric voxel renderer. The landscape is drawn into an off-screen cache a few
// rows at a time (so the page never stutters) and swapped in when complete.
// Light, weather and small moving details are drawn on top every frame.

import { N, MAX_H, BASE_DEPTH, DAYS_PER_YEAR } from './config.js';
import { hash2, clamp } from './rng.js';
import { TREE } from './vegetation.js';
import { MAT } from './terrain.js';
import { drawCreatures, drawSchools, drawBubbles } from './creatures.js';
import { MAT_COLORS, COL, mix, shade, rgb, rgba, grassColor, leafState, skyColors, lightTint } from './palette.js';

const TW = 12, TH = 6, VH = 5;          // tile width/height and one voxel step, in world pixels
const HW = TW / 2, HH = TH / 2;
const CS = 1.5;                         // cache resolution multiplier
const LEFT = 0.86, RIGHT = 0.72;        // face lighting
const E = 0.35;                         // tiny overlap to hide seams

export class Renderer {
  constructor(canvas, world) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.world = world;
    this.rot = 0;
    this.worldW = N * TW + TW * 2;
    this.worldH = N * TH + (MAX_H + BASE_DEPTH + 6) * VH;
    this.originX = this.worldW / 2;
    this.originY = (MAX_H + 4) * VH;
    this.front = this.makeBuffer();
    this.back = this.makeBuffer();
    this.job = null;
    this.lastBuildDone = -1e9;
    this.scene = document.createElement('canvas');
    this.sctx = this.scene.getContext('2d');
    this.cam = { x: this.worldW / 2, y: this.worldH * 0.52, z: 1, fit: 1, userZoom: 1, panX: 0, panY: 0 };
    this.particles = { glint: [], streak: [], jump: [], ripple: [], smoke: [], shadow: [] };
    this.drops = [];
    this.flakes = [];
    this.stars = Array.from({ length: 140 }, (_, k) => ({ x: hash2(k, 1, 7), y: hash2(k, 2, 7) * 0.6, s: 0.5 + hash2(k, 3, 7) * 1.2, p: hash2(k, 4, 7) * 6.28 }));
    this.flash = 0;
    this.alpha = 1;
    this.selected = -1;
    this.follow = -1;
    this.animalScreen = [];
    this.time = 0;
    this.drift = true;
    this.resize();
    this.buildNow();
  }

  makeBuffer() {
    const c = document.createElement('canvas');
    c.width = Math.ceil(this.worldW * CS);
    c.height = Math.ceil(this.worldH * CS);
    const ctx = c.getContext('2d');
    return {
      canvas: c, ctx,
      sx: new Float32Array(N * N), sy: new Float32Array(N * N), di: new Int16Array(N * N), dj: new Int16Array(N * N), surf: new Int16Array(N * N),
      water: [], flowing: [], fishy: [],
    };
  }

  // display (i, j) -> world index
  idx(i, j) {
    switch (this.rot) {
      case 0: return j * N + i;
      case 1: return (N - 1 - i) * N + j;
      case 2: return (N - 1 - j) * N + (N - 1 - i);
      default: return i * N + (N - 1 - j);
    }
  }
  // world position (float) -> display coordinates
  toDisplay(x, y) {
    switch (this.rot) {
      case 0: return [x, y];
      case 1: return [N - 1 - y, x];
      case 2: return [N - 1 - x, N - 1 - y];
      default: return [y, N - 1 - x];
    }
  }
  // world flow vector -> display direction
  dir(fx, fy) {
    switch (this.rot) {
      case 0: return [fx, fy];
      case 1: return [-fy, fx];
      case 2: return [-fx, -fy];
      default: return [fy, -fx];
    }
  }
  screenOf(i, j, h) {
    return [this.originX + (i - j) * HW, this.originY + (i + j) * HH - h * VH];
  }

  setRotation(r) {
    this.rot = ((r % 4) + 4) % 4;
    this.buildNow();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.scene.width = this.canvas.width;
      this.scene.height = this.canvas.height;
    }
    this.dpr = dpr;
    this.cssW = w; this.cssH = h;
    this.cam.fit = Math.min(w / this.worldW, h / (this.worldH * 0.92)) * 0.96;
  }

  // ---------- landscape cache ----------

  buildNow() {
    const job = this.buildJob(this.back);
    while (!job.next().done);
    this.swap();
  }

  swap() {
    const t = this.front; this.front = this.back; this.back = t;
    this.lastBuildDone = performance.now();
    this.job = null;
  }

  advanceBuild(budgetMs) {
    const now = performance.now();
    if (!this.job) {
      if (now - this.lastBuildDone < 1200) return;
      this.job = this.buildJob(this.back);
    }
    const end = now + budgetMs;
    while (performance.now() < end) {
      if (this.job.next().done) { this.swap(); return; }
    }
  }

  *buildJob(buf) {
    const w = this.world;
    const ctx = buf.ctx;
    const cal = w.cal;
    const yf = cal.yearFrac;
    const grassC = grassColor(yf);
    const leaf = leafState(yf, 0);
    buf.water.length = 0; buf.flowing.length = 0; buf.fishy.length = 0;

    // Surface level per display cell.
    const g = new Int16Array(N * N), surf = new Int16Array(N * N), wtop = new Uint8Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = this.idx(i, j);
      const gr = Math.floor(w.terrain[k]);
      const wd = w.water[k];
      let s = gr, hasBody = 0;
      if (wd >= 0.3) {
        const top = Math.floor(w.terrain[k] + wd + 0.2);
        if (top > gr) { s = top; hasBody = 1; }
      }
      const d = j * N + i;
      g[d] = gr; surf[d] = s; wtop[d] = hasBody;
    }

    ctx.setTransform(CS, 0, 0, CS, 0, 0);
    ctx.clearRect(0, 0, this.worldW, this.worldH);
    const t0 = performance.now();

    for (let s = 0; s < 2 * N - 1; s++) {
      const iMin = Math.max(0, s - (N - 1)), iMax = Math.min(N - 1, s);
      for (let i = iMin; i <= iMax; i++) {
        const j = s - i;
        this.drawColumn(ctx, buf, w, i, j, g, surf, wtop, grassC, leaf, yf);
      }
      if (s % 6 === 5) yield;
    }
    this.lastBuildMs = performance.now() - t0;
  }

  groundColor(w, k, grassC, x, y) {
    let c = MAT_COLORS[w.material[k]];
    const dryness = 1 - clamp((w.moist[k] - 0.08) / 0.3, 0, 1);
    const gc = mix(grassC, COL.dry, dryness * 0.6);
    c = mix(c, gc, w.grass[k] * 0.95);
    if (w.burn[k] > 0) c = mix(c, COL.ash, w.burn[k] * (1 - w.grass[k] * 0.8) * 0.9);
    if (w.water[k] > 0.004 && w.water[k] < 0.025) c = shade(c, 0.88);
    if (w.snow[k] > 0.002) c = mix(c, COL.snow, clamp(w.snow[k] / 0.03, 0, 1));
    const v = 1 + (hash2(x, y, 11) - 0.5) * 0.07;
    return shade(c, v);
  }

  drawColumn(ctx, buf, w, i, j, g, surf, wtop, grassC, leaf, yf) {
    const k = this.idx(i, j);
    const x = k % N, y = (k / N) | 0;
    const d = j * N + i;
    const gr = g[d], s = surf[d];
    const cx = this.originX + (i - j) * HW;
    const baseY = this.originY + (i + j) * HH;
    const ty = baseY - s * VH;
    buf.sx[k] = cx; buf.sy[k] = ty; buf.di[k] = i; buf.dj[k] = j; buf.surf[k] = s;

    const haze = 0.1 * (1 - (i + j) / (2 * N - 2)) + clamp((s - 20) / 60, 0, 0.08);
    const ground = this.groundColor(w, k, grassC, x, y);
    const wd = w.water[k];
    const hasWater = wd >= 0.025;

    // Top face
    let top;
    if (hasWater) {
      let wc = mix(COL.waterShallow, COL.waterDeep, clamp((wd - 0.1) / 2.4, 0, 1));
      if (w.sed[k] > 0.001) wc = mix(wc, COL.mud, Math.min(0.55, w.sed[k] * 25));
      if (!wtop[d]) wc = mix(ground, wc, clamp(0.62 + wd * 1.2, 0.62, 0.92));
      if (w.ice[k]) wc = mix(wc, COL.ice, 0.85);
      if (w.ice[k] && w.snow[k] > 0.005) wc = mix(wc, COL.snow, 0.8);
      top = shade(wc, 1 + (hash2(x, y, 13) - 0.5) * 0.03);
      buf.water.push(k);
      if (w.flow[k] > 0.02 && !w.ice[k]) buf.flowing.push(k);
      if (w.fish[k] > 0.35 && !w.ice[k]) buf.fishy.push(k);
    } else top = ground;
    top = mix(top, COL.haze, haze);

    // Side faces: left faces display neighbour (i, j+1), right faces (i+1, j).
    const leftTo = j < N - 1 ? surf[d + N] : -BASE_DEPTH;
    const rightTo = i < N - 1 ? surf[d + 1] : -BASE_DEPTH;
    if (leftTo < s) this.drawSide(ctx, cx, baseY, s, leftTo, gr, wtop[d], ground, w, k, true, haze, x, y, j === N - 1);
    if (rightTo < s) this.drawSide(ctx, cx, baseY, s, rightTo, gr, wtop[d], ground, w, k, false, haze, x, y, i === N - 1);

    ctx.fillStyle = rgb(top);
    ctx.beginPath();
    ctx.moveTo(cx, ty - HH - E);
    ctx.lineTo(cx + HW + E, ty);
    ctx.lineTo(cx, ty + HH + E);
    ctx.lineTo(cx - HW - E, ty);
    ctx.closePath();
    ctx.fill();

    if (!hasWater || !wtop[d]) {
      if (w.reed[k] > 0.25) this.drawReeds(ctx, w, k, cx, ty, x, y, yf);
      const sp = w.tree[k];
      if (sp) this.drawTree(ctx, w, k, sp, cx, ty, x, y, leaf, yf, haze);
    } else if (w.reed[k] > 0.4 && wd < 0.8) this.drawReeds(ctx, w, k, cx, ty, x, y, yf);
  }

  drawSide(ctx, cx, baseY, from, to, gr, body, ground, w, k, left, haze, x, y, edge) {
    const lightK = left ? LEFT : RIGHT;
    const seg = (a, b, c) => {
      const ya = baseY - a * VH, yb = baseY - b * VH;
      ctx.fillStyle = rgb(mix(shade(c, lightK), COL.haze, haze));
      ctx.beginPath();
      if (left) {
        ctx.moveTo(cx - HW - E, ya); ctx.lineTo(cx, ya + HH); ctx.lineTo(cx, yb + HH + E); ctx.lineTo(cx - HW - E, yb + E);
      } else {
        ctx.moveTo(cx, ya + HH); ctx.lineTo(cx + HW + E, ya); ctx.lineTo(cx + HW + E, yb + E); ctx.lineTo(cx, yb + HH + E);
      }
      ctx.closePath();
      ctx.fill();
    };
    let level = from;
    if (body && from > gr) {
      const wb = Math.max(to, gr);
      let wc = COL.sideWater;
      if (w.ice[k]) wc = mix(wc, COL.ice, 0.8);
      seg(level, wb, wc);
      level = wb;
    }
    if (level <= to) return;
    // Ground strata: grassy lip, soil, then layered rock.
    const mat = MAT_COLORS[w.material[k]];
    const soil = mix(COL.sideSoil, mat, 0.35);
    let depth = gr - level;
    while (level > to) {
      let next = level - 1;
      let c;
      if (depth <= 0) c = mix(soil, shade(ground, 0.92), 0.55);
      else if (depth < 3 && w.material[k] !== MAT.ROCK) c = soil;
      else {
        c = ((level + (edge ? 0 : 1)) & 1) ? COL.sideRock : COL.sideRock2;
        c = mix(c, mat, 0.2);
        // merge consecutive rock bands when not on the diorama edge
        if (!edge) { next = to; }
      }
      if (level <= 0 && edge) c = shade(COL.sideRock, 0.82);
      seg(level, Math.max(next, to), shade(c, 1 + (hash2(x, level, 17) - 0.5) * 0.05));
      if (depth <= 0 && w.grass[k] > 0.3 && w.snow[k] < 0.01) {
        // a little overhang of grass on the edge
        const ya = baseY - level * VH;
        ctx.fillStyle = rgb(mix(shade(ground, lightK * 0.96), COL.haze, haze));
        ctx.beginPath();
        if (left) { ctx.moveTo(cx - HW - E, ya); ctx.lineTo(cx, ya + HH); ctx.lineTo(cx, ya + HH + 1.4); ctx.lineTo(cx - HW - E, ya + 1.4); }
        else { ctx.moveTo(cx, ya + HH); ctx.lineTo(cx + HW + E, ya); ctx.lineTo(cx + HW + E, ya + 1.4); ctx.lineTo(cx, ya + HH + 1.4); }
        ctx.closePath(); ctx.fill();
      }
      depth += level - Math.max(next, to);
      level = Math.max(next, to);
    }
  }

  drawReeds(ctx, w, k, cx, ty, x, y, yf) {
    const n = Math.round(2 + w.reed[k] * 4);
    const autumn = yf > 0.55 && yf < 0.95;
    const col = autumn ? COL.reedDry : COL.reed;
    ctx.lineWidth = 0.7;
    for (let r = 0; r < n; r++) {
      const ox = (hash2(x * 7 + r, y, 31) - 0.5) * TW * 0.7;
      const oy = (hash2(x, y * 7 + r, 37) - 0.5) * TH * 0.6;
      const h = 2.5 + hash2(x + r, y - r, 41) * 3 * w.reed[k];
      ctx.strokeStyle = rgb(shade(col, 0.85 + hash2(r, x, y) * 0.3));
      ctx.beginPath();
      ctx.moveTo(cx + ox, ty + oy);
      ctx.lineTo(cx + ox + 0.4, ty + oy - h);
      ctx.stroke();
      if (yf > 0.3 && yf < 0.75 && r % 3 === 0) {
        ctx.fillStyle = rgb(COL.cattail);
        ctx.fillRect(cx + ox - 0.2, ty + oy - h - 0.5, 1.1, 1.6);
      }
    }
  }

  box(ctx, cx, by, hw, h, top, left, right) {
    const hh = hw / 2;
    ctx.fillStyle = rgb(left);
    ctx.beginPath();
    ctx.moveTo(cx - hw, by - h); ctx.lineTo(cx, by - h + hh); ctx.lineTo(cx, by + hh); ctx.lineTo(cx - hw, by);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = rgb(right);
    ctx.beginPath();
    ctx.moveTo(cx, by - h + hh); ctx.lineTo(cx + hw, by - h); ctx.lineTo(cx + hw, by); ctx.lineTo(cx, by + hh);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = rgb(top);
    ctx.beginPath();
    ctx.moveTo(cx, by - h - hh); ctx.lineTo(cx + hw, by - h); ctx.lineTo(cx, by - h + hh); ctx.lineTo(cx - hw, by - h);
    ctx.closePath(); ctx.fill();
  }

  cube(ctx, cx, by, hw, h, c, haze, snowTop) {
    const base = mix(c, COL.haze, haze);
    const top = snowTop ? mix(COL.snow, COL.haze, haze) : base;
    this.box(ctx, cx, by, hw, h, top, shade(base, LEFT), shade(base, RIGHT));
  }

  drawTree(ctx, w, k, sp, cx, ty, x, y, leaf, yf, haze) {
    const s = w.treeSize[k];
    if (s < 0.04) return;
    const hv = hash2(x, y, 53);
    const px = cx + (hv - 0.5) * 3, py = ty + (hash2(x, y, 59) - 0.5) * 1.6;
    const snowy = w.snow[k] > 0.01;
    const sick = 1 - w.treeHealth[k];
    if (sp === TREE.DECID) {
      const st = leafState(yf, hv);
      const th = 2 + 4 * s;
      this.cube(ctx, px, py, 0.9, th, COL.trunk, haze, false);
      const cw = 2.2 + 3.6 * s, ch = 2.4 + 4.4 * s;
      if (st.density > 0.05) {
        let c = mix(st.col, COL.dry, sick * 0.6);
        c = shade(c, 0.94 + hv * 0.12);
        const dw = cw * (0.55 + 0.45 * st.density);
        this.cube(ctx, px, py - th * 0.8, dw, ch * (0.6 + 0.4 * st.density), c, haze, snowy);
        if (s > 0.35) this.cube(ctx, px + (hv - 0.5), py - th * 0.8 - ch * 0.7, dw * 0.6, ch * 0.5, shade(c, 1.06), haze, snowy);
      } else {
        ctx.globalAlpha = 0.55;
        this.cube(ctx, px, py - th * 0.8, cw * 0.7, ch * 0.75, COL.bare, haze, snowy);
        ctx.globalAlpha = 1;
      }
    } else if (sp === TREE.CONIFER) {
      const th = 1.5 + 1.5 * s;
      this.cube(ctx, px, py, 0.8, th, COL.trunk, haze, false);
      let hw = 2 + 2.8 * s, h = 2 + 2.6 * s, by = py - th;
      const winter = yf > 0.75;
      let c = mix(winter ? COL.coniferWinter : COL.conifer, COL.dry, sick * 0.6);
      c = shade(c, 0.94 + hv * 0.12);
      const tiers = s > 0.3 ? 3 : 2;
      for (let t = 0; t < tiers; t++) {
        this.cube(ctx, px, by, hw, h, shade(c, 1 + t * 0.05), haze, snowy);
        by -= h * 0.75; hw *= 0.66; h *= 0.85;
      }
    } else if (sp === TREE.SHRUB) {
      const hw = 1.6 + 2 * s, h = 1.6 + 2.4 * s;
      const winter = yf > 0.74 || yf < 0.03;
      const c = mix(COL.shrub, COL.dry, sick * 0.6);
      if (winter) {
        ctx.globalAlpha = 0.45;
        this.cube(ctx, px, py, hw * 0.8, h * 0.8, COL.bare, haze, snowy);
        ctx.globalAlpha = 1;
      } else this.cube(ctx, px, py, hw, h, shade(c, 0.94 + hv * 0.12), haze, snowy);
      if (yf > 0.4 && yf < 0.68 && s > 0.4) {
        ctx.fillStyle = rgb(COL.berry);
        for (let b = 0; b < 3; b++) ctx.fillRect(px - hw * 0.6 + b * hw * 0.55, py - h + 0.5 + (b % 2), 0.9, 0.9);
      }
    } else if (sp === TREE.SNAG) {
      const th = 3 + 7 * s;
      this.cube(ctx, px, py, 0.8, th, COL.snag, haze, false);
      ctx.strokeStyle = rgb(shade(COL.snag, 0.8));
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(px, py - th * 0.7); ctx.lineTo(px + 2 * (hv > 0.5 ? 1 : -1), py - th * 0.9);
      ctx.stroke();
    }
  }

  // ---------- per-frame drawing ----------

  frame(dt) {
    this.time += dt;
    this.resize();
    this.advanceBuild(5);
    const w = this.world, c = w.climate;
    const ctx = this.ctx, W = this.canvas.width, H = this.canvas.height, dpr = this.dpr;
    const cam = this.cam;
    const z = cam.fit * cam.userZoom * dpr;
    if (this.follow >= 0) {
      const it = this.animalScreen.find(t => t.a.id === this.follow);
      if (it) {
        cam.panX += (it.sx - (cam.x + cam.panX)) * Math.min(1, dt * 2);
        cam.panY += (it.sy - (cam.y + cam.panY)) * Math.min(1, dt * 2);
      } else this.follow = -1;
    }
    let cx = cam.x + cam.panX, cy = cam.y + cam.panY;
    if (this.drift && this.follow < 0) { cx += Math.sin(this.time * 0.021) * 6; cy += Math.cos(this.time * 0.017) * 3; }
    this.view = { z, cx, cy, W, H };
    const toScreen = () => this.sctx.setTransform(z, 0, 0, z, W / 2 - cx * z, H / 2 - cy * z);

    // Sky
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const [skyTop, skyBot] = skyColors(c.elev, c.cloud);
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, rgb(skyTop));
    grad.addColorStop(1, rgb(skyBot));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    const night = clamp((-c.elev - 0.03) * 6, 0, 1) * (1 - c.cloud * 0.9);
    if (night > 0.01) {
      for (const s of this.stars) {
        const a = night * (0.5 + 0.5 * Math.sin(this.time * 0.8 + s.p));
        ctx.fillStyle = `rgba(240,240,255,${a * 0.8})`;
        ctx.fillRect(s.x * W, s.y * H, s.s * dpr, s.s * dpr);
      }
    }

    // Soft shadow under the diorama
    const sx = W / 2 - cx * z + this.worldW / 2 * z, sy = H / 2 - cy * z + (this.originY + N * TH + 4 * VH) * z;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.scale(1, 0.32);
    const rr = N * HW * z * 0.95;
    const sg = ctx.createRadialGradient(0, 0, rr * 0.2, 0, 0, rr);
    sg.addColorStop(0, 'rgba(30,40,50,0.16)');
    sg.addColorStop(1, 'rgba(30,40,50,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(-rr, -rr, rr * 2, rr * 2);
    ctx.restore();

    // Scene: landscape plus things that should be lit by the time of day.
    const sctx = this.sctx;
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.globalCompositeOperation = 'source-over';
    sctx.clearRect(0, 0, W, H);
    toScreen();
    sctx.imageSmoothingEnabled = true;
    sctx.drawImage(this.front.canvas, 0, 0, this.worldW, this.worldH);
    this.updateParticles(dt);
    this.drawWaterLife(sctx, dt);
    drawSchools(this, sctx, this.alpha, this.time);
    drawCreatures(this, sctx, this.alpha, this.time);
    this.drawCloudShadows(sctx, dt);

    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.globalCompositeOperation = 'multiply';
    sctx.fillStyle = rgb(lightTint(c.elev, c.cloud));
    sctx.fillRect(0, 0, W, H);
    sctx.globalCompositeOperation = 'destination-in';
    toScreen();
    sctx.drawImage(this.front.canvas, 0, 0, this.worldW, this.worldH);
    sctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(this.scene, 0, 0);

    // Glows, smoke and steam over the lit scene.
    ctx.setTransform(z, 0, 0, z, W / 2 - cx * z, H / 2 - cy * z);
    this.drawFire(ctx);
    this.drawSmoke(ctx, c);

    // Weather in screen space
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.drawPrecip(ctx, dt, c, W, H);
    this.drawFog(ctx, c, W, H);
    if (c.weather === 'storm' && Math.random() < dt * 0.05) this.flash = 1;
    if (this.flash > 0) {
      ctx.fillStyle = `rgba(235,240,255,${this.flash * 0.18})`;
      ctx.fillRect(0, 0, W, H);
      this.flash = Math.max(0, this.flash - dt * 3);
    }

    drawBubbles(this, ctx);

    // Vignette
    const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    vg.addColorStop(0, 'rgba(20,28,36,0)');
    vg.addColorStop(1, 'rgba(20,28,36,0.22)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
  }

  updateParticles(dt) {
    for (const key in this.particles) {
      const arr = this.particles[key];
      for (let n = arr.length - 1; n >= 0; n--) {
        arr[n].t += dt;
        if (arr[n].t >= arr[n].life) arr.splice(n, 1);
      }
    }
  }

  surfacePoint(k, spread = 0.7) {
    const b = this.front;
    return [b.sx[k] + (Math.random() - 0.5) * TW * spread, b.sy[k] + (Math.random() - 0.5) * TH * spread];
  }

  drawWaterLife(ctx, dt) {
    const w = this.world, c = w.climate, b = this.front, P = this.particles;
    const day = clamp(c.sun * 2 + 0.15, 0.15, 1);
    // Sun glints
    if (b.water.length) {
      let n = dt * 30 * day * (1 - c.cloud * 0.7);
      while (n > 0) {
        if (Math.random() < n) {
          const k = b.water[(Math.random() * b.water.length) | 0];
          if (!w.ice[k]) { const [x, y] = this.surfacePoint(k); P.glint.push({ x, y, t: 0, life: 0.6 + Math.random() * 0.9 }); }
        }
        n -= 1;
      }
    }
    // Current streaks along flowing water
    if (b.flowing.length) {
      let n = dt * 26;
      while (n > 0) {
        if (Math.random() < n) {
          const k = b.flowing[(Math.random() * b.flowing.length) | 0];
          const [di, dj] = this.dir(w.fx[k], w.fy[k]);
          const len = Math.hypot(di, dj) || 1;
          const vx = (di - dj) / len * HW, vy = (di + dj) / len * HH;
          const [x, y] = this.surfacePoint(k, 0.5);
          P.streak.push({ x, y, vx: vx * 0.9, vy: vy * 0.9, t: 0, life: 1 + Math.random() * 0.8 });
        }
        n -= 1;
      }
    }
    // Fish jumping
    if (b.fishy.length && Math.random() < dt * 0.5) {
      const k = b.fishy[(Math.random() * b.fishy.length) | 0];
      const [x, y] = this.surfacePoint(k, 0.4);
      P.jump.push({ x, y, d: Math.random() < 0.5 ? -1 : 1, t: 0, life: 0.8 });
      P.ripple.push({ x, y, t: -0.65, life: 1.6 });
    }
    // Rain rings
    if (c.precip > 0 && c.temp > 0.5 && b.water.length) {
      let n = dt * (c.weather === 'storm' ? 60 : 22);
      while (n > 0) {
        if (Math.random() < n) {
          const k = b.water[(Math.random() * b.water.length) | 0];
          if (!w.ice[k]) { const [x, y] = this.surfacePoint(k); P.ripple.push({ x, y, t: 0, life: 0.9, small: true }); }
        }
        n -= 1;
      }
    }

    ctx.lineCap = 'round';
    for (const p of P.glint) {
      const a = Math.sin(Math.PI * p.t / p.life);
      ctx.strokeStyle = `rgba(255,255,250,${a * 0.85})`;
      ctx.lineWidth = 0.55;
      ctx.beginPath(); ctx.moveTo(p.x - 0.9, p.y); ctx.lineTo(p.x + 0.9, p.y); ctx.stroke();
    }
    for (const p of P.streak) {
      const a = Math.sin(Math.PI * p.t / p.life) * 0.45;
      const x = p.x + p.vx * p.t, y = p.y + p.vy * p.t;
      ctx.strokeStyle = `rgba(236,248,250,${a})`;
      ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + p.vx * 0.35, y + p.vy * 0.35); ctx.stroke();
    }
    for (const p of P.ripple) {
      if (p.t < 0) continue;
      const f = p.t / p.life;
      const r = (p.small ? 1.6 : 3.2) * f + 0.3;
      ctx.strokeStyle = `rgba(240,250,252,${(1 - f) * 0.6})`;
      ctx.lineWidth = 0.4;
      ctx.beginPath(); ctx.ellipse(p.x, p.y, r, r * 0.5, 0, 0, Math.PI * 2); ctx.stroke();
    }
    for (const p of P.jump) {
      const f = p.t / p.life;
      const x = p.x + p.d * f * 3, y = p.y - Math.sin(Math.PI * f) * 4;
      ctx.fillStyle = 'rgba(176,184,180,0.95)';
      ctx.save(); ctx.translate(x, y); ctx.rotate(p.d * (f - 0.5) * 2.2);
      ctx.fillRect(-1, -0.4, 2, 0.8);
      ctx.restore();
    }
  }

  drawCloudShadows(ctx, dt) {
    const c = this.world.climate, P = this.particles.shadow;
    const want = c.cloud > 0.2 ? 6 : 0;
    if (P.length < want && Math.random() < dt * 0.5) {
      P.push({ x: -80 + Math.random() * 40, y: Math.random() * this.worldH, r: 60 + Math.random() * 80, t: 0, life: 120 });
    }
    for (const p of P) {
      const x = p.x + (8 + c.windX * 6) * p.t, y = p.y + c.windY * 3 * p.t;
      if (x - p.r > this.worldW) { p.t = p.life; continue; }
      const fade = Math.min(1, p.t / 6, (p.life - p.t) / 6);
      const g = ctx.createRadialGradient(x, y, 0, x, y, p.r);
      g.addColorStop(0, `rgba(40,50,60,${0.14 * c.cloud * fade})`);
      g.addColorStop(1, 'rgba(40,50,60,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(x, y, p.r, p.r * 0.55, 0, 0, Math.PI * 2); ctx.fill();
    }
  }

  drawFire(ctx) {
    const w = this.world, b = this.front;
    if (!w.burning.length) return;
    ctx.globalCompositeOperation = 'lighter';
    for (const k of w.burning) {
      const x = b.sx[k], y = b.sy[k];
      const fl = 0.7 + 0.3 * Math.sin(this.time * 9 + k);
      const g = ctx.createRadialGradient(x, y - 2, 0, x, y - 2, 9);
      g.addColorStop(0, `rgba(255,170,80,${0.55 * fl})`);
      g.addColorStop(1, 'rgba(255,120,40,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - 10, y - 12, 20, 20);
      ctx.fillStyle = `rgba(255,${200 + 40 * fl | 0},120,${0.8 * fl})`;
      ctx.beginPath(); ctx.moveTo(x - 1.6, y); ctx.lineTo(x, y - 3.5 - 2 * fl); ctx.lineTo(x + 1.6, y); ctx.fill();
      if (Math.random() < 0.08) this.particles.smoke.push({ x, y: y - 3, t: 0, life: 5, r: 1.5, dark: true });
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  drawSmoke(ctx, c) {
    const w = this.world, b = this.front, P = this.particles.smoke;
    if (w.hotSpring >= 0 && Math.random() < (c.temp < 8 ? 0.12 : 0.05)) {
      const k = w.hotSpring;
      P.push({ x: b.sx[k] + (Math.random() - 0.5) * 4, y: b.sy[k], t: 0, life: 4, r: 1.2 });
    }
    const tint = lightTint(c.elev, c.cloud);
    for (const p of P) {
      const f = p.t / p.life;
      const x = p.x + c.windX * 4 * p.t + Math.sin(p.t * 1.3 + p.x) * 1.2;
      const y = p.y - p.t * (p.dark ? 4 : 3);
      const r = p.r + f * (p.dark ? 6 : 4);
      const base = p.dark ? [110, 108, 104] : [240, 242, 244];
      const col = [base[0] * tint[0] / 255, base[1] * tint[1] / 255, base[2] * tint[2] / 255];
      ctx.fillStyle = rgba(col, (1 - f) * (p.dark ? 0.35 : 0.3) * Math.min(1, p.t * 2));
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
  }

  drawPrecip(ctx, dt, c, W, H) {
    const snowing = c.precip > 0 && c.temp < 0.5;
    const raining = c.precip > 0 && !snowing;
    const dpr = this.dpr;
    const wantDrops = raining ? (c.weather === 'storm' ? 420 : 160) : 0;
    while (this.drops.length < wantDrops) this.drops.push({ x: Math.random() * W, y: Math.random() * H, v: 0.8 + Math.random() * 0.4 });
    if (this.drops.length > wantDrops) this.drops.length = Math.max(0, this.drops.length - Math.ceil(dt * 200));
    if (this.drops.length) {
      const wx = c.windX * 0.25;
      ctx.strokeStyle = 'rgba(210,222,232,0.35)';
      ctx.lineWidth = 1 * dpr;
      ctx.beginPath();
      for (const d of this.drops) {
        d.y += 900 * d.v * dt * dpr; d.x += 900 * wx * d.v * dt * dpr;
        if (d.y > H) { d.y -= H + 20; d.x = Math.random() * W; }
        if (d.x > W) d.x -= W; if (d.x < 0) d.x += W;
        ctx.moveTo(d.x, d.y); ctx.lineTo(d.x - wx * 14 * dpr, d.y - 14 * dpr);
      }
      ctx.stroke();
    }
    const wantFlakes = snowing ? (c.weather === 'storm' ? 380 : 200) : 0;
    while (this.flakes.length < wantFlakes) this.flakes.push({ x: Math.random() * W, y: Math.random() * H, v: 0.5 + Math.random(), p: Math.random() * 6 });
    if (this.flakes.length > wantFlakes) this.flakes.length = Math.max(0, this.flakes.length - Math.ceil(dt * 100));
    if (this.flakes.length) {
      ctx.fillStyle = 'rgba(250,252,255,0.85)';
      for (const f of this.flakes) {
        f.y += 40 * f.v * dt * dpr;
        f.x += (Math.sin(this.time + f.p) * 12 + c.windX * 30) * dt * dpr;
        if (f.y > H) { f.y = -5; f.x = Math.random() * W; }
        if (f.x > W) f.x -= W; if (f.x < 0) f.x += W;
        const r = (0.8 + f.v * 0.9) * dpr;
        ctx.fillRect(f.x, f.y, r, r);
      }
    }
  }

  drawFog(ctx, c, W, H) {
    if (c.fog < 0.02) return;
    const tint = lightTint(c.elev, 0.5);
    const col = [232 * tint[0] / 255, 236 * tint[1] / 255, 238 * tint[2] / 255];
    for (let k = 0; k < 4; k++) {
      const y = H * (0.35 + k * 0.17) + Math.sin(this.time * 0.05 + k) * 20;
      const g = ctx.createLinearGradient(0, y - H * 0.18, 0, y + H * 0.18);
      g.addColorStop(0, rgba(col, 0));
      g.addColorStop(0.5, rgba(col, 0.32 * c.fog));
      g.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, y - H * 0.18, W, H * 0.36);
    }
  }

  // ---------- picking & camera ----------

  pickAnimal(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    const { z, cx, cy, W, H } = this.view;
    const px = ((clientX - r.left) * this.dpr - W / 2) / z + cx;
    const py = ((clientY - r.top) * this.dpr - H / 2) / z + cy;
    let best = null, bestD = Math.max(5, 14 / (z / this.dpr));
    for (const it of this.animalScreen) {
      const d = Math.hypot(it.sx - px, it.sy - 2 - py);
      if (d < bestD) { bestD = d; best = it.a; }
    }
    return best;
  }

  pick(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    const { z, cx, cy, W, H } = this.view;
    const px = ((clientX - r.left) * this.dpr - W / 2) / z + cx;
    const py = ((clientY - r.top) * this.dpr - H / 2) / z + cy;
    const b = this.front;
    let best = -1, bestOrder = -1;
    for (let k = 0; k < N * N; k++) {
      const dx = Math.abs(px - b.sx[k]) / HW, dy = Math.abs(py - b.sy[k]) / HH;
      if (dx + dy <= 1) {
        const order = b.di[k] + b.dj[k];
        if (order > bestOrder) { bestOrder = order; best = k; }
      }
    }
    return best;
  }

  zoomAt(factor, clientX, clientY) {
    const cam = this.cam;
    const old = cam.userZoom;
    cam.userZoom = clamp(cam.userZoom * factor, 0.6, 6);
    const r = this.canvas.getBoundingClientRect();
    const { z } = this.view;
    const ox = ((clientX - r.left) * this.dpr - this.view.W / 2) / z;
    const oy = ((clientY - r.top) * this.dpr - this.view.H / 2) / z;
    const k = 1 - old / cam.userZoom;
    cam.panX += ox * k; cam.panY += oy * k;
  }

  pan(dxCss, dyCss) {
    const z = this.view.z / this.dpr;
    this.cam.panX -= dxCss / z;
    this.cam.panY -= dyCss / z;
  }

  resetView() { this.cam.userZoom = 1; this.cam.panX = 0; this.cam.panY = 0; }
}
