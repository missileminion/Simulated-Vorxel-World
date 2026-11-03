// Water: river inflow from the wider catchment, rain and snow, flow over the
// terrain, soaking into soil, evaporation, groundwater, ice and very slow erosion.
//
// Water levels relax toward their neighbours once per game minute. Flow speed is
// therefore simplified, but volumes, seasons and floods follow real budgets.

import { N } from './config.js';
import { MAT } from './terrain.js';
import { clamp } from './rng.js';

const FLOW_K = 0.45;          // fraction of the head difference moved per step
export const SOIL_CAP = 0.25; // water (m) a fully wet soil column holds
const INFILTRATION = 0.0005;  // m/min into permeable dry soil
const EVAP_WATER = 1.0e-4;    // m/min from open water at warm full sun (compressed year)
const EVAP_SOIL = 1.1e-4;     // m/min transpiration from wet, vegetated soil (compressed year)
const MELT = 2.6e-5;          // m/min of snow per °C above freezing

// Catchment beyond the map edge feeding the river.
const CATCH_AREA = 48000;     // cells of hidden catchment (sized for the 160-cell valley)
const CATCH_EFF = 0.45;       // fraction of catchment rain that becomes river water
const QUICK = 0.12;           // fraction of that which arrives right away (floods)
const BASEFLOW_TAU = 8640;    // minutes; groundwater release time constant
const RECHARGE_TO_RIVER = 0.25; // share of water soaking through the valley soil that returns to the river (the rest goes deep)

// Erosion is deliberately tiny: ordinary flow barely moves the bed, floods do most.
const EROSION_CAP = 0.012;
const EROSION_RATE = 0.0003;
const DEPOSIT_RATE = 0.03;

const PERM = [0.05, 1.3, 1.5, 0.55, 0.2, 0.85, 0.6];
const RESIST = [0.04, 0.35, 1, 1, 0.45, 0.75, 0.6];

export function initialGroundwater() { return 0.55 * BASEFLOW_TAU; }

export function cellTemp(w, i) {
  return w.climate.temp - (w.terrain[i] - 8) * 0.16 + w.warm[i];
}

export function stepWater(w) {
  const { terrain: t, water: wa, sed, delta, sedDelta, fx, fy, flow, material } = w;
  delta.fill(0); sedDelta.fill(0);
  let drained = 0;
  const L = N - 1;

  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x;
    const wi = wa[i];
    if (wi < 1e-4) { flow[i] *= 0.97; fx[i] *= 0.97; fy[i] *= 0.97; continue; }
    const H = t[i] + wi;
    // Front edges (x = L, y = L) drain out of the valley; back edges are walls.
    let dE = x < L ? H - t[i + 1] - wa[i + 1] : wi + 0.3;
    let dW = x > 0 ? H - t[i - 1] - wa[i - 1] : 0;
    let dS = y < L ? H - t[i + N] - wa[i + N] : wi + 0.3;
    let dN = y > 0 ? H - t[i - N] - wa[i - N] : 0;
    if (dE < 0) dE = 0; if (dW < 0) dW = 0; if (dS < 0) dS = 0; if (dN < 0) dN = 0;
    const maxd = Math.max(dE, dW, dS, dN);
    if (maxd <= 1e-6) { flow[i] *= 0.97; fx[i] *= 0.97; fy[i] *= 0.97; continue; }
    const sum = dE + dW + dS + dN;
    const amt = Math.min(wi, maxd * FLOW_K);
    const k = amt / sum;
    const sedOut = sed[i] * (amt / wi);
    const ks = sedOut / sum;

    if (dE > 0) { if (x < L) { delta[i + 1] += dE * k; sedDelta[i + 1] += dE * ks; } else drained += dE * k; }
    if (dW > 0) { delta[i - 1] += dW * k; sedDelta[i - 1] += dW * ks; }
    if (dS > 0) { if (y < L) { delta[i + N] += dS * k; sedDelta[i + N] += dS * ks; } else drained += dS * k; }
    if (dN > 0) { delta[i - N] += dN * k; sedDelta[i - N] += dN * ks; }
    delta[i] -= amt;
    sedDelta[i] -= sedOut;

    fx[i] = fx[i] * 0.96 + (dE - dW) * k * 0.04;
    fy[i] = fy[i] * 0.96 + (dS - dN) * k * 0.04;
    flow[i] = flow[i] * 0.96 + amt * 0.04;

    // Stream power picks up sediment; slow water drops it.
    const power = amt * Math.min(maxd, 1.5);
    const cap = EROSION_CAP * power * Math.sqrt(power);
    const s = sed[i];
    if (s < cap && !w.noErode[i]) {
      // Beds armour themselves as they deepen: once the loose layer is gone it gets slow.
      const cut = w.terrainBase ? w.terrainBase[i] - t[i] : 0;
      const armour = cut > 0 ? Math.max(0.08, 1 - cut * 2) : 1;
      const e = EROSION_RATE * (cap - s) * RESIST[material[i]] * armour;
      t[i] -= e; sedDelta[i] += e;
    } else if (s > cap) {
      const d = (s - cap) * DEPOSIT_RATE;
      t[i] += d; sedDelta[i] -= d; w.deposit[i] += d;
    }
  }

  for (let i = 0; i < wa.length; i++) {
    wa[i] += delta[i];
    if (wa[i] < 0) wa[i] = 0;
    sed[i] += sedDelta[i];
    if (sed[i] < 0) sed[i] = 0;
  }
  w.drainedToday += drained;
}

