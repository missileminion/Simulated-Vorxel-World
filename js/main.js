// Starts the valley, keeps the clock running, catches up after absences and
// wires the small interface around the canvas.

import { World } from './world.js';
import { Renderer } from './render.js';
import * as store from './store.js';
import { GAME_MIN_PER_REAL_SEC, SPEEDS, EXACT_CATCHUP_MIN, MAX_CATCHUP_DAYS, MIN_PER_DAY, SEASON_NAMES } from './config.js';
import { calendar, moonName } from './climate.js';
import { placeName, MAT_NAMES } from './terrain.js';
import { TREE_NAMES } from './vegetation.js';
import { cellTemp } from './hydrology.js';
import { SPECIES, SPECIES_KEYS, ACTIONS, A } from './species.js';
import { ageYears } from './animals.js';
import { belief, hedge, timeAgo } from './mind.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const nextFrame = () => new Promise(r => setTimeout(r, 0));

let settings = { speed: 0, rot: 0 };
let world, renderer;
let paused = false;

// ---------- formatting ----------

const pad = n => String(n).padStart(2, '0');
function stamp(minute) {
  const c = calendar(minute);
  return `Year ${c.year + 1} · ${SEASON_NAMES[c.season]} ${c.dayOfSeason + 1} · ${pad(Math.floor(c.hour))}:${pad(Math.floor(c.minOfDay % 60))}`;
}
function duration(ms) {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'}`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} hour${h === 1 ? '' : 's'}`;
  return `${Math.round(h / 24)} days`;
}
function gameSpan(min) {
  const d = Math.floor(min / MIN_PER_DAY);
  if (d >= 1) return `${d} valley day${d === 1 ? '' : 's'}`;
  return `${Math.round(min / 60)} valley hours`;
}

// ---------- overlay ----------

function overlay(title, text, progress) {
  $('overlay').classList.remove('hidden');
  $('overlayTitle').textContent = title;
  $('overlayText').textContent = text || '';
  $('overlayBar').parentElement.classList.toggle('hidden', progress == null);
  if (progress != null) $('overlayBar').style.width = `${Math.round(progress * 100)}%`;
}
function closeOverlay() {
  $('overlay').classList.add('hidden');
  $('overlayList').innerHTML = '';
  $('overlayClose').classList.add('hidden');
}
$('overlayClose').addEventListener('click', closeOverlay);

// ---------- catching up ----------

let catchingUp = false;
async function catchUp(realMs, label) {
  const total = Math.min(realMs / 1000 * GAME_MIN_PER_REAL_SEC, MAX_CATCHUP_DAYS * MIN_PER_DAY);
  if (total < 2) return;
  catchingUp = true;
  const start = world.minute;
  const exact = Math.min(total, EXACT_CATCHUP_MIN);
  const big = total > 240;
  let done = 0;
  if (big) overlay('Catching up…', `You were away ${duration(realMs)}.`, 0);
  while (done < exact) {
    const end = performance.now() + 40;
    while (done < exact && performance.now() < end) { world.tick(); done++; }
    if (big) { $('overlayBar').style.width = `${Math.round(done / total * 100)}%`; await nextFrame(); }
  }
  while (done + MIN_PER_DAY <= total) {
    world.approximateDay();
    done += MIN_PER_DAY;
    if (big) { $('overlayBar').style.width = `${Math.round(done / total * 100)}%`; await nextFrame(); }
  }
  catchingUp = false;
  renderer.buildNow();
  if (big) {
    const events = world.log.since(start);
    overlay(label || 'While you were away', `${duration(realMs)} passed here, about ${gameSpan(world.minute - start)} in the valley.`, null);
    const list = $('overlayList');
    for (const e of events.slice(-12)) {
      const li = document.createElement('li');
      li.textContent = e.text;
      list.appendChild(li);
    }
    if (!events.length) list.innerHTML = '<li>Nothing remarkable. The river kept running.</li>';
    $('overlayClose').classList.remove('hidden');
  }
  renderLog();
}

// ---------- HUD ----------

function updateHud() {
  const c = world.cal, cl = world.climate;
  $('clock').textContent = `${pad(Math.floor(c.hour))}:${pad(Math.floor(c.minOfDay % 60))}`;
  $('date').textContent = `${SEASON_NAMES[c.season]} · day ${c.dayOfSeason + 1} · year ${c.year + 1}`;
  const moon = cl.elev < 0 && cl.moonElev > 0 ? ` · ${moonName(cl.moonPhase)}` : '';
  $('weather').textContent = `${cl.describe()} · ${Math.round(cl.temp)}°C${moon}`;
  $('speed').textContent = settings.speed ? `${SPEEDS[settings.speed]}×` : 'live';
  $('pop').textContent = SPECIES_KEYS.map(sp => {
    const n = world.animals.filter(a => a.sp === sp).length;
    if (sp === 'heron' && !n && world.awayHerons && world.awayHerons.length) return 'herons away south';
    return `${n} ${n === 1 ? SPECIES[sp].label : SPECIES[sp].plural}`;
  }).join(' · ') + ` · ~${Math.round(world.stats.fish / 10) * 10} fish`;
}

