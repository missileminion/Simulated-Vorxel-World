// What goes on inside an animal's head.
//
// Moods change smoothly over time (small differential equations stepped each
// minute). Beliefs are counts of good and bad outcomes, read as probabilities.
// Thoughts are short, crude, cute sentences built from what the animal really
// feels, believes and is doing, in its species' own voice. They avoid repeating
// recent wording and pull in specifics (names, places, counts, weather) so they
// stay fresh.

import { N, MIN_PER_DAY, SEASON_NAMES } from './config.js';
import { clamp } from './rng.js';

const MAX_THOUGHTS = 8;
const RECENT = 18;

// ---------- voices ----------

const VOICE = {
  otter: {
    sound: ['eep!', 'chirp chirp', 'squee', 'mmm', 'wheee', 'hehe', 'brrbl', 'eek'],
    food: ['fish', 'fishies', 'crunchy fish', 'wiggly fish', 'slippy fish', 'fishy snacks'],
    body: ['paws', 'whiskers', 'belly', 'tail', 'toes', 'fur'],
    kinword: ['pups', 'family', 'otter pals', 'the gang'],
    skill: 'fishing',
  },
  deer: {
    sound: ['mm.', 'snf.', '...', 'hm.', 'mmh.'],
    food: ['grass', 'green bits', 'soft leafs', 'tender shoots', 'clover'],
    body: ['ears', 'hooves', 'nose', 'legs', 'tail'],
    kinword: ['fawn', 'herd', 'family'],
    skill: 'finding food',
  },
  rabbit: {
    sound: ['thump!', 'twitch.', 'sniff sniff', 'eep.', 'nose wiggle.'],
    food: ['clover', 'grass', 'green', 'yummy stalks', 'sweet shoots'],
    body: ['ears', 'feet', 'nose', 'whiskers', 'fluff'],
    kinword: ['babies', 'warren', 'hoppers'],
    skill: 'finding clover',
  },
  fox: {
    sound: ['heh.', 'hmm.', 'sniff sniff', 'yip!', 'hehe.'],
    food: ['mousies', 'squeakers', 'crunchy mice', 'snacks', 'hare'],
    body: ['paws', 'nose', 'tail', 'ears', 'fluffy tail'],
    kinword: ['kits', 'family'],
    skill: 'hunting',
  },
  heron: {
    sound: ['...', 'patience.', 'still.', 'hm.', 'krraak.'],
    food: ['froggies', 'little fish', 'slippy things', 'fish', 'silver ones'],
    body: ['legs', 'neck', 'beak', 'feathers', 'toes'],
    kinword: ['chicks', 'kin'],
    skill: 'fishing',
  },
};

// What each species calls the others. Each individual picks its own nickname once.
const NICKS = {
  otter: { fox: ['orange sneak', 'pointy-nose', 'sly one'], heron: ['stilt bird', 'long-legs', 'grey poker'], deer: ['tall leaf-eaters', 'big ears'], rabbit: ['jumpy ears', 'hoppers'], fish: ['fishies', 'silver wigglers'] },
  deer: { fox: ['the red shadow', 'orange sneak', 'that fox'], heron: ['tall bird', 'grey stick'], otter: ['river wigglers', 'splashy ones'], rabbit: ['little hoppers', 'small ears'] },
  rabbit: { fox: ['FOX', 'red teeth', 'orange danger', 'sneaky red'], heron: ['stick bird', 'pointy bird'], deer: ['big ones', 'tall friends'], otter: ['wet noodles', 'river ones'] },
  fox: { rabbit: ['bunnies', 'long-ears', 'hoppy snacks'], deer: ['big-hooves', 'tall kickers'], otter: ['water weasels', 'bitey swimmers'], heron: ['grey stick', 'fish bird'] },
  heron: { fox: ['the red one', 'the sly one'], otter: ['the thieves', 'splashers'], fish: ['the silver ones', 'little swimmers'], deer: ['tall walkers'], rabbit: ['ground ears'] },
};

// ---------- phrasebook ----------
// {food} {sound} {place} {hedge} {kin} {pred} {prey} {guard} {body} {count} {me}
// {time} {season} {kinword} {nick} {newplace} {skill}

