// Fish as a density per water cell (0..1 of what the cell can support).
// They breed in spring, follow good habitat, die when water dries or freezes
// solid, and are restocked from the river upstream of the valley.

import { N, DAYS_PER_SEASON } from './config.js';
import { clamp } from './rng.js';

export function capacity(w, i, temp) {
  const d = w.water[i];
  if (d < 0.12) return 0;
  let c = clamp((d - 0.12) / 0.6, 0, 1);
  if (temp > 21 && w.flow[i] < 0.02) c *= 0.55;                 // warm still water: low oxygen
  if (w.ice[i] && d < 0.6) c *= 0.3;                             // shallow ice: winter kill
  c *= 0.75 + 0.25 * w.reed[i];
  c *= 1 - clamp(w.sed[i] * 20, 0, 0.5);                         // muddy water
  return c;
}

export function dailyFish(w, cal) {
  const { fish, delta, rng } = w;
  const meanT = w.climate.meanTemp(cal.yearFrac);
  const caps = w.scratch;
  let died = 0;
  const r = cal.season === 0 ? (cal.dayOfSeason < DAYS_PER_SEASON / 2 ? 0.22 : 0.08)
    : cal.season === 1 ? 0.05 : cal.season === 2 ? 0.02 : -0.01;

  for (let i = 0; i < fish.length; i++) {
    const temp = meanT - (w.terrain[i] - 8) * 0.16 + w.warm[i];
    const cap = capacity(w, i, temp);
    caps[i] = cap;
    const f = fish[i];
    if (f <= 0) continue;
    if (cap <= 0.01) { died += f; w.litter[i] += f * 0.1; fish[i] = 0; continue; }
    let nf = f + r * f * (1 - f / cap);
    if (f > cap) nf = f - (f - cap) * 0.3;
    fish[i] = Math.max(0, nf);
  }
  if (died > 0) w.fishDied += died;

  // Fish move toward better habitat along connected water.
  for (let pass = 0; pass < 3; pass++) {
    delta.fill(0);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const f = fish[i];
      if (f < 0.002) continue;
      const room = caps[i] > 0 ? f / caps[i] : 2;
      let moved = 0;
      const nbrs = [x < N - 1 ? i + 1 : -1, x > 0 ? i - 1 : -1, y < N - 1 ? i + N : -1, y > 0 ? i - N : -1];
      for (const j of nbrs) {
        if (j < 0 || caps[j] <= 0.02) continue;
        const roomJ = fish[j] / caps[j];
        if (roomJ < room) {
          const m = f * 0.1 * Math.min(1, room - roomJ);
          delta[j] += m; moved += m;
        }
      }
      delta[i] -= moved;
    }
    for (let i = 0; i < fish.length; i++) fish[i] = Math.max(0, fish[i] + delta[i]);
  }

  // Upstream river keeps fish arriving; a rare stray also reaches the lake.
  for (const s of w.springs) {
    if (caps[s.i] > 0.05) fish[s.i] = Math.max(fish[s.i], 0.4 * caps[s.i]);
  }
  if (rng.chance(0.05)) {
    const i = rng.int(N * N);
    if (caps[i] > 0.3 && fish[i] < 0.1) fish[i] = 0.2;
  }
}

export function seedInitialFish(w) {
  for (let i = 0; i < w.fish.length; i++) {
    const cap = capacity(w, i, 12);
    w.fish[i] = cap * 0.7;
  }
}
