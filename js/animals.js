// Animals that run their own lives.
//
// Each animal has needs (hunger, energy, company, play, fear), a personality
// inherited from its parents, a small memory of places, a skill for getting food,
// and a learned table of "in this situation, this choice paid off". Every
// decision mixes instinct (needs x personality) with what it has learned.
// Rewards come from needs being met; punishment from hunger, fear and pain.
// Young animals explore more, learn faster and pick up skill by watching adults.

import { N, MIN_PER_DAY, DAYS_PER_YEAR } from './config.js';
import { clamp } from './rng.js';
import { SPECIES, SPECIES_KEYS, ACTIONS, A, sleepiness, pickName } from './species.js';
import { TREE } from './vegetation.js';
import { placeName } from './terrain.js';

const NA = ACTIONS.length;
const NS = 64;
const GAMMA = 0.6;
const MEMORY = 8;
const MEMORY_MIN = 10 * MIN_PER_DAY;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];

const cellOf = (x, y) => clamp(Math.round(y), 0, N - 1) * N + clamp(Math.round(x), 0, N - 1);

// ---------- creation ----------

function traitsFrom(rng, a, b) {
  const t = {};
  for (const k of ['bold', 'social', 'curious', 'lazy']) {
    const base = a && b ? (a[k] + b[k]) / 2 : a ? a[k] : 0.5;
    t[k] = clamp(base + rng.normal() * (a ? 0.08 : 0.18), 0.02, 0.98);
  }
  return t;
}

export function makeAnimal(w, sp, x, y, opts = {}) {
  const S = SPECIES[sp];
  const rng = w.rng;
  const taken = new Set(w.animals.map(a => a.name));
  const a = {
    id: w.nextAnimalId++,
    sp, name: pickName(rng, taken),
    sex: opts.sex || (rng.chance(0.5) ? 'f' : 'm'),
    x, y, px: x, py: y, tx: x, ty: y,
    born: w.minute - Math.round((opts.ageYears ?? 0) * DAYS_PER_YEAR * MIN_PER_DAY),
    mother: opts.mother ?? -1,
    traits: opts.traits || traitsFrom(rng),
    hunger: 0.3, energy: 0.8, lonely: 0.3, play: 0.3, fear: 0,
    condition: 0.7,
    skill: opts.skill ?? (opts.ageYears >= S.adult ? 0.45 + rng.next() * 0.3 : 0.05),
    q: new Array(NS * NA).fill(0),
    memory: [],
    home: cellOf(x, y),
    action: A.EXPLORE, target: -1, prey: -1, timer: 0, since: 0,
    reward: 0, lastState: 0, pose: 'walk', stuck: 0, pregnant: 0, father: -1,
    lifespan: S.lifespan * (0.75 + rng.next() * 0.4),
    catches: 0, heading: rng.next() * 6.28, flying: 0, alive: true, done: false,
  };
  // Inherit a little of the mother's learned habits (a head start, not a copy).
  if (opts.motherQ) for (let k = 0; k < a.q.length; k++) a.q[k] = opts.motherQ[k] * 0.3;
  return a;
}

export function ageYears(w, a) { return (w.minute - a.born) / (DAYS_PER_YEAR * MIN_PER_DAY); }
const isAdult = (w, a) => ageYears(w, a) >= SPECIES[a.sp].adult;

function spawnPoint(w, sp) {
  const S = SPECIES[sp];
  for (let k = 0; k < 400; k++) {
    const i = w.rng.int(N * N);
    if (w.fire[i] > 0) continue;
    const wa = w.water[i];
    if (S.diet === 'fish') { if (wa > 0.05 || !nearWater(w, i, 3)) continue; }
    else if (S.diet === 'wade') { if (wa > 0.05 || !nearWater(w, i, 2)) continue; }
    else if (wa > 0.02) continue;
    if (S.diet === 'graze' && w.grass[i] < 0.4) continue;
    if (w.terrain[i] > 30 && sp !== 'heron') continue;
    return i;
  }
  return w.rng.int(N * N);
}

function nearWater(w, i, r) {
  const x = i % N, y = (i / N) | 0;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < N && ny < N && w.water[ny * N + nx] > 0.25) return true;
  }
  return false;
}

export function seedAnimals(w) {
  w.animals = [];
  for (const sp of SPECIES_KEYS) {
    const S = SPECIES[sp];
    // Groups start together so families and herds exist from day one.
    let home = spawnPoint(w, sp);
    for (let n = 0; n < S.start; n++) {
      if (n % 3 === 0 && n > 0 && sp !== 'otter') home = spawnPoint(w, sp);
      if (sp === 'otter' && n === 3) home = spawnPoint(w, sp);
      const x = (home % N) + w.rng.range(-1.5, 1.5), y = ((home / N) | 0) + w.rng.range(-1.5, 1.5);
      const a = makeAnimal(w, sp, clamp(x, 0, N - 1), clamp(y, 0, N - 1), {
        sex: n % 2 ? 'm' : 'f',
        ageYears: S.adult + w.rng.next() * S.lifespan * 0.4,
      });
      a.home = home;
      w.animals.push(a);
    }
  }
}

// ---------- the world around an animal ----------

function buildGrid(w) {
  const g = w.animalGrid || (w.animalGrid = Array.from({ length: 144 }, () => []));
  for (const b of g) b.length = 0;
  for (const a of w.animals) g[((a.y / 8) | 0) * 12 + ((a.x / 8) | 0)].push(a);
  return g;
}

