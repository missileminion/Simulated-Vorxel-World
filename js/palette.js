// Soft, muted colours. Everything is mixed from these so the whole scene stays calm.

import { clamp } from './rng.js';

export const MAT_COLORS = [
  [150, 150, 146], // rock
  [172, 166, 152], // gravel
  [224, 208, 164], // sand
  [172, 156, 126], // silt
  [180, 150, 120], // clay
  [166, 140, 108], // loam
  [118, 102, 84],  // peat
];

export const COL = {
  ash: [96, 90, 86],
  snow: [243, 245, 247],
  dry: [206, 190, 138],
  waterShallow: [118, 184, 198],
  waterDeep: [70, 128, 160],
  ice: [216, 232, 238],
  mud: [170, 158, 122],
  sideSoil: [146, 116, 88],
  sideRock: [128, 122, 116],
  sideRock2: [138, 132, 124],
  sideWater: [112, 168, 186],
  haze: [214, 224, 226],
  trunk: [116, 92, 72],
  snag: [140, 128, 116],
  bare: [140, 124, 110],
  conifer: [86, 128, 108],
  coniferWinter: [92, 122, 112],
  shrub: [118, 156, 104],
  berry: [196, 82, 86],
  reed: [154, 162, 98],
  reedDry: [190, 176, 120],
  cattail: [120, 90, 66],
};

// Grass colour through the year: keyframes at the middle of each season.
const GRASS_KEYS = [
  [140, 186, 118], // spring
  [118, 166, 102], // summer
  [166, 166, 110], // autumn
  [146, 152, 126], // winter
];

const AUTUMN_LEAVES = [[224, 162, 86], [208, 114, 80], [228, 198, 108], [196, 136, 82]];

export const mix = (a, b, t) => {
  t = clamp(t, 0, 1);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
};
export const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
export const rgb = c => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
export const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

// yearFrac 0..1 with season centres at 0.125, 0.375, 0.625, 0.875
export function grassColor(yearFrac) {
  const p = ((yearFrac - 0.125) * 4 + 4) % 4;
  const k = Math.floor(p), t = p - k;
  const s = t * t * (3 - 2 * t);
  return mix(GRASS_KEYS[k], GRASS_KEYS[(k + 1) % 4], s);
}

// Broadleaf canopy: how full it is and what colour, by time of year.
export function leafState(yearFrac, h) {
  const d = yearFrac * 28;
  let density = 1, col;
  const summer = [118, 166, 102], fresh = [172, 204, 136];
  if (d < 3.5) { density = 0.25 + 0.75 * (d / 3.5); col = mix(fresh, summer, d / 6); }
  else if (d < 14) col = mix(fresh, summer, clamp(d / 6, 0, 1));
  else if (d < 20) {
    const t = (d - 14) / 6;
    col = mix(summer, AUTUMN_LEAVES[Math.floor(h * 4) % 4], clamp(t * 1.5, 0, 1));
    density = d < 18 ? 1 : 1 - (d - 18) / 2.6;
  } else if (d < 27) { density = 0; col = summer; }
  else { density = (d - 27) * 0.25; col = fresh; }
  return { density: clamp(density, 0, 1), col };
}

export function skyColors(elev, cloud) {
  const day = [[156, 190, 208], [226, 234, 226]];
  const gold = [[128, 150, 188], [246, 208, 172]];
  const dusk = [[70, 74, 120], [176, 138, 150]];
  const night = [[18, 26, 50], [42, 54, 84]];
  let top, bot;
  if (elev > 0.25) { top = day[0]; bot = day[1]; }
  else if (elev > 0.05) { const t = (elev - 0.05) / 0.2; top = mix(gold[0], day[0], t); bot = mix(gold[1], day[1], t); }
  else if (elev > -0.05) { const t = (elev + 0.05) / 0.1; top = mix(dusk[0], gold[0], t); bot = mix(dusk[1], gold[1], t); }
  else if (elev > -0.2) { const t = (elev + 0.2) / 0.15; top = mix(night[0], dusk[0], t); bot = mix(night[1], dusk[1], t); }
  else { top = night[0]; bot = night[1]; }
  const light = clamp(elev * 4 + 0.5, 0, 1);
  const grey = [[168, 176, 182], [204, 208, 206]];
  top = mix(top, shade(grey[0], 0.4 + 0.6 * light), cloud * 0.7);
  bot = mix(bot, shade(grey[1], 0.4 + 0.6 * light), cloud * 0.6);
  return [top, bot];
}

export function lightTint(elev, cloud) {
  const dayC = [255, 252, 246], gold = [255, 214, 176], dusk = [196, 156, 182], night = [78, 94, 146];
  let c;
  if (elev > 0.25) c = dayC;
  else if (elev > 0.06) c = mix(gold, dayC, (elev - 0.06) / 0.19);
  else if (elev > -0.04) c = mix(dusk, gold, (elev + 0.04) / 0.1);
  else if (elev > -0.2) c = mix(night, dusk, (elev + 0.2) / 0.16);
  else c = night;
  const grey = [(c[0] + c[1] + c[2]) / 3 * 0.9, (c[0] + c[1] + c[2]) / 3 * 0.92, (c[0] + c[1] + c[2]) / 3 * 0.95];
  return mix(c, grey, cloud * 0.55);
}
