// The world state and its clock. Everything here is free of DOM code so it can
// also run headless in Node for long stability tests.

import { N, MIN_PER_DAY, DAYS_PER_YEAR, SEASON_NAMES } from './config.js';
import { Rng } from './rng.js';
import { generateTerrain, placeName } from './terrain.js';
import { Climate, calendar } from './climate.js';
import { stepWater, stepSources, dailyMoistureSpread, buildWarmMap, initialGroundwater } from './hydrology.js';
import { seedInitialVegetation, dailyVegetation, hourlyFire, tryLightning, TREE } from './vegetation.js';
import { dailyFish, seedInitialFish } from './fish.js';
import { EventLog } from './events.js';
import { seedAnimals, tickAnimals, dailyAnimals, approxDayAnimals } from './animals.js';
import { SPECIES_KEYS } from './species.js';

export const FLOAT_FIELDS = ['terrain', 'water', 'sed', 'moist', 'snow', 'grass', 'reed', 'treeSize',
  'treeHealth', 'litter', 'fert', 'fish', 'burn', 'fire', 'flow', 'fx', 'fy', 'deposit'];
export const BYTE_FIELDS = ['material', 'tree', 'drown', 'ice'];

export class World {
  constructor(seed) {
    this.seed = seed >>> 0;
    const size = N * N;
    for (const f of FLOAT_FIELDS) this[f] = new Float32Array(size);
    for (const f of BYTE_FIELDS) this[f] = new Uint8Array(size);
    this.delta = new Float32Array(size);
    this.sedDelta = new Float32Array(size);
    this.scratch = new Float32Array(size);
    this.warm = new Float32Array(size);
    this.noErode = new Uint8Array(size);
    this.rng = new Rng(this.seed);
    this.climate = new Climate();
    this.log = new EventLog();
    this.minute = 9 * 60;           // start in the morning on the first day of spring
    this.groundwater = initialGroundwater();
    this.catchSnow = 0;
    this.springs = [];
    this.hotSpring = -1;
    this.burning = [];
    this.drainedToday = 0;
    this.inflowToday = 0;
    this.fishDied = 0;
    this.monitor = { drought: false, flood: 0, ice: false, snow: false, avgDrain: 0, fire: null, trees: 0, fishTotal: 0 };
    this.stats = {};
    this.animals = [];
    this.nextAnimalId = 1;
    this.birthsToday = {};
    this.deathsToday = {};
    this.revision = 0;              // bumps when something visible changed a lot
  }

  static create(seed) {
    const w = new World(seed);
    generateTerrain(w);
    w.prepare();
    w.warmup();
    seedInitialVegetation(w);
    seedInitialFish(w);
    w.updateWetList();
    seedAnimals(w);
    w.computeStats();
    w.monitor.trees = w.stats.trees;
    w.monitor.fishTotal = w.stats.fish;
    w.log.add(w.minute, 'A quiet valley on the first morning of spring.', 'season');
    return w;
  }