function nearby(w, a, r, filter) {
  const g = w.animalGrid, out = [];
  const x0 = Math.max(0, ((a.x - r) / 8) | 0), x1 = Math.min(11, ((a.x + r) / 8) | 0);
  const y0 = Math.max(0, ((a.y - r) / 8) | 0), y1 = Math.min(11, ((a.y + r) / 8) | 0);
  for (let gy = y0; gy <= y1; gy++) for (let gx = x0; gx <= x1; gx++) {
    for (const b of g[gy * 12 + gx]) {
      if (b === a || !filter(b)) continue;
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      if (d <= r) out.push([b, d]);
    }
  }
  return out;
}

function passable(w, S, from, to, a) {
  if (a.flying) return true;
  const wa = w.water[to];
  if (wa > S.wade && !S.swim) return false;
  if (w.fire[to] > 0) return false;
  if (Math.abs(w.terrain[to] - w.terrain[from]) > S.climb && !(S.swim && wa > 0.2 && w.water[from] > 0.2)) return false;
  return true;
}

function foodScore(w, a, i) {
  const S = SPECIES[a.sp];
  let v = 0;
  if (S.diet === 'graze') {
    if (w.water[i] > 0.05) return 0;
    v = w.grass[i] * (w.snow[i] > 0.02 ? 0.35 : 1);
    if (w.tree[i] === TREE.SHRUB && w.treeSize[i] > 0.3) v += 0.3;
    if (a.sp === 'deer' && w.tree[i] && w.tree[i] < 4 && w.treeSize[i] < 0.25) v += 0.25;
    // In winter deer browse twigs and bark when the grass is buried.
    if (a.sp === 'deer' && w.tree[i] >= 1 && w.tree[i] <= 3 && w.snow[i] > 0.02) v += 0.3;
  } else if (S.diet === 'fish') {
    if (w.water[i] < 0.2) return 0;
    v = w.fish[i] * 1.5 * (w.ice[i] ? 0.4 : 1);       // otters hunt under the ice through holes
  } else if (S.diet === 'wade') {
    const wa = w.water[i];
    if (wa < 0.04 || wa > 0.55 || w.ice[i]) return 0;
    v = shallowLife(w, i);
  } else if (S.diet === 'hunt') {
    const yf = w.cal.yearFrac;
    if (w.tree[i] === TREE.SHRUB && w.treeSize[i] > 0.4 && yf > 0.4 && yf < 0.7) v = 0.4;
    else if (w.water[i] < 0.02) v = w.grass[i] * (w.snow[i] > 0.05 ? 0.2 : 0.35);
  }
  for (const m of a.memory) if (m.i === i && m.kind === 'danger') v *= 0.3;
  return v;
}

// Frogs, small fish and insects in the shallows: what a heron mostly eats.
function shallowLife(w, i) {
  const yf = w.cal.yearFrac;
  const season = yf > 0.75 ? 0.4 : 1;
  return (0.22 + w.reed[i] * 0.3 + w.fish[i]) * season;
}

// Look around a few random spots and remember the good ones.
function scout(w, a, radius) {
  const rng = w.rng;
  let best = -1, bestV = 0.08;
  const S = SPECIES[a.sp];
  if ((S.diet === 'fish' || S.diet === 'wade') && w.wetList && w.wetList.length) {
    // Fishers follow the water: sample real water cells, nearer ones preferred.
    for (let k = 0; k < 24; k++) {
      const i = w.wetList[rng.int(w.wetList.length)];
      const d = Math.hypot((i % N) - a.x, ((i / N) | 0) - a.y);
      if (d > radius * 3) continue;
      const v = foodScore(w, a, i) * (1 - d / (radius * 4));
      if (v > bestV) { bestV = v; best = i; }
    }
    if (best >= 0 && bestV > 0.2) remember(w, a, best, 'food', bestV);
    return best;
  }
  for (let k = 0; k < 14; k++) {
    const x = Math.round(a.x + rng.range(-radius, radius)), y = Math.round(a.y + rng.range(-radius, radius));
    if (x < 0 || y < 0 || x >= N || y >= N) continue;
    const i = y * N + x;
    const v = foodScore(w, a, i) * (1 - Math.hypot(x - a.x, y - a.y) / (radius * 2.5));
    if (v > bestV && reachable(w, a, x, y)) { bestV = v; best = i; }
  }
  if (best >= 0 && bestV > 0.3) remember(w, a, best, 'food', bestV);
  return best;
}

function remember(w, a, i, kind, v) {
  const m = a.memory.find(m => m.i === i && m.kind === kind);
  if (m) { m.v = v; m.t = w.minute; return; }
  a.memory.push({ i, kind, v, t: w.minute });
  if (a.memory.length > MEMORY) {
    a.memory.sort((p, q) => (q.v - (w.minute - q.t) / MEMORY_MIN) - (p.v - (w.minute - p.t) / MEMORY_MIN));
    a.memory.length = MEMORY;
  }
}

function recalledFood(w, a) {
  let best = -1, bestV = 0;
  for (const m of a.memory) {
    if (m.kind !== 'food') continue;
    const age = (w.minute - m.t) / MEMORY_MIN;
    const d = Math.hypot((m.i % N) - a.x, ((m.i / N) | 0) - a.y);
    const v = m.v * (1 - age) - d * 0.008;
    if (v > bestV) { bestV = v; best = m.i; }
  }
  return best;
}

