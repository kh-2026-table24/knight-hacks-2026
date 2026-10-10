// Recorded sounds, shared by every game. Files are in public/sfx/<name>-<n>.ogg; each play picks one
// of the n variations so repeated sounds (footsteps above all) don't sound mechanical.
// All from Kenney's CC0 packs (public/sfx/LICENSE-kenney.txt).
export const SOUND_VARIATIONS = {
  "footstep-concrete": 5,
  "footstep-wood": 5,
  "footstep-grass": 5,
  "footstep-carpet": 5,
  "footstep-snow": 5,
  "door-open": 2,
  "door-close": 4,
  "door-locked": 1,
  unlock: 1,
  creak: 3,
  pickup: 2,
  "key-pickup": 3,
  hurt: 5,
  dialogue: 3,
  page: 3,
  drop: 1,
  glass: 3,
  thud: 3,
} as const;

export type SoundName = keyof typeof SOUND_VARIATIONS;

export const soundUrls = (name: SoundName) =>
  Array.from({ length: SOUND_VARIATIONS[name] }, (_, i) => `/sfx/${name}-${i}.ogg`);

export type FloorSound = "concrete" | "wood" | "grass" | "carpet" | "snow";

// Checked in order, so "wooden boards over damp stone" counts as wood.
const FLOOR_WORDS: [FloorSound, RegExp][] = [
  ["carpet", /carpet|rug|velvet|fabric|cloth|mat\b/],
  ["wood", /wood|plank|board|timber|parquet|oak|pine|deck/],
  ["snow", /snow|ice|frost/],
  ["grass", /grass|lawn|moss|dirt|earth|soil|mud|leaves|leaf|garden|meadow|field|turf|hay|straw/],
  ["concrete", /stone|flag|cobble|brick|concrete|marble|tile|slate|granite|rock|metal|iron/],
];

/** Which footsteps fit a floor, from its description, or `fallback` if nothing in it says. */
export function floorSoundFor(description: string | undefined, fallback: FloorSound = "concrete"): FloorSound {
  const text = description?.toLowerCase() ?? "";
  return FLOOR_WORDS.find(([, words]) => words.test(text))?.[0] ?? fallback;
}
