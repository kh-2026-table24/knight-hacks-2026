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
    name: "unknown footsteps",
    expect: ['footsteps must be one of "wood", "stone"'],
    room: "cellar",
    mutate: (g) => (room(g, "cellar").footsteps = "gravel"),
  },
  {
    name: "unknown ambience",
    expect: ['ambience must be one of "wind", "rain"'],
    room: "study",
    mutate: (g) => (room(g, "study").ambience = "thunder"),
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

  // Room layout (R rules) ---------------------------------------------------------------------
  {
    name: "prop pushed out of the room",
    expect: ["props[4](couch) sticks out of the room"],
    room: "foyer",
    mutate: (g) => (prop(g, "foyer", "couch").position = [19.5, 0, 6]),
  },
  {
    name: "props intersect",
    expect: ["(hearth) and", "(couch) intersect"],
    room: "foyer",
    mutate: (g) => (prop(g, "foyer", "couch").position = [5, 0, 1.5]),
  },
  {
    name: "start inside the couch",
    expect: ["rooms[0](foyer).start [5, 6] is not open floor"],
    room: "foyer",
    mutate: (g) => (room(g, "foyer").start = [5, 6]),
  },
  {
    name: "missing door",
    expect: ['must contain exactly one door with connection "foyer-study"'],
    room: "foyer",
    mutate: (g) => (room(g, "foyer").doors = room(g, "foyer").doors.filter((d: RawGame) => d.connection !== "foyer-study")),
  },
  {
    name: "door to a room it doesn't connect",
    expect: ['uses connection "cellar-study", which doesn\'t join this room'],
    mutate: (g) => room(g, "cellar").doors.push({ connection: "cellar-study", offset: 3 }),
  },
  {
    name: "door blocked",
    expect: ["is blocked", "blocking-crate"],
    room: "foyer",
    mutate: (g) =>
      room(g, "foyer").props.push({
        id: "blocking-crate", name: "crate", material: "rough pine planks", position: [11.5, 0, 1.3],
        parts: [{ shape: "box", position: [0, 0, 0], size: [1.2, 1, 1.2] }],
      }),
  },
  {
    name: "character inside the bookshelf",
    expect: ["characters[0](caretaker) can't stand at"],
    room: "study",
    mutate: (g) => (character(g, "study", "caretaker").position = [8, 0, 0.7]),
  },
  {
    name: "patrol point inside the desk",
    expect: ["movement.points[1] [5, 4] can't be walked to"],
    room: "study",
    mutate: (g) => (character(g, "study", "caretaker").movement.points[1] = [5, 4]),
  },
  {
    name: "pickup out of reach on top of the bookshelf",
    expect: ["pickups[0](spare-key) can't be picked up"],
    room: "study",
    mutate: (g) =>
      (room(g, "study").pickups = [
        { id: "spare-key", item: { kind: "key", name: "Spare Key", art: "small iron key", unlocks: "foyer-cellar" }, position: [8, 3.2, 0.7] },
      ]),
  },
  {
    name: "examine text out of reach",
    expect: ["props[6](portrait) can't be examined"],
    room: "foyer",
    mutate: (g) => (prop(g, "foyer", "portrait").position = [2.2, 2.5, 0.32]),
  },

  // Whole game (G rules) ----------------------------------------------------------------------
  {
    name: "duplicate room id",
    expect: ['"cellar" is used by another room too'],
    mutate: (g) => (room(g, "study").id = "cellar"),
  },
  {
    name: "rooms that aren't neighbors",
    expect: ["are not in neighboring grid cells"],
    mutate: (g) => (room(g, "study").grid = [2, 0]),
  },
  {
    name: "unreachable room",
    expect: ["rooms[2](study) can't be reached from foyer"],
    mutate: (g) => (g.connections = g.connections.filter((c: RawGame) => c.id !== "foyer-study")),
  },
  {
    name: "locked door with no key",
    expect: ["is locked but nothing opens it"],
    mutate: (g) => delete prop(g, "foyer", "butler-corpse").contains,
  },
  {
    name: "key behind its own lock",
    expect: ["connections[0](foyer-cellar) can never be opened"],
    mutate: (g) => {
      delete prop(g, "foyer", "butler-corpse").contains;
      room(g, "cellar").pickups = [
        { id: "brass-key", item: { kind: "key", name: "Brass Key", art: "old ornate brass key", unlocks: "foyer-cellar" }, position: [7, 0, 6] },
      ];
    },
  },
  {
    name: "key for a connection that doesn't exist",
    expect: ['unlocks "foyer-attic", but there is no connection with that id'],
    mutate: (g) => (prop(g, "foyer", "butler-corpse").contains.unlocks = "foyer-attic"),
  },
  {
    name: "duplicate id within a room",
    expect: ['uses the id "hearth"'],
    room: "foyer",
    mutate: (g) => (prop(g, "foyer", "couch").id = "hearth"),
  },
];