  // Derived lookups that are not saved.
  prepare() {
    buildWarmMap(this);
    this.noErode.fill(0);
    for (const s of this.springs) {
      const x = s.i % N, y = Math.floor(s.i / N);
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < N && ny < N) this.noErode[ny * N + nx] = 1;
      }
    }
  }

  // Let the river find its course and fill the lake before anything grows.
  warmup() {
    const c = this.climate;
    c.temp = 12; c.precip = 0; c.sun = 0.5;
    for (let k = 0; k < 9000; k++) {
      stepSources(this);
      stepWater(this);
    }
    for (let i = 0; i < this.moist.length; i++) {
      if (this.water[i] < 0.02) this.moist[i] = Math.max(this.moist[i], 0.45);
    }
    for (let k = 0; k < 6; k++) dailyMoistureSpread(this);
    this.drainedToday = 0; this.inflowToday = 0;
    this.terrainBase = Float32Array.from(this.terrain);
  }

  get cal() { return calendar(this.minute); }

  tick() {
    const cal = this.climate.update(this.minute, this.rng);
    stepSources(this);
    stepWater(this);
    tickAnimals(this);
    this.minute++;
    const m = this.minute % MIN_PER_DAY;
    if (m % 60 === 0) this.hourly();
    if (m === 0) this.daily();
    return cal;
  }

  updateWetList() {
    const list = [];
    for (let i = 0; i < this.water.length; i++) if (this.water[i] > 0.12) list.push(i);
    this.wetList = list;
  }

  hourly() {
    this.updateWetList();
    const lit = tryLightning(this, this.rng);
    if (lit >= 0 && !this.monitor.fire) {
      this.monitor.fire = { start: this.minute, where: placeName(lit), cells: 0 };
      this.log.add(this.minute, `Lightning sets ${placeName(lit)} alight.`, 'fire');
    }
    const burned = hourlyFire(this, this.rng);
    if (this.monitor.fire) {
      this.monitor.fire.cells += burned;
      if (!this.burning.length) {
        const f = this.monitor.fire;
        const hours = Math.round((this.minute - f.start) / 60);
        const msg = f.cells > 8
          ? `The fire near ${f.where} burns out after ${hours} hours, leaving ${f.cells} patches of ash.`
          : `The fire near ${f.where} fizzles out.`;
        this.log.add(this.minute, msg, 'fire');
        this.monitor.fire = null;
      }
      this.revision++;
    }
  }

  daily() {
    const cal = this.cal;
    dailyMoistureSpread(this);
    dailyVegetation(this, cal);
    dailyFish(this, cal);
    if (!this.approximating) dailyAnimals(this, cal);
    this.computeStats();
    this.checkEvents(cal);
    this.drainedToday = 0; this.inflowToday = 0; this.fishDied = 0;
    if (cal.doy % 7 === 0) {
      if (cal.doy === 0 && cal.year > 0) {
        this.climate.newYear(this.rng);
        const c = this.climate;
        const kind = c.wetness > 1.2 ? 'a wet year' : c.wetness < 0.8 ? 'a dry year' : c.warmth > 1.2 ? 'a warm year' : c.warmth < -1.2 ? 'a cold year' : 'an ordinary year';
        this.log.add(this.minute, `Year ${cal.year + 1} begins. It looks like ${kind}.`, 'season');
      } else if (cal.doy > 0) {
        this.log.add(this.minute, `${SEASON_NAMES[cal.season]} arrives.`, 'season');
      }
    }
    this.revision++;
  }

  // Daily approximation used when catching up long absences: no water flow,
  // but rain, snow, plants and fish still change.
  approximateDay() {
    const startMin = this.minute;
    for (let h = 0; h < 24; h++) {
      this.climate.update(this.minute, this.rng);
      const c = this.climate;
      const rain = c.precip * 60;
      for (let i = 0; i < this.moist.length; i++) {
        if (this.water[i] > 0.05) continue;
        const temp = c.temp - (this.terrain[i] - 8) * 0.16 + this.warm[i];
        if (rain > 0 && temp < 0.5) this.snow[i] += rain;
        else this.moist[i] = Math.min(1, this.moist[i] + rain / 0.25);
        if (temp > 0.5 && this.snow[i] > 0) this.snow[i] = Math.max(0, this.snow[i] - 0.0015 * (temp - 0.5));
        this.moist[i] = Math.max(0, this.moist[i] - 0.0045 * Math.max(0, temp / 20) * (0.3 + c.sun));
      }
      this.minute += 60;
      this.hourly();
    }
    this.minute = startMin + MIN_PER_DAY;
    this.approximating = true;
    this.daily();
    this.approximating = false;
    approxDayAnimals(this, this.cal);
  }

  computeStats() {
    let water = 0, wetCells = 0, trees = 0, conifers = 0, decid = 0, shrubs = 0, snags = 0, grass = 0, moist = 0, fish = 0, snow = 0, ice = 0, maxErode = 0, maxDep = 0;
    const base = this.terrainBase;
    for (let i = 0; i < this.water.length; i++) {
      water += this.water[i];
      if (this.water[i] > 0.1) wetCells++;
      const t = this.tree[i];
      if (t === TREE.DECID) decid++; else if (t === TREE.CONIFER) conifers++; else if (t === TREE.SHRUB) shrubs++; else if (t === TREE.SNAG) snags++;
      grass += this.grass[i]; moist += this.moist[i]; fish += this.fish[i];
      if (this.snow[i] > 0.02) snow++;
      if (this.ice[i]) ice++;
      if (base) {
        const d = this.terrain[i] - base[i];
        if (-d > maxErode) { maxErode = -d; this.maxErodeAt = i; }
        if (d > maxDep) maxDep = d;
      }
    }
    trees = decid + conifers + shrubs;
    const n = this.water.length;
    this.stats = {
      water, wetCells, trees, decid, conifers, shrubs, snags,
      grass: grass / n, moist: moist / n, fish, snowCells: snow, iceCells: ice,
      drained: this.drainedToday, inflow: this.inflowToday, groundwater: this.groundwater,
      maxErode, maxDep, burning: this.burning.length,
      animals: Object.fromEntries(SPECIES_KEYS.map(sp => [sp, this.animals.filter(a => a.sp === sp).length])),
    };
  }

  checkEvents(cal) {
    const s = this.stats, mon = this.monitor, t = this.minute;
    mon.avgDrain = mon.avgDrain ? mon.avgDrain * 0.93 + s.drained * 0.07 : s.drained;

    if (mon.flood > 0) mon.flood--;
    if (s.drained > mon.avgDrain * 2.2 && s.drained > 600 && mon.flood === 0) {
      this.log.add(t, 'The river runs high and spills over its banks.', 'water');
      mon.flood = 5;
    }
    if (!mon.drought && s.moist < 0.32 && cal.season === 1) {
      mon.drought = true;
      this.log.add(t, 'A drought settles in. The meadows turn brown and the river shrinks.', 'water');
    } else if (mon.drought && s.moist > 0.45) {
      mon.drought = false;
      this.log.add(t, 'Rain returns and the drought breaks.', 'water');
    }
    if (!mon.ice && s.iceCells > 120) { mon.ice = true; this.log.add(t, 'Ice spreads across the still water.', 'season'); }
    else if (mon.ice && s.iceCells < 5) { mon.ice = false; this.log.add(t, 'The ice breaks up and the water opens again.', 'season'); }
    const snowy = s.snowCells > this.water.length * 0.3;
    if (!mon.snow && snowy) { mon.snow = true; this.log.add(t, 'Snow blankets the valley.', 'season'); }
    else if (mon.snow && s.snowCells < this.water.length * 0.05) { mon.snow = false; this.log.add(t, 'The last of the snow melts from the valley floor.', 'season'); }

    if (mon.fishTotal > 50 && s.fish < mon.fishTotal * 0.7) this.log.add(t, 'Many fish die as the water warms and shrinks.', 'life');
    mon.fishTotal = s.fish;

    if (cal.doy === DAYS_PER_YEAR - 1) {
      const change = (s.trees - mon.trees) / Math.max(1, mon.trees);
      if (change > 0.12) this.log.add(t, 'Over the past year the woods have spread noticeably.', 'life');
      else if (change < -0.12) this.log.add(t, 'The woods are thinner than a year ago.', 'life');
      mon.trees = s.trees;
    }
  }
}