function renderLog() {
  const box = $('log');
  box.innerHTML = '';
  const items = world.log.items.slice(-2);
  items.forEach((e, n) => {
    const d = document.createElement('div');
    d.className = 'item' + (n < items.length - 2 ? ' old' : '');
    const c = calendar(e.minute);
    d.innerHTML = `<span class="when"></span>`;
    d.firstChild.textContent = `${SEASON_NAMES[c.season]} ${c.dayOfSeason + 1}`;
    d.appendChild(document.createTextNode(e.text));
    box.appendChild(d);
  });
  if (!$('historyPanel').classList.contains('hidden')) renderHistory();
}

function renderHistory() {
  const ol = $('historyList');
  ol.innerHTML = '';
  for (const e of world.log.items) {
    const li = document.createElement('li');
    const when = document.createElement('span');
    when.className = 'when';
    when.textContent = stamp(e.minute);
    li.appendChild(when);
    li.appendChild(document.createTextNode(e.text));
    ol.appendChild(li);
  }
}

// ---------- inspector ----------

let inspected = -1;
let watched = -1;

function doing(a) {
  const S = SPECIES[a.sp];
  switch (a.action) {
    case A.EAT:
      if (a.prey >= 0) return a.sp === 'fox' ? 'chasing prey' : 'hunting';
      if (a.pose === 'dive') return 'diving for fish';
      if (a.pose === 'stalk') return 'stalking the shallows';
      if (a.pose === 'pounce') return 'pouncing on mice';
      if (a.pose === 'eat') return 'grazing';
      return S.diet === 'fish' ? 'looking for fish' : 'looking for food';
    case A.REST: return a.pose === 'sleep' ? 'sleeping' : a.pose === 'rest' ? 'resting, saving energy' : 'heading somewhere to rest';
    case A.SOCIAL: return a.pose === 'groom' ? 'grooming a friend' : a.pose === 'idle' ? 'keeping company' : 'looking for company';
    case A.EXPLORE: return 'exploring';
    case A.FLEE: return 'fleeing!';
    case A.PLAY: return 'playing';
  }
  return '';
}

