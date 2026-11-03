// Animals that run their own lives.
//
// Each animal has needs (hunger, energy, company, play, fear), health that can
// be hurt and heals over time, a personality inherited from its parents, a
// memory of places it has named itself, a skill for getting food, a mind with
// moods and beliefs (see mind.js), and a learned table of "in this situation,
// this choice paid off". Every decision mixes instinct with what it learned.
// Rewards come from needs being met; punishment from hunger, fear and pain.
//
// Predators weigh risk before they attack: how likely the hunt works, how
// likely they get hurt (guardians, herds), and how hungry they are. Prey fight
// back: mothers defend their young, deer kick, herds raise the alarm together.

import { N, MIN_PER_DAY, DAYS_PER_YEAR, SEASON_NAMES } from './config.js';
import { clamp } from './rng.js';
import { SPECIES, SPECIES_KEYS, ACTIONS, A, sleepiness, pickName } from './species.js';
import { TREE } from './vegetation.js';
import { placeName } from './terrain.js';
import { nearestSchool, startle } from './fish.js';
import { newMind, belief, learn, stepMood, think, idleThought, namePlace } from './mind.js';

const NA = ACTIONS.length;
const NS = 64;
const GAMMA = 0.6;
const MEMORY = 8;
const MEMORY_MIN = 10 * MIN_PER_DAY;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];

// What a fox expects before it has any experience of its own.
const HUNT_PRIOR = { rabbit: [2, 5], deer: [1, 5], otter: [1, 5] };
const HURT_PRIOR = { rabbit: [1, 9], deer: [2, 4], otter: [2, 5] };
const FOOD_VALUE = { rabbit: 0.65, deer: 0.9, otter: 0.5 };

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
    condition: 0.7, health: 1,
    skill: opts.skill ?? (opts.ageYears >= S.adult ? 0.45 + rng.next() * 0.3 : 0.05),
    q: new Array(NS * NA).fill(0),
    memory: [],
    home: cellOf(x, y),
    action: A.EXPLORE, target: -1, prey: -1, school: -1, defend: -1, defendT: 0, timer: 0, since: 0,
    reward: 0, lastState: 0, pose: 'walk', stuck: 0, pregnant: 0, father: -1,
    lifespan: S.lifespan * (0.75 + rng.next() * 0.4),
    catches: 0, misses: 0, heading: rng.next() * 6.28, flying: 0, alive: true, done: false,
    novel: false, wasAsleep: false,
  };
  a.mind = newMind(w, a);
  // Inherit a little of the mother's learned habits (a head start, not a copy).
  if (opts.motherQ) for (let k = 0; k < a.q.length; k++) a.q[k] = opts.motherQ[k] * 0.3;
  return a;
}

export function ageYears(w, a) { return (w.minute - a.born) / (DAYS_PER_YEAR * MIN_PER_DAY); }
const isAdult = (w, a) => ageYears(w, a) >= SPECIES[a.sp].adult;
const nick = (a, sp) => (a.mind && a.mind.nick[sp]) || SPECIES[sp]?.label || sp;

