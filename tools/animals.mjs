// Runs the valley without graphics and reports how the animals are doing.
// Usage: node tools/animals.mjs [years] [seed] [--thoughts]
import { World } from '../js/world.js';
import { MIN_PER_DAY, DAYS_PER_YEAR } from '../js/config.js';
import { SPECIES_KEYS } from '../js/species.js';

const years = Number(process.argv[2] || 2), seed = Number(process.argv[3] || 12345);
const showThoughts = process.argv.includes('--thoughts');
const w = World.create(seed);
w.log.onAdd(e => { const c = w.cal; console.log(`    [y${c.year + 1} d${c.doy + 1}] ${e.text}`); });
const t0 = Date.now();
for (let d = 0; d < years * DAYS_PER_YEAR; d++) {
  for (let m = 0; m < MIN_PER_DAY; m++) w.tick();
  if (d % 4 === 3) {
    const c = w.cal;
    const pop = SPECIES_KEYS.map(sp => {
      const list = w.animals.filter(a => a.sp === sp);
      const avg = f => (list.reduce((s, a) => s + a[f], 0) / Math.max(1, list.length)).toFixed(2);
      return `${sp} ${list.length} (c${avg('condition')} h${avg('health')} s${avg('skill')})`;
    }).join('  ');
    console.log(`y${c.year + 1} d${c.doy + 1}  ${pop}  fish ${w.stats.fish.toFixed(0)} in ${w.schools.length} schools`);
  }
}
if (showThoughts) {
  for (const a of w.animals.slice(0, 40)) for (const t of a.mind.thoughts.slice(-3)) console.log(`  ${a.sp.padEnd(6)} ${a.name.padEnd(10)} ${t.text}`);
}
console.log(w.deathTally);
console.log(`${years} years in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
