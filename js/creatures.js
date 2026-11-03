// Draws animals as little voxel models and fish schools as shadows in the water.
//
// Models are built from boxes measured in metres, so species are the right size
// relative to each other (deer > heron > fox > otter > hare). All of them are
// drawn E times larger than life against the terrain so they read on screen.
// Level of detail changes smoothly with zoom: a soft blob fades into the model,
// then fur texture, eyes and markings fade in as you get closer.

import { N } from './config.js';
import { SPECIES } from './species.js';
import { shade, rgb, mix } from './palette.js';
import { hash2, clamp, smoothstep } from './rng.js';

const E = 3;          // enlargement against the terrain
const PPM = 3.35;     // world pixels per metre at zoom 1 (one cell is 2 m)
const LEFT = 0.86, RIGHT = 0.72;

// ---------- colours ----------

const C = {
  otter: { fur: [94, 72, 56], dark: [72, 55, 43], light: [116, 90, 70], face: [214, 204, 172], faceDark: [184, 172, 140], nose: [34, 28, 26], leg: [70, 54, 42] },
  deer: { coat: [178, 134, 94], dark: [150, 110, 76], light: [234, 216, 186], leg: [140, 104, 72], hoof: [62, 50, 42], antler: [206, 186, 154], nose: [40, 32, 30] },
  rabbit: { coat: [152, 130, 106], winter: [238, 238, 234], dark: [120, 102, 84], light: [226, 216, 202], tip: [52, 46, 42], nose: [180, 120, 120] },
  fox: { coat: [210, 114, 58], dark: [176, 90, 44], light: [244, 238, 228], leg: [62, 46, 40], nose: [30, 24, 22] },
  heron: { grey: [162, 170, 182], dark: [118, 126, 140], white: [236, 238, 240], crest: [54, 56, 64], leg: [154, 142, 110], beak: [216, 178, 82] },
};

// ---------- models ----------
// A box: centre (x forward, y left) and bottom z, sizes lx, ly, lz, all in metres.
// tex: fur speckles; deco: small markings drawn on a face ({face, u, v, w, h, c}).

const B = (x, y, z, lx, ly, lz, c, tex = 0, deco = null, top = null) => ({ x, y, z, lx, ly, lz, c, tex, deco, top });

