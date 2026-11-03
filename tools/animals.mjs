// Runs the valley without graphics and reports how the animals are doing.
// Usage: node tools/animals.mjs [years] [seed]
import { World } from '../js/world.js';
import { MIN_PER_DAY, DAYS_PER_YEAR } from '../js/config.js';
import { SPECIES_KEYS } from '../js/species.js';
import { ACTIONS } from '../js/species.js';

const years = Number(process.argv[2] || 2), seed = Number(process.argv[3] || 12345);
const w = World.create(seed);
w.log.onAdd(e => { const c = w.cal; console.log(`    [y${c.year + 1} d${c.doy + 1}] ${e.text}`); });
const t0 = Date.now();
for (let d = 0; d < years * DAYS_PER_YEAR; d++) {
  const acts = {};
  for (let m = 0; m < MIN_PER_DAY; m++) {
    w.tick();
    if (m % 60 === 0) for (const a of w.animals) { const k = a.sp + ':' + ACTIONS[a.action]; acts[k] = (acts[k] || 0) + 1; }
  }
  if (d % 4 === 3) {
    const c = w.cal;
    const pop = SPECIES_KEYS.map(sp => {
      const list = w.animals.filter(a => a.sp === sp);
      const cond = list.reduce((s, a) => s + a.condition, 0) / Math.max(1, list.length);
      const skill = list.reduce((s, a) => s + a.skill, 0) / Math.max(1, list.length);
      return `${sp} ${list.length} (c${cond.toFixed(2)} s${skill.toFixed(2)})`;
    }).join('  ');
    console.log(`y${c.year + 1} d${c.doy + 1}  ${pop}  fish ${w.stats.fish.toFixed(0)}`);
    const ot = Object.entries(acts).filter(([k]) => k.startsWith('otter')).map(([k, v]) => `${k.split(':')[1]} ${v}`).join(' ');
    console.log(`      otter time: ${ot}`);
  }
}
console.log(w.deathTally);
console.log(`${years} years in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