const GENERAL = {
  hungry: ['belly rumbly. need {food}.', '{me} hungry. {food} where?', '{sound} tummy says {food} time.', 'so hungry. {food} {food} {food}.',
    'could eat a whole {place}.', '{food}. now pls.', 'empty belly. not fun.', 'think about {food}. only {food}.'],
  eat: ['nom nom {food}.', 'mmm {food}. good {food}.', '{sound} {food} so good.', 'chomp. chomp. happy.', '{food} at {place}. yes.',
    'tasty. more?', 'best {food} today.', 'munch munch.'],
  full: ['belly full. {sound}', 'too full to move. ok.', 'ate good. nap soon?', 'round belly. happy {me}.', 'no more {food}. ...ok one more.'],
  catch: ['got one! {sound}', 'GOT IT. {food}!', '{sound} caught {prey}!', 'fast {body} win. {food}!', 'yes yes yes. dinner.',
    '{prey} not fast enough. heh.', 'catch number {count}. good at this.'],
  miss: ['missed. {sound}', 'slippery {prey}... come back!', 'ugh. too slow.', '{prey} gone. rude.', 'almost! almost...',
    'next time. {hedge} next time.', '{prey} saw me. sneakier next time.'],
  missAngry: ['UGH. {prey} hate me.', 'why always miss?? {sound}', 'stupid wiggly {prey}.', 'tried {count} times. nothing.', '{prey} too smart today. grr.'],
  scared: ['{pred}!! {sound}', 'uh oh. {pred} near.', 'ears up. {pred} smell.', 'no no no. {pred}.', '{pred} at {place}. bad.',
    'heart go fast. {pred}.', 'stay still... {pred} looking...'],
  fire: ['hot smoke! bad!', 'fire! go go go!', 'sky orange. nose stings. run.', 'burning smell. away!'],
  flee: ['RUN.', 'go go go!', 'away away away!', 'run {me} run!', 'not today {pred}!', 'zoom.'],
  safe: ['phew. safe.', '{pred} gone. ok... ok.', 'hid good. {sound}', 'breathing again.', 'still alive. {sound}'],
  alarm: ['others running?? run too!', '{kin} scared. me scared.', 'everyone go! follow!', 'herd run. no question. run.'],
  hurt: ['ow. ow. {body} hurts.', 'ouch!! {sound}', '{body} bad now. limp.', 'hurt. not fun.', 'owie. {pred} mean.'],
  healed: ['{body} better now.', 'no more ouch. {sound}', 'feel strong again.'],
  fightWin: ['go away {pred}! {sound}', 'kicked {pred}. ha!', '{me} strong. {pred} run.', 'not MY {kinword}!', 'and STAY away.'],
  fightLose: ['{pred} too strong. owie.', 'lost. ow.', 'bad idea. ow.'],
  defend: ['leave {kin} alone!!', '{pred} near {kin}. NO.', 'protect {kin}!', 'mama mad now.'],
  skipHunt: ['{prey}... but {guard} close. nope.', 'tasty {prey}. big {guard} tho. not worth.', '{hedge} catch. but get kicked. skip.',
    'hmm. {prey} has friends. {food} instead.', 'remember last kick. no thanks.'],
  hunt: ['{prey} alone. now.', 'sneak... sneak... {prey}.', 'hungry enough. go for {prey}.', '{prey} looks slow. {hedge} easy.', 'pounce time.'],
  tired: ['eyes heavy.', 'yawwwn.', '{body} tired. sleep?', 'so sleepy. {sound}', 'need nap. now.'],
  sleep: ['zzz', 'zz... {food}... zz', 'curl up. warm.', 'sleepy spot at {place}.', 'night night {kin}.', 'dream of {food}.'],
  wake: ['awake! {sound}', 'stretch {body}. new day.', 'morning. {food}?', '{time} already. ok.', 'up up. what today?'],
  lonely: ['where {kin}?', 'lonely. {sound}', 'miss {kinword}.', 'want friend. any friend.', 'too quiet here.'],
  friend: ['{kin}! {sound}', 'found {kin}. good.', 'cuddle {kin}.', '{kin} smells nice. stay close.', 'sit with {kin}. warm.'],
  mom: ['mama! {sound}', 'stay close to mama.', 'mama catch {food}! me learn.', 'watch mama. copy mama.', 'mama big. mama know.'],
  learn: ['oh! THAT is how.', 'mama dive, mama get {food}. me try!', 'watch... remember...', 'big ones do it like that. hmm.'],
  kid: ['where {kin}? ok there.', '{kin} so small. watch {kin}.', 'my babies. {sound}', '{kin} wobbly. cute.'],
  born: ['babies!! {sound}', 'tiny {kinword}. mine.', 'new little ones. must feed.'],
  bored: ['boring.', 'same same same.', 'nothing happens. {sound}', 'want something new.', '{place} again? meh.'],
  explore: ['what over there?', 'new place! {sound}', 'sniff sniff. never been here.', 'adventure time.', 'go see far away.'],
  discover: ['new place: {newplace}. remember.', 'found {newplace}. good {food}?', 'call this {newplace}. good name.', '{newplace}. me found it first.'],
  play: ['wheee!', 'splash splash!', 'roll roll roll.', 'chase own tail. heh.', 'play play play!', 'slide! again! again!'],
  cold: ['brr. {body} cold.', 'cold cold cold.', 'snow on {body}. no like.', 'need warm spot.'],
  hot: ['too hot. {sound}', 'hot. find shade.', 'pant pant.'],
  rain: ['wet. {sound}', 'rain on {body}.', 'drip drip.', 'rain. good for {food}?'],
  snow: ['white stuff again.', 'snow! {sound}', 'cold white everywhere.'],
  storm: ['sky angry. hide.', 'BOOM?! scary sky.', 'loud sky. stay low.'],
  night: ['dark now. careful.', 'moon up. {sound}', 'night smells different.'],
  grief: ['{kin}... gone.', 'miss {kin}.', '{kin} not come back. sad.', 'quiet without {kin}.'],
  season: ['air smells like {season}.', '{season} now. {sound}', '{season} again. remember last one.'],
  beliefPred: ['{pred} bad. {hedge}.', '{pred} dangerous? {hedge}.', 'stay away from {pred}. {hedge} smart.', 'think about {pred}. shiver.'],
  beliefPrey: ['catching {prey}: {hedge} works.', '{prey} getting smarter? {hedge}.', '{prey} easy? {hedge}.', 'next {prey} mine. {hedge}.'],
  beliefPlace: ['{place} good for {food}. {hedge}.', 'remember {place}. {food} there before.', '{place}... go back soon.', 'dream about {place}.'],
  beliefSkill: ['me good at {skill} now. {sound}', 'getting better at {skill}.', '{skill}? still learning.', 'old {me} knows {skill}.'],
  musing: ['why {nick} stand so still?', 'where water go?', 'sky has holes at night.', '{nick} weird.', 'what is fire? hot flower?',
    'water always go down. why?', 'moon follow me.', 'bugs. so many bugs.', 'clouds look like {food}.'],
};