function otterModel(a, pose, t, young) {
  const k = C.otter, out = [];
  const eyes = [{ f: '+y', u: 0.25, v: 0.62, w: 0.16, h: 0.16, c: k.nose }, { f: '-y', u: 0.6, v: 0.62, w: 0.16, h: 0.16, c: k.nose }, { f: '+x', u: 0.4, v: 0.25, w: 0.2, h: 0.18, c: k.nose }];
  if (pose === 'float') {
    // On its back, paws on chest, face to the sky.
    out.push(B(0, 0, 0, 0.5, 0.22, 0.12, k.fur, 1, null, k.faceDark));
    out.push(B(0.06, 0.06, 0.12, 0.08, 0.06, 0.05, k.leg), B(0.06, -0.06, 0.12, 0.08, 0.06, 0.05, k.leg));
    out.push(B(0.32, 0, 0.0, 0.16, 0.18, 0.13, k.face, 0, [{ f: '+z', u: 0.35, v: 0.2, w: 0.14, h: 0.14, c: k.nose }, { f: '+z', u: 0.35, v: 0.66, w: 0.14, h: 0.14, c: k.nose }, { f: '+z', u: 0.75, v: 0.42, w: 0.16, h: 0.16, c: k.nose }]));
    out.push(B(-0.3, 0.05, 0.08, 0.07, 0.06, 0.06, k.leg), B(-0.3, -0.05, 0.08, 0.07, 0.06, 0.06, k.leg));
    out.push(B(-0.42, 0, 0, 0.22, 0.09, 0.05, k.dark, 1));
    return out;
  }
  if (pose === 'dive') {
    out.push(B(-0.05, 0, -0.02, 0.1, 0.1, 0.06, k.fur, 1));
    out.push(B(-0.14, 0, 0.02, 0.07, 0.07, 0.22, k.dark, 1));
    return out;
  }
  if (pose === 'swim') {
    const wob = Math.sin(t * 6 + a.id) * 0.03;
    out.push(B(0, 0, -0.02, 0.5, 0.2, 0.1, k.fur, 1));
    out.push(B(0.3, 0, 0.0, 0.08, 0.18, 0.14, k.fur, 1));
    out.push(B(0.39, 0, 0.0, 0.1, 0.16, 0.13, k.face, 0, eyes));
    out.push(B(-0.36, wob, -0.02, 0.22, 0.1, 0.06, k.dark, 1), B(-0.52, wob * 2, -0.02, 0.14, 0.07, 0.04, k.dark, 1));
    return out;
  }
  if (pose === 'sleep') {
    out.push(B(0, 0, 0, 0.32, 0.28, 0.16, k.fur, 1));
    out.push(B(0.1, 0.1, 0.0, 0.14, 0.14, 0.12, k.face, 0, null));
    out.push(B(-0.06, -0.12, 0, 0.3, 0.08, 0.07, k.dark, 1));
    return out;
  }
  if (pose === 'groom') {
    // Sitting up.
    out.push(B(0, 0, 0, 0.2, 0.2, 0.34, k.fur, 1, [{ f: '+x', u: 0.2, v: 0.15, w: 0.6, h: 0.6, c: k.faceDark }]));
    out.push(B(0.02, 0, 0.34, 0.16, 0.17, 0.15, k.face, 0, eyes));
    out.push(B(0.12, 0.05, 0.2, 0.08, 0.05, 0.05, k.leg), B(0.12, -0.05, 0.2, 0.08, 0.05, 0.05, k.leg));
    out.push(B(-0.18, 0, 0, 0.26, 0.09, 0.06, k.dark, 1));
    return out;
  }
  // Walking / running / playing on land.
  const run = pose === 'run' || pose === 'play' ? 1.7 : 1;
  const ph = t * 9 * run + a.id;
  const hop = pose === 'play' ? Math.abs(Math.sin(t * 8 + a.id)) * 0.08 : 0;
  const legs = [[0.17, 0.08, 0], [0.17, -0.08, Math.PI], [-0.17, 0.08, Math.PI], [-0.17, -0.08, 0]];
  for (const [lx, ly, p] of legs) {
    const s = Math.sin(ph + p);
    out.push(B(lx + s * 0.03, ly, hop + Math.max(0, s) * 0.02, 0.07, 0.06, 0.08, k.leg));
  }
  out.push(B(0, 0, 0.08 + hop, 0.5, 0.22, 0.19, k.fur, 1));
  out.push(B(0.29, 0, 0.11 + hop, 0.08, 0.19, 0.17, k.fur, 1));
  out.push(B(0.39, 0, 0.11 + hop, 0.12, 0.17, 0.15, k.face, 0, eyes));
  out.push(B(0.33, 0.08, 0.27 + hop, 0.04, 0.03, 0.03, k.dark), B(0.33, -0.08, 0.27 + hop, 0.04, 0.03, 0.03, k.dark));
  const sw = Math.sin(ph * 0.5) * 0.04;
  out.push(B(-0.35, sw, 0.1 + hop, 0.2, 0.12, 0.1, k.fur, 1), B(-0.52, sw * 2, 0.08 + hop, 0.16, 0.08, 0.07, k.dark, 1));
  return out;
}

