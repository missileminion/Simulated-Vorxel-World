// Calendar, sun, temperature and weather. Weather changes hourly through
// seasonal odds; each year drifts a little wetter/drier and warmer/colder.

import { MIN_PER_DAY, DAYS_PER_YEAR, DAYS_PER_SEASON, SEASON_NAMES } from './config.js';
import { clamp } from './rng.js';

export const WEATHER = {
  clear:  { label: 'Clear',    cloud: 0.05, rain: 0,       hours: [8, 30] },
  cloudy: { label: 'Overcast', cloud: 0.7,  rain: 0,       hours: [4, 16] },
  rain:   { label: 'Rain',     cloud: 0.88, rain: 0.00011, hours: [3, 12] },
  storm:  { label: 'Storm',    cloud: 1.0,  rain: 0.0005,  hours: [1, 4] },
  fog:    { label: 'Fog',      cloud: 0.45, rain: 0,       hours: [3, 6] },
};

const ODDS = [ // spring, summer, autumn, winter
  { clear: 0.34, cloudy: 0.28, rain: 0.30, storm: 0.04, fog: 0.04 },
  { clear: 0.54, cloudy: 0.18, rain: 0.15, storm: 0.11, fog: 0.02 },
  { clear: 0.30, cloudy: 0.28, rain: 0.30, storm: 0.04, fog: 0.08 },
  { clear: 0.30, cloudy: 0.38, rain: 0.27, storm: 0.01, fog: 0.04 },
];

export function calendar(minute) {
  const day = Math.floor(minute / MIN_PER_DAY);
  const year = Math.floor(day / DAYS_PER_YEAR);
  const doy = day % DAYS_PER_YEAR;
  const minOfDay = minute - day * MIN_PER_DAY;
  return {
    day, year, doy,
    season: Math.floor(doy / DAYS_PER_SEASON),
    dayOfSeason: doy % DAYS_PER_SEASON,
    minOfDay,
    hour: minOfDay / 60,
    yearFrac: (doy + minOfDay / MIN_PER_DAY) / DAYS_PER_YEAR,
  };
}

export function seasonName(cal) { return SEASON_NAMES[cal.season]; }

// Mid-summer is at 37.5% of the year (middle of the second season).
const seasonal = yf => Math.cos(2 * Math.PI * (yf - 0.375));

export function sunTimes(yearFrac) {
  const len = 12 + 3 * seasonal(yearFrac);
  return { rise: 12.5 - len / 2, set: 12.5 + len / 2 };
}

// -1..1, positive while the sun is up.
export function sunElevation(cal) {
  const { rise, set } = sunTimes(cal.yearFrac);
  const h = cal.hour;
  if (h >= rise && h <= set) return Math.sin(Math.PI * (h - rise) / (set - rise)) * (0.55 + 0.25 * seasonal(cal.yearFrac));
  const nightLen = 24 - (set - rise);
  const t = h > set ? h - set : h + 24 - set;
  return -Math.sin(Math.PI * t / nightLen) * 0.6;
}

// The real moon: its phase comes from the real date the valley minute stands for.
export const MOON_DAYS = 29.530588;
const NEW_MOON_REF = Date.UTC(2000, 0, 6, 18, 14);         // a known new moon

export function moonCycle(minute, epochMs) {
  const realMs = (epochMs ?? Date.now() - minute * 60000) + minute * 60000;
  return (realMs - NEW_MOON_REF) / 86400000 / MOON_DAYS;
}

export function moonState(minute, epochMs) {
  const c = moonCycle(minute, epochMs);
  const phase = ((c % 1) + 1) % 1;                          // 0 new, 0.5 full
  const illum = (1 - Math.cos(2 * Math.PI * phase)) / 2;
  // A full moon rises at sunset, a new moon at sunrise.
  const hour = (minute % MIN_PER_DAY) / 60;
  const rise = (6 + phase * 24) % 24;
  let t = hour - rise; if (t < 0) t += 24;
  const elev = t < 12.4 ? Math.sin(Math.PI * t / 12.4) : -Math.sin(Math.PI * (t - 12.4) / 11.6);
  return { phase, illum, elev, t };
}