// ---------- deciding ----------

function stateOf(w, a, foodKnown) {
  const c = w.climate;
  const i = cellOf(a.x, a.y);
  return (a.hunger > 0.5 ? 1 : 0) | (a.energy < 0.35 ? 2 : 0) | (a.fear > 0.3 ? 4 : 0)
    | (foodKnown ? 8 : 0) | (c.elev < 0 ? 16 : 0) | ((w.cal.season === 3 || w.snow[i] > 0.02) ? 32 : 0);
}

function instincts(w, a, S, sleepy, young) {
  const t = a.traits;
  return [
    Math.pow(a.hunger, 1.4) * 1.3 + (young ? 0.1 : 0) + (a.hunger > 0.8 ? 1 : 0),
    Math.pow(1 - a.energy, 1.3) + sleepy * 0.7 + t.lazy * 0.15,
    a.lonely * (0.3 + t.social) * 0.8 + (young ? 0.3 : 0),
    0.12 + t.curious * 0.3 + (young ? 0.15 : 0) - sleepy * 0.2,
    a.fear * (1.6 - t.bold),
    a.play * (a.sp === 'otter' ? 0.9 : young ? 0.5 : 0.1) * (1 - a.hunger),
  ];
}

function decide(w, a) {
  const S = SPECIES[a.sp];
  const rng = w.rng;
  const age = ageYears(w, a);
  const young = age < S.adult;
  const sleepy = sleepiness(S.activity, w.cal.hour);
  const foodNear = scout(w, a, S.sense);
  const s = stateOf(w, a, foodNear >= 0 || recalledFood(w, a) >= 0);

  // Learn from how the last choice turned out.
  const lr = clamp(0.35 - age * 0.04, 0.06, 0.35);
  const prev = a.lastState * NA + a.action;
  let maxNext = -Infinity;
  for (let k = 0; k < NA; k++) maxNext = Math.max(maxNext, a.q[s * NA + k]);
  a.q[prev] += lr * (clamp(a.reward, -1, 1) + GAMMA * maxNext - a.q[prev]);
  a.reward = 0;

  // Choose: instinct plus learned value, softened by curiosity and youth.
  const inst = instincts(w, a, S, sleepy, young);
  const temp = 0.08 + a.traits.curious * 0.12 + (young ? 0.12 : 0);
  const scores = inst.map((v, k) => (v + a.q[s * NA + k] * 0.8) / temp);
  if (a.sp !== 'otter' && !young) scores[A.PLAY] -= 2 / temp;
  if (a.fear < 0.15) scores[A.FLEE] = -Infinity;
  const mx = Math.max(...scores);
  let sum = 0;
  const p = scores.map(v => { const e = Math.exp(v - mx); sum += e; return e; });
  let r = rng.next() * sum, choice = 0;
  for (let k = 0; k < NA; k++) { r -= p[k]; if (r <= 0) { choice = k; break; } }

  a.lastState = s;
  startAction(w, a, choice, foodNear);
}

function startAction(w, a, act, foodNear) {
  const S = SPECIES[a.sp];
  const rng = w.rng;
  a.action = act; a.timer = 0; a.prey = -1; a.target = -1; a.stuck = 0; a.progD = undefined;
  a.since = w.minute;
  const setTarget = i => { a.target = i; a.tx = i % N; a.ty = (i / N) | 0; };
  if (act === A.EAT) {
    if (S.diet === 'hunt') {
      // Hares resting in their burrow are out of reach.
      const prey = nearby(w, a, S.sense * 0.7, b => (b.sp === 'rabbit' && b.pose !== 'sleep') || ((b.sp === 'deer' || b.sp === 'otter') && !isAdult(w, b) && ageYears(w, b) < 0.5));
      if (prey.length && rng.chance(0.4 + 0.4 * a.traits.bold)) { prey.sort((p, q) => p[1] - q[1]); a.prey = prey[0][0].id; return; }
    }
    const here = cellOf(a.x, a.y);
    const flyTo = i => { setTarget(i); if (S.fly && Math.hypot(a.tx - a.x, a.ty - a.y) > 4) a.flying = 1; };
    if (foodScore(w, a, here) > 0.25) setTarget(here);
    else if (S.fly && foodNear >= 0) flyTo(foodNear);
    else if (foodNear >= 0) setTarget(foodNear);
    else { const m = recalledFood(w, a); if (m >= 0) setTarget(m); else wanderTarget(w, a, 14); }
  } else if (act === A.REST) {
    const dHome = Math.hypot((a.home % N) - a.x, ((a.home / N) | 0) - a.y);
    if (dHome < 25 && goodBed(w, a, a.home) && reachable(w, a, a.home % N, (a.home / N) | 0)) setTarget(a.home);
    else { a.home = findBed(w, a); setTarget(a.home); }
  } else if (act === A.SOCIAL) {
    const kin = nearby(w, a, S.sense * 2.5, b => b.sp === a.sp);
    if (kin.length) {
      kin.sort((p, q) => (p[0].id === a.mother ? -99 : p[1]) - (q[0].id === a.mother ? -99 : q[1]));
      a.prey = kin[0][0].id;
    } else wanderTarget(w, a, 18);
  } else if (act === A.EXPLORE) {
    wanderTarget(w, a, 10 + a.traits.curious * 18);
  } else if (act === A.FLEE) {
    const dx = a.x - (a.threatX ?? a.x), dy = a.y - (a.threatY ?? a.y);
    const len = Math.hypot(dx, dy) || 1;
    a.tx = clamp(a.x + dx / len * 10 + rng.range(-2, 2), 0, N - 1);
    a.ty = clamp(a.y + dy / len * 10 + rng.range(-2, 2), 0, N - 1);
    if (S.fly) a.flying = 1;
  } else if (act === A.PLAY) {
    if (a.sp === 'otter') {
      let best = -1;
      for (let k = 0; k < 12 && best < 0; k++) {
        const x = Math.round(a.x + rng.range(-6, 6)), y = Math.round(a.y + rng.range(-6, 6));
        if (x >= 0 && y >= 0 && x < N && y < N && w.water[y * N + x] > 0.25 && !w.ice[y * N + x]) best = y * N + x;
      }
      if (best >= 0) setTarget(best); else wanderTarget(w, a, 5);
    } else wanderTarget(w, a, 4);
  }
}

