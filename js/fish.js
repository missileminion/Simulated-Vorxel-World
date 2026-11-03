// Fish live in schools. Each school is a little group with a size, a fear
// level and a growing wariness: it feeds where the water is good, flees and
// scatters from otters and herons, hides in reeds and deep water at night,
// avoids places where it was attacked, runs upstream to spawn in spring, and
// splits or merges as it grows and shrinks. The upstream river keeps
// sending newcomers, so the valley never runs out of fish for good.

import { N, DAYS_PER_SEASON } from './config.js';
import { clamp } from './rng.js';

const MAX_SCHOOLS = 64;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
const cellOf = (x, y) => clamp(Math.round(y), 0, N - 1) * N + clamp(Math.round(x), 0, N - 1);
const swimmable = (w, i) => w.water[i] > 0.12;

// How good a cell is for fish: depth, oxygen, cover, clarity.
export function capacity(w, i, temp) {
  const d = w.water[i];
  if (d < 0.12) return 0;
  let c = clamp((d - 0.12) / 0.6, 0, 1);
  if (temp > 21 && w.flow[i] < 0.02) c *= 0.55;      // warm still water: little oxygen
  if (w.ice[i] && d < 0.6) c *= 0.3;                  // shallow ice: winter kill
  c *= 0.75 + 0.25 * w.reed[i];
  c *= 1 - clamp(w.sed[i] * 20, 0, 0.5);              // muddy water
  return c;
}

const cellTempFor = (w, i) => w.climate.temp - (w.terrain[i] - 8) * 0.16 + w.warm[i];

// Hiding value: deep water and thick reeds.
function cover(w, i) { return clamp(w.water[i] / 2, 0, 1) * 0.6 + w.reed[i] * 0.8; }

function makeSchool(w, i, n) {
  const x = i % N, y = (i / N) | 0;
  return {
    id: w.nextSchoolId++, x, y, px: x, py: y, tx: x, ty: y, n,
    fear: 0, wary: 0, heading: w.rng.next() * 6.28, mode: 'feed',
    migrant: w.rng.chance(0.4), danger: [], threatX: x, threatY: y,
  };
}

export function seedSchools(w) {
  w.schools = [];
  const rng = w.rng;
  for (let k = 0; k < 4000 && w.schools.length < 40; k++) {
    const i = rng.int(N * N);
    if (capacity(w, i, 12) < 0.2) continue;
    if (w.schools.some(s => Math.hypot(s.x - (i % N), s.y - ((i / N) | 0)) < 4)) continue;
    w.schools.push(makeSchool(w, i, 30 + rng.int(80)));
  }
  rebuildFishMap(w);
}

export function nearestSchool(w, x, y, r, filter) {
  let best = null, bestD = r;
  for (const s of w.schools) {
    if (s.n < 5 || !swimmable(w, cellOf(s.x, s.y))) continue;
    const d = Math.hypot(s.x - x, s.y - y);
    if (d < bestD && (!filter || filter(s))) { bestD = d; best = s; }
  }
  return best;
}

// Something attacked this school: fear, wariness, a remembered danger spot.
export function startle(w, s, fromX, fromY, caught) {
  s.fear = 1;
  s.wary = Math.min(0.8, s.wary + (caught ? 0.1 : 0.04));
  s.threatX = fromX; s.threatY = fromY;
  s.danger.push({ x: Math.round(s.x), y: Math.round(s.y), t: w.minute });
  if (s.danger.length > 4) s.danger.shift();
  if (caught) s.n = Math.max(0, s.n - 1);
}

function moveSchool(w, s, tx, ty, speed) {
  // A minute of swimming in short steps.
  for (let left = speed; left > 0.01; left -= 0.7) {
    if (stepSchool(w, s, tx, ty, Math.min(0.7, left))) return true;
  }
  return false;
}

function stepSchool(w, s, tx, ty, speed) {
  const dx = tx - s.x, dy = ty - s.y, dist = Math.hypot(dx, dy);
  if (dist < 0.3) return true;
  const here = cellOf(s.x, s.y);
  let best = -Infinity, bx = 0, by = 0;
  for (const [ox, oy] of DIRS) {
    const len = Math.hypot(ox, oy);
    const nx = s.x + ox / len * 0.8, ny = s.y + oy / len * 0.8;
    if (nx < 0 || ny < 0 || nx > N - 1 || ny > N - 1) continue;
    const j = cellOf(nx, ny);
    if (j !== here && !swimmable(w, j)) continue;
    const score = (ox * dx + oy * dy) / (len * dist) + w.rng.next() * 0.2;
    if (score > best) { best = score; bx = ox / len; by = oy / len; }
  }
  if (best === -Infinity) return true;
  const step = Math.min(speed, dist);
  s.x = clamp(s.x + bx * step, 0, N - 1);
  s.y = clamp(s.y + by * step, 0, N - 1);
  s.heading = Math.atan2(by, bx);
  return false;
}

