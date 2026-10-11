import { hash, slug } from "./art";
import type { CharacterSpec, GameSpec } from "./spec";

// A hostile character's scream is described in its spec and generated as a sound while the game is
// painted (server/screams.ts), with an id derived from the description the way art ids are, so the server
// and the client agree on it. Until it's made, or if it can't be, the scare uses one of a few recorded
// voices (public/audio/screams/, made by scripts/gen-screams.ts), picked from the description.

/** woman, man, child: a human voice. creature: inhuman, demonic. beast: a large animal. vermin: rats, bats, small things. drowned: through water. */
export const SCREAM_VOICES = ["woman", "man", "child", "creature", "beast", "vermin", "drowned"] as const;
export type ScreamVoice = (typeof SCREAM_VOICES)[number];

export interface ScreamJob {
  id: string;
  /** What screams and how, from the spec. */
  prompt: string;
  /** The recorded voice to use while this one isn't made. */
  voice: ScreamVoice;
}

/** The scream of a hostile character, or undefined if it doesn't scream. */
export function screamFor(character: Pick<CharacterSpec, "scream" | "art" | "name">): ScreamJob | undefined {
  if (!character.scream) return undefined;
  const prompt = character.scream;
  return { id: `scream-${slug(prompt)}-${hash(`scream|${prompt}`)}`, prompt, voice: guessVoice(`${prompt} ${character.art.description} ${character.name}`) };
}

/** Every scream a game needs, by id, in room order. */
export function collectScreams(spec: Pick<GameSpec, "rooms">): Map<string, ScreamJob> {
  const jobs = new Map<string, ScreamJob>();
  for (const room of spec.rooms) {
    for (const character of room.characters) {
      const job = screamFor(character);
      if (job) jobs.set(job.id, job);
    }
  }
  return jobs;
}

export const isScreamId = (id: string) => id.startsWith("scream-");

// Checked in order, so "drowned woman" screams through water and "little girl" is a child, not a woman.
const WORDS: [ScreamVoice, RegExp][] = [
  ["vermin", /\brats?\b|mouse|mice|\bbats?\b|spider|insect|crow|raven|vermin|maggot|swarm/],
  ["beast", /hound|\bdogs?\b|wolf|wolves|\bbears?\b|\bboars?\b|beast|panther|\bcats?\b|\bhorses?\b|\bgoats?\b/],
  ["drowned", /drown|\bsea\b|water|weed|soaked|sodden|dripping|brine|kelp|tide/],
  ["child", /child|\bgirl|\bboy\b|infant|baby|toddler|little one/],
  ["woman", /woman|women|lady|\bnun\b|bride|widow|mother|wife|maid|witch|crone|nightgown|\bshe\b|\bher\b/],
  ["man", /\bman\b|\bmen\b|keeper|caretaker|monk|priest|soldier|butler|father|husband|\bhe\b|\bhis\b/],
];

/** Which recorded voice a description suggests ("pale ghost woman in a nightgown" → woman); anything unrecognisable is a creature. */
export function guessVoice(description: string): ScreamVoice {
  const text = description.toLowerCase();
  return WORDS.find(([, words]) => words.test(text))?.[0] ?? "creature";
}
