// Saves the whole world to localStorage (about 1 MB) and restores it.

import { World, FLOAT_FIELDS, BYTE_FIELDS } from './world.js';
import { SAVE_KEY, SAVE_VERSION } from './config.js';
import { serializeAnimals, loadAnimals, seedAnimals } from './animals.js';

const SKIP = new Set(['fx', 'fy']); // rebuilt within seconds, not worth the space

function toB64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromB64(str) {
  const s = atob(str);
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8;
}
const f32 = a => toB64(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));

export function save(world, settings) {
  const fields = {};
  for (const f of FLOAT_FIELDS) if (!SKIP.has(f)) fields[f] = f32(world[f]);
  for (const f of BYTE_FIELDS) fields[f] = toB64(world[f]);
  const data = {
    v: SAVE_VERSION,
    savedAt: Date.now(),
    settings,
    seed: world.seed,
    minute: world.minute,
    rng: world.rng.s,
    groundwater: world.groundwater,
    catchSnow: world.catchSnow,
    springs: world.springs,
    hotSpring: world.hotSpring,
    burning: world.burning,
    monitor: world.monitor,
    climate: world.climate.toJSON(),
    log: world.log.toJSON(),
    terrainBase: f32(world.terrainBase),
    animals: serializeAnimals(world),
    schools: world.schools,
    awayHerons: world.awayHerons || [],
    nextSchoolId: world.nextSchoolId,
    nextAnimalId: world.nextAnimalId,
    epochMs: world.epochMs,
    fields,
  };
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function load() {
  let d;
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    d = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!d || d.v !== SAVE_VERSION) return null;
  try {
    const w = new World(d.seed);
    for (const f of FLOAT_FIELDS) {
      if (!d.fields[f]) continue;
      w[f].set(new Float32Array(fromB64(d.fields[f]).buffer));
    }
    for (const f of BYTE_FIELDS) if (d.fields[f]) w[f].set(fromB64(d.fields[f]));
    w.terrainBase = new Float32Array(fromB64(d.terrainBase).buffer);
    w.minute = d.minute;
    w.rng.s = d.rng;
    w.groundwater = d.groundwater;
    w.catchSnow = d.catchSnow;
    w.springs = d.springs;
    w.hotSpring = d.hotSpring;
    w.burning = d.burning || [];
    w.monitor = { ...w.monitor, ...d.monitor };
    w.climate.load(d.climate);
    w.epochMs = d.epochMs ?? (d.savedAt - d.minute * 60000);
    w.climate.epochMs = w.epochMs;
    w.log.load(d.log);
    if (d.animals) { loadAnimals(w, d.animals); w.nextAnimalId = d.nextAnimalId || 1; }
    else seedAnimals(w); // saves from before animals existed
    w.schools = d.schools || []; w.nextSchoolId = d.nextSchoolId || 1;
    w.awayHerons = d.awayHerons || [];
    w.prepare();
    w.updateWetList();
    w.computeStats();
    return { world: w, savedAt: d.savedAt, settings: d.settings || {} };
  } catch {
    return null;
  }
}

export function clear() {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* storage blocked */ }
}