// A dry, safe place to sleep. Otters want a bank next to water; others like cover.
function goodBed(w, a, i) {
  if (w.fire[i] > 0) return false;
  if (a.sp === 'otter') return w.water[i] < 0.3 && nearWater(w, i, 2);
  return w.water[i] < 0.03;
}
// Can it walk there in a straight line without crossing water it can't wade?
function reachable(w, a, tx, ty) {
  const S = SPECIES[a.sp];
  if (S.swim || S.fly) return true;
  const d = Math.hypot(tx - a.x, ty - a.y);
  const n = Math.ceil(d * 2);
  for (let k = 1; k <= n; k++) {
    const i = cellOf(a.x + (tx - a.x) * k / n, a.y + (ty - a.y) * k / n);
    if (w.water[i] > S.wade * 0.8) return false;
  }
  return true;
}

function findBed(w, a) {
  let best = cellOf(a.x, a.y), bestV = -Infinity;
  for (let k = 0; k < 20; k++) {
    const x = Math.round(clamp(a.x + w.rng.range(-6, 6), 0, N - 1)), y = Math.round(clamp(a.y + w.rng.range(-6, 6), 0, N - 1));
    const i = y * N + x;
    if (!goodBed(w, a, i) || !reachable(w, a, x, y)) continue;
    const cover = (w.tree[i] >= 1 && w.tree[i] <= 3 ? 0.5 : 0) + w.reed[i] * 0.3 + w.grass[i] * 0.1;
    const v = cover - Math.hypot(x - a.x, y - a.y) * 0.05;
    if (v > bestV) { bestV = v; best = i; }
  }
  return best;
}

function wanderTarget(w, a, r) {
  const S = SPECIES[a.sp];
  for (let k = 0; k < 10; k++) {
    const x = Math.round(clamp(a.x + w.rng.range(-r, r), 0, N - 1)), y = Math.round(clamp(a.y + w.rng.range(-r, r), 0, N - 1));
    const i = y * N + x;
    if (w.water[i] > S.wade && !S.swim && !S.fly) continue;
    if (S.diet === 'fish' && !nearWater(w, i, 4)) continue;
    if (S.diet === 'wade' && !nearWater(w, i, 6)) continue;
    a.tx = x; a.ty = y; a.target = i;
    if (S.fly && Math.hypot(x - a.x, y - a.y) > 4) a.flying = 1;
    return;
  }
  a.tx = a.x; a.ty = a.y;
}

// ---------- each minute ----------

function moveToward(w, a, S, tx, ty, speedMul = 1) {
  const dx = tx - a.x, dy = ty - a.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 0.3) return true;
  const here = cellOf(a.x, a.y);
  const inWater = w.water[here] > 0.25;
  // Somewhere it shouldn't be (deep water, fire): any way out will do.
  const trapped = !a.flying && ((!S.swim && w.water[here] > S.wade) || w.fire[here] > 0);
  if (trapped && S.fly) a.flying = 1;
  let sp = (inWater ? S.swimSpeed : S.speed) * speedMul;
  if (a.flying) sp = S.runSpeed;
  if (w.snow[here] > 0.03 && !inWater && !a.flying) sp *= 0.75;
  sp *= 0.9 + a.energy * 0.2;
  const step = Math.min(sp, dist);
  // Pick the passable direction that best heads toward the target.
  let bx = 0, by = 0, best = -Infinity;
  for (const [ox, oy] of DIRS) {
    const len = Math.hypot(ox, oy);
    const nx = a.x + ox / len * Math.min(step, 0.9), ny = a.y + oy / len * Math.min(step, 0.9);
    if (nx < 0 || ny < 0 || nx > N - 1 || ny > N - 1) continue;
    const j = cellOf(nx, ny);
    if (j !== here && !passable(w, S, here, j, a) && !trapped) continue;
    const wet = !S.swim && !a.flying ? w.water[j] * 1.5 : 0;   // land animals avoid wading
    const score = (ox * dx + oy * dy) / (len * dist) - Math.abs(w.terrain[j] - w.terrain[here]) * 0.05 - wet + w.rng.next() * 0.15;
    if (score > best) { best = score; bx = ox / len; by = oy / len; }
  }
  if (best === -Infinity || best < -0.2) { a.stuck++; return false; }
  // Blend toward the direct line so paths look smooth.
  const ux = dx / dist, uy = dy / dist;
  let mx = bx * 0.7 + ux * 0.3, my = by * 0.7 + uy * 0.3;
  const ml = Math.hypot(mx, my) || 1;
  mx /= ml; my /= ml;
  const nx = a.x + mx * step, ny = a.y + my * step;
  const j = cellOf(nx, ny);
  if (j !== here && !passable(w, S, here, j, a) && !trapped) { a.x += bx * step; a.y += by * step; }
  else { a.x = nx; a.y = ny; }
  a.x = clamp(a.x, 0, N - 1); a.y = clamp(a.y, 0, N - 1);
  a.heading = Math.atan2(my, mx);
  a.energy -= S.tire * (speedMul > 1.2 ? 1.5 : 0.4);
  return Math.hypot(tx - a.x, ty - a.y) < 0.4;
}

