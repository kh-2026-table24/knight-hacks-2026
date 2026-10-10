// Randomness comes from code, not from asking Claude for "a random theme": LLMs asked for random
// ideas keep returning the same few (haunted mansion, wizard tower). Rolling independent axes
// gives thousands of combinations, and Claude's job becomes making an odd combo coherent.

const SETTINGS = [
  "lighthouse keeper's quarters",
  "ballet rehearsal studio",
  "orbital greenhouse module",
  "alchemist's workshop",
  "roadside diner",
  "royal map room",
  "submarine mess hall",
  "clockmaker's shop",
  "children's nursery",
  "archaeologist's field tent",
  "underground speakeasy",
  "train dining car",
  "ice-fishing cabin",
  "private library",
  "detective's office",
  "bell tower chamber",
  "bakery kitchen",
  "museum storage room",
  "space station medbay",
  "puppet theater backstage",
  "monastery scriptorium",
  "mountain observatory",
  "ship captain's cabin",
  "village apothecary",
  "radio station booth",
  "schoolroom",
  "tailor's fitting room",
  "beekeeper's cottage",
];

const ERAS = [
  "the 1890s",
  "the roaring 1920s",
  "the 1970s",
  "the medieval era",
  "the Renaissance",
  "a far-future colony",
  "a neon cyberpunk near-future",
  "ancient Rome",
  "Edo-period Japan",
  "a post-apocalyptic future",
  "the 1950s atomic age",
  "an Art Deco 1930s",
  "a solarpunk future",
  "a timeless fairy tale",
];

const MOODS = [
  "lonely",
  "festive",
  "sinister",
  "cozy",
  "frantic",
  "melancholy",
  "whimsical",
  "eerie",
  "opulent",
  "decaying",
  "serene",
  "tense",
  "dreamlike",
];

// Each twist should leave visible evidence, since the room tells its story through objects alone.
const TWISTS = [
  "the owner left in a hurry in the middle of a task",
  "everything is ankle-deep in water",
  "a celebration was interrupted moments ago",
  "something huge broke through one wall",
  "every clock has stopped at the same minute",
  "plants have overgrown the room",
  "someone has been secretly living here",
  "a prized object was just stolen from its display",
  "the room is half packed for a move",
  "an experiment went badly wrong",
  "it is decorated for a holiday nobody remembers",
  "a cat has clearly been in charge for weeks",
  "the room was hastily barricaded",
  "it is the night before a grand opening",
  "two rivals have divided the room down the middle",
];

function pick<T>(list: readonly T[], random: () => number): T {
  return list[Math.floor(random() * list.length)];
}

/** A random theme brief for the room prompt. Pass a seeded `random` to reproduce one. */
export function rollTheme(random: () => number = Math.random): string {
  return [
    `Setting: ${pick(SETTINGS, random)}`,
    `Era: ${pick(ERAS, random)}`,
    `Mood: ${pick(MOODS, random)}`,
    `Twist: ${pick(TWISTS, random)}`,
  ].join("\n");
}