// Look around for a better spot: food and cover, away from remembered danger and crowds.
function bestSpot(w, s, r, wantCover) {
  let best = -1, bestV = -Infinity;
  for (let k = 0; k < 8; k++) {
    const x = Math.round(clamp(s.x + w.rng.range(-r, r), 0, N - 1)), y = Math.round(clamp(s.y + w.rng.range(-r, r), 0, N - 1));
    const i = y * N + x;
    if (!swimmable(w, i)) continue;
    let v = wantCover ? cover(w, i) : capacity(w, i, cellTempFor(w, i)) + cover(w, i) * 0.2 * (1 + s.wary);
    for (const d of s.danger) if (Math.abs(d.x - x) + Math.abs(d.y - y) < 4) v -= 0.4 * (1 + s.wary);
    v -= w.fish[i] * 0.3;                               // spread out a little
    v -= Math.hypot(x - s.x, y - s.y) * 0.02;
    if (v > bestV) { bestV = v; best = i; }
  }
  return best;
}

export function tickSchools(w) {
  if (!w.schools || !w.schools.length) return;
  if (w.schools.some(s => s.n < 1)) w.schools = w.schools.filter(s => s.n >= 1);
  const cal = w.cal;
  const night = w.climate.elev < -0.05;
  const spawnRun = cal.season === 0 && cal.dayOfSeason < 4;
  const preds = w.animals.filter(a => a.sp === 'otter' || a.sp === 'heron');
  for (const s of w.schools) {
    s.px = s.x; s.py = s.y;
    const here = cellOf(s.x, s.y);
    // Stranded: head for the deepest water nearby, or slowly die.
    if (!swimmable(w, here)) {
      let deep = -1, dv = 0.12;
      for (const [ox, oy] of DIRS) {
        const j = cellOf(s.x + ox, s.y + oy);
        if (w.water[j] > dv) { dv = w.water[j]; deep = j; }
      }
      if (deep >= 0) { s.x = deep % N; s.y = (deep / N) | 0; }
      else s.n = Math.max(0, s.n - Math.max(1, s.n * 0.05));   // stuck in a drying puddle
      continue;
    }
    // Watch for hunters. Wary schools notice them from further away.
    let fear = s.fear * 0.92;
    const shallow = w.water[here] < 0.6;
    for (const p of preds) {
      const range = (p.sp === 'otter' ? 4 : shallow ? 2.5 : 0) * (1 + s.wary * 0.8) * (w.climate.temp < 4 ? 0.6 : 1) * (w.climate.elev < -0.05 ? 0.6 + 0.4 * w.climate.moonLight : 1);
      if (!range) continue;
      const d = Math.hypot(p.x - s.x, p.y - s.y);
      if (d < range && (p.sp !== 'heron' || p.pose === 'stalk' || p.flying)) {
        const f = 1 - d / range;
        if (f > fear) { fear = f; s.threatX = p.x; s.threatY = p.y; }
      }
    }
    s.fear = fear;
    s.wary = Math.max(0, s.wary - 0.0003);
    // Cold water makes fish slow and dozy.
    const cold = w.climate.temp - (w.terrain[here] - 8) * 0.16 < 4 ? 0.5 : 1;

    let speed = 5;
    if (s.fear > 0.35) {
      // Flee away from the threat, toward cover.
      s.mode = 'flee';
      const dx = s.x - s.threatX, dy = s.y - s.threatY, len = Math.hypot(dx, dy) || 1;
      const hide = bestSpot(w, s, 5, true);
      if (hide >= 0 && w.rng.chance(0.5)) { s.tx = hide % N; s.ty = (hide / N) | 0; }
      else { s.tx = s.x + dx / len * 5; s.ty = s.y + dy / len * 5; }
      speed = 12;
    } else if (spawnRun && s.migrant) {
      // Run upstream toward the springs to spawn.
      s.mode = 'migrate';
      let src = w.springs[0], bd = Infinity;
      for (const sp of w.springs) {
        const d = Math.hypot((sp.i % N) - s.x, ((sp.i / N) | 0) - s.y);
        if (d < bd) { bd = d; src = sp; }
      }
      s.tx = src.i % N; s.ty = (src.i / N) | 0;
      speed = 6;
    } else if (night || w.ice[here]) {
      // Rest somewhere covered.
      if (s.mode !== 'rest' || w.rng.chance(0.01)) {
        const hide = bestSpot(w, s, 4, true);
        if (hide >= 0) { s.tx = hide % N; s.ty = (hide / N) | 0; }
      }
      s.mode = 'rest';
      speed = 1.5;
    } else {
      s.mode = 'feed';
      if (Math.hypot(s.tx - s.x, s.ty - s.y) < 0.5 || w.rng.chance(0.02)) {
        const spot = bestSpot(w, s, 6, false);
        if (spot >= 0) { s.tx = spot % N; s.ty = (spot / N) | 0; }
      }
      speed = 3;
    }
    moveSchool(w, s, s.tx, s.ty, speed * cold);
  }
}