function senseThreats(w, a, S) {
  const young = !isAdult(w, a);
  const preds = young ? S.youngPredators : S.predators;
  let fear = a.fear * 0.96;
  if (preds.length) {
    const r = S.sense * (0.7 + 0.5 * (1 - a.traits.bold));
    for (const [b, d] of nearby(w, a, r, b => preds.includes(b.sp) && isAdult(w, b))) {
      const f = 1 - d / r;
      if (f > fear) { fear = f; a.threatX = b.x; a.threatY = b.y; }
    }
  }
  if (w.burning.length) {
    for (const k of w.burning) {
      const d = Math.hypot((k % N) - a.x, ((k / N) | 0) - a.y);
      if (d < 6 && 1 - d / 6 > fear * 0.9) { fear = Math.max(fear, 1 - d / 7); a.threatX = k % N; a.threatY = (k / N) | 0; }
    }
  }
  if (fear > 0.5 && a.fear <= 0.5) remember(w, a, cellOf(a.x, a.y), 'danger', fear);
  a.reward -= Math.max(0, fear - a.fear) * 0.4;
  a.fear = fear;
}

function byId(w, id) {
  if (!w.animalIndex) return null;
  return w.animalIndex.get(id) || null;
}

function act(w, a, S) {
  const rng = w.rng;
  a.timer++;
  const before = { h: a.hunger, e: a.energy, l: a.lonely, p: a.play };
  a.pose = 'walk';
  switch (a.action) {
    case A.EAT: {
      if (a.prey >= 0) {
        const p = byId(w, a.prey);
        if (!p || !p.alive || (p.sp === 'rabbit' && p.pose === 'sleep')) { a.done = true; break; }
        const d = Math.hypot(p.x - a.x, p.y - a.y);
        if (d > S.sense * 1.6 || a.timer > 90) { a.done = true; break; }
        moveToward(w, a, S, p.x, p.y, d < 4 ? S.runSpeed / S.speed : 1);
        a.pose = 'run';
        if (d < 0.8) {
          let chance = 0.06 + 0.3 * a.skill - (p.fear > 0.3 ? 0.05 : 0);
          const mum = byId(w, p.mother);
          if (mum && mum.alive && Math.hypot(mum.x - p.x, mum.y - p.y) < 3) chance *= 0.25;
          if (rng.chance(clamp(chance, 0.02, 0.5))) {
            kill(w, p, 'caught', a);
            a.hunger = Math.max(0, a.hunger - 0.65);
            a.skill = Math.min(1, a.skill + 0.04 * (1 - a.skill));
            a.catches++;
            a.done = true;
          } else a.skill = Math.min(1, a.skill + 0.004);
        }
        break;
      }
      if (moveToward(w, a, S, a.tx, a.ty)) {
        a.pose = 'eat';
        const i = cellOf(a.x, a.y);
        if (S.diet === 'graze') {
          const snowK = w.snow[i] > 0.02 ? 0.35 : 1;
          const bite = Math.min(w.grass[i], 0.004) * snowK;
          w.grass[i] -= bite;
          a.hunger -= bite * (a.sp === 'deer' ? 2.2 : 2.8) + 0.0006 * snowK;
          if (w.tree[i] === TREE.SHRUB && w.treeSize[i] > 0.3) { a.hunger -= 0.004; w.treeSize[i] -= 0.0008; }
          if (a.sp === 'deer' && w.tree[i] && w.tree[i] < 4 && w.treeSize[i] < 0.25) { w.treeSize[i] -= 0.004; a.hunger -= 0.003; }
          else if (a.sp === 'deer' && w.tree[i] >= 1 && w.tree[i] <= 3 && w.snow[i] > 0.02) { a.hunger -= 0.0035; w.treeHealth[i] -= 0.0004; }
          if (foodScore(w, a, i) < 0.15) a.done = true;
        } else if (S.diet === 'fish' || S.diet === 'wade') {
          if (foodScore(w, a, i) < 0.04) { a.done = true; break; }
          a.pose = S.diet === 'fish' ? 'dive' : 'stalk';
          if (a.timer % 4 === 0) {
            const f = w.fish[i];
            const food = S.diet === 'wade' ? shallowLife(w, i) : f * (w.ice[i] ? 0.4 : 1);
            const chance = (0.08 + 0.55 * a.skill) * Math.min(1, food * 2) * (S.diet === 'wade' ? 0.8 : 1);
            if (rng.chance(chance)) {
              a.hunger -= S.diet === 'fish' ? 0.22 : 0.3;
              if (S.diet === 'fish' || f > 0.1) w.fish[i] = Math.max(0, f - 0.012);
              a.skill = Math.min(1, a.skill + 0.025 * (1 - a.skill));
              a.catches++;
              if (a.catches === 1 && S.named && !isAdult(w, a)) w.log.add(w.minute, `${a.name}, a young otter, catches a fish on its own for the first time.`, 'life');
              // Youngsters nearby learn by watching, and a parent shares the catch.
              for (const [b] of nearby(w, a, 3, b => b.sp === a.sp && !isAdult(w, b))) {
                b.skill = Math.min(1, b.skill + 0.01 * (1 - b.skill));
                if (b.mother === a.id) { b.hunger = Math.max(0, b.hunger - 0.15); a.hunger += 0.08; }
              }
              remember(w, a, i, 'food', Math.min(1, f * 1.5 + 0.2));
            } else {
              a.skill = Math.min(1, a.skill + 0.0015);
              if (a.timer > 30 && rng.chance(0.15)) { remember(w, a, i, 'food', Math.max(0.02, food)); a.done = true; }
            }
          }
        } else if (S.diet === 'hunt') {
          if (w.tree[i] === TREE.SHRUB && w.treeSize[i] > 0.4) a.hunger -= 0.004;
          else if (w.grass[i] > 0.3) {
            // Voles and mice in the grass: a fox's everyday food.
            a.pose = 'pounce';
            if (a.timer % 5 === 0 && rng.chance((0.12 + 0.2 * a.skill) * (w.snow[i] > 0.05 ? 0.6 : 1))) { a.hunger -= 0.12; a.skill = Math.min(1, a.skill + 0.003); }
          } else a.done = true;
        }
      }
      if (a.hunger < 0.08 || a.timer > 240) a.done = true;
      break;
    }
    case A.REST: {
      // If the way to bed is blocked, settle wherever is dry enough.
      if (a.stuck > 3 && goodBed(w, a, cellOf(a.x, a.y))) { a.tx = a.x; a.ty = a.y; a.stuck = 0; }
      if (moveToward(w, a, S, a.tx, a.ty)) {
        a.pose = 'sleep';
        a.energy += 1 / 330;
        a.hunger -= S.hunger * 0.5;
        // Otters and deer like to rest close together.
        if (a.sp === 'otter' || a.sp === 'deer') {
          if (nearby(w, a, 2, b => b.sp === a.sp && b.action === A.REST).length) a.lonely -= 1 / 300;
        }
        if (a.energy > 0.97 && sleepiness(S.activity, w.cal.hour) < 0.5) a.done = true;
      }
      if (a.timer > 600) a.done = true;
      break;
    }
    case A.SOCIAL: {
      const f = a.prey >= 0 ? byId(w, a.prey) : null;
      if (f && f.alive) {
        const d = Math.hypot(f.x - a.x, f.y - a.y);
        if (d > 1.3) moveToward(w, a, S, f.x + 0.6, f.y + 0.4);
        else {
          a.pose = a.sp === 'otter' ? 'groom' : 'idle';
          a.lonely -= 1 / 80; f.lonely -= 1 / 160;
          if (a.mother === f.id && f.skill > a.skill && (f.action === A.EAT || f.pose === 'dive')) a.skill += 0.004 * (f.skill - a.skill);
        }
      } else if (moveToward(w, a, S, a.tx, a.ty)) a.done = true;
      if (a.lonely < 0.05 || a.timer > 120) a.done = true;
      break;
    }
    case A.EXPLORE: {
      if (moveToward(w, a, S, a.tx, a.ty)) a.done = true;
      if (a.timer % 15 === 0) scout(w, a, S.sense);
      a.play -= 1 / 900;
      if (a.timer > 200) a.done = true;
      break;
    }
    case A.FLEE: {
      a.pose = 'run';
      if (moveToward(w, a, S, a.tx, a.ty, S.runSpeed / S.speed)) a.done = true;
      if (a.fear < 0.12 || a.timer > 40) a.done = true;
      break;
    }
    case A.PLAY: {
      if (moveToward(w, a, S, a.tx, a.ty, 1.3)) {
        a.pose = 'play';
        a.play -= 1 / 50;
        a.energy -= S.tire;
        a.tx = clamp(a.x + rng.range(-2.5, 2.5), 0, N - 1); a.ty = clamp(a.y + rng.range(-2.5, 2.5), 0, N - 1);
        const j = cellOf(a.tx, a.ty);
        if (a.sp === 'otter' && w.water[j] < 0.2) { a.tx = a.x; a.ty = a.y; }
      }
      if (a.play < 0.05 || a.timer > 90) a.done = true;
      break;
    }
  }
  if (a.stuck > 6) a.done = true;

  // Reward: needs met are good, needs growing urgent are bad.
  a.reward += (before.h - a.hunger) * 1.6 + Math.max(0, a.energy - before.e) * 1.0
    + Math.max(0, before.l - a.lonely) * 0.8 + Math.max(0, before.p - a.play) * 0.6;
}