function deerModel(a, pose, t, young) {
  const k = C.deer, out = [];
  const male = a.sex === 'm' && !young;
  const spots = young ? [0.2, 0.5, 0.75].map((u, n) => ({ f: '+z', u, v: 0.25 + (n % 2) * 0.4, w: 0.1, h: 0.14, c: k.light })) : null;
  const eyes = [{ f: '+y', u: 0.3, v: 0.6, w: 0.14, h: 0.18, c: k.nose }, { f: '-y', u: 0.56, v: 0.6, w: 0.14, h: 0.18, c: k.nose }, { f: '+x', u: 0.3, v: 0.1, w: 0.4, h: 0.3, c: k.nose }];
  if (pose === 'sleep') {
    out.push(B(0, 0, 0, 0.85, 0.4, 0.38, k.coat, 1, spots));
    out.push(B(0.42, 0, 0.3, 0.16, 0.15, 0.32, k.coat, 1));
    out.push(B(0.52, 0, 0.55, 0.28, 0.15, 0.16, k.coat, 1, eyes));
    if (male) out.push(B(0.46, 0.06, 0.71, 0.04, 0.04, 0.2, k.antler), B(0.46, -0.06, 0.71, 0.04, 0.04, 0.2, k.antler));
    return out;
  }
  const ph = t * (pose === 'run' ? 14 : 7) + a.id;
  const moving = pose === 'walk' || pose === 'run' || pose === 'fight';
  const legs = [[0.32, 0.12, 0], [0.32, -0.12, Math.PI], [-0.32, 0.12, Math.PI], [-0.32, -0.12, 0]];
  for (const [lx, ly, p] of legs) {
    const s = moving ? Math.sin(ph + p) : 0;
    out.push(B(lx + s * 0.08, ly, Math.max(0, s) * 0.04, 0.08, 0.08, 0.58, k.leg));
    out.push(B(lx + s * 0.08, ly, 0, 0.09, 0.09, 0.06, k.hoof));
  }
  out.push(B(0, 0, 0.58, 0.9, 0.36, 0.4, k.coat, 1, spots));
  out.push(B(-0.47, 0, 0.72, 0.05, 0.22, 0.24, k.light));             // white rump
  out.push(B(-0.5, 0, 0.88, 0.06, 0.08, 0.1, k.light));               // tail
  const eat = pose === 'eat';
  if (eat) {
    out.push(B(0.48, 0, 0.25, 0.16, 0.15, 0.45, k.coat, 1));
    out.push(B(0.58, 0, 0.05, 0.3, 0.15, 0.17, k.coat, 1, eyes));
  } else {
    out.push(B(0.46, 0, 0.82, 0.16, 0.15, 0.42, k.coat, 1, [{ f: '+x', u: 0.15, v: 0.1, w: 0.7, h: 0.5, c: k.light }]));
    out.push(B(0.58, 0, 1.18, 0.3, 0.15, 0.17, k.coat, 1, eyes));
    out.push(B(0.46, 0.1, 1.32, 0.05, 0.1, 0.12, k.dark), B(0.46, -0.1, 1.32, 0.05, 0.1, 0.12, k.dark));
    if (male) {
      out.push(B(0.5, 0.06, 1.35, 0.04, 0.04, 0.3, k.antler), B(0.5, -0.06, 1.35, 0.04, 0.04, 0.3, k.antler));
      out.push(B(0.56, 0.12, 1.55, 0.12, 0.04, 0.04, k.antler), B(0.56, -0.12, 1.55, 0.12, 0.04, 0.04, k.antler));
    }
  }
  return out;
}

function rabbitModel(a, pose, t, young, winter) {
  const k = C.rabbit, out = [];
  const coat = winter ? k.winter : k.coat;
  const eyes = [{ f: '+y', u: 0.35, v: 0.6, w: 0.2, h: 0.2, c: k.tip }, { f: '-y', u: 0.45, v: 0.6, w: 0.2, h: 0.2, c: k.tip }, { f: '+x', u: 0.4, v: 0.3, w: 0.2, h: 0.15, c: k.nose }];
  const hop = (pose === 'walk' || pose === 'run') ? Math.abs(Math.sin(t * (pose === 'run' ? 14 : 9) + a.id)) * 0.09 : 0;
  if (pose === 'sleep') {
    out.push(B(0, 0, 0, 0.3, 0.2, 0.16, coat, 1));
    out.push(B(0.14, 0, 0.04, 0.12, 0.13, 0.11, coat, 1));
    out.push(B(0.06, 0.03, 0.15, 0.16, 0.03, 0.03, coat), B(0.06, -0.03, 0.15, 0.16, 0.03, 0.03, coat));
    return out;
  }
  out.push(B(-0.08, 0.06, hop, 0.14, 0.05, 0.08, coat), B(-0.08, -0.06, hop, 0.14, 0.05, 0.08, coat));
  out.push(B(0, 0, 0.04 + hop, 0.3, 0.18, 0.18, coat, 1));
  out.push(B(-0.17, 0, 0.12 + hop, 0.05, 0.08, 0.08, k.light));
  out.push(B(0.19, 0, 0.13 + hop, 0.14, 0.13, 0.12, coat, 1, eyes));
  const tip = [{ f: '+z', u: 0, v: 0, w: 1, h: 1, c: k.tip }];
  const ear = pose === 'eat' ? 0.1 : 0.17;
  out.push(B(0.16, 0.035, 0.25 + hop, 0.04, 0.03, ear, coat, 0, tip), B(0.16, -0.035, 0.25 + hop, 0.04, 0.03, ear, coat, 0, tip));
  return out;
}

