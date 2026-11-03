// What each kind of animal is like. Rates are per game minute.
// Learning and personality sit on top of these instincts (see animals.js).

export const ACTIONS = ['eat', 'rest', 'social', 'explore', 'flee', 'play'];
export const A = { EAT: 0, REST: 1, SOCIAL: 2, EXPLORE: 3, FLEE: 4, PLAY: 5 };

export const SPECIES = {
  otter: {
    strength: 0.5,
    label: 'otter', plural: 'otters',
    diet: 'fish', swim: true, wade: 99, climb: 2.2,
    speed: 12, swimSpeed: 22, runSpeed: 45,        // cells (2 m) per minute
    sense: 8, lifespan: 10, adult: 1,
    hunger: 1 / 520, tire: 1 / 950, lonely: 1 / 900, playful: 1 / 650,
    activity: 'dusk',
    mate: { season: 0, days: [0, 3], gestation: 2, litter: [1, 3] },
    cap: 10, start: 6,
    predators: [], youngPredators: ['fox'],
    named: true,
  },
  deer: {
    strength: 0.8,
    label: 'deer', plural: 'deer',
    diet: 'graze', swim: false, wade: 0.45, climb: 2.6,
    speed: 14, swimSpeed: 4, runSpeed: 70,
    sense: 9, lifespan: 12, adult: 1.5,
    hunger: 1 / 700, tire: 1 / 1100, lonely: 1 / 1300, playful: 1 / 2000,
    activity: 'dusk',
    mate: { season: 2, days: [2, 6], gestation: 12, litter: [1, 1] },
    cap: 16, start: 8,
    predators: [], youngPredators: ['fox'],
  },
  rabbit: {
    strength: 0.12,
    label: 'hare', plural: 'hares',
    diet: 'graze', swim: false, wade: 0.12, climb: 1.6,
    speed: 8, swimSpeed: 1, runSpeed: 80,
    sense: 6, lifespan: 4, adult: 0.3,
    hunger: 1 / 480, tire: 1 / 900, lonely: 1 / 2400, playful: 1 / 2500,
    activity: 'dusk',
    mate: { season: [0, 1], days: [0, 5], gestation: 1, litter: [2, 4] },
    cap: 34, start: 16,
    predators: ['fox'], youngPredators: ['fox'],
  },
  fox: {
    strength: 0.45,
    label: 'fox', plural: 'foxes',
    diet: 'hunt', swim: false, wade: 0.25, climb: 2.2,
    speed: 14, swimSpeed: 3, runSpeed: 75,
    sense: 9, lifespan: 7, adult: 0.8,
    hunger: 1 / 800, tire: 1 / 1000, lonely: 1 / 4000, playful: 1 / 2200,
    activity: 'night',
    mate: { season: 0, days: [0, 3], gestation: 2, litter: [2, 4] },
    cap: 4, start: 2,
    predators: [], youngPredators: [],
  },
  heron: {
    strength: 0.35,
    label: 'heron', plural: 'herons',
    diet: 'wade', swim: false, wade: 0.55, climb: 99,
    speed: 3, swimSpeed: 2, runSpeed: 120, fly: true,
    sense: 11, lifespan: 15, adult: 1,
    hunger: 1 / 700, tire: 1 / 1000, lonely: 1 / 6000, playful: 1 / 9000,
    activity: 'day',
    mate: { season: 0, days: [0, 3], gestation: 2, litter: [1, 3] },
    cap: 6, start: 3,
    predators: [], youngPredators: [],
  },
};

export const SPECIES_KEYS = Object.keys(SPECIES);

// How sleepy a species is at a given hour, 0..1.
export function sleepiness(activity, hour) {
  const near = (h, c, w) => Math.max(0, 1 - Math.min(Math.abs(h - c), 24 - Math.abs(h - c)) / w);
  if (activity === 'day') return Math.max(near(hour, 1, 6), 0);
  if (activity === 'night') return near(hour, 13, 5);
  // crepuscular: rest in the middle of the day and the dead of night
  return Math.max(near(hour, 13, 3.5) * 0.8, near(hour, 2, 3.5));
}

const NAMES = ['Pip', 'Moss', 'Fern', 'Wren', 'Bram', 'Hazel', 'Sloe', 'Tansy', 'Rush', 'Alder', 'Pebble', 'Burr',
  'Clover', 'Dace', 'Elder', 'Flint', 'Gorse', 'Heath', 'Juniper', 'Kestrel', 'Linnet', 'Marsh', 'Nettle', 'Oak',
  'Pike', 'Quill', 'Reed', 'Sorrel', 'Thistle', 'Umber', 'Vetch', 'Willow', 'Yarrow', 'Bracken', 'Cress', 'Dusk',
  'Ember', 'Fable', 'Glen', 'Holly', 'Iris', 'Kelp', 'Larch', 'Mallow', 'Nook', 'Otto', 'Pinecone', 'Rowan',
  'Sedge', 'Teal', 'Wisp', 'Brook', 'Ripple', 'Sable', 'Tumble', 'Whisker', 'Muddle', 'Paddle', 'Splash', 'Drift'];

export function pickName(rng, taken) {
  for (let k = 0; k < 20; k++) {
    const n = NAMES[rng.int(NAMES.length)];
    if (!taken.has(n)) return n;
  }
  return NAMES[rng.int(NAMES.length)] + ' ' + ['the Younger', 'II', 'of the Reeds', 'of the Lake'][rng.int(4)];
}