export function moonName(phase) {
  if (phase < 0.04 || phase > 0.96) return 'new moon';
  if (phase < 0.22) return 'waxing crescent';
  if (phase < 0.28) return 'first quarter';
  if (phase < 0.46) return 'waxing gibbous';
  if (phase < 0.54) return 'full moon';
  if (phase < 0.72) return 'waning gibbous';
  if (phase < 0.78) return 'last quarter';
  return 'waning crescent';
}

export class Climate {
  constructor() {
    this.weather = 'clear';
    this.hoursLeft = 10;
    this.wetness = 1;      // yearly multiplier on rain odds and amounts
    this.warmth = 0;       // yearly temperature offset (°C)
    this.windX = 0.8; this.windY = 0.3;
    // derived each minute
    this.temp = 10; this.sun = 0; this.elev = 0; this.precip = 0; this.cloud = 0; this.fog = 0;
    this.moonPhase = 0; this.moonIllum = 0; this.moonElev = 0; this.moonLight = 0;
  }

  toJSON() {
    const { weather, hoursLeft, wetness, warmth, windX, windY, fog, cloud } = this;
    return { weather, hoursLeft, wetness, warmth, windX, windY, fog, cloud };
  }
  load(o) { Object.assign(this, o); }

  meanTemp(yearFrac) { return 9 + this.warmth + 12 * seasonal(yearFrac); }

  update(minute, rng) {
    const cal = calendar(minute);
    if (cal.minOfDay % 60 === 0) this.hourly(cal, rng);
    const w = WEATHER[this.weather];
    this.cloud += (w.cloud - this.cloud) * 0.01;
    const fogTarget = this.weather === 'fog' ? 1 : 0;
    this.fog += (fogTarget - this.fog) * 0.01;
    this.elev = sunElevation(cal);
    this.sun = Math.max(0, this.elev) * (1 - 0.65 * this.cloud);
    const moon = moonState(minute, this.epochMs);
    this.moonPhase = moon.phase; this.moonIllum = moon.illum; this.moonElev = moon.elev;
    // How much moonlight reaches the ground (0 dark .. 1 bright full moon, clear sky, night).
    const night = clamp((-this.elev - 0.02) * 8, 0, 1);
    this.moonLight = moon.illum * clamp(moon.elev * 2, 0, 1) * (1 - 0.85 * this.cloud) * night;
    const diurnal = 4.5 * Math.sin(2 * Math.PI * (cal.hour - 9) / 24) * (1 - 0.5 * this.cloud);
    this.temp = this.meanTemp(cal.yearFrac) + diurnal - (this.weather === 'rain' ? 2 : this.weather === 'storm' ? 3 : 0);
    this.precip = w.rain * (0.6 + 0.4 * this.wetness);
    return cal;
  }

  hourly(cal, rng) {
    // Wind wanders slowly.
    this.windX = clamp(this.windX + rng.normal() * 0.08, -1.2, 1.2);
    this.windY = clamp(this.windY + rng.normal() * 0.08, -1.2, 1.2);
    if (--this.hoursLeft > 0) {
      if (this.weather === 'fog' && cal.hour > 11) this.hoursLeft = 0; else return;
    }
    const base = ODDS[cal.season];
    const odds = { ...base };
    odds.rain *= this.wetness; odds.storm *= this.wetness;
    odds.clear *= 2 - this.wetness;
    if (!(cal.hour < 8 || cal.hour > 20)) odds.fog = 0; // fog forms in cool hours
    let next = rng.pick(odds);
    if (next === this.weather && next !== 'clear') next = rng.pick(odds);
    this.weather = next;
    const [a, b] = WEATHER[next].hours;
    this.hoursLeft = Math.round(a + rng.next() * (b - a));
  }

  newYear(rng) {
    this.wetness = clamp(1 + 0.5 * (this.wetness - 1) + rng.normal() * 0.22, 0.55, 1.6);
    this.warmth = clamp(0.5 * this.warmth + rng.normal() * 1.0, -3, 3);
  }

  describe() {
    const w = WEATHER[this.weather];
    if (this.precip > 0 && this.temp < 0.5) return this.weather === 'storm' ? 'Blizzard' : 'Snow';
    return w.label;
  }
}