export function dailySchools(w, cal) {
  const rng = w.rng;
  const r = cal.season === 0 ? (cal.dayOfSeason < DAYS_PER_SEASON / 2 ? 0.5 : 0.25)
    : cal.season === 1 ? 0.15 : cal.season === 2 ? 0.05 : 0;
  const meanT = w.climate.meanTemp(cal.yearFrac);
  for (const s of w.schools) {
    const i = cellOf(s.x, s.y);
    const temp = meanT - (w.terrain[i] - 8) * 0.16 + w.warm[i];
    const cap = capacity(w, i, temp);
    const K = 30 + 150 * cap;
    // Spawning near the springs and gravel shallows gives a bigger boost.
    const nursery = cal.season === 0 && w.springs.some(sp => Math.hypot((sp.i % N) - s.x, ((sp.i / N) | 0) - s.y) < 12) ? 1.6 : 1;
    if (cap < 0.02) s.n *= 0.6;
    else if (s.n > K) s.n -= (s.n - K) * 0.25;          // too crowded: some move on or die, gradually
    else s.n += r * nursery * s.n * (1 - s.n / K);
    s.n = Math.max(0, s.n);
    if (temp > 23 && w.flow[i] < 0.02 && w.water[i] < 0.6) s.n *= 0.85;   // summer die-off in warm puddles
  }
  // Split big schools, merge tiny ones, remove the gone.
  const add = [];
  for (const s of w.schools) {
    if (s.n > 160 && w.schools.length + add.length < MAX_SCHOOLS) {
      const half = Math.floor(s.n / 2);
      s.n -= half;
      const t = makeSchool(w, cellOf(s.x, s.y), half);
      t.wary = s.wary; t.migrant = rng.chance(0.4);
      add.push(t);
    }
  }
  w.schools.push(...add);
  for (const s of w.schools) {
    if (s.n >= 15 || s.n <= 0) continue;
    const other = w.schools.find(o => o !== s && o.n > 0 && Math.hypot(o.x - s.x, o.y - s.y) < 3);
    if (other) { other.n += s.n; s.n = 0; }
  }
  const before = w.schools.length;
  w.schools = w.schools.filter(s => s.n >= 1);
  if (w.schools.length < before - 2) w.fishLost = (w.fishLost || 0) + before - w.schools.length;
  // Newcomers swim down from upstream.
  const arrivals = w.schools.length < 12 ? 3 : w.schools.length < 22 ? 1 : rng.chance(0.08) ? 1 : 0;
  for (let k = 0; k < arrivals && w.schools.length < MAX_SCHOOLS; k++) {
    const sp = w.springs[rng.int(w.springs.length)];
    if (swimmable(w, sp.i)) w.schools.push(makeSchool(w, sp.i, 25 + rng.int(30)));
  }
}

// A per-cell fish density, for inspecting cells and for animals scouting.
export function rebuildFishMap(w) {
  const f = w.fish;
  f.fill(0);
  for (const s of w.schools) {
    const x = Math.round(s.x), y = Math.round(s.y);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      const i = ny * N + nx;
      f[i] = Math.min(1, f[i] + s.n / (dx || dy ? 400 : 150));
    }
  }
}

export function fishTotal(w) { return w.schools.reduce((t, s) => t + s.n, 0); }