// Some topics get extra lines in a species' own manner.
const SPECIAL = {
  otter: {
    eat: ['crunch crunch, fish head best part.', 'eat on back. belly is table.'],
    play: ['slide down mud! WHEEE!', 'juggle pebble. very skill.', 'float. spin. float.'],
    sleep: ['hold paws with {kin}. no float away.', 'float on back. sleepy.'],
    hungry: ['dive time. fishies hide.', 'smell fish. close. very close.'],
  },
  deer: {
    eat: ['chew. chew. look up. chew.', 'soft {food}. mm.'],
    scared: ['ears turn. something there.', 'stamp hoof. warn herd.'],
    musing: ['grass taller over there. always.'],
  },
  rabbit: {
    eat: ['eat. look. eat. look.', 'nibble nibble. ears up.', 'quick quick eat.'],
    scared: ['FREEZE.', 'thump thump! danger!'],
    sleep: ['burrow safe. burrow good.'],
    hungry: ['clover. clover. clover?'],
  },
  fox: {
    catch: ['heh. too slow.', 'snack acquired.', 'clever fox. fed fox.'],
    hungry: ['sniff sniff. mousie under there.', 'listen... squeak... there.'],
    eat: ['pounce! got squeaker.', 'crunchy. heh.'],
    play: ['pounce on leaf. leaf lose.'],
  },
  heron: {
    hungry: ['patience. {food} will come.', 'stand. wait. strike.', 'the water owes me {food}.'],
    catch: ['strike. {food}.', 'as foreseen.', 'the silver one is mine.'],
    miss: ['...the water mocks me.', 'patience. again.'],
    eat: ['swallow whole. dignified.'],
    musing: ['the sky is a lake too.', 'all things move. not me.'],
    season: ['the wind turns. time to go.', 'south. the old way.', 'home again. the water remembers me.'],
  },
};

