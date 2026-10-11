import type { Scream } from "./spec";

// Checked in order, so "drowned woman" screams through water and "little girl" is a child, not a woman.
const WORDS: [Scream, RegExp][] = [
  ["vermin", /\brats?\b|mouse|mice|\bbats?\b|spider|insect|crow|raven|vermin|maggot|swarm/],
  ["beast", /hound|\bdogs?\b|wolf|wolves|\bbears?\b|\bboars?\b|beast|panther|\bcats?\b|\bhorses?\b|\bgoats?\b/],
  ["drowned", /drown|\bsea\b|water|weed|soaked|sodden|dripping|brine|kelp|tide/],
  ["child", /child|\bgirl|\bboy\b|infant|baby|toddler|little one/],
  ["woman", /woman|women|lady|\bnun\b|bride|widow|mother|wife|maid|witch|crone|nightgown|\bshe\b|\bher\b/],
  ["man", /\bman\b|\bmen\b|keeper|caretaker|monk|priest|soldier|butler|father|husband|\bhe\b|\bhis\b/],
];

/** Which voice a character's description suggests ("pale ghost woman in a nightgown" → woman); anything unrecognisable is a creature. */
export function guessScream(description: string): Scream {
  const text = description.toLowerCase();
  return WORDS.find(([, words]) => words.test(text))?.[0] ?? "creature";
}