export function stepSources(w) {
  const { terrain: t, water: wa, sed, moist, snow, material, ice, grass, tree, treeSize, warm, flow } = w;
  const c = w.climate;
  const sunF = 0.25 + 0.75 * c.sun;
  let recharge = 0;

  for (let i = 0; i < wa.length; i++) {
    const temp = c.temp - (t[i] - 8) * 0.16 + warm[i];

    if (c.precip > 0) {
      if (temp < 0.5 && (wa[i] < 0.05 || ice[i])) snow[i] += c.precip; else wa[i] += c.precip;
    }
    if (snow[i] > 0 && temp > 0.5) {
      const m = Math.min(snow[i], MELT * (temp - 0.5) * (0.6 + c.sun) + (c.precip > 0 ? c.precip * 0.5 : 0));
      snow[i] -= m; wa[i] += m;
    }

    let wi = wa[i];
    if (wi > 0) {
      const room = (1 - moist[i]) * SOIL_CAP;
      if (room > 0) {
        const inf = Math.min(wi, INFILTRATION * PERM[material[i]], room);
        wi -= inf; moist[i] += inf / SOIL_CAP;
      }
      // Standing water keeps the soil under it wet, but only by giving up some of itself.
      if (wi > 0.02 && moist[i] < 1) {
        const take = Math.min(wi - 0.02, (1 - moist[i]) * SOIL_CAP);
        wi -= take; moist[i] += take / SOIL_CAP;
      }
      const e = EVAP_WATER * clamp((temp + 2) / 24, 0, 1.4) * sunF * (ice[i] ? 0.1 : 1);
      wi = wi > e ? wi - e : 0;
      if (wi < 2e-4) { t[i] += sed[i]; sed[i] = 0; wi = 0; }
      wa[i] = wi;
      if (temp < -1.5 && wi > 0.05 && flow[i] < 0.06) ice[i] = 1;
    }
    if (ice[i] && (temp > 0.5 || wa[i] < 0.03)) ice[i] = 0;

    if (moist[i] > 0 && snow[i] < 0.01) {
      const veg = 0.35 + 0.4 * grass[i] + (tree[i] > 0 && tree[i] < 4 ? 0.5 * treeSize[i] : 0);
      const et = EVAP_SOIL * clamp(temp / 20, 0, 1.4) * sunF * veg * moist[i];
      moist[i] = Math.max(0, moist[i] - et / SOIL_CAP);
    }
    if (moist[i] > 0.6) {
      const p = (moist[i] - 0.6) * 0.002;
      moist[i] -= p; recharge += p * SOIL_CAP;
    }
  }

  // Hidden catchment: rain and snowmelt up in the mountains feed the river.
  const mtnTemp = c.temp - 5;
  const catchIn = c.precip * CATCH_AREA * CATCH_EFF;
  let quick = 0;
  if (catchIn > 0) {
    if (mtnTemp < 0.5) w.catchSnow += catchIn;
    else { w.groundwater += catchIn * (1 - QUICK); quick = catchIn * QUICK; }
  }
  if (w.catchSnow > 0 && mtnTemp > 0.5) {
    const m = Math.min(w.catchSnow, w.catchSnow * 0.0006 * (mtnTemp - 0.5) / 10 + 0.01);
    w.catchSnow -= m; w.groundwater += m;
  }
  w.groundwater += recharge * RECHARGE_TO_RIVER;
  const base = w.groundwater / BASEFLOW_TAU;
  w.groundwater -= base;
  const inflow = base + quick;
  w.inflowToday += inflow;
  for (const s of w.springs) wa[s.i] += inflow * s.share;

  // The hot spring: small warm flow that never freezes.
  if (w.hotSpring >= 0) wa[w.hotSpring] += 0.004;
}

// Spread soil moisture sideways a little each day so riverbanks stay green.
export function dailyMoistureSpread(w) {
  const { moist, water, delta } = w;
  delta.set(moist);
  for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) {
    const i = y * N + x;
    const m = Math.max(moist[i - 1], moist[i + 1], moist[i - N], moist[i + N]);
    if (m > moist[i] + 0.1 && water[i] < 0.02) delta[i] = moist[i] + (m - moist[i]) * 0.25;
  }
  moist.set(delta);
}

export function buildWarmMap(w) {
  w.warm.fill(0);
  if (w.hotSpring < 0) return;
  const hx = w.hotSpring % N, hy = Math.floor(w.hotSpring / N);
  for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
    const x = hx + dx, y = hy + dy;
    if (x < 0 || y < 0 || x >= N || y >= N) continue;
    const d = Math.hypot(dx, dy);
    if (d <= 4) w.warm[y * N + x] = 9 * (1 - d / 4.5);
  }
}

export { MAT };