function spawnPoint(w, sp) {
  const S = SPECIES[sp];
  for (let k = 0; k < 600; k++) {
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
      if (sp === 'otter' ? n % 3 === 0 && n > 0 : n % 3 === 0 && n > 0) home = spawnPoint(w, sp);
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

const GW = Math.ceil(N / 8);
function buildGrid(w) {
  const g = w.animalGrid || (w.animalGrid = Array.from({ length: GW * GW }, () => []));
  for (const b of g) b.length = 0;
  for (const a of w.animals) g[((a.y / 8) | 0) * GW + ((a.x / 8) | 0)].push(a);
  return g;
}

function nearby(w, a, r, filter) {
  const g = w.animalGrid, out = [];
  const x0 = Math.max(0, ((a.x - r) / 8) | 0), x1 = Math.min(GW - 1, ((a.x + r) / 8) | 0);
  const y0 = Math.max(0, ((a.y - r) / 8) | 0), y1 = Math.min(GW - 1, ((a.y + r) / 8) | 0);
  for (let gy = y0; gy <= y1; gy++) for (let gx = x0; gx <= x1; gx++) {
    for (const b of g[gy * GW + gx]) {
      if (b === a || !b.alive || !filter(b)) continue;
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
    // Fish first; crayfish, frogs and snails under the stones as a fallback.
    v = (w.fish[i] * 1.5 + bottomLife(w, i)) * (w.ice[i] ? 0.4 : 1);   // otters hunt under the ice through holes
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

// Crayfish, frogs and snails along stony and reedy bottoms.
function bottomLife(w, i) {
  const yf = w.cal.yearFrac;
  const stony = w.material[i] === 1 || w.material[i] === 0 ? 0.12 : 0.05;
  return (stony + w.reed[i] * 0.1) * (yf > 0.75 ? 0.5 : 1) * (w.water[i] < 1.5 ? 1 : 0.5);
}

// Frogs, small fish and insects in the shallows: much of what a heron eats.
function shallowLife(w, i) {
  const yf = w.cal.yearFrac;
  const season = yf > 0.75 ? 0.4 : 1;
  return (0.2 + w.reed[i] * 0.3 + w.fish[i] * 0.5) * season;
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

// Remember a place. New places get a name of the animal's own making.
function remember(w, a, i, kind, v) {
  const near = a.memory.find(m => m.kind === kind && Math.abs((m.i % N) - (i % N)) + Math.abs(((m.i / N) | 0) - ((i / N) | 0)) < 3);
  if (near) { near.v = v; near.t = w.minute; return; }
  const m = { i, kind, v, t: w.minute, name: namePlace(w, a, i, kind) };
  a.memory.push(m);
  if (a.memory.length > MEMORY) {
    a.memory.sort((p, q) => (q.v - (w.minute - q.t) / MEMORY_MIN) - (p.v - (w.minute - p.t) / MEMORY_MIN));
    a.memory.length = MEMORY;
  }
  if (a.memory.includes(m)) {
    a.novel = true;
    if (kind === 'food') think(w, a, 'discover', { newplace: m.name }, 0.4);
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
  const t = a.traits, m = a.mind;
  return [
    Math.pow(a.hunger, 1.4) * 1.3 + (young ? 0.1 : 0) + (a.hunger > 0.8 ? 1 : 0),
    Math.pow(1 - a.energy, 1.3) + sleepy * 0.7 + t.lazy * 0.15 + m.grief * 0.25 + (1 - a.health) * 0.4,
    a.lonely * (0.3 + t.social) * 0.8 + (young ? 0.3 : 0) + m.grief * 0.15,
    0.12 + t.curious * 0.3 + (young ? 0.15 : 0) - sleepy * 0.2 + m.bored * 0.6,
    a.fear * (1.6 - t.bold),
    (a.play * (a.sp === 'otter' ? 0.9 : young ? 0.5 : 0.1) + m.bored * (a.sp === 'otter' || young ? 0.35 : 0)) * (1 - a.hunger),
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

  // Choose: instinct plus learned value. Curiosity, youth and frustration make it less predictable.
  const inst = instincts(w, a, S, sleepy, young);
  const temp = 0.08 + a.traits.curious * 0.12 + (young ? 0.12 : 0) + a.mind.frustrated * 0.15;
  const scores = inst.map((v, k) => (v + a.q[s * NA + k] * 0.8) / temp);
  if (a.sp !== 'otter' && !young) scores[A.PLAY] -= 2 / temp;
  if (a.fear < 0.15) scores[A.FLEE] = -Infinity;
  const mx = Math.max(...scores);
  let sum = 0;
  const p = scores.map(v => { const e = Math.exp(v - mx); sum += e; return e; });
  let r = rng.next() * sum, choice = 0;
  for (let k = 0; k < NA; k++) { r -= p[k]; if (r <= 0) { choice = k; break; } }

  const prevAction = a.action;
  a.lastState = s;
  startAction(w, a, choice, foodNear);

  // Say (to itself) why.
  if (choice !== prevAction) {
    if (choice === A.EAT && a.hunger > 0.55 && a.prey < 0) think(w, a, 'hungry', {}, 0.8);
    else if (choice === A.REST && a.energy < 0.35) think(w, a, 'tired', {}, 0.8);
    else if (choice === A.SOCIAL && a.lonely > 0.6) {
      const k = byId(w, a.prey);
      think(w, a, 'lonely', { kin: k ? k.name : undefined }, 0.8);
    } else if (choice === A.EXPLORE) think(w, a, a.mind.bored > 0.55 ? 'bored' : 'explore', {}, 0.6);
    else if (choice === A.PLAY) think(w, a, 'play', {}, 0.9);
  }
}

// A fox sizes up what it could hunt: chance of success vs. chance of getting hurt.
function chooseHunt(w, a, S) {
  const cands = nearby(w, a, S.sense * 0.8, b => (b.sp === 'rabbit' && b.pose !== 'sleep')
    || ((b.sp === 'deer' || b.sp === 'otter') && !isAdult(w, b) && ageYears(w, b) < 0.5));
  let best = null, bestEV = 0.04, tempting = null;
  const desperate = clamp((a.hunger - 0.7) * 2.5, 0, 0.9);
  for (const [b, d] of cands) {
    const sp = b.sp;
    let pS = belief(a, 'hunt:' + sp, HUNT_PRIOR[sp]);
    if (b.fear > 0.3) pS *= 0.6;
    if (b.health < 0.6) pS *= 1.4;
    const guards = nearby(w, b, 4, g => g.sp === sp && g !== b && isAdult(w, g));
    let guardStr = 0;
    for (const [g] of guards) guardStr += SPECIES[g.sp].strength * (0.5 + g.traits.bold);
    const pHurt = belief(a, 'hurt:' + sp, HURT_PRIOR[sp]) * Math.min(1.6, 0.35 + guardStr);
    const value = FOOD_VALUE[sp] * (0.3 + a.hunger);
    const cost = pHurt * 0.9 * (1.3 - a.mind.confident) * (1 - desperate);
    const ev = pS * value - cost - d * 0.01;
    if (ev > bestEV) { bestEV = ev; best = { b, pS }; }
    else if (pS * value > 0.15 && (!tempting || pS * value > tempting.v)) {
      tempting = { b, v: pS * value, pS, guard: guards.length ? guards[0][0] : null };
    }
  }
  if (best) {
    think(w, a, 'hunt', { prey: nick(a, best.b.sp), p: best.pS }, 1);
    return best.b;
  }
  if (tempting) think(w, a, 'skipHunt', { prey: nick(a, tempting.b.sp), guard: tempting.guard ? nick(a, tempting.guard.sp) : 'grown-up', p: tempting.pS }, 1);
  return null;
}

function startAction(w, a, act, foodNear) {
  const S = SPECIES[a.sp];
  const rng = w.rng;
  a.action = act; a.timer = 0; a.prey = -1; a.school = -1; a.target = -1; a.stuck = 0; a.progD = undefined;
  a.since = w.minute;
  const setTarget = i => { a.target = i; a.tx = i % N; a.ty = (i / N) | 0; };
  if (act === A.EAT) {
    if (S.diet === 'hunt') {
      const prey = chooseHunt(w, a, S);
      if (prey) { a.prey = prey.id; return; }
    }
    if (S.diet === 'fish') {
      // Go after a school it can see, if chasing fish has been working lately;
      // otherwise grub for crayfish and frogs along the bottom.
      const p = belief(a, 'fishing', [3, 2]);
      const sch = nearestSchool(w, a.x, a.y, S.sense * 1.6, s => !w.ice[cellOf(s.x, s.y)] || rng.chance(0.7));
      if (sch && rng.chance(0.25 + p * 0.75)) { a.school = sch.id; a.tx = sch.x; a.ty = sch.y; return; }
    }
    if (S.diet === 'wade') {
      // Herons pick a shallow spot near fish and wait there.
      const sch = nearestSchool(w, a.x, a.y, S.sense * 2, s => w.water[cellOf(s.x, s.y)] < 0.9);
      if (sch) {
        for (let k = 0; k < 12; k++) {
          const x = Math.round(clamp(sch.x + rng.range(-2, 2), 0, N - 1)), y = Math.round(clamp(sch.y + rng.range(-2, 2), 0, N - 1));
          const i = y * N + x;
          if (w.water[i] > 0.04 && w.water[i] < 0.5) { setTarget(i); if (Math.hypot(a.tx - a.x, a.ty - a.y) > 4) a.flying = 1; return; }
        }
      }
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
      const kinScore = ([b, d]) => (b.id === a.mother || b.mother === a.id ? -99 : 0) + d;
      kin.sort((p, q) => kinScore(p) - kinScore(q));
      a.prey = kin[0][0].id;
    } else wanderTarget(w, a, 18);
  } else if (act === A.EXPLORE) {
    wanderTarget(w, a, 10 + a.traits.curious * 18 + a.mind.bored * 10);
  } else if (act === A.FLEE) {
    fleeTarget(w, a, S);
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

function fleeTarget(w, a, S) {
  const dx = a.x - (a.threatX ?? a.x), dy = a.y - (a.threatY ?? a.y);
  const len = Math.hypot(dx, dy) || 1;
  a.tx = clamp(a.x + dx / len * 10 + w.rng.range(-2, 2), 0, N - 1);
  a.ty = clamp(a.y + dy / len * 10 + w.rng.range(-2, 2), 0, N - 1);
  // Hares bolt for their burrow if it's not toward the danger.
  if (a.sp === 'rabbit') {
    const hx = a.home % N, hy = (a.home / N) | 0;
    if ((hx - a.x) * dx + (hy - a.y) * dy > 0 && Math.hypot(hx - a.x, hy - a.y) < 12) { a.tx = hx; a.ty = hy; }
  }
  if (S.fly) a.flying = 1;
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
  sp *= (0.9 + a.energy * 0.2) * (0.45 + 0.55 * a.health);
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
  let threat = null;
  if (preds.length) {
    const r = S.sense * (0.7 + 0.5 * (1 - a.traits.bold));
    for (const [b, d] of nearby(w, a, r, b => preds.includes(b.sp) && isAdult(w, b))) {
      // How bad it feels depends on what this animal has learned about that predator.
      const dread = 0.6 + 0.8 * belief(a, 'fear:' + b.sp, [2, 2]);
      const f = Math.min(1, (1 - d / r) * dread);
      if (f > fear) { fear = f; a.threatX = b.x; a.threatY = b.y; threat = b; }
    }
  }
  let fire = false;
  if (w.burning.length) {
    for (const k of w.burning) {
      const d = Math.hypot((k % N) - a.x, ((k / N) | 0) - a.y);
      if (d < 6 && 1 - d / 6 > fear * 0.9) { fear = Math.max(fear, 1 - d / 7); a.threatX = k % N; a.threatY = (k / N) | 0; fire = true; }
    }
  }
  if (fear > 0.5 && a.fear <= 0.5) {
    if (threat) { a.lastThreat = nick(a, threat.sp); a.lastThreatSp = threat.sp; }
    remember(w, a, cellOf(a.x, a.y), 'danger', fear);
    think(w, a, fire ? 'fire' : 'scared', { pred: threat ? nick(a, threat.sp) : 'something' }, 2);
    // Herd and family pick up the alarm.
    if (a.sp === 'deer' || a.sp === 'rabbit' || a.sp === 'otter') {
      for (const [b] of nearby(w, a, 6, b => b.sp === a.sp && b.fear < fear * 0.6)) {
        b.fear = Math.max(b.fear, fear * 0.65); b.threatX = a.threatX; b.threatY = a.threatY;
        think(w, b, 'alarm', { kin: a.name }, 1);
      }
    }
  } else if (a.fear > 0.4 && fear < 0.15) {
    think(w, a, 'safe', { pred: a.lastThreat || 'it' }, 1);
    // Nothing bad happened this time: that predator seems a little less scary.
    if (a.lastThreatSp) learn(a, 'fear:' + a.lastThreatSp, false, [2, 2]);
  }
  a.reward -= Math.max(0, fear - a.fear) * 0.4;
  a.fear = fear;

  // Parents (and herd adults) may stand and fight for the young.
  if (threat && isAdult(w, a) && a.defend < 0 && (a.sp === 'deer' || a.sp === 'otter')) {
    const kids = nearby(w, threat, 5, k => k.sp === a.sp && !isAdult(w, k));
    if (kids.length) {
      const own = kids.find(([k]) => k.mother === a.id);
      const urge = (own ? 0.5 : a.sp === 'deer' ? 0.15 : 0) + 0.35 * a.traits.bold + 0.3 * a.mind.confident - 0.3 * (1 - a.health);
      if (w.rng.chance(clamp(urge, 0, 0.95))) {
        a.defend = threat.id; a.defendT = 25;
        think(w, a, 'defend', { pred: nick(a, threat.sp), kin: (own || kids[0])[0].name }, 2);
      }
    }
  }
}

function byId(w, id) {
  if (!w.animalIndex) return null;
  return w.animalIndex.get(id) || null;
}

// Hurt an animal. It remembers who did it.
function hurt(w, a, dmg, by) {
  a.health = Math.max(0, a.health - dmg);
  a.reward -= dmg * 2;
  a.hurtAt = w.minute;
  if (by) {
    learn(a, (SPECIES[a.sp].diet === 'hunt' ? 'hurt:' : 'fear:') + by.sp, true, SPECIES[a.sp].diet === 'hunt' ? HURT_PRIOR[by.sp] : [2, 2]);
    think(w, a, 'hurt', { pred: nick(a, by.sp) }, 2);
  }
  if (a.health <= 0) kill(w, a, 'wounds', by);
}

// A guardian closes in and fights. The predator usually backs off.
function doDefend(w, a, S) {
  const p = byId(w, a.defend);
  a.defendT--;
  if (!p || !p.alive || a.defendT <= 0 || Math.hypot(p.x - a.x, p.y - a.y) > 10 || a.health < 0.3) { a.defend = -1; return false; }
  const d = Math.hypot(p.x - a.x, p.y - a.y);
  a.pose = 'fight';
  moveToward(w, a, S, p.x, p.y, S.runSpeed / S.speed);
  if (d < 1) {
    if (w.rng.chance(0.45)) {
      hurt(w, p, S.strength * w.rng.range(0.15, 0.35), a);
      p.fear = 1; p.threatX = a.x; p.threatY = a.y;
      if (p.alive) { p.action = A.FLEE; fleeTarget(w, p, SPECIES[p.sp]); p.timer = 0; p.prey = -1; }
      learn(a, 'fight:' + p.sp, true);
      think(w, a, 'fightWin', { pred: nick(a, p.sp) }, 2);
      a.mind.confident = Math.min(1, a.mind.confident + 0.1);
      a.defend = -1;
    } else if (w.rng.chance(0.25)) {
      hurt(w, a, SPECIES[p.sp].strength * w.rng.range(0.1, 0.25), p);
      learn(a, 'fight:' + p.sp, false);
    }
  }
  return true;
}

function act(w, a, S) {
  const rng = w.rng;
  a.timer++;
  const before = { h: a.hunger, e: a.energy, l: a.lonely, p: a.play };
  a.pose = 'walk';
  switch (a.action) {
    case A.EAT: {
      if (a.prey >= 0) { chase(w, a, S); break; }
      if (a.school >= 0) { fishSchool(w, a, S); break; }
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
          if (a.timer % 30 === 5) think(w, a, 'eat', {}, 0.5);
          if (foodScore(w, a, i) < 0.15) a.done = true;
        } else if (S.diet === 'fish' || S.diet === 'wade') {
          if (foodScore(w, a, i) < 0.04) { a.done = true; break; }
          a.pose = S.diet === 'fish' ? 'dive' : 'stalk';
          if (a.timer % 4 === 0) {
            const food = S.diet === 'wade' ? shallowLife(w, i) : (w.fish[i] * 0.5 + bottomLife(w, i) * 2) * (w.ice[i] ? 0.4 : 1);
            // Herons also strike at a school passing through the shallows.
            const sch = S.diet === 'wade' ? nearestSchool(w, a.x, a.y, 1.6, s => w.water[cellOf(s.x, s.y)] < 0.6) : null;
            if (sch && rng.chance((0.15 + 0.45 * a.skill) * (1 - 0.5 * sch.fear) * (1 - 0.3 * sch.wary))) {
              startle(w, sch, a.x, a.y, true);
              gotFood(w, a, S, 0.32, nick(a, 'fish'));
            } else if (rng.chance((0.06 + 0.3 * a.skill) * Math.min(1, food * 2))) {
              gotFood(w, a, S, S.diet === 'fish' ? 0.15 : 0.22, S.diet === 'wade' ? 'froggy' : w.rng.pick({ crayfish: 2, froggy: 1, snail: 1, [nick(a, 'fish')]: w.fish[i] * 3 }));
              remember(w, a, i, 'food', Math.min(1, food + 0.2));
            } else {
              if (sch) startle(w, sch, a.x, a.y, false);
              missed(w, a, nick(a, 'fish'));
              if (a.timer > 30 && rng.chance(0.15)) { remember(w, a, i, 'food', Math.max(0.02, food)); a.done = true; }
            }
          }
        } else if (S.diet === 'hunt') {
          if (w.tree[i] === TREE.SHRUB && w.treeSize[i] > 0.4) { a.hunger -= 0.004; if (a.timer % 25 === 3) think(w, a, 'eat', { food: 'berries' }, 0.5); }
          else if (w.grass[i] > 0.3) {
            // Voles and mice in the grass: a fox's everyday food.
            a.pose = 'pounce';
            if (a.timer % 5 === 0) {
              if (rng.chance((0.12 + 0.2 * a.skill) * (w.snow[i] > 0.05 ? 0.6 : 1))) { a.hunger -= 0.12; a.skill = Math.min(1, a.skill + 0.003); think(w, a, 'eat', {}, 0.5); }
            }
          } else a.done = true;
        }
      }
      if (a.hunger < 0.08) { a.done = true; think(w, a, 'full', {}, 0.6); }
      if (a.timer > 240) a.done = true;
      break;
    }
    case A.REST: {
      // If the way to bed is blocked, settle wherever is dry enough.
      if (a.stuck > 3 && goodBed(w, a, cellOf(a.x, a.y))) { a.tx = a.x; a.ty = a.y; a.stuck = 0; }
      if (moveToward(w, a, S, a.tx, a.ty)) {
        a.pose = 'sleep';
        if (!a.wasAsleep) { a.wasAsleep = true; think(w, a, 'sleep', {}, 0.7); }
        a.energy += 1 / 330;
        a.hunger -= S.hunger * 0.5;
        // Otters and deer like to rest close together.
        if (a.sp === 'otter' || a.sp === 'deer') {
          if (nearby(w, a, 2, b => b.sp === a.sp && b.action === A.REST).length) a.lonely -= 1 / 300;
        }
        if (a.energy > 0.97 && sleepiness(S.activity, w.cal.hour) < 0.5) { a.done = true; think(w, a, 'wake', {}, 0.8); }
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
          if (a.timer % 20 === 2) {
            if (a.mother === f.id) think(w, a, 'mom', {}, 0.8);
            else if (f.mother === a.id) think(w, a, 'kid', { kin: f.name }, 0.8);
            else think(w, a, 'friend', { kin: f.name }, 0.7);
          }
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
      if (a.timer === 1) think(w, a, 'flee', { pred: a.lastThreat || 'it' }, 1);
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
  if (a.action !== A.REST) a.wasAsleep = false;
  if (a.stuck > 6) a.done = true;

  // Reward: needs met are good, needs growing urgent are bad.
  const r = (before.h - a.hunger) * 1.6 + Math.max(0, a.energy - before.e) * 1.0
    + Math.max(0, before.l - a.lonely) * 0.8 + Math.max(0, before.p - a.play) * 0.6;
  a.reward += r;
  return r;
}

// Fed: skill grows, little ones nearby learn by watching, a parent shares.
function gotFood(w, a, S, amount, preyWord) {
  a.hunger = Math.max(0, a.hunger - amount);
  a.skill = Math.min(1, a.skill + 0.025 * (1 - a.skill));
  a.catches++;
  a.misses = 0;
  a.mind.frustrated *= 0.5;
  think(w, a, 'catch', { prey: preyWord, count: a.catches, food: preyWord }, a.catches < 3 ? 2 : 0.8);
  if (a.catches === 1 && S.named && !isAdult(w, a)) w.log.add(w.minute, `${a.name}, a young otter, catches a fish on its own for the first time.`, 'life');
  for (const [b] of nearby(w, a, 3, b => b.sp === a.sp && !isAdult(w, b))) {
    b.skill = Math.min(1, b.skill + 0.01 * (1 - b.skill));
    if (b.mother === a.id) { b.hunger = Math.max(0, b.hunger - 0.15); a.hunger += 0.08; think(w, b, 'learn', {}, 0.8); }
  }
}

function missed(w, a, preyWord) {
  a.skill = Math.min(1, a.skill + 0.0015);
  a.misses++;
  a.mind.frustrated = Math.min(1, a.mind.frustrated + 0.08);
  think(w, a, a.mind.frustrated > 0.55 ? 'missAngry' : 'miss', { prey: preyWord, count: a.misses }, 0.5);
}

// Otters chase a school through the water and dive at it.
function fishSchool(w, a, S) {
  const s = w.schools.find(sc => sc.id === a.school);
  if (!s || s.n < 5 || w.water[cellOf(s.x, s.y)] < 0.12) { a.done = true; a.school = -1; return; }
  const d = Math.hypot(s.x - a.x, s.y - a.y);
  if (d > S.sense * 2 || a.timer > 150) { a.done = true; learn(a, 'fishing', false); return; }
  moveToward(w, a, S, s.x, s.y, d < 3 ? 1.4 : 1);
  a.pose = d < 1.5 ? 'dive' : 'swim';
  if (d < 1.2 && a.timer % 3 === 0) {
    const i = cellOf(s.x, s.y);
    const coverK = (1 - 0.4 * w.reed[i] - (w.water[i] > 2 ? 0.25 : 0) - (w.ice[i] ? 0.2 : 0)) * (w.climate.temp < 4 ? 1.3 : 1);
    // Up close, a quick otter still gets one now and then even from a jumpy school.
    const chance = (0.16 + 0.5 * a.skill) * (1 - 0.35 * s.fear) * (1 - 0.3 * s.wary) * Math.min(1, s.n / 20) * coverK;
    if (w.rng.chance(chance)) {
      startle(w, s, a.x, a.y, true);
      learn(a, 'fishing', true);
      gotFood(w, a, S, 0.24, nick(a, 'fish'));
      remember(w, a, i, 'food', 0.8);
      if (a.hunger < 0.25) a.done = true;
    } else {
      startle(w, s, a.x, a.y, false);
      missed(w, a, nick(a, 'fish'));
    }
  }
}

// A fox chasing prey. Prey may kick back; guardians may join in.
function chase(w, a, S) {
  const p = byId(w, a.prey);
  if (!p || !p.alive || (p.sp === 'rabbit' && p.pose === 'sleep')) { a.done = true; return; }
  const d = Math.hypot(p.x - a.x, p.y - a.y);
  if (d > S.sense * 1.6 || a.timer > 90) {
    a.done = true;
    learn(a, 'hunt:' + p.sp, false, HUNT_PRIOR[p.sp]);
    missed(w, a, nick(a, p.sp));
    return;
  }
  moveToward(w, a, S, p.x, p.y, d < 4 ? S.runSpeed / S.speed : 1);
  a.pose = 'run';
  if (d < 0.8) {
    let chance = 0.06 + 0.3 * a.skill - (p.fear > 0.3 ? 0.05 : 0);
    const mum = byId(w, p.mother);
    if (mum && mum.alive && Math.hypot(mum.x - p.x, mum.y - p.y) < 3) chance *= 0.25;
    if (w.rng.chance(clamp(chance, 0.02, 0.5))) {
      learn(a, 'hunt:' + p.sp, true, HUNT_PRIOR[p.sp]);
      kill(w, p, 'caught', a);
      a.hunger = Math.max(0, a.hunger - 0.65 * (FOOD_VALUE[p.sp] / 0.65));
      a.skill = Math.min(1, a.skill + 0.04 * (1 - a.skill));
      a.catches++;
      think(w, a, 'catch', { prey: nick(a, p.sp), count: a.catches }, 2);
      a.done = true;
    } else {
      a.skill = Math.min(1, a.skill + 0.004);
      // Cornered prey kicks or bites.
      const fight = SPECIES[p.sp].strength * (0.3 + 0.5 * p.traits.bold);
      if (w.rng.chance(fight * 0.5)) {
        hurt(w, a, SPECIES[p.sp].strength * w.rng.range(0.1, 0.3), p);
        think(w, p, 'fightWin', { pred: nick(p, a.sp) }, 2);
        if (a.alive && a.health < 0.7) { a.done = true; learn(a, 'hunt:' + p.sp, false, HUNT_PRIOR[p.sp]); }
      }
    }
  }
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
  // Family grieves.
  for (const b of w.animals) {
    if (!b.alive || b.sp !== a.sp) continue;
    if (b.mother === a.id || a.mother === b.id) {
      b.mind.grief = 1; b.mind.griefFor = a.name;
      think(w, b, 'grief', { kin: a.name }, 2);
    }
  }
  if (S.named) {
    const who = `${a.name} the ${S.label}`;
    const msg = cause === 'caught' ? `${who} is caught by ${by.name} the ${SPECIES[by.sp].label} near ${placeName(i)}.`
      : cause === 'starved' ? `${who} could not find enough food and dies near ${placeName(i)}.`
        : cause === 'fire' ? `${who} is caught by the fire.`
          : cause === 'wounds' ? `${who} dies of wounds${by ? ` from a fight with a ${SPECIES[by.sp].label}` : ''}.`
            : `${who} dies of old age near ${placeName(i)}.`;
    w.log.add(w.minute, msg, 'life');
  } else {
    w.deathsToday[a.sp] = w.deathsToday[a.sp] || {};
    w.deathsToday[a.sp][cause] = (w.deathsToday[a.sp][cause] || 0) + 1;
  }
  if (cause === 'wounds' && by && SPECIES[by.sp].diet !== 'hunt' && a.sp === 'fox') {
    w.log.add(w.minute, `A fox picked the wrong fight with a ${SPECIES[by.sp].label} and did not survive.`, 'life');
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
    // Wounds heal, faster in good condition and at rest.
    if (a.health < 1) {
      const was = a.health;
      a.health = Math.min(1, a.health + 0.0006 * (0.4 + a.condition) * (a.pose === 'sleep' ? 2 : 1) * (1 - a.health + 0.05));
      if (was < 0.85 && a.health >= 0.85) think(w, a, 'healed', {}, 1);
    }
    if (a.energy < 0.1) a.reward -= 0.002;
    if (w.fire[i] > 0 && !a.flying) { a.condition -= 0.05; a.reward -= 0.3; if (a.condition <= 0) { kill(w, a, 'fire'); continue; } }
    if (a.condition <= 0) { kill(w, a, 'starved'); continue; }

    senseThreats(w, a, S);
    let r = 0;
    if (a.defend >= 0 && doDefend(w, a, S)) { a.timer++; }
    else {
      const prevAction = a.action;
      if (a.done || a.timer > 45 + w.rng.int(30) || (a.fear > 0.5 && a.action !== A.FLEE)) {
        a.done = false;
        decide(w, a);
      }
      // Youngsters stay close to mother unless she is gone.
      if (young && ageYears(w, a) < S.adult * 0.6 && a.action !== A.FLEE) {
        const m = byId(w, a.mother);
        if (m && m.alive && Math.hypot(m.x - a.x, m.y - a.y) > 4) { a.action = A.SOCIAL; a.prey = m.id; }
      }
      r = act(w, a, S);
      a.sameFor = a.action === prevAction ? (a.sameFor || 0) + 1 : 0;
    }
    if (!a.alive) continue;
    // Give up on goals it isn't getting any closer to.
    if (a.timer % 20 === 0 && a.prey < 0 && a.school < 0) {
      const d = Math.hypot(a.tx - a.x, a.ty - a.y);
      if (d > 0.6 && a.progD !== undefined && d > a.progD - 0.3) a.done = true;
      a.progD = d;
    }
    if (a.flying && Math.hypot(a.tx - a.x, a.ty - a.y) < 0.5) a.flying = 0;
    // Mood and wandering thoughts.
    stepMood(a, { reward: r, same: (a.sameFor || 0) > 90 && a.action !== A.REST, novel: a.novel });
    a.novel = false;
    if (w.minute >= a.mind.nextIdle) idleThought(w, a);
  }
  if (w.animals.some(a => !a.alive)) w.animals = w.animals.filter(a => a.alive);
}

// ---------- each day: ageing, births, deaths, newcomers ----------

export function dailyAnimals(w, cal) {
  const rng = w.rng;
  const counts = {};
  for (const sp of SPECIES_KEYS) counts[sp] = 0;
  for (const a of w.animals) counts[a.sp]++;
  const newSeason = cal.dayOfSeason === 0;

  for (const a of [...w.animals]) {
    const S = SPECIES[a.sp];
    const age = ageYears(w, a);
    // Old age
    if (age > a.lifespan && rng.chance(0.15)) { kill(w, a, 'old'); continue; }
    if (cal.season === 3 && a.condition < 0.2 && rng.chance(0.1)) { kill(w, a, 'starved'); continue; }
    // Forget stale memories.
    a.memory = a.memory.filter(m => w.minute - m.t < MEMORY_MIN);
    if (newSeason && rng.chance(0.4)) think(w, a, 'season', {}, 1);
    // Mating
    const m = S.mate;
    if (a.sex === 'f' && age >= S.adult && !a.pregnant && [].concat(m.season).includes(cal.season) && cal.dayOfSeason >= m.days[0] && cal.dayOfSeason <= m.days[1]
      && a.condition > 0.45 && counts[a.sp] < S.cap && rng.chance(0.5)) {
      const mates = w.animals.filter(b => b.sp === a.sp && b.sex === 'm' && b.alive && ageYears(w, b) >= S.adult && Math.hypot(b.x - a.x, b.y - a.y) < 45);
      if (mates.length) {
        mates.sort((p, q) => (q.condition + q.skill + q.health) - (p.condition + p.skill + p.health));
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
        // Little ones start out wary of whatever their mother fears.
        for (const k in a.mind.b) if (k.startsWith('fear:')) kid.mind.b[k] = a.mind.b[k].map(v => v * 0.5 + 1);
        w.animals.push(kid); born.push(kid); counts[a.sp]++;
      }
      a.condition -= 0.1 * born.length;
      if (born.length) think(w, a, 'born', {}, 2);
      if (born.length && S.named) {
        const names = born.map(b => b.name);
        const list = names.length === 1 ? names[0] : names.slice(0, -1).join(', ') + ' and ' + names.at(-1);
        w.log.add(w.minute, `${a.name} the otter has ${born.length === 1 ? 'a pup' : born.length + ' pups'}: ${list}.`, 'life');
      } else if (born.length) w.birthsToday[a.sp] = (w.birthsToday[a.sp] || 0) + born.length;
    }
  }

  // Herons spend the winter somewhere warmer and come back in spring.
  if (cal.season === 2 && cal.dayOfSeason === 5) {
    const leaving = w.animals.filter(a => a.sp === 'heron');
    if (leaving.length) {
      for (const a of leaving) { a.alive = false; think(w, a, 'season', {}, 2); }
      w.awayHerons = (w.awayHerons || []).concat(leaving.map(a => ({ ...a, alive: true })));
      w.animals = w.animals.filter(a => a.sp !== 'heron');
      w.log.add(w.minute, `The ${leaving.length === 1 ? 'heron flies' : leaving.length + ' herons fly'} south for the winter.`, 'season');
    }
  }
  if (cal.season === 0 && cal.dayOfSeason === 0 && w.awayHerons && w.awayHerons.length) {
    // Most come back; the journey is long.
    const back = w.awayHerons.filter(() => rng.chance(0.85));
    for (const a of back) {
      const i = spawnPoint(w, 'heron');
      a.x = a.px = a.tx = i % N; a.y = a.py = a.ty = (i / N) | 0; a.flying = 0; a.hunger = 0.5; a.condition = Math.max(0.5, a.condition);
      a.born -= 0; w.animals.push(a);
    }
    if (back.length) w.log.add(w.minute, `${back.length === 1 ? 'A heron is' : back.length + ' herons are'} back from the south${back.length < w.awayHerons.length ? ', though not all of them' : ''}.`, 'season');
    w.awayHerons = [];
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
    if (sp === 'heron' && (cal.season === 3 || (cal.season === 2 && cal.dayOfSeason >= 5) || (w.awayHerons && w.awayHerons.length))) continue;
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
    if (SPECIES[a.sp].diet === 'hunt') food = Math.min(1, w.animals.filter(b => b.sp === 'rabbit').length / 10 + 0.2);
    if (SPECIES[a.sp].diet === 'wade') food = Math.max(food, 0.35);
    a.condition = clamp(a.condition + (food - 0.25) * 0.15, 0, 1);
    a.health = Math.min(1, a.health + 0.3);
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
  w.animals = (list || []).map(a => ({ health: 1, school: -1, defend: -1, misses: 0, ...a, alive: true, done: false }));
  for (const a of w.animals) if (!a.mind) a.mind = newMind(w, a);
}