function kill(w, a, cause, by) {
  if (!a.alive) return;
  a.alive = false;
  a.cause = cause;
  const tally = w.deathTally || (w.deathTally = {});
  const key = `${a.sp}:${cause}:${ageYears(w, a) < SPECIES[a.sp].adult ? 'young' : 'adult'}`;
  tally[key] = (tally[key] || 0) + 1;
  const i = cellOf(a.x, a.y);
  w.litter[i] += 0.15;
  const S = SPECIES[a.sp];
  if (S.named || (by && SPECIES[by.sp].named)) {
    const who = `${a.name} the ${S.label}`;
    const msg = cause === 'caught' ? `${who} is caught by ${by.name} the ${SPECIES[by.sp].label} near ${placeName(i)}.`
      : cause === 'starved' ? `${who} could not find enough food and dies near ${placeName(i)}.`
        : cause === 'fire' ? `${who} is caught by the fire.`
          : `${who} dies of old age near ${placeName(i)}.`;
    if (S.named) w.log.add(w.minute, msg, 'life');
  } else {
    w.deathsToday[a.sp] = w.deathsToday[a.sp] || {};
    w.deathsToday[a.sp][cause] = (w.deathsToday[a.sp][cause] || 0) + 1;
  }
}

export function tickAnimals(w) {
  if (!w.animals.length) return;
  buildGrid(w);
  w.animalIndex = new Map(w.animals.map(a => [a.id, a]));
  const c = w.climate;
  for (const a of w.animals) {
    if (!a.alive) continue;
    const S = SPECIES[a.sp];
    a.px = a.x; a.py = a.y;
    const i = cellOf(a.x, a.y);
    const young = !isAdult(w, a);
    // Needs drift.
    const cold = c.temp < -5 && w.water[i] < 0.2 ? 1.3 : 1;
    a.hunger = clamp(a.hunger + S.hunger * cold * (young ? 0.8 : 1), 0, 1);
    a.energy = clamp(a.energy - S.tire * 0.6, 0, 1);
    a.lonely = clamp(a.lonely + S.lonely, 0, 1);
    a.play = clamp(a.play + S.playful * (young ? 1.6 : 1), 0, 1);
    // Very young ones are fed by their mothers.
    if (young && ageYears(w, a) < S.adult * 0.6) {
      const m = byId(w, a.mother);
      if (m && m.alive && Math.hypot(m.x - a.x, m.y - a.y) < 4) a.hunger = Math.max(0, a.hunger - S.hunger * (ageYears(w, a) < S.adult * 0.3 ? 1.5 : 0.7));
    }
    if (a.hunger > 0.75) { a.condition -= 0.0005; a.reward -= 0.004; }
    else if (a.hunger < 0.55) a.condition = Math.min(1, a.condition + 0.0003);
    if (a.energy < 0.1) a.reward -= 0.002;
    if (w.fire[i] > 0 && !a.flying) { a.condition -= 0.05; a.reward -= 0.3; if (a.condition <= 0) { kill(w, a, 'fire'); continue; } }
    if (a.condition <= 0) { kill(w, a, 'starved'); continue; }

    senseThreats(w, a, S);
    if (a.done || a.timer > 45 + w.rng.int(30) || (a.fear > 0.5 && a.action !== A.FLEE)) {
      a.done = false;
      decide(w, a);
    }
    // Youngsters stay close to mother unless she is gone.
    if (young && ageYears(w, a) < S.adult * 0.6 && a.action !== A.FLEE) {
      const m = byId(w, a.mother);
      if (m && m.alive && Math.hypot(m.x - a.x, m.y - a.y) > 4) { a.action = A.SOCIAL; a.prey = m.id; }
    }
    act(w, a, S);
    // Give up on goals it isn't getting any closer to.
    if (a.timer % 20 === 0 && a.prey < 0) {
      const d = Math.hypot(a.tx - a.x, a.ty - a.y);
      if (d > 0.6 && a.progD !== undefined && d > a.progD - 0.3) a.done = true;
      a.progD = d;
    }
    if (a.flying && Math.hypot(a.tx - a.x, a.ty - a.y) < 0.5) a.flying = 0;
  }
  if (w.animals.some(a => !a.alive)) w.animals = w.animals.filter(a => a.alive);
}