function foxModel(a, pose, t, young) {
  const k = C.fox, out = [];
  const eyes = [{ f: '+y', u: 0.3, v: 0.62, w: 0.16, h: 0.16, c: k.nose }, { f: '-y', u: 0.54, v: 0.62, w: 0.16, h: 0.16, c: k.nose }];
  if (pose === 'sleep') {
    out.push(B(0, 0, 0, 0.36, 0.3, 0.17, k.coat, 1));
    out.push(B(0.12, 0.08, 0.02, 0.15, 0.14, 0.12, k.coat, 0, eyes));
    out.push(B(-0.02, -0.15, 0, 0.34, 0.1, 0.1, k.coat, 1), B(0.17, -0.15, 0, 0.08, 0.1, 0.1, k.light));
    return out;
  }
  const run = pose === 'run' ? 1.8 : 1;
  const ph = t * 10 * run + a.id;
  const pounce = pose === 'pounce' ? Math.max(0, Math.sin(t * 3 + a.id)) * 0.25 : 0;
  const legs = [[0.17, 0.07, 0], [0.17, -0.07, Math.PI], [-0.17, 0.07, Math.PI], [-0.17, -0.07, 0]];
  for (const [lx, ly, p] of legs) {
    const s = pose === 'walk' || pose === 'run' ? Math.sin(ph + p) : 0;
    out.push(B(lx + s * 0.05, ly, pounce + Math.max(0, s) * 0.03, 0.06, 0.06, 0.2, k.leg));
  }
  out.push(B(0, 0, 0.19 + pounce, 0.46, 0.18, 0.17, k.coat, 1, [{ f: '+x', u: 0.2, v: 0.1, w: 0.6, h: 0.7, c: k.light }]));
  out.push(B(0.3, 0, 0.27 + pounce, 0.15, 0.16, 0.14, k.coat, 0, eyes));
  out.push(B(0.42, 0, 0.27 + pounce, 0.11, 0.08, 0.07, k.light, 0, [{ f: '+x', u: 0.3, v: 0.5, w: 0.4, h: 0.4, c: k.nose }]));
  const ear = [{ f: '+z', u: 0, v: 0, w: 1, h: 1, c: k.leg }];
  out.push(B(0.27, 0.05, 0.41 + pounce, 0.04, 0.04, 0.08, k.coat, 0, ear), B(0.27, -0.05, 0.41 + pounce, 0.04, 0.04, 0.08, k.coat, 0, ear));
  const sw = Math.sin(ph * 0.4) * 0.05;
  out.push(B(-0.37, sw, 0.18 + pounce, 0.28, 0.12, 0.12, k.coat, 1), B(-0.55, sw * 1.6, 0.17 + pounce, 0.1, 0.1, 0.1, k.light));
  return out;
}

function heronModel(a, pose, t, young) {
  const k = C.heron, out = [];
  const eye = [{ f: '+y', u: 0.3, v: 0.55, w: 0.25, h: 0.25, c: k.crest }, { f: '-y', u: 0.45, v: 0.55, w: 0.25, h: 0.25, c: k.crest }];
  if (a.flying) {
    const flap = Math.sin(t * 6 + a.id);
    out.push(B(0, 0, 0, 0.42, 0.18, 0.16, k.grey, 1));
    out.push(B(0, 0.3, 0.1 + flap * 0.15, 0.3, 0.42, 0.03, k.dark), B(0, -0.3, 0.1 + flap * 0.15, 0.3, 0.42, 0.03, k.dark));
    out.push(B(0.24, 0, 0.06, 0.12, 0.08, 0.1, k.white, 0, eye), B(0.36, 0, 0.08, 0.14, 0.03, 0.03, k.beak));
    out.push(B(-0.36, 0, 0.04, 0.3, 0.04, 0.04, k.leg));
    return out;
  }
  const stalk = pose === 'stalk';
  out.push(B(0, 0.05, 0, 0.04, 0.04, 0.45, k.leg), B(0, -0.05, 0, 0.04, 0.04, 0.45, k.leg));
  out.push(B(-0.02, 0, 0.45, 0.42, 0.2, 0.26, k.grey, 1, null, k.dark));
  if (stalk) {
    out.push(B(0.22, 0, 0.6, 0.18, 0.06, 0.07, k.white));
    out.push(B(0.34, 0, 0.6, 0.11, 0.08, 0.09, k.white, 0, eye));
    out.push(B(0.47, 0, 0.62, 0.16, 0.03, 0.03, k.beak));
  } else {
    out.push(B(0.16, 0, 0.64, 0.07, 0.07, 0.3, k.white));
    out.push(B(0.2, 0, 0.92, 0.12, 0.08, 0.09, k.white, 0, eye));
    out.push(B(0.12, 0, 0.98, 0.08, 0.02, 0.02, k.crest));
    out.push(B(0.33, 0, 0.94, 0.16, 0.03, 0.03, k.beak));
  }
  return out;
}