const POSITIVE = new Set(['eat', 'full', 'catch', 'play', 'friend', 'mom', 'kid', 'wake', 'explore', 'discover', 'safe', 'healed', 'fightWin', 'born', 'learn', 'beliefSkill', 'beliefPlace', 'musing']);

const MOOD_PREFIX = {
  happy: ['{sound} ', '', '', 'yay. '],
  frustrated: ['ugh. ', 'grr. ', 'hmph. '],
  scared: ['eek. ', '', 'uh. '],
  grief: ['... ', ''],
  bored: ['meh. ', ''],
};

// ---------- mind state ----------

export function newMind(w, a) {
  const nick = {};
  const table = NICKS[a.sp] || {};
  for (const sp in table) nick[sp] = table[sp][w.rng.int(table[sp].length)];
  return {
    happy: 0.55, bored: 0.2, frustrated: 0, confident: 0.4, grief: 0, griefFor: '',
    b: {},                // beliefs: key -> [good, bad] counts
    nick,
    thoughts: [],
    recent: [],
    last: -1e9,
    nextIdle: w.minute + 60 + w.rng.int(120),
    tries: 0,
  };
}

// Beliefs: Beta counts read as a probability.
export function belief(a, key, prior = [1, 1]) {
  const v = a.mind.b[key] || prior;
  return v[0] / (v[0] + v[1]);
}
export function learn(a, key, good, prior = [1, 1]) {
  const v = a.mind.b[key] || (a.mind.b[key] = prior.slice());
  if (good) v[0]++; else v[1]++;
  // Old evidence fades so beliefs can change.
  const n = v[0] + v[1];
  if (n > 30) { v[0] *= 30 / n; v[1] *= 30 / n; }
}

export function hedge(p) {
  if (p > 0.85) return 'for sure';
  if (p > 0.65) return "prob'ly";
  if (p > 0.45) return 'maybe';
  if (p > 0.25) return 'dunno';
  return 'nope';
}

// Mood dynamics, one minute at a time.
export function stepMood(a, ctx) {
  const m = a.mind;
  const base = 0.5 + 0.25 * (a.condition - 0.5) - 0.3 * m.grief - 0.25 * Math.max(0, a.hunger - 0.5) - 0.2 * a.fear;
  m.happy = clamp(m.happy + 0.06 * ctx.reward - 0.004 * (m.happy - base), 0, 1);
  m.bored = clamp(m.bored + (ctx.same ? 0.0011 : -0.002) - (ctx.novel ? 0.25 : 0) - (a.pose === 'play' ? 0.01 : 0), 0, 1);
  m.frustrated = clamp(m.frustrated - 0.003 * m.frustrated, 0, 1);
  m.grief = Math.max(0, m.grief - 0.0004 * m.grief - 0.00002);
  const target = 0.5 * a.skill + 0.3 * a.health + 0.2 * m.happy;
  m.confident = clamp(m.confident + 0.01 * (target - m.confident), 0, 1);
}

// ---------- making a thought ----------

function pick(rng, arr) { return arr[rng.int(arr.length)]; }

function countWord(n) {
  if (n <= 1) return 'one';
  if (n === 2) return 'two';
  if (n === 3) return 'three';
  if (n < 7) return 'lots';
  return 'so many';
}

function timeWord(hour) {
  if (hour < 5) return 'deep night';
  if (hour < 8) return 'sunrise';
  if (hour < 12) return 'morning';
  if (hour < 17) return 'sunny time';
  if (hour < 20) return 'evening';
  return 'night';
}

