// Deliberate mistakes for scripts/check-specs.ts. Each case copies fixtures/games/haunted.json, breaks
// one thing, and lists text the resulting error messages must contain. Every validation rule should
// have a case, so a rule that silently stops firing is caught.

// reason: cases edit the raw fixture JSON freely, including into shapes the types forbid.
type RawGame = any;

export interface SpecCase {
  name: string;
  /** Each must appear in some error message. */
  expect: string[];
  /** If set, the matching errors must be tagged with this room. */
  room?: string;
  mutate(game: RawGame): void;
}

const room = (game: RawGame, id: string): RawGame => game.rooms.find((r: RawGame) => r.id === id);
const prop = (game: RawGame, roomId: string, id: string): RawGame => room(game, roomId).props.find((p: RawGame) => p.id === id);
const character = (game: RawGame, roomId: string, id: string): RawGame => room(game, roomId).characters.find((c: RawGame) => c.id === id);

export const CASES: SpecCase[] = [
  // Shape (S rules) ---------------------------------------------------------------------------
  {
    name: "wrong version",
    expect: ["version must be 1"],
    mutate: (g) => (g.version = 2),
  },
  {
    name: "room without a size",
    expect: ["rooms[0](foyer).size is required"],
    room: "foyer",
    mutate: (g) => delete room(g, "foyer").size,
  },
  {
    name: "misspelled field",
    expect: ['unknown field "dialogues"'],
    room: "study",
    mutate: (g) => {
      const caretaker = character(g, "study", "caretaker");
      caretaker.dialogues = caretaker.dialogue;
      delete caretaker.dialogue;
    },
  },
  {
    name: "light too bright",
    expect: ["props[2](hearth).light.intensity must be a number above 0 and at most 10"],
    mutate: (g) => (prop(g, "foyer", "hearth").light.intensity = 15),
  },
  {
    name: "id that isn't a slug",
    expect: ['must be a lowercase slug like "great-hall", got "Great Couch"'],
    mutate: (g) => (prop(g, "foyer", "couch").id = "Great Couch"),
  },
  {
    name: "panel with a material",
    expect: ["material is only for box and wedge parts"],
    mutate: (g) => (prop(g, "foyer", "portrait").parts[0].material = "oak"),
  },
  {
    name: "box with no material anywhere",
    expect: ['props[4](couch) needs a "material"'],
    mutate: (g) => delete prop(g, "foyer", "couch").material,
  },
  {
    name: "chase faster than the player",
    expect: ["movement.speed must be at most 4"],
    mutate: (g) => (character(g, "foyer", "ghost").movement.speed = 5),
  },
  {
    name: "gives without dialogue",
    expect: ['gives needs "dialogue"'],
    mutate: (g) => (character(g, "cellar", "rat").gives = { kind: "key", name: "Rusty Key", art: "rusty key", unlocks: "foyer-cellar" }),
  },
  {
    name: "unknown item kind",
    expect: ['kind must be one of "key"'],
    mutate: (g) => (prop(g, "foyer", "butler-corpse").contains.kind = "potion"),
  },
];