function buildModel(a, pose, t, young, winter) {
  switch (a.sp) {
    case 'otter': return otterModel(a, pose, t, young);
    case 'deer': return deerModel(a, pose, t, young);
    case 'rabbit': return rabbitModel(a, pose, t, young, winter);
    case 'fox': return foxModel(a, pose, t, young);
    default: return heronModel(a, pose, t, young);
  }
}

// ---------- projection and drawing ----------

// Corners: bit0 x(+), bit1 y(+), bit2 z(+). Faces listed so edge 0->1 is horizontal and 0->3 vertical.
const FACES = {
  '+x': { q: [1, 3, 7, 5], n: [1, 0] },
  '-x': { q: [2, 0, 4, 6], n: [-1, 0] },
  '+y': { q: [3, 2, 6, 7], n: [0, 1] },
  '-y': { q: [0, 1, 5, 4], n: [0, -1] },
  '+z': { q: [4, 5, 7, 6], n: null },
};

function quad(ctx, p, q) {
  ctx.beginPath();
  ctx.moveTo(p[q[0]][0], p[q[0]][1]);
  ctx.lineTo(p[q[1]][0], p[q[1]][1]);
  ctx.lineTo(p[q[2]][0], p[q[2]][1]);
  ctx.lineTo(p[q[3]][0], p[q[3]][1]);
  ctx.closePath();
  ctx.fill();
}

// A small patch on a face, in the face's own 0..1 coordinates.
function patch(ctx, o, eu, ev, u, v, w, h) {
  const x = o[0] + eu[0] * u + ev[0] * v, y = o[1] + eu[1] * u + ev[1] * v;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + eu[0] * w, y + eu[1] * w);
  ctx.lineTo(x + eu[0] * w + ev[0] * h, y + eu[1] * w + ev[1] * h);
  ctx.lineTo(x + ev[0] * h, y + ev[1] * h);
  ctx.closePath();
  ctx.fill();
}

function drawModel(r, ctx, a, boxes, sx, sy, heading, scale, detail, haze) {
  const cos = Math.cos(heading), sin = Math.sin(heading);
  // Screen vectors for one metre along the world axes.
  const [i1, j1] = r.dir(1, 0), [i2, j2] = r.dir(0, 1);
  const k = 0.5 * scale; // metres -> cells
  const bx = [(i1 - j1) * 6 * k, (i1 + j1) * 3 * k], by = [(i2 - j2) * 6 * k, (i2 + j2) * 3 * k];
  const bz = PPM * scale;
  const proj = (lx, ly, lz) => {
    const wx = cos * lx - sin * ly, wy = sin * lx + cos * ly;
    return [sx + bx[0] * wx + by[0] * wy, sy + bx[1] * wx + by[1] * wy - bz * lz];
  };
  const depthOf = (lx, ly) => {
    const wx = cos * lx - sin * ly, wy = sin * lx + cos * ly;
    const [di, dj] = r.dir(wx, wy);
    return di + dj;
  };
  boxes.sort((p, q) => (depthOf(p.x, p.y) + p.z * 0.6) - (depthOf(q.x, q.y) + q.z * 0.6));
  const facing = {};
  for (const f in FACES) {
    const n = FACES[f].n;
    if (!n) { facing[f] = { vis: true, light: 1 }; continue; }
    const wx = cos * n[0] - sin * n[1], wy = sin * n[0] + cos * n[1];
    const [di, dj] = r.dir(wx, wy);
    const pi = Math.max(0, di), pj = Math.max(0, dj);
    facing[f] = { vis: di + dj > 0.01, light: pi + pj > 0 ? (pj * LEFT + pi * RIGHT) / (pi + pj) : 1 };
  }
  for (let bi = 0; bi < boxes.length; bi++) {
    const b = boxes[bi];
    const x0 = b.x - b.lx / 2, x1 = b.x + b.lx / 2, y0 = b.y - b.ly / 2, y1 = b.y + b.ly / 2, z0 = b.z, z1 = b.z + b.lz;
    const p = [];
    for (let c = 0; c < 8; c++) p.push(proj(c & 1 ? x1 : x0, c & 2 ? y1 : y0, c & 4 ? z1 : z0));
    for (const f of ['-x', '+x', '-y', '+y', '+z']) {
      const fc = facing[f];
      if (!fc.vis) continue;
      const base = f === '+z' && b.top ? b.top : b.c;
      ctx.fillStyle = rgb(mix(shade(base, fc.light), [214, 224, 226], haze));
      const q = FACES[f].q;
      quad(ctx, p, q);
      if (detail <= 0.02) continue;
      const o = p[q[0]], eu = [p[q[1]][0] - o[0], p[q[1]][1] - o[1]], ev = [p[q[3]][0] - o[0], p[q[3]][1] - o[1]];
      if (b.tex) {
        // Mottled fur: a few lighter and darker flecks, fixed per animal.
        ctx.globalAlpha = detail * 0.8;
        for (let s = 0; s < 5; s++) {
          const h = hash2(a.id * 13 + bi, s * 7 + f.length, f.charCodeAt(1));
          const u = hash2(a.id, bi * 31 + s, 3) * 0.75, v = hash2(bi, a.id * 7 + s, 5) * 0.7;
          ctx.fillStyle = rgb(shade(base, fc.light * (h > 0.5 ? 0.8 : 1.14)));
          patch(ctx, o, eu, ev, u, v, 0.22, 0.26);
        }
        ctx.globalAlpha = 1;
      }
      if (b.deco) {
        for (const d of b.deco) {
          if (d.f !== f) continue;
          ctx.globalAlpha = Math.min(1, detail * 1.6);
          ctx.fillStyle = rgb(shade(d.c, fc.light));
          patch(ctx, o, eu, ev, d.u, d.v, d.w, d.h);
          ctx.globalAlpha = 1;
        }
      }
    }
  }
}