// ---------- each day: ageing, births, deaths, newcomers ----------

export function dailyAnimals(w, cal) {
  const rng = w.rng;
  const counts = {};
  for (const sp of SPECIES_KEYS) counts[sp] = 0;
  for (const a of w.animals) counts[a.sp]++;

  for (const a of [...w.animals]) {
    const S = SPECIES[a.sp];
    const age = ageYears(w, a);
    // Old age
    if (age > a.lifespan && rng.chance(0.15)) { kill(w, a, 'old'); continue; }
    if (cal.season === 3 && a.condition < 0.2 && rng.chance(0.1)) { kill(w, a, 'starved'); continue; }
    // Forget stale memories.
    a.memory = a.memory.filter(m => w.minute - m.t < MEMORY_MIN);
    // Mating
    const m = S.mate;
    if (a.sex === 'f' && age >= S.adult && !a.pregnant && [].concat(m.season).includes(cal.season) && cal.dayOfSeason >= m.days[0] && cal.dayOfSeason <= m.days[1]
      && a.condition > 0.45 && counts[a.sp] < S.cap && rng.chance(0.5)) {
      const mates = w.animals.filter(b => b.sp === a.sp && b.sex === 'm' && b.alive && ageYears(w, b) >= S.adult && Math.hypot(b.x - a.x, b.y - a.y) < 35);
      if (mates.length) {
        mates.sort((p, q) => (q.condition + q.skill) - (p.condition + p.skill));
        a.pregnant = m.gestation;
        a.father = mates[0].id;
      }
    } else if (a.pregnant > 0 && --a.pregnant === 0) {
      const father = w.animals.find(b => b.id === a.father);
      const n = m.litter[0] + rng.int(m.litter[1] - m.litter[0] + 1);
      const born = [];
      for (let k = 0; k < n && counts[a.sp] < S.cap + 2; k++) {
        const kid = makeAnimal(w, a.sp, clamp(a.x + rng.range(-0.5, 0.5), 0, N - 1), clamp(a.y + rng.range(-0.5, 0.5), 0, N - 1), {
          mother: a.id, traits: traitsFrom(rng, a.traits, father ? father.traits : a.traits),
          skill: 0.03, motherQ: a.q,
        });
        kid.home = a.home;
        kid.condition = 0.6;
        w.animals.push(kid); born.push(kid); counts[a.sp]++;
      }
      a.condition -= 0.1 * born.length;
      if (born.length && S.named) {
        const names = born.map(b => b.name);
        const list = names.length === 1 ? names[0] : names.slice(0, -1).join(', ') + ' and ' + names.at(-1);
        w.log.add(w.minute, `${a.name} the otter has ${born.length === 1 ? 'a pup' : born.length + ' pups'}: ${list}.`, 'life');
      } else if (born.length) w.birthsToday[a.sp] = (w.birthsToday[a.sp] || 0) + born.length;
    }
  }

  // Summaries for the unnamed species.
  for (const sp in w.birthsToday) {
    const n = w.birthsToday[sp];
    if (sp === 'rabbit') {
      // Hares breed all spring and summer: mention it once a season.
      const key = cal.year * 4 + cal.season;
      if (n && w.monitor.hareNews !== key) { w.monitor.hareNews = key; w.log.add(w.minute, 'The hares are having litters all over the meadows.', 'life'); }
      continue;
    }
    if (n) w.log.add(w.minute, `${n} young ${n === 1 ? SPECIES[sp].label : SPECIES[sp].plural} born in the valley.`, 'life');
  }
  for (const sp in w.deathsToday) {
    const d = w.deathsToday[sp];
    if (d.starved >= 2) w.log.add(w.minute, `Hunger takes ${d.starved} ${SPECIES[sp].plural}.`, 'life');
  }
  w.birthsToday = {}; w.deathsToday = {};

  // Newcomers keep any species from vanishing for good.
  for (const sp of SPECIES_KEYS) {
    const alive = w.animals.filter(a => a.sp === sp).length;
    if (alive < Math.max(2, Math.round(SPECIES[sp].cap * 0.15)) && rng.chance(0.2)) {
      const S = SPECIES[sp];
      const edge = arrival(w, sp);
      for (const sex of ['f', 'm']) {
        const a = makeAnimal(w, sp, edge % N, (edge / N) | 0, { sex, ageYears: S.adult + rng.next() * 2 });
        a.home = spawnPoint(w, sp);
        a.action = A.EXPLORE; a.tx = a.home % N; a.ty = (a.home / N) | 0;
        w.animals.push(a);
      }
      w.log.add(w.minute, `A pair of ${S.plural} wanders into the valley${sp === 'otter' ? ' up the river' : ''}.`, 'life');
    }
  }
}

