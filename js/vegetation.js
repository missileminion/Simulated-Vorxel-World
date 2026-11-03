// Plants: grass, reeds, shrubs and two kinds of trees. Growth follows water,
// warmth, light and soil. Trees seed nearby, drown in floods, die of drought or
// old age, stand as snags and rot into the soil. Lightning can start fires.

import { N, DAYS_PER_YEAR } from './config.js';
import { MAT } from './terrain.js';
import { clamp, fbm, smoothstep } from './rng.js';

export const TREE = { NONE: 0, DECID: 1, CONIFER: 2, SHRUB: 3, SNAG: 4 };
export const TREE_NAMES = ['', 'broadleaf tree', 'pine', 'berry shrub', 'dead tree'];

const SPECIES = {
  1: { grow: 0.0065, life: 90, drown: 9, moist: [0.32, 0.95], maxH: 27 },
  2: { grow: 0.0045, life: 140, drown: 5, moist: [0.2, 0.85], maxH: 38 },
  3: { grow: 0.02, life: 18, drown: 6, moist: [0.15, 0.8], maxH: 30 },
};

const BASE_FERT = [0.08, 0.2, 0.3, 0.8, 0.6, 0.7, 0.9];

export function baseFertility(mat) { return BASE_FERT[mat]; }

function suitability(w, i, sp) {
  const mat = w.material[i];
  if (mat === MAT.ROCK && sp !== 2) return 0;
  if (w.water[i] > 0.05) return 0;
  const s = SPECIES[sp];
  const m = w.moist[i];
  const wet = smoothstep(s.moist[0] - 0.1, s.moist[0] + 0.05, m) * (1 - smoothstep(s.moist[1], s.moist[1] + 0.15, m));
  const h = w.terrain[i];
  const height = 1 - smoothstep(s.maxH - 4, s.maxH + 2, h);
  const lowland = sp === 2 ? 0.45 + 0.55 * smoothstep(8, 18, h) : 1;
  const soil = mat === MAT.ROCK ? 0.25 : mat === MAT.GRAVEL || mat === MAT.SAND ? 0.45 : 1;
  return wet * height * lowland * soil * (0.5 + 0.5 * w.fert[i]);
}

function growSeason(temp) { return clamp((temp - 4) / 12, 0, 1); }

export function seedInitialVegetation(w) {
  const { seed } = w;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x;
    const mat = w.material[i];
    w.fert[i] = BASE_FERT[mat];
    if (w.water[i] > 0.05) { w.reed[i] = w.water[i] < 0.6 ? 0.5 : 0; continue; }
    w.grass[i] = mat === MAT.ROCK ? 0.1 : clamp(0.4 + w.moist[i] * 0.6, 0, 1) * (mat === MAT.SAND ? 0.4 : 1);
    const forest = fbm(x * 0.06, y * 0.06, seed + 33, 4);
    const r = w.rng.next();
    if (forest > 0.52 && r < (forest - 0.4) * 1.8) {
      const sp = w.terrain[i] > 17 ? (w.rng.chance(0.85) ? 2 : 1) : (w.rng.chance(0.2) ? 2 : 1);
      if (suitability(w, i, sp) > 0.15) plant(w, i, sp, 0.25 + w.rng.next() * 0.75);
    } else if (forest > 0.42 && r < 0.08 && suitability(w, i, 3) > 0.2) {
      plant(w, i, 3, 0.3 + w.rng.next() * 0.7);
    }
  }
}

function plant(w, i, sp, size) {
  w.tree[i] = sp; w.treeSize[i] = size; w.treeHealth[i] = 1; w.drown[i] = 0;
}

function killTree(w, i) {
  w.tree[i] = TREE.SNAG; w.treeHealth[i] = 0;
}