function blobColor(a, winter) {
  switch (a.sp) {
    case 'otter': return C.otter.fur;
    case 'deer': return C.deer.coat;
    case 'rabbit': return winter ? C.rabbit.winter : C.rabbit.coat;
    case 'fox': return C.fox.coat;
    default: return C.heron.grey;
  }
}

const LENGTH = { otter: 0.9, deer: 1.6, rabbit: 0.45, fox: 1.0, heron: 0.6 };

export function drawSchools(r, ctx, alpha, time) {
  const w = r.world;
  if (!w.schools) return;
  const ppm = PPM * (r.view.z / r.dpr);
  for (const s of w.schools) {
    const x = s.px + (s.x - s.px) * alpha, y = s.py + (s.y - s.py) * alpha;
    const k = Math.round(y) * N + Math.round(x);
    if (w.water[k] < 0.12 || (w.ice[k] && w.snow[k] > 0.005)) continue;
    const [di, dj] = r.toDisplay(x, y);
    const sx = r.originX + (di - dj) * 6, sy = r.originY + (di + dj) * 3 - r.front.surf[k] * 5;
    const n = Math.min(8, Math.ceil(s.n / 15));
    const spread = 1.2 + s.fear * 2.5 + Math.min(1.5, s.n / 100);
    const [hi, hj] = r.dir(Math.cos(s.heading), Math.sin(s.heading));
    const ang = Math.atan2((hi + hj) * 3, (hi - hj) * 6);
    const deep = clamp(w.water[k] / 2.5, 0, 1);
    ctx.fillStyle = `rgba(36,52,62,${0.14 + 0.08 * (1 - deep)})`;
    for (let f = 0; f < n; f++) {
      const h1 = hash2(s.id, f, 1), h2 = hash2(s.id, f, 2);
      const wob = Math.sin(time * (0.5 + h1 * 0.5) + f) * 0.3;
      const ox = (h1 - 0.5) * spread * 2 + wob, oy = (h2 - 0.5) * spread;
      const len = Math.max(0.6, ppm > 6 ? 1.1 : 0.9);
      ctx.beginPath();
      ctx.ellipse(sx + ox, sy + oy, len, len * 0.32, ang, 0, Math.PI * 2);
      ctx.fill();
    }
    if (ppm > 5 && Math.random() < 0.004 * n) {
      ctx.fillStyle = 'rgba(240,248,250,0.7)';
      ctx.fillRect(sx + (Math.random() - 0.5) * spread * 2, sy + (Math.random() - 0.5) * spread, 0.6, 0.3);
    }
  }
}