const STATE_WORDS = [['hungry', 1], ['tired', 2], ['scared', 4], ['near food', 8], ['in the dark', 16], ['in winter', 32]];
const ACTION_WORDS = ['eat', 'rest', 'seek company', 'explore', 'run', 'play'];
function lessons(a) {
  const out = [];
  for (let s = 0; s < 64; s++) for (let k = 0; k < 6; k++) {
    const v = a.q[s * 6 + k];
    if (Math.abs(v) > 0.15) out.push({ s, k, v });
  }
  out.sort((p, q) => Math.abs(q.v) - Math.abs(p.v));
  const seen = new Set(), lines = [];
  for (const { s, k, v } of out) {
    // "near food" is true most of the time, so only mention it when nothing else applies.
    let when = STATE_WORDS.filter(([, b]) => s & b && b !== 8).map(([t]) => t);
    if (!when.length) when = s & 8 ? ['food is close'] : ['all is calm'];
    const key = `${k}:${v > 0}:${when[0]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(`${v > 0 ? 'Good' : 'Bad'} to ${ACTION_WORDS[k]} when ${when.slice(0, 2).join(' and ')}`);
    if (lines.length >= 3) break;
  }
  return lines;
}

function trait(v, lo, hi) { return v > 0.62 ? hi : v < 0.38 ? lo : null; }

function updateAnimalPanel() {
  const panel = $('inspect');
  const a = world.animals.find(b => b.id === watched);
  if (!a) {
    if (watched >= 0) { panel.innerHTML = '<p>Gone. Its story is in the valley history.</p>'; watched = -1; renderer.selected = -1; renderer.follow = -1; }
    return;
  }
  const S = SPECIES[a.sp];
  const age = ageYears(world, a);
  const ageText = age < 1 ? `${Math.max(1, Math.round(age * 28))} days old` : `${age.toFixed(1)} years old`;
  const young = age < S.adult;
  const traits = [trait(a.traits.bold, 'shy', 'bold'), trait(a.traits.social, 'a loner', 'sociable'),
    trait(a.traits.curious, 'cautious', 'curious'), trait(a.traits.lazy, 'energetic', 'lazy')].filter(Boolean);
  const mother = world.animals.find(b => b.id === a.mother);
  const skillName = S.diet === 'fish' ? 'Fishing' : S.diet === 'wade' ? 'Fishing' : S.diet === 'hunt' ? 'Hunting' : 'Foraging';
  const rows = [];
  const add = (k, v) => rows.push(`<dt>${k}</dt><dd>${v}</dd>`);
  add('Doing', doing(a));
  add('Age', ageText + (young ? ' (young)' : ''));
  if (traits.length) add('Nature', traits.join(', '));
  add('Hunger', pct(a.hunger) + meter(a.hunger));
  add('Energy', pct(a.energy) + meter(a.energy));
  add('Loneliness', pct(a.lonely) + meter(a.lonely));
  if (a.fear > 0.05) add('Fear', pct(a.fear) + meter(a.fear));
  add('Body condition', pct(a.condition) + meter(a.condition));
  add(skillName + ' skill', pct(a.skill) + meter(a.skill));
  if (a.catches) add('Catches', a.catches);
  if (mother) add('Mother', mother.name);
  if (a.pregnant) add('Expecting', 'soon');
  if (a.health < 0.95) add('Wounds', pct(1 - a.health) + meter(1 - a.health));
  const m = a.mind;
  const moods = [];
  if (m.grief > 0.3) moods.push(`missing ${m.griefFor || 'someone'}`);
  if (m.happy > 0.7) moods.push('happy');
  else if (m.happy < 0.3) moods.push('glum');
  if (m.bored > 0.55) moods.push('bored');
  if (m.frustrated > 0.45) moods.push('frustrated');
  if (m.confident > 0.7) moods.push('confident');
  if (a.fear > 0.4) moods.push('scared');
  add('Feels', moods.join(', ') || 'calm');
  const learned = lessons(a);
  // Beliefs, in its own words.
  const beliefs = [];
  for (const k in m.b) {
    const [kind, what] = k.split(':');
    const name = m.nick[what] || (SPECIES[what] ? SPECIES[what].plural : what);
    const p = belief(a, k);
    if (kind === 'fear') beliefs.push(`${name} are dangerous: ${hedge(p)}`);
    else if (kind === 'hunt') beliefs.push(`catching ${name} works: ${hedge(p)}`);
    else if (kind === 'hurt') beliefs.push(`${name} fight back: ${hedge(p)}`);
    else if (kind === 'fight') beliefs.push(`can beat ${name}: ${hedge(p)}`);
    else if (kind === 'fishing') beliefs.push(`chasing fish pays off: ${hedge(p)}`);
  }
  const places = a.memory.filter(mm => mm.name).slice(0, 4).map(mm => `${mm.name}${mm.kind === 'danger' ? ' (scary)' : ''}`);
  panel.innerHTML = `<div class="sheet-head"><h3></h3><button class="close" aria-label="Close">×</button></div>
    <ol class="thoughts"></ol>
    <dl>${rows.join('')}</dl>
    <p class="learned beliefs"></p>
    <p class="learned places"></p>
    ${learned.length ? `<p class="learned"><b>Has learned</b><br>${learned.join('<br>')}</p>` : '<p class="learned">Still working out how the world works.</p>'}
    <button class="follow">${renderer.follow === a.id ? 'Stop following' : 'Follow'}</button>`;
  panel.querySelector('h3').textContent = `${a.name} the ${S.label}${a.sex === 'f' ? ' ♀' : ' ♂'}`;
  const ol = panel.querySelector('.thoughts');
  for (const t of m.thoughts.slice(-4).reverse()) {
    const li = document.createElement('li');
    const when = document.createElement('span');
    when.className = 'when';
    when.textContent = timeAgo(world.minute - t.t);
    li.append(`“${t.text}”`, when);
    ol.appendChild(li);
  }
  if (!m.thoughts.length) ol.remove();
  const bp = panel.querySelector('.beliefs');
  if (beliefs.length) { bp.innerHTML = '<b>Believes</b><br>'; bp.append(...beliefs.slice(0, 4).flatMap((b, n) => n ? [document.createElement('br'), b] : [b])); } else bp.remove();
  const pp = panel.querySelector('.places');
  if (places.length) { pp.innerHTML = '<b>Places it named</b><br>'; pp.append(places.join(' · ')); } else pp.remove();
  panel.querySelector('.close').onclick = () => { watched = -1; renderer.selected = -1; renderer.follow = -1; panel.classList.add('hidden'); };
  panel.querySelector('.follow').onclick = () => { renderer.follow = renderer.follow === a.id ? -1 : a.id; updateAnimalPanel(); };
  panel.classList.remove('hidden');
}
function pct(v) { return `${Math.round(v * 100)}%`; }
function meter(v) { return `<div class="meter"><i style="width:${Math.round(Math.min(1, Math.max(0, v)) * 100)}%"></i></div>`; }
function updateInspect() {
  const panel = $('inspect');
  if (watched >= 0) { updateAnimalPanel(); return; }
  if (inspected < 0) { panel.classList.add('hidden'); return; }
  const k = inspected, w = world;
  const rows = [];
  const add = (a, b) => rows.push(`<dt>${a}</dt><dd>${b}</dd>`);
  add('Height', `${w.terrain[k].toFixed(1)} m`);
  add('Ground', MAT_NAMES[w.material[k]]);
  add('Temperature', `${Math.round(cellTemp(w, k))}°C`);
  if (w.water[k] > 0.02) add(w.ice[k] ? 'Water (iced)' : 'Water', `${w.water[k].toFixed(2)} m`);
  if (w.snow[k] > 0.002) add('Snow', `${Math.round(w.snow[k] * 1000 * 8)} mm`);
  add('Soil moisture', pct(w.moist[k]) + meter(w.moist[k]));
  if (w.grass[k] > 0.05) add('Grass', pct(w.grass[k]) + meter(w.grass[k]));
  if (w.reed[k] > 0.05) add('Reeds', pct(w.reed[k]) + meter(w.reed[k]));
  if (w.tree[k]) {
    add('Plant', TREE_NAMES[w.tree[k]]);
    if (w.tree[k] < 4) add('Size · health', `${pct(w.treeSize[k])} · ${pct(w.treeHealth[k])}`);
  }
  if (w.fish[k] > 0.01) add('Fish', pct(w.fish[k]) + meter(w.fish[k]));
  add('Soil fertility', pct(w.fert[k]) + meter(w.fert[k]));
  if (w.fire[k] > 0) add('Fire', 'burning');
  else if (w.burn[k] > 0.1) add('Burn scar', pct(w.burn[k]));
  const name = placeName(k);
  panel.innerHTML = `<div class="sheet-head"><h3></h3><button class="close" aria-label="Close">×</button></div><dl>${rows.join('')}</dl>`;
  panel.querySelector('h3').textContent = name.charAt(0).toUpperCase() + name.slice(1);
  panel.querySelector('.close').onclick = () => { inspected = -1; updateInspect(); };
  panel.classList.remove('hidden');
}

// ---------- input ----------

function setupInput() {
  const cv = $('view');
  const pointers = new Map();
  let moved = 0, pinch = 0;
  cv.addEventListener('pointerdown', e => {
    cv.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved = 0;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = Math.hypot(a.x - b.x, a.y - b.y);
    }
    cv.classList.add('dragging');
  });
  cv.addEventListener('pointermove', e => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (pointers.size === 1) { renderer.pan(dx, dy); moved += Math.abs(dx) + Math.abs(dy); if (moved > 6) renderer.follow = -1; }
    else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch > 0) renderer.zoomAt(d / pinch, (a.x + b.x) / 2, (a.y + b.y) / 2);
      pinch = d; moved += 10;
    }
  });
  const up = e => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size === 0) {
      cv.classList.remove('dragging');
      if (moved < 6) {
        const a = renderer.pickAnimal(e.clientX, e.clientY);
        if (a) {
          watched = a.id; inspected = -1; renderer.selected = a.id;
        } else {
          watched = -1; renderer.selected = -1; renderer.follow = -1;
          const k = renderer.pick(e.clientX, e.clientY);
          inspected = k === inspected ? -1 : k;
        }
        updateInspect();
      }
    }
    pinch = 0;
  };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);
  cv.addEventListener('wheel', e => {
    e.preventDefault();
    renderer.zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
  }, { passive: false });

  const rotate = d => { settings.rot = (settings.rot + d + 4) % 4; renderer.setRotation(settings.rot); };
  const togglePause = () => {
    paused = !paused;
    $('pauseIcon').innerHTML = paused ? '<path d="M8 5l11 7-11 7z" />' : '<path d="M9 6v12M15 6v12" />';
  };
  const cycleSpeed = () => { settings.speed = (settings.speed + 1) % SPEEDS.length; renderer.rebuildMs = Math.max(1200, 30000 / SPEEDS[settings.speed]); updateHud(); };
  const toggleHistory = () => {
    const p = $('historyPanel');
    p.classList.toggle('hidden');
    if (!p.classList.contains('hidden')) renderHistory();
  };
  $('rotL').onclick = () => rotate(-1);
  $('rotR').onclick = () => rotate(1);
  $('home').onclick = () => renderer.resetView();
  $('pause').onclick = togglePause;
  $('speed').onclick = cycleSpeed;
  $('history').onclick = toggleHistory;
  document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => $(b.dataset.close).classList.add('hidden'));
  $('newWorld').onclick = () => {
    if (!confirm('Start over with a brand new valley? The current one will be gone.')) return;
    store.clear();
    location.search = '?fresh';
  };
  window.addEventListener('keydown', e => {
    if (e.target.closest('input, textarea')) return;
    if (e.key === 'q' || e.key === 'Q') rotate(-1);
    else if (e.key === 'e' || e.key === 'E') rotate(1);
    else if (e.key === ' ') { e.preventDefault(); togglePause(); }
    else if (e.key === 's' || e.key === 'S') cycleSpeed();
    else if (e.key === 'h' || e.key === 'H') toggleHistory();
    else if (e.key === '0') renderer.resetView();
    else if (e.key === '+' || e.key === '=') renderer.zoomAt(1.2, innerWidth / 2, innerHeight / 2);
    else if (e.key === '-') renderer.zoomAt(1 / 1.2, innerWidth / 2, innerHeight / 2);
    else if (e.key === 'Escape') { inspected = -1; watched = -1; renderer.selected = -1; renderer.follow = -1; updateInspect(); $('historyPanel').classList.add('hidden'); closeOverlay(); }
  });

  // Fade the interface when the pointer rests.
  let idleTimer;
  const wake = () => {
    document.body.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => document.body.classList.add('idle'), 6000);
  };
  ['pointermove', 'pointerdown', 'keydown', 'wheel'].forEach(t => window.addEventListener(t, wake, { passive: true }));
  wake();
}

// ---------- saving & visibility ----------

let lastSave = performance.now();
function persist() {
  if (catchingUp) return;
  store.save(world, settings);
  lastSave = performance.now();
}
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); persist(); }
  else if (hiddenAt) {
    const away = Date.now() - hiddenAt;
    hiddenAt = 0;
    if (!paused) catchUp(away);
  }
});
window.addEventListener('pagehide', persist);

// ---------- main loop ----------

let last = performance.now(), acc = 0, frameAcc = 0, hudAcc = 0, inspectAcc = 0;
function loop(now) {
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  if (!paused && !catchingUp) {
    acc += dt * GAME_MIN_PER_REAL_SEC * SPEEDS[settings.speed];
    const end = performance.now() + 9;
    while (acc >= 1 && performance.now() < end) { world.tick(); acc -= 1; }
    if (acc > 900) acc = 900;
  }
  frameAcc += dt;
  if (frameAcc >= 1 / 30) {
    renderer.alpha = paused ? 1 : Math.min(1, acc);
    renderer.frame(frameAcc);
    frameAcc = 0;
  }
  hudAcc += dt;
  if (hudAcc > 0.25) { updateHud(); hudAcc = 0; }
  inspectAcc += dt;
  if ((inspected >= 0 || watched >= 0) && inspectAcc > 0.5) { updateInspect(); inspectAcc = 0; }
  if (now - lastSave > 30000) persist();
  requestAnimationFrame(loop);
}

// ---------- start ----------

async function start() {
  const loaded = params.has('fresh') ? null : store.load();
  if (loaded) {
    world = loaded.world;
    settings = { ...settings, ...loaded.settings };
  } else {
    overlay('Shaping a new valley…', 'Carving the river and filling the lake.', null);
    await nextFrame();
    const seed = params.get('seed') ? Number(params.get('seed')) : (Math.random() * 2 ** 32) >>> 0;
    const now = new Date();
    world = World.create(seed, { minuteOfDay: now.getHours() * 60 + now.getMinutes() });
    closeOverlay();
    if (params.has('fresh')) history.replaceState(null, '', location.pathname);
  }
  renderer = new Renderer($('view'), world);
  renderer.rebuildMs = Math.max(1200, 30000 / SPEEDS[settings.speed || 0]);
  window.valley = { world, renderer }; // handy for poking around in the console
  if (settings.rot) renderer.setRotation(settings.rot);
  world.log.onAdd(() => renderLog());
  setupInput();
  updateHud();
  renderLog();
  addEventListener('resize', () => renderer.resize());
  requestAnimationFrame(t => { last = t; requestAnimationFrame(loop); });
  if (loaded) await catchUp(Date.now() - loaded.savedAt);
  persist();
}

start();
