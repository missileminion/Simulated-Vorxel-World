// Runs the world without graphics and prints how it is doing.
// Usage: node tools/headless.mjs [years] [seed] [--approx]

import { World } from '../js/world.js';
import { MIN_PER_DAY, DAYS_PER_YEAR } from '../js/config.js';

const years = Number(process.argv[2] || 3);
const seed = Number(process.argv[3] || 12345);
const approx = process.argv.includes('--approx');

const t0 = Date.now();
const w = World.create(seed);
console.log(`created in ${Date.now() - t0} ms`);
w.log.onAdd(e => {
  const c = w.cal;
  console.log(`    [y${c.year + 1} d${c.doy + 1}] ${e.text}`);
});

const fmt = (v, d = 1) => Number(v).toFixed(d);
const line = () => {
  const s = w.stats, c = w.cal;
  console.log(`y${c.year + 1} d${String(c.doy + 1).padStart(2)} ` +
    `water ${fmt(s.water, 0)} wet ${s.wetCells} in ${fmt(s.inflow, 0)} out ${fmt(s.drained, 0)} gw ${fmt(s.groundwater, 0)} ` +
    `moist ${fmt(s.moist, 2)} grass ${fmt(s.grass, 2)} trees ${s.decid}/${s.conifers}/${s.shrubs} snags ${s.snags} ` +
    `fish ${fmt(s.fish, 0)} snow ${s.snowCells} ice ${s.iceCells} erode ${fmt(s.maxErode, 3)} dep ${fmt(s.maxDep, 3)} ` +
    `wet ${fmt(w.climate.wetness, 2)}`);
};

const t1 = Date.now();
const days = years * DAYS_PER_YEAR;
for (let d = 0; d < days; d++) {
  if (approx) w.approximateDay();
  else for (let m = 0; m < MIN_PER_DAY; m++) w.tick();
  if (d % 2 === 1) line();
}
if (w.maxErodeAt != null) console.log('max erosion at', w.maxErodeAt % 96, Math.floor(w.maxErodeAt / 96), 'water', w.water[w.maxErodeAt].toFixed(2), 'flow', w.flow[w.maxErodeAt].toFixed(3));
console.log(`simulated ${years} years in ${((Date.now() - t1) / 1000).toFixed(1)} s`);