// Invent a name for a place from what it is like.
export function namePlace(w, a, i, kind) {
  const rng = w.rng;
  const adj = [];
  const wa = w.water[i];
  if (wa > 1.5) adj.push('deep', 'big wet', 'dark');
  else if (wa > 0.25) adj.push('splashy', 'wet', 'wiggly');
  if (w.reed[i] > 0.4) adj.push('reedy', 'whispery', 'tickly');
  if (w.fish[i] > 0.4) adj.push('fishy', 'yummy');
  if (w.warm[i] > 2) adj.push('warm', 'steamy');
  if (w.snow[i] > 0.02) adj.push('cold', 'white');
  if (w.tree[i] >= 1 && w.tree[i] <= 3) adj.push('shady', 'leafy');
  if (w.grass[i] > 0.6 && wa < 0.05) adj.push('soft', 'green', 'tasty');
  if (w.terrain[i] > 24) adj.push('high', 'windy');
  if (w.material[i] === 0 || w.material[i] === 1) adj.push('rocky', 'pebbly');
  if (w.burn[i] > 0.3) adj.push('burny', 'black');
  if (kind === 'danger') adj.push('scary', 'bad', 'stinky');
  if (!adj.length) adj.push('quiet', 'plain', 'that');
  const noun = wa > 0.25 ? ['pool', 'wet', 'splash place', 'water', 'puddle'] : wa > 0.02 ? ['muddy bit', 'squelch', 'bank'] :
    w.tree[i] ? ['trees', 'leaf place', 'bushes'] : w.terrain[i] > 24 ? ['hill', 'top', 'rocks'] : ['patch', 'spot', 'place', 'grass'];
  let name = `${pick(rng, adj)} ${pick(rng, noun)}`;
  if (kind === 'danger' && a.lastThreat && rng.chance(0.5)) name = `${a.lastThreat} ${pick(rng, ['place', 'spot', 'corner'])}`;
  return name;
}

function placeWord(w, a) {
  const named = a.memory.filter(m => m.name);
  if (named.length && w.rng.chance(0.8)) {
    // Prefer the nearest named place.
    named.sort((p, q) => Math.hypot((p.i % N) - a.x, ((p.i / N) | 0) - a.y) - Math.hypot((q.i % N) - a.x, ((q.i / N) | 0) - a.y));
    return named[0].name;
  }
  return pick(w.rng, ['here', 'this place', 'over there', 'this spot', 'right here']);
}

export function think(w, a, topic, ctx = {}, importance = 1) {
  const m = a.mind;
  if (!m) return;
  const rng = w.rng;
  if (importance < 2) {
    if (w.minute - m.last < 25 + rng.int(35)) return;
    if (!rng.chance(importance >= 1 ? 0.7 : 0.35)) return;
  } else if (w.minute - m.last < 3) return;

  const V = VOICE[a.sp];
  const pool = [];
  (GENERAL[topic] || []).forEach((t, k) => pool.push({ t, key: `${topic}:${k}` }));
  ((SPECIAL[a.sp] || {})[topic] || []).forEach((t, k) => pool.push({ t, key: `${topic}:s${k}` }));
  if (!pool.length) return;
  const globalKeys = w.recentKeys || (w.recentKeys = []);
  const fresh = pool.filter(p => !m.recent.includes(p.key) && !globalKeys.includes(a.sp + p.key));
  const choices = fresh.length ? fresh : pool;

  const kinName = ctx.kin || pick(rng, V.kinword);
  const slots = {
    food: () => ctx.food || pick(rng, V.food),
    sound: () => pick(rng, V.sound),
    place: () => ctx.place || placeWord(w, a),
    newplace: () => ctx.newplace || placeWord(w, a),
    hedge: () => hedge(ctx.p ?? 0.5),
    kin: () => kinName,
    kinword: () => pick(rng, V.kinword),
    pred: () => ctx.pred || 'something',
    prey: () => ctx.prey || pick(rng, V.food),
    guard: () => ctx.guard || 'grown-up',
    body: () => pick(rng, V.body),
    count: () => countWord(ctx.count ?? 2),
    me: () => (rng.chance(0.35) ? a.name : 'me'),
    time: () => timeWord(w.cal.hour),
    season: () => SEASON_NAMES[w.cal.season].toLowerCase(),
    nick: () => { const vals = Object.values(m.nick); return vals.length ? pick(rng, vals) : 'others'; },
    skill: () => V.skill,
  };

  let text = '', key = '';
  for (let tries = 0; tries < 4; tries++) {
    const c = pick(rng, choices);
    key = c.key;
    text = c.t.replace(/\{(\w+)\}/g, (_, s) => (slots[s] ? slots[s]() : s));
    let moodKey = m.grief > 0.4 ? 'grief' : m.frustrated > 0.5 ? 'frustrated' : a.fear > 0.4 ? 'scared' : m.bored > 0.6 ? 'bored' : m.happy > 0.7 ? 'happy' : null;
    // Only colour a thought with a mood that fits it.
    if (moodKey === 'happy' && !POSITIVE.has(topic)) moodKey = null;
    if ((moodKey === 'frustrated' || moodKey === 'bored') && POSITIVE.has(topic)) moodKey = null;
    if (moodKey && rng.chance(0.35) && !text.startsWith('{')) {
      const pre = pick(rng, MOOD_PREFIX[moodKey]).replace('{sound}', pick(rng, V.sound));
      if (pre && !text.toLowerCase().startsWith(pre.trim().toLowerCase())) text = pre + text;
    }
    // Hares say things twice when nervous; herons trail off.
    if (a.sp === 'rabbit' && a.fear > 0.3 && rng.chance(0.4)) text = text.replace(/^(\w+)/, '$1 $1');
    if (a.sp === 'heron' && rng.chance(0.25) && !text.endsWith('...')) text = text.replace(/[.!?]?$/, '...');
    const seen = w.recentThoughts || (w.recentThoughts = []);
    if (!seen.includes(text)) { seen.push(text); if (seen.length > 60) seen.shift(); break; }
  }
  m.recent.push(key);
  if (m.recent.length > RECENT) m.recent.shift();
  globalKeys.push(a.sp + key);
  if (globalKeys.length > 12) globalKeys.shift();
  m.thoughts.push({ t: w.minute, text, topic });
  if (m.thoughts.length > MAX_THOUGHTS) m.thoughts.shift();
  m.last = w.minute;
}