export function drawCreatures(r, ctx, alpha, time) {
  const w = r.world, buf = r.front;
  const yf = w.cal.yearFrac;
  const winter = yf > 0.73 || yf < 0.04;
  const view = r.view;
  const zCss = view.z / r.dpr;
  const ppm = PPM * E * zCss;                       // on-screen pixels per metre
  const blob = 1 - smoothstep(2.4, 4.2, ppm);
  const detail = smoothstep(5.5, 10, ppm);
  // What part of the world is on screen (for skipping off-screen animals).
  const left = view.cx - view.W / 2 / view.z - 20, right = view.cx + view.W / 2 / view.z + 20;
  const top = view.cy - view.H / 2 / view.z - 30, bottom = view.cy + view.H / 2 / view.z + 30;

  const list = [];
  for (const a of w.animals) {
    const x = a.px + (a.x - a.px) * alpha, y = a.py + (a.y - a.py) * alpha;
    const [di, dj] = r.toDisplay(x, y);
    const k = Math.round(y) * N + Math.round(x);
    const surf = buf.surf[k];
    const sx = r.originX + (di - dj) * 6;
    const sy = r.originY + (di + dj) * 3 - surf * 5;
    list.push({ a, sx, sy, depth: di + dj, k, vis: sx > left && sx < right && sy > top && sy < bottom });
  }
  list.sort((p, q) => p.depth - q.depth);
  r.animalScreen = list;

  for (const it of list) {
    if (!it.vis) continue;
    const { a, sx, sy, k } = it;
    const S = SPECIES[a.sp];
    const young = (w.minute - a.born) / (28 * 1440) < S.adult;
    const scale = E * (young ? 0.62 : 1);
    const inWater = w.water[k] > 0.25 && !w.ice[k];
    let pose = a.pose;
    if (pose === 'rest') {
      if (a.sp === 'heron') pose = 'idle';
      else if (a.sp === 'otter' && !inWater) {
        // A resting otter keeps busy: grooms, rolls on its back, lies flat, grooms again.
        const phase = Math.floor(time / 14 + a.id * 0.37) % 4;
        pose = phase === 1 ? 'float' : phase === 2 ? 'sleep' : 'groom';
      } else pose = 'sleep';
    }
    if (a.sp === 'otter' && a.pose === 'sleep' && !inWater && Math.floor(time / 40 + a.id) % 3 === 0) pose = 'groom';
    // Small signs of life while still: breathing, a slowly turning head.
    const stillPose = pose === 'sleep' || pose === 'float' || pose === 'groom' || pose === 'eat' || pose === 'idle' || pose === 'stalk';
    if (a.sp === 'otter' && inWater) pose = pose === 'sleep' ? 'float' : pose === 'dive' ? 'dive' : 'swim';
    const lift = a.flying ? 14 : 0;
    const len = LENGTH[a.sp] * PPM * scale;

    // Ground shadow.
    if (!inWater || a.sp !== 'otter') {
      ctx.fillStyle = `rgba(30,40,40,${a.flying ? 0.1 : 0.2})`;
      ctx.beginPath(); ctx.ellipse(sx, sy, len * 0.45, len * 0.2, 0, 0, Math.PI * 2); ctx.fill();
    }
    if (r.selected === a.id) {
      ctx.strokeStyle = 'rgba(255,236,170,0.9)'; ctx.lineWidth = Math.max(0.4, 1 / zCss);
      ctx.beginPath(); ctx.ellipse(sx, sy, len * 0.7, len * 0.32, 0, 0, Math.PI * 2); ctx.stroke();
    }
    const breathe = stillPose ? Math.sin(time * 1.6 + a.id) * 0.25 : 0;
    const by = sy - lift - breathe;
    const [hi, hj] = r.dir(Math.cos(a.heading), Math.sin(a.heading));
    const haze = 0.1 * (1 - it.depth / (2 * N - 2));

    if (blob > 0.01) {
      ctx.globalAlpha = blob;
      const col = blobColor(a, winter);
      const ang = Math.atan2((hi + hj) * 3, (hi - hj) * 6);
      ctx.fillStyle = rgb(col);
      ctx.beginPath(); ctx.ellipse(sx, by - len * 0.2, len * 0.5, len * 0.28, ang, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = rgb(shade(col, 0.7));
      ctx.beginPath(); ctx.ellipse(sx + Math.cos(ang) * len * 0.4, by - len * 0.25 + Math.sin(ang) * len * 0.2, len * 0.18, len * 0.16, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
    if (blob < 0.99) {
      ctx.globalAlpha = 1 - blob;
      const boxes = buildModel(a, pose, time, young, winter);
      const look = stillPose && pose !== 'sleep' ? Math.sin(time * 0.35 + a.id * 1.7) * 0.5 : 0;
      drawModel(r, ctx, a, boxes, sx, by, a.heading + look, scale, detail, haze);
      ctx.globalAlpha = 1;
    }
    if (inWater && a.sp === 'otter' && (pose === 'swim' || pose === 'dive') && Math.hypot(a.x - a.px, a.y - a.py) > 0.02) {
      ctx.strokeStyle = 'rgba(240,250,252,0.5)'; ctx.lineWidth = Math.max(0.3, 0.6 / zCss);
      const bx = (hi - hj) * 6, byy = (hi + hj) * 3, l = Math.hypot(bx, byy) || 1;
      const ux = bx / l, uy = byy / l;
      ctx.beginPath();
      ctx.moveTo(sx - ux * len * 1.2 - uy * len * 0.4, sy - uy * len * 1.2 + ux * len * 0.2);
      ctx.lineTo(sx - ux * len * 0.2, sy - uy * len * 0.2);
      ctx.lineTo(sx - ux * len * 1.2 + uy * len * 0.4, sy - uy * len * 1.2 - ux * len * 0.2);
      ctx.stroke();
    }
    it.headY = by - (a.sp === 'deer' ? 1.6 : a.sp === 'heron' ? 1.1 : 0.5) * PPM * scale;
  }
}

// Thought bubbles, drawn in screen space after lighting so they stay readable at night.
export function drawBubbles(r, ctx) {
  const w = r.world, view = r.view;
  const zCss = view.z / r.dpr;
  const ppm = PPM * E * zCss;
  // Zoomed out: a couple of fresh thoughts at a time. Zoomed in: more, and longer-lived.
  const close = smoothstep(8, 12, ppm);
  const maxBubbles = close > 0.5 ? 2 : 1;
  const freshFor = close > 0.5 ? 30 : 15;
  const show = 1;
  const toScreen = (x, y) => [(x - view.cx) * view.z + view.W / 2, (y - view.cy) * view.z + view.H / 2];
  const now = w.minute;
  // The selected animal, plus a couple of others near the middle with something fresh on their mind.
  const cands = [];
  for (const it of r.animalScreen) {
    if (!it.vis || !it.headY) continue;
    const th = it.a.mind && it.a.mind.thoughts.at(-1);
    if (!th) continue;
    const age = now - th.t;
    const sel = r.selected === it.a.id;
    if (age > (sel ? 120 : freshFor)) continue;
    const [px, py] = toScreen(it.sx, it.headY);
    if (px < 0 || py < 0 || px > view.W || py > view.H) continue;
    const dc = Math.hypot(px - view.W / 2, py - view.H / 2);
    cands.push({ it, th, age, sel, px, py, score: sel ? -1e9 : dc + age * 3 });
  }
  cands.sort((p, q) => p.score - q.score);
  const dpr = r.dpr;
  const fs = close > 0.5 ? 12 : 11;
  ctx.font = `${fs * dpr}px ui-rounded, system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  const placed = [];
  for (const c of cands.slice(0, maxBubbles)) {
    const text = c.th.text;
    const tw = Math.min(ctx.measureText(text).width, 230 * dpr);
    const bw = tw + 16 * dpr, bh = (fs + 12) * dpr;
    const bx = c.px - bw / 2, by = c.py - bh - 10 * dpr;
    if (placed.some(p => Math.abs(p.x - bx) < bw && Math.abs(p.y - by) < bh)) continue;
    placed.push({ x: bx, y: by });
    const fade = clamp(((c.sel ? 120 : freshFor) - c.age) / 8, 0, 1);   // fade out over the last few minutes
    ctx.globalAlpha = show * fade * (c.sel ? 1 : 0.85);
    ctx.fillStyle = 'rgba(252,250,244,0.92)';
    ctx.strokeStyle = 'rgba(38,49,58,0.15)';
    ctx.lineWidth = dpr;
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, 10 * dpr);
    ctx.moveTo(c.px - 5 * dpr, by + bh);
    ctx.lineTo(c.px, by + bh + 7 * dpr);
    ctx.lineTo(c.px + 5 * dpr, by + bh);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#2b3640';
    ctx.fillText(text, bx + 8 * dpr, by + bh / 2, 230 * dpr);
    ctx.globalAlpha = 1;
  }
}
