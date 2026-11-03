// World-wide constants. One cell is roughly 2 m across, one voxel step is 1 m high.

export const N = 96;                 // the valley is N x N columns
export const MAX_H = 44;             // tallest possible terrain (voxels)
export const BASE_DEPTH = 3;         // how far the diorama base goes below height 0

// Calendar. Years are compressed so seasons are visible during a study session,
// but every rate in the simulation is expressed per real-feeling day or year.
export const MIN_PER_DAY = 1440;
export const DAYS_PER_SEASON = 7;
export const DAYS_PER_YEAR = DAYS_PER_SEASON * 4;
export const MIN_PER_YEAR = MIN_PER_DAY * DAYS_PER_YEAR;
export const SEASON_NAMES = ['Spring', 'Summer', 'Autumn', 'Winter'];

// Pace: at 1x, one real second is two game minutes (a day lasts 12 real minutes).
export const GAME_MIN_PER_REAL_SEC = 2;
export const SPEEDS = [1, 5, 30, 150];

// Catching up after the page was closed: exact simulation for the first week,
// then a cheaper daily approximation, up to a cap.
export const EXACT_CATCHUP_MIN = 7 * MIN_PER_DAY;
export const MAX_CATCHUP_DAYS = 2 * DAYS_PER_YEAR;

export const SAVE_KEY = 'svw.world.v1';
export const SAVE_VERSION = 1;