// Something to think about when nothing in particular is happening.
export function idleThought(w, a) {
  const m = a.mind, c = w.climate, rng = w.rng;
  m.nextIdle = w.minute + 90 + rng.int(200);
  const opts = [];
  if (a.hunger > 0.6) opts.push(['hungry', {}]);
  if (a.energy < 0.25) opts.push(['tired', {}]);
  if (a.lonely > 0.7) opts.push(['lonely', {}]);
  if (m.bored > 0.6) opts.push(['bored', {}]);
  if (m.grief > 0.3) opts.push(['grief', { kin: m.griefFor }]);
  const temp = c.temp;
  if (temp < -3) opts.push(['cold', {}]);
  if (temp > 25) opts.push(['hot', {}]);
  if (c.weather === 'storm') opts.push(['storm', {}]);
  else if (c.precip > 0) opts.push([temp < 0.5 ? 'snow' : 'rain', {}]);
  if (c.elev < -0.05 && rng.chance(0.4)) opts.push(['night', {}]);
  // Speak a belief.
  const keys = Object.keys(m.b);
  if (keys.length && rng.chance(0.5)) {
    const k = pick(rng, keys);
    const [kind, what] = k.split(':');
    const p = belief(a, k);
    if (kind === 'fear') opts.push(['beliefPred', { pred: m.nick[what] || what, p }]);
    else if (kind === 'hunt') opts.push(['beliefPrey', { prey: m.nick[what] || what, p }]);
  }
  const fav = a.memory.filter(mm => mm.name && mm.kind === 'food');
  if (fav.length) { const f = pick(rng, fav); opts.push(['beliefPlace', { place: f.name, p: clamp(f.v, 0, 1) }]); }
  if (a.skill > 0.6 || (a.skill < 0.3 && rng.chance(0.3))) opts.push(['beliefSkill', {}]);
  if (a.traits.curious > 0.5 || rng.chance(0.15)) opts.push(['musing', {}]);
  if (!opts.length) opts.push([a.action === 1 ? 'sleep' : 'explore', {}]);
  const [topic, ctx] = pick(rng, opts);
  think(w, a, topic, ctx, 1);
}

export function timeAgo(minutes) {
  if (minutes < 20) return 'just now';
  if (minutes < 90) return `${Math.round(minutes / 10) * 10} min ago`;
  if (minutes < MIN_PER_DAY) return `${Math.round(minutes / 60)} h ago`;
  return `${Math.round(minutes / MIN_PER_DAY)} d ago`;
}