function arrival(w, sp) {
  if (sp === 'otter') {
    // Up the river from the outlet: the lowest wet cell on the front edges.
    let best = -1, bestH = Infinity;
    for (let k = 0; k < N; k++) for (const i of [(N - 1) * N + k, k * N + (N - 1)]) {
      if (w.water[i] > 0.05 && w.terrain[i] < bestH) { bestH = w.terrain[i]; best = i; }
    }
    if (best >= 0) return best;
  }
  return spawnPoint(w, sp);
}

// Cheap stand-in for long absences: needs settle, condition follows food nearby.
export function approxDayAnimals(w, cal) {
  for (const a of w.animals) {
    let food = 0;
    for (let k = 0; k < 10; k++) {
      const x = Math.round(clamp(a.x + w.rng.range(-10, 10), 0, N - 1)), y = Math.round(clamp(a.y + w.rng.range(-10, 10), 0, N - 1));
      food = Math.max(food, foodScore(w, a, y * N + x));
    }
    if (SPECIES[a.sp].diet === 'hunt') food = Math.min(1, w.animals.filter(b => b.sp === 'rabbit').length / 10);
    a.condition = clamp(a.condition + (food - 0.25) * 0.15, 0, 1);
    a.hunger = 0.4; a.energy = 0.7; a.lonely = 0.3; a.fear = 0;
    if (a.condition <= 0) kill(w, a, 'starved');
  }
  w.animals = w.animals.filter(a => a.alive);
  dailyAnimals(w, cal);
}

export function serializeAnimals(w) {
  return w.animals.map(a => ({ ...a, q: a.q.map(v => Math.round(v * 1000) / 1000) }));
}

export function loadAnimals(w, list) {
  w.animals = (list || []).map(a => ({ ...a, alive: true, done: false }));
}
