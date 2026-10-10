import type { Footsteps } from "./spec";

// Checked in order, so "wooden boards over damp stone" counts as wood.
const WORDS: [Footsteps, RegExp][] = [
  ["carpet", /carpet|rug|velvet|fabric|cloth|\bmat\b/],
  ["wood", /wood|plank|board|timber|parquet|oak|pine|deck/],
  ["snow", /snow|ice|frost/],
  ["grass", /grass|lawn|moss|dirt|earth|soil|mud|leaves|leaf|garden|meadow|field|turf|hay|straw/],
  ["stone", /stone|flag|cobble|brick|concrete|marble|tile|slate|granite|rock|metal|iron/],
];

/** Which footsteps a material description suggests ("dark rotting floorboards" → wood), or `fallback` if it doesn't say. */
export function guessFootsteps(description: string, fallback: Footsteps = "stone"): Footsteps {
  const text = description.toLowerCase();
  return WORDS.find(([, words]) => words.test(text))?.[0] ?? fallback;
}
