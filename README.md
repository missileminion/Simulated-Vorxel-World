# Quiet Valley

A small voxel valley that lives on its own. Leave it open while you study and glance over now and then: the river rises and falls, seasons turn, forests spread and burn, otters chase fish schools and raise pups, foxes hunt hares (when it's worth the risk), deer graze and defend their fawns, herons stalk the shallows and fly south for the winter. Zoom in and you can read what they're thinking. Nothing is scripted; everything follows from water, weather, soil and what each animal needs and has learned.

## Run it

It's plain HTML and ES modules, so any static server works:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000. GitHub Pages serves it as is.

## Looking closer

Zoomed out you see the whole valley from a cached image. Zoom in and the part in view is redrawn at screen resolution, with block textures, grass tufts, wildflowers, pebbles and stone strata fading in. Animals behind hills are hidden by the land in front of them. Thought bubbles show a couple at a time from afar and more when you zoom in; click an animal to always see its latest thought.

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

The valley is 160×160 blocks. At 1× a valley day lasts 12 minutes and a year (four 7-day seasons) about 5.5 hours. The world is saved in your browser. When you come back it catches up on the time you were away (exact for the first three valley days, approximated after that, up to two years) and tells you what happened.

`?fresh` starts a new valley, `?seed=123` picks a specific one.

## What's simulated

- **Water:** river inflow from a hidden mountain catchment (rain and snowmelt feed groundwater, which releases slowly), rain and snow on the map, flow over terrain, soaking into soil, evaporation, ice, floods and droughts.
- **Erosion:** stream power moves sediment very slowly; beds armour as they deepen. Ordinary flow changes almost nothing, floods do most of the work, the lake slowly silts up.
- **Moon:** phases about every 2.4 valley days (the calendar is squeezed about 13x), rising and setting like the real one. Bright nights light the valley; prey hide and watch harder, foxes hunt better, herons fish; on dark nights fish are easier to sneak up on.
- **Climate:** day/night with seasonal day length, temperature with altitude, hourly weather from seasonal odds, wind, and years that drift wetter/drier and warmer/colder.
- **Plants:** grass, reeds, berry shrubs, broadleaf trees and pines. They grow by water, warmth, light and soil fertility, seed nearby, drown in floods, die of drought or age, stand as dead trees and rot back into soil.
- **Fire:** lightning from storms and dry summer thunderheads, spreading with fuel, dryness and wind.
- **Fish:** a density per water cell that breeds in spring, moves to better habitat and dies when water dries, warms or freezes.

- **Fish:** schools that feed, flee and scatter, hide in reeds and deep water, avoid spots where they were attacked, grow warier with each attack, go sluggish in cold water, run upstream to spawn and split or merge. Newcomers swim down from upstream.
- **Minds:** every animal has moods that rise and fade over time (happy, bored, frustrated, confident, grieving), beliefs kept as counts of good and bad outcomes ("foxes are dangerous: prob'ly"), its own nicknames for other species and names for places it remembers ("tickly wet", "fox corner"). Short thoughts in each species' voice come from what it actually feels, believes and does, and avoid repeating recent wording.
- **Saving energy:** when fed and safe, animals lie low instead of wandering; they shelter from rain, storms and midday heat. Hunger overrides it all. Wasted energy counts as a small cost in what they learn.
- **Risk and fights:** a fox estimates its chance of a catch against its chance of getting kicked (more guardians, more risk; more hunger, more daring). Prey kick back, parents defend their young, herds raise the alarm together. Wounds slow animals down and heal over time.
- **Animals:** otters, deer, hares, foxes and herons, each one an individual with a name, needs (hunger, energy, company, play, fear), an inherited personality (bold/shy, sociable/loner, curious/cautious, lazy/energetic), a memory of good and dangerous places, and a food-finding skill.
  - **Deciding:** every choice mixes instinct (needs weighted by personality) with a learned table of which choices paid off in which situations. Meeting needs is the reward; hunger, fear and pain are the punishment. Young animals explore more and learn faster; old ones are set in their ways.
  - **Learning from others:** pups inherit a little of their mother's habits, gain skill by watching adults catch fish, and are fed by their mothers until they can fend for themselves.
  - **Food web:** otters and herons eat fish (and herons the frogs and small life of the shallows), foxes catch hares and mice, deer and hares graze and browse saplings. Hares hide in burrows, foxes are territorial, deer browse twigs under snow, otters fish under ice.
  - **Life cycle:** seasonal mating, litters, growing up, old age, starvation, predation, fire. If a species dwindles, newcomers wander in from outside the valley.

## Files

- `index.html`, `style.css`: page and interface
- `js/world.js`: state and clock; `terrain.js`, `climate.js`, `hydrology.js`, `vegetation.js`, `fish.js`: the systems
- `js/species.js`, `js/animals.js`: animal traits, needs, decisions, learning, fights, births and deaths; `js/mind.js`: moods, beliefs, names and thoughts; `js/fish.js`: fish schools; `js/creatures.js`: voxel models, fish shadows and thought bubbles
- `js/render.js`, `js/palette.js`: isometric drawing, light and weather effects
- `js/store.js`: saving; `js/main.js`: loop, catch-up and controls
- `tools/headless.mjs`: runs the world without graphics for long stability checks (`node tools/headless.mjs 10`)
- `tools/animals.mjs`: the same for animal populations, skills and causes of death (`node tools/animals.mjs 5`)
