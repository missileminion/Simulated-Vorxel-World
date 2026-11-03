// Builds the valley: mountains at the back corner, a meandering river with one
// tributary, a lake near the front, and soil materials that follow the landform.

import { N, MAX_H } from './config.js';
import { fbm, hash2, clamp, smoothstep } from './rng.js';

export const MAT = { ROCK: 0, GRAVEL: 1, SAND: 2, SILT: 3, CLAY: 4, SOIL: 5, PEAT: 6 };
export const MAT_NAMES = ['rock', 'gravel', 'sand', 'silt', 'clay', 'loam', 'peat'];

const L = N - 1;
// u runs from the mountain corner (0) to the outlet corner (1); v runs across the valley.
export const toUV = (x, y) => ({ u: (x + y) / (2 * L), v: (x - y) / L });
const toXY = (u, v) => ({ x: L * (u + v / 2), y: L * (u - v / 2) });

function meander(u, seed) {
  const room = clamp(Math.min(u, 1 - u) * 4, 0, 1);
  const s = (seed % 97) / 97 * 6.28;
  return room * (0.2 * Math.sin(u * 7.2 + s) + 0.07 * Math.sin(u * 16.5 + s * 2) + (fbm(u * 3, 0.5, seed + 77, 3) - 0.5) * 0.14);
}

function polyline(points) {
  return points.map(p => toXY(p.u, p.v));
}

function distToPolyline(px, py, pts) {
  let best = Infinity;
  for (let k = 0; k < pts.length - 1; k++) {
    const a = pts[k], b = pts[k + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy || 1;
    const t = clamp(((px - a.x) * dx + (py - a.y) * dy) / len2, 0, 1);
    const ex = a.x + dx * t - px, ey = a.y + dy * t - py;
    const d = ex * ex + ey * ey;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

export function generateTerrain(world) {
  const { seed, terrain, material } = world;

  const main = [];
  for (let u = 0; u <= 1.0001; u += 0.01) main.push({ u, v: meander(u, seed) });
  const join = 0.56;
  const t0 = { u: 0.27, v: -0.48 }, t1 = { u: 0.42, v: -0.44 }, t2 = { u: join, v: meander(join, seed) };
  const trib = [];
  for (let k = 0; k <= 30; k++) {
    const t = k / 30, a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t;
    trib.push({ u: a * t0.u + b * t1.u + c * t2.u, v: a * t0.v + b * t1.v + c * t2.v });
  }
  const mainXY = polyline(main), tribXY = polyline(trib);
  const lakeU = 0.83, lakeC = toXY(lakeU, meander(lakeU, seed));
  const dMainArr = new Float32Array(N * N);

  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x;
    const { u } = toUV(x, y);
    const dMain = distToPolyline(x, y, mainXY);
    const dTrib = distToPolyline(x, y, tribXY);
    dMainArr[i] = dMain;
    const dValley = Math.min(dMain, dTrib * 1.5);

    const floor = 3.5 + Math.pow(1 - u, 1.5) * 24;
    const walls = smoothstep(3, 38, dValley) * (8 + 11 * fbm(x * 0.03, y * 0.03, seed + 5, 3));
    const peaks = Math.pow(1 - u, 2.2) * 15 * fbm(x * 0.07, y * 0.07, seed + 9, 4);
    const hills = (fbm(x * 0.05, y * 0.05, seed, 5) - 0.5) * 7 * smoothstep(2, 14, dValley);
    let h = floor + walls + peaks + hills;

    h -= 1.5 * (1 - smoothstep(0.4, 3.0, dMain));
    h -= 1.0 * (1 - smoothstep(0.3, 2.2, dTrib));
    const lr = Math.hypot(x - lakeC.x, y - lakeC.y) / (N * 0.085);
    h -= 3.6 * Math.exp(-lr * lr * 1.5);

    terrain[i] = clamp(h, 0.6, MAX_H - 2);
  }

  // Materials follow slope, height and distance to water.
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x, h = terrain[i];
    let slope = 0;
    if (x > 0) slope = Math.max(slope, Math.abs(h - terrain[i - 1]));
    if (x < L) slope = Math.max(slope, Math.abs(h - terrain[i + 1]));
    if (y > 0) slope = Math.max(slope, Math.abs(h - terrain[i - N]));
    if (y < L) slope = Math.max(slope, Math.abs(h - terrain[i + N]));
    const { u } = toUV(x, y);
    const dMain = dMainArr[i];
    const dTrib = distToPolyline(x, y, tribXY);
    const lr = Math.hypot(x - lakeC.x, y - lakeC.y) / (N * 0.085);
    const patch = fbm(x * 0.08, y * 0.08, seed + 21, 3);
    let m = MAT.SOIL;
    if (h > 32 || slope > 2.6) m = MAT.ROCK;
    else if (dMain < 1.4 || dTrib < 1.0) m = MAT.GRAVEL;
    else if (lr < 1.15 && hash2(x, y, seed + 3) < 0.85) m = MAT.SAND;
    else if (lr < 1.7 && patch > 0.5) m = MAT.PEAT;
    else if (dMain < 7 && u > 0.3) m = MAT.SILT;
    else if (patch > 0.64) m = MAT.CLAY;
    else if (h > 27 && patch < 0.4) m = MAT.GRAVEL;
    material[i] = m;
  }

  const cell = p => {
    const x = clamp(Math.round(p.x), 0, L), y = clamp(Math.round(p.y), 0, L);
    return y * N + x;
  };
  // River inflow from the larger catchment beyond the map.
  const src = toXY(0.035, meander(0.035, seed));
  const tsrc = toXY(t0.u + 0.01, t0.v);
  world.springs = [
    { i: cell(src), share: 0.75 },
    { i: cell(tsrc), share: 0.25 },
  ];
  // A hot spring on the far slope.
  let hot = cell(toXY(0.47, 0.42));
  for (let k = 0; k < 40 && dMainArr[hot] < 6; k++) hot = cell(toXY(0.47, 0.42 + k * 0.01));
  world.hotSpring = hot;
}

// Plain-language place names for the event log.
export function placeName(i) {
  const x = i % N, y = Math.floor(i / N);
  const { u, v } = toUV(x, y);
  const side = v < -0.25 ? 'western ' : v > 0.25 ? 'eastern ' : '';
  if (u < 0.2) return `the ${side}high ridge`;
  if (u < 0.42) return `the ${side}upper valley`;
  if (u < 0.68) return `the ${side}meadows`;
  if (u < 0.88) return side ? `the ${side}lake shore` : 'the lake';
  return 'the valley mouth';
}
