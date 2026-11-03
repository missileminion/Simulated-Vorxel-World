# Quiet Valley

A small voxel valley that lives on its own. Leave it open while you study and glance over now and then: the river rises and falls, seasons turn, forests spread and burn, otters fish and raise pups, foxes hunt hares, deer graze, herons stalk the shallows. Nothing is scripted; everything follows from water, weather, soil and what each animal needs and has learned.

## Run it

It's plain HTML and ES modules, so any static server works:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000. GitHub Pages serves it as is.

## Controls

| | |
|---|---|
| Drag / scroll / pinch | Pan and zoom |
| Click an animal | See what it's doing, its needs, personality, skill and what it has learned; follow it |
| Click a block | Inspect it (water, soil, plants, fish) |
| Q / E | Rotate |
| Space | Pause |
| S | Speed (1×, 5×, 30×, 150×) |
| H | History of the valley |
| 0 | Reset the view |

At 1× a valley day lasts 12 minutes and a year (four 7-day seasons) about 5.5 hours. The world is saved in your browser. When you come back it catches up on the time you were away (exact for the first week, approximated after that, up to two years) and tells you what happened.

`?fresh` starts a new valley, `?seed=123` picks a specific one.

## What's simulated

- **Water:** river inflow from a hidden mountain catchment (rain and snowmelt feed groundwater, which releases slowly), rain and snow on the map, flow over terrain, soaking into soil, evaporation, ice, floods and droughts.
- **Erosion:** stream power moves sediment very slowly; beds armour as they deepen. Ordinary flow changes almost nothing, floods do most of the work, the lake slowly silts up.
- **Climate:** day/night with seasonal day length, temperature with altitude, hourly weather from seasonal odds, wind, and years that drift wetter/drier and warmer/colder.
- **Plants:** grass, reeds, berry shrubs, broadleaf trees and pines. They grow by water, warmth, light and soil fertility, seed nearby, drown in floods, die of drought or age, stand as dead trees and rot back into soil.
- **Fire:** lightning from storms and dry summer thunderheads, spreading with fuel, dryness and wind.
- **Fish:** a density per water cell that breeds in spring, moves to better habitat and dies when water dries, warms or freezes.

- **Animals:** otters, deer, hares, foxes and herons, each one an individual with a name, needs (hunger, energy, company, play, fear), an inherited personality (bold/shy, sociable/loner, curious/cautious, lazy/energetic), a memory of good and dangerous places, and a food-finding skill.
  - **Deciding:** every choice mixes instinct (needs weighted by personality) with a learned table of which choices paid off in which situations. Meeting needs is the reward; hunger, fear and pain are the punishment. Young animals explore more and learn faster; old ones are set in their ways.
  - **Learning from others:** pups inherit a little of their mother's habits, gain skill by watching adults catch fish, and are fed by their mothers until they can fend for themselves.
  - **Food web:** otters and herons eat fish (and herons the frogs and small life of the shallows), foxes catch hares and mice, deer and hares graze and browse saplings. Hares hide in burrows, foxes are territorial, deer browse twigs under snow, otters fish under ice.
  - **Life cycle:** seasonal mating, litters, growing up, old age, starvation, predation, fire. If a species dwindles, newcomers wander in from outside the valley.

## Files

- `index.html`, `style.css`: page and interface
- `js/world.js`: state and clock; `terrain.js`, `climate.js`, `hydrology.js`, `vegetation.js`, `fish.js`: the systems
- `js/species.js`, `js/animals.js`: animal traits, needs, decisions, learning, births and deaths; `js/creatures.js`: drawing them
- `js/render.js`, `js/palette.js`: isometric drawing, light and weather effects
- `js/store.js`: saving; `js/main.js`: loop, catch-up and controls
- `tools/headless.mjs`: runs the world without graphics for long stability checks (`node tools/headless.mjs 10`)
- `tools/animals.mjs`: the same for animal populations, skills and causes of death (`node tools/animals.mjs 5`)