export function dailyVegetation(w, cal) {
  const { grass, reed, tree, treeSize, treeHealth, water, moist, snow, litter, fert, burn, rng } = w;
  const doyF = cal.doy / DAYS_PER_YEAR;
  const meanT = w.climate.meanTemp(doyF + 0.5 / DAYS_PER_YEAR);
  const stats = { died: 0, born: 0 };

  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x;
    const temp = meanT - (w.terrain[i] - 8) * 0.16 + w.warm[i];
    const gs = growSeason(temp) * (snow[i] > 0.02 ? 0.1 : 1);
    const wa = water[i];

    // Grass
    if (wa > 0.25) grass[i] = Math.max(0, grass[i] - 0.15);
    else {
      const shade = tree[i] > 0 && tree[i] < 4 ? treeSize[i] * 0.45 : 0;
      const cap = clamp(smoothstep(0.05, 0.4, moist[i]) * (0.35 + 0.65 * fert[i]) - shade, 0, 1)
        * (w.material[i] === MAT.ROCK ? 0.25 : 1);
      if (grass[i] < cap) grass[i] += 0.07 * gs * (grass[i] + 0.05) * (1 - grass[i]);
      else grass[i] -= (grass[i] - cap) * 0.04;
    }

    // Reeds live in shallow water and soggy edges.
    const reedOk = (wa > 0.03 && wa < 0.8) || (moist[i] > 0.97 && wa <= 0.03);
    if (reedOk && wa < 0.8) reed[i] = Math.min(1, reed[i] + 0.04 * gs * (reed[i] + 0.04));
    else reed[i] = Math.max(0, reed[i] - (wa > 1.2 ? 0.08 : 0.03));

    // Trees
    const sp = tree[i];
    if (sp >= 1 && sp <= 3) {
      const s = SPECIES[sp];
      if (wa > 0.12) w.drown[i] = Math.min(255, w.drown[i] + 1); else if (w.drown[i] > 0) w.drown[i]--;
      let hDelta = 0.03;
      if (w.drown[i] > 2) hDelta = -1 / s.drown;
      else if (moist[i] < 0.07 && temp > 8) hDelta = -0.03;
      treeHealth[i] = clamp(treeHealth[i] + hDelta, 0, 1);
      const suit = suitability(w, i, sp) || 0.2;
      treeSize[i] = Math.min(1, treeSize[i] + s.grow * gs * suit * (1.05 - treeSize[i]) * 2);
      const age = 1 / (s.life * DAYS_PER_YEAR) * (treeSize[i] > 0.9 ? 2.5 : 0.4);
      if (treeHealth[i] <= 0 || rng.chance(age)) { killTree(w, i); stats.died++; }
    } else if (sp === TREE.SNAG) {
      treeSize[i] -= wa > 0.1 ? 0.01 : 0.004;
      if (treeSize[i] <= 0.05 || rng.chance(0.002)) {
        litter[i] += 0.3 + treeSize[i]; tree[i] = 0; treeSize[i] = 0;
      }
    } else if (gs > 0.3 && wa < 0.05) {
      // Seeds from a random nearby tree, or a rare long-distance arrival.
      const ox = x + rng.int(7) - 3, oy = y + rng.int(7) - 3;
      let src = 0;
      if (ox >= 0 && oy >= 0 && ox < N && oy < N) {
        const j = oy * N + ox;
        if (tree[j] >= 1 && tree[j] <= 3 && treeSize[j] > 0.45) src = tree[j];
      }
      let chance = src ? 0.05 : 0.0006;
      if (!src) src = temp < 6 ? 2 : rng.chance(0.25) ? 3 : rng.chance(0.3) ? 2 : 1;
      chance *= (1 - 0.55 * grass[i]) * (1 + burn[i] * 1.5);
      const suit = suitability(w, i, src);
      if (suit > 0.1 && rng.chance(chance * suit)) { plant(w, i, src, 0.03); stats.born++; }
    }

    // Leaf litter and old wood rot into fertile soil.
    const decay = litter[i] * 0.01 * (0.3 + moist[i]) * (temp > 2 ? 1 : 0.2);
    litter[i] -= decay;
    fert[i] = clamp(fert[i] + decay * 0.4 + (BASE_FERT[w.material[i]] - fert[i]) * 0.002, 0, 1);
    if (w.deposit[i] > 0.01) { fert[i] = Math.min(1, fert[i] + w.deposit[i] * 2); w.deposit[i] = 0; }
    if (burn[i] > 0) burn[i] = Math.max(0, burn[i] - 0.008);
  }
  return stats;
}

// ---- Fire ----

function fuel(w, i) {
  let f = w.grass[i] * 0.55 + w.litter[i] * 0.3;
  const sp = w.tree[i];
  if (sp >= 1 && sp <= 3) f += w.treeSize[i] * (sp === 2 ? 1.1 : 0.8);
  else if (sp === TREE.SNAG) f += w.treeSize[i] * 1.2;
  return f;
}

// Lightning: mostly at the start of storms, before the rain soaks in, and
// occasionally from dry summer thunderheads that bring no rain at all.
export function tryLightning(w, rng) {
  const c = w.climate;
  let strikes = 0;
  if (c.weather === 'storm' && rng.chance(0.4)) strikes = 1;
  else if (c.precip === 0 && c.temp > 22 && rng.chance(0.008)) strikes = 1;
  for (let k = 0; k < strikes; k++) {
    const i = rng.int(N * N);
    if (w.water[i] > 0.01 || w.snow[i] > 0.01) continue;
    const dry = 1 - w.moist[i];
    if (fuel(w, i) > 0.45 && dry > 0.62 && rng.chance(0.5)) { ignite(w, i); return i; }
  }
  return -1;
}

function ignite(w, i) {
  if (w.fire[i] > 0) return;
  w.fire[i] = 1;
  w.burning.push(i);
}

export function hourlyFire(w, rng) {
  if (!w.burning.length) return 0;
  const c = w.climate;
  const rain = c.precip > 0;
  const next = [];
  let burned = 0;
  for (const i of w.burning) {
    const x = i % N, y = Math.floor(i / N);
    // Spread to neighbours, helped by wind and dryness.
    if (!rain) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const j = ny * N + nx;
        if (w.fire[j] > 0 || w.water[j] > 0.02 || w.snow[j] > 0.02) continue;
        const wind = 1 + 0.6 * (dx * c.windX + dy * c.windY) / Math.hypot(dx, dy);
        const p = 0.28 * fuel(w, j) * Math.pow(1 - w.moist[j], 2) * wind * (dx && dy ? 0.6 : 1);
        if (rng.chance(p)) { w.fire[j] = 1; next.push(j); }
      }
    }
    // Burn what's here.
    w.fire[i] -= rain ? 0.6 : 0.3;
    w.burn[i] = 1;
    w.litter[i] = 0;
    w.grass[i] *= 0.3;
    if (w.tree[i] >= 1 && w.tree[i] <= 3) {
      if (rng.chance(w.tree[i] === 3 ? 0.9 : 0.7)) { w.tree[i] = TREE.SNAG; w.treeHealth[i] = 0; w.treeSize[i] *= 0.7; }
    } else if (w.tree[i] === TREE.SNAG && rng.chance(0.5)) {
      w.tree[i] = 0; w.treeSize[i] = 0;
    }
    w.fert[i] = Math.min(1, w.fert[i] + 0.06);
    if (w.fire[i] > 0) next.push(i); else { w.fire[i] = 0; burned++; }
  }
  w.burning = next;
  return burned;
}
