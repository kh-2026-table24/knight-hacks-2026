import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sideToward } from "../../src/shared/geometry";
import { DOOR, GENERATED_ROOM, INTERACT, PLAYER, WALL_THICKNESS } from "../../src/shared/constants";
import { LIMITS } from "../../src/shared/spec";
import type { Storyboard, StoryboardRoom } from "./checkStoryboard";

// Stage 2 of generation: one call per room, all in parallel. The system prompt (format reference,
// building guide, storyboard) is the same for every room of a game, so it's cached; the user prompt
// carries the facts code has already fixed for this room: its doors and the keys it must hold.

// spec.ts is the contract and its comments are written to be read, so Claude gets it verbatim. Reading
// it at startup means the prompt can't drift from what the parser accepts.
const SPEC_SOURCE = readFileSync(join(import.meta.dirname, "..", "..", "src", "shared", "spec.ts"), "utf8")
  .replace(/^import .*\n/m, "")
  .replace("0.8 * PLAYER.speed", String(LIMITS.maxSpeed));

const GUIDE = `You are building one room of Paradise Chateau, a 2.5D horror exploration game in a retro
PS1 style. The storyboard below was written by the game's lead writer; your room must bring its part of
that story to life. You write the room as JSON in the GameSpec format, and the engine turns it into a
playable 3D scene with painted sprites, tiled textures, real lights and physics.

<format>
The GameSpec format, as TypeScript types. You write one RoomSpec. Fields the comments give a default for
(rotation, rotationY, solid, outdoor, baseLight, the empty lists) can be left out.

${SPEC_SOURCE}
</format>

<building_with_it>
How the format plays out on screen, and techniques that work well. Use your judgment; none of this is a
recipe.

Space and camera
- x runs east from 0 to W, z runs south from 0 to D, y is up. Positions are the bottom-center of things.
- The engine builds the walls, ${WALL_THICKNESS} m thick: the north wall along z = 0 and, indoors, the west and east
  walls, so the usable floor indoors is x ${WALL_THICKNESS}..W-${WALL_THICKNESS}, z ${WALL_THICKNESS}..D. Outdoors only the north wall exists.
- The camera looks north, a little from above, from beyond the open south edge. The north wall is the
  backdrop and the stage: put the focal point there or in the middle of the room. Things near z = D are
  closest to the camera, so keep that strip low (under about 1.5 m) or they'll hide the room.
- The player is ${PLAYER.height} m tall and ${PLAYER.radius * 2} m wide, climbs steps up to ${PLAYER.stepHeight} m and slopes up to ${PLAYER.maxSlopeDeg}°, and can use
  [E] on things within ${INTERACT.range} m whose bottom is no more than ${INTERACT.maxHeightAboveFeet} m above her feet.
- Rooms are at most ${GENERATED_ROOM.maxSide} m wide or deep and ${GENERATED_ROOM.maxHeight} m tall, and smaller is often better: a compact room that's
  full reads better than a big one that's empty.
- Depth comes from layering: big things behind small ones, and a few low pieces at the sides in front.

Scale
- Everything is life size, measured against the player: she stands ${PLAYER.height} m (about 6 ft), and her sprite reads a
  little taller than that on screen. A doorway is 7 to 8 ft (2.1 to 2.4 m) tall, a wardrobe stands above her
  head, a tree towers over her. Size each object from <reference_sizes> or from what you know of the real
  thing, and when you're unsure between two sizes take the larger: things smaller than life look like toys
  beside her.
- Nothing is shrunk to suggest distance or to fit more in. The room is the whole world, with nothing beyond it
  to be far away: a lighthouse in the yard is a full-size lighthouse. If something can't fit at full size,
  leave it out or build only the part that fits (the foot of a tower, the stern of a boat).

Structures and sprites
Every object is made one of two ways, and choosing well for each one is most of what makes a room look good.
- A structure is built from boxes and wedges. It is really there in 3D: it has depth, takes the room's light
  and shade, keeps its shape as the player walks around it, and can be climbed on, hidden behind or walked
  under.
- A sprite is a panel: a flat painted cutout facing the camera. It can show any shape and any detail, but it
  has no depth, so a blocky object made as a sprite looks like a cardboard standee once the player walks
  past it.

Prefer structures, and decide object by object from the shape of the thing itself:
- If it's mostly flat faces, straight edges and right angles, so a handful of boxes and wedges would capture
  its silhouette, build it. Most made things are like this: furniture, cabinets and shelving, chests and
  crates, tables and counters, beds and coffins, stoves and hearths, altars and tombs, fences, steps and
  platforms.
- If it's organic, irregular, soft, round or a cluster of many small pieces, so boxes would turn it into a
  lump, make it a sprite: grass, bushes, trees and vines, flowers, rocks, bones and bodies, a heap of rubble
  or rags, a skull, a doll, a lantern, a candle.
- Many objects are both: build the body and add a sprite for what boxes can't carry (a box clock case with a
  painted face, a bookcase of boxes with a sprite row of books on each shelf, a box hearth with a sprite fire,
  a table with a sprite candelabra on it).
These examples show how the test works; they are not a list of things to include. The room's objects come
from the storyboard, and the same test decides each one, whatever it is.

Building structures
- One structure is one prop with several parts. Think about how the real thing is put together and give its
  main pieces their own parts: a table is a top on four legs; a bed is a frame, a mattress, a pillow and a
  headboard; a wardrobe is a tall body with two door fronts standing slightly proud of it and a cornice; a
  chair is a seat, four legs and a back. Aim for the silhouette you'd recognize across the room, usually 3
  to 12 parts, not every detail.
- A part with a "color" and no material is plain color and needs no image, so color-only parts are free: use
  them for legs, trim, frames, handles, cushions, bedding and plinths. Give a material to the large surfaces
  whose texture matters (a tabletop's grain, an altar's stone), and reuse one material across props with a
  different "color" on each.
- A material is a tiled texture, so describe a surface ("damp red brick with crumbling mortar"), not an object.
- Near-black parts read as openings and depth: the recess of a bookcase or fireplace, a window's dark pane,
  the gap under a door.
- Parts of one prop may touch or overlap; different props must not overlap.
- A wedge is full height at its north end. Two back to back, one turned 180° (rotation [0, 3.1416, 0]), make
  a pitched roof.
- Two equal boxes, one turned 45° (rotation [0, 0.785, 0]), read as round: a column, a tower, a well.
- A prop's light comes from its tallest part, so a fire, candle or lamp that belongs to something big is its
  own small prop, in front of it or on it.
- Structures also make the architecture the player moves through: platforms, balconies, stairs, pillars, low
  walls, a raised stage, a sunken floor, a collapsed beam, a gallery. Give each room one or two memorable
  pieces like this, whatever suits the story.
- Stairs and ramps need room to use, so give them their space before placing anything around them. Leave
  at least 1.2 m of open floor in front of the bottom step, in the direction the steps climb, so the player
  can walk straight onto it: never start a flight against a wall or another prop. Make the flight at least
  1 m wide, and open its top onto floor at least 1 m deep. Steps rise ${(PLAYER.stepHeight - 0.05).toFixed(2)} m or less each over
  treads at least 0.45 m deep; a wedge needs a depth at least its height.

Sprites
- A sprite's picture is generated from its description: the prop's name, or the part's own "art". Name each
  one specifically ("cracked porcelain doll missing one eye").
- The picture fills its panel edge to edge, so size the panel to the subject's real width and height; a
  panel with other proportions stretches the picture.
- Every sprite is a solid physical thing with a clear outline: something that could stand on the floor, sit
  on something, or hang on a wall. Never make a sprite (or an ambient particle) of weather or effects: fog,
  mist, smoke, steam, spray, waves, wind, rain, light beams. As cutouts they look like cardboard shapes
  floating in the room. Show them with lights, small solid particles (drips, embers, dust motes, falling
  leaves) and examine text instead.
- Set "solid": true on sprites that should block the player (a tree, a body, a boulder). Leave small things
  walk-through.
- Hang pictures on the north wall: a panel at z of about ${(WALL_THICKNESS + 0.02).toFixed(2)}, raised with y (portraits, mirrors, a
  crucifix, scratched writing, a window).
- Lay decals flat on the floor with rotation [-1.5708, 0, 0] and y 0.01: rugs, bloodstains, puddles, chalk
  circles, scattered papers, leaves.
- "copies" repeats a prop at more positions: tufts of grass over a yard, a few gravestones, a row of pews.
- Outdoor rooms have no walls to frame them, so they need more dressing than indoor rooms: tall silhouettes
  along the north edge (trees, the building's face, fences, ruins), with bushes, rocks and grass tufts
  grouped around the paths.

What the player can interact with
- 1 to 5 things in the whole room, counting props with "examine" or "contains" and characters together; 2
  or 3 is usually right. These are the room's story objects and characters from the storyboard. Everything
  else is scenery with no "examine", however interesting it looks: a room full of [E] prompts buries the few
  that matter.
- Every character is someone the player can talk to, unless it's hostile; one with no "dialogue" is removed.
  Its "dialogue" is one conversation that ends in an outcome: it "gives" a key, sets an "objective", or both.
  Its "afterwards" is the same short, unhelpful brush-off on every later talk; it never repeats the help.
- Hostile characters are rare: only where the storyboard has one. Each jumpscares the player when it
  catches her, so give it a "scream" that fits who or what it was in the story, and a "jumpscare" that
  says what makes its face its own up close. Keep threats away from the start and the doorways, and leave
  a way around them.
- Objectives: the user prompt lists the objectives this room sets and what sets each one. Put "objective"
  with that id on that prop, character or pickup, and set no others.

Images
- The whole game is drawn from at most ${LIMITS.artJobsWarning} generated images, shared by every room. Each distinct material,
  sprite description, animation frame and character pose is one image; a description repeated word for word
  is drawn once, even in another room. Color-only parts cost nothing.
- So reuse wherever you can: build with color-only parts and a few shared materials (the storyboard's, word
  for word), recolor a material with "color" instead of describing a new one, repeat a sprite with "copies"
  or with "tint" for a color variant, give characters one idle pose unless their movement matters, and
  animate only things that really move.
</building_with_it>

<reference_sizes>
For judging scale only. This is not a list of things to put in the room: build the room from the
storyboard, and use these to size whatever you place. Sizes are width x height in meters unless noted
(1 m is about 3.3 ft).

- People and creatures: adult 1.7-1.8 tall (5'7" to 6'), child 1.1-1.3 tall, cat 0.5 x 0.3, dog 0.8 x 0.6, crow 0.3 x 0.3,
  sheep 1.2 x 0.9, horse 2.4 x 1.7.
- The building: doorway 1.0 x 2.2 (7 to 8 ft; the engine's own doors are bigger, ${DOOR.width} x ${DOOR.height}), window 0.9 x 1.2 with its sill 0.9 up, fireplace 1.5 x 1.2,
  pillar 0.4-0.6 wide, counter or bar 1.0 high, stair step 0.15-0.3 high, indoor ceiling 2.6-3.5.
- Furniture: chair 0.5 x 0.9 (seat 0.45 up), armchair 0.9 x 1.0, sofa 2.0 x 0.85, table 0.75 high
  (dining table 1.8 long), desk 1.2 x 0.75, bed 2.0 long x 1.5 wide x 0.6 high, narrow cot 0.9 wide,
  wardrobe 1.2 x 2.1, bookcase 1.0 x 2.0, chest of drawers 1.2 x 1.0, upright piano 1.5 x 1.3,
  grandfather clock 0.5 x 2.0, bathtub 1.7 x 0.6, iron stove 0.8 x 0.9, coffin 2.0 long x 0.7 wide,
  trunk 0.9 x 0.5, crate 0.6-1.0 on a side, barrel 0.6 x 0.9, portrait 0.5 x 0.7, mirror 0.6 x 0.9,
  rug 2 x 3.
- Small things: candle 0.15-0.3 tall, candlestick 0.4, lantern 0.3 x 0.4, oil lamp 0.25 x 0.45, book
  0.2 x 0.25, bottle 0.08 x 0.3, cup 0.1, plate 0.25 across, skull 0.2, doll 0.4, letter 0.2 x 0.3, mantel
  clock 0.25 x 0.3, vase 0.3 x 0.5, bucket 0.3 x 0.35. Keys and other pickups are always drawn 0.4 across.
- Outdoors: tree 4-8 tall (trunk 0.3-0.8 wide), bush 1-2 x 0.8-1.5, grass tuft 0.4 x 0.3, rock 0.3-1.5,
  boulder 1.5-3, gravestone 0.6 x 0.9-1.2, mausoleum 3 x 3.5, fence section 2.0 x 1.1, gate 1.2-3 x 1.5-2,
  lamp post 0.3 x 3.5, well 1.5 x 0.8 (its rim), cart 2.5 x 1.5, bench 1.5 x 0.8, statue 0.8 x 2.5,
  garden shed 3 x 2.5.
</reference_sizes>

<output>
Answer in two parts. First, inside <design></design>, plan the room as a designer would: what the player
sees when she enters, the focal point, the zones of the room and what fills each one (with rough
positions and life-size dimensions, and whether each object is a structure, a sprite or both, and why),
the lights, the 1 to 5 things the player can interact with and what they say, each character's outcome,
the objectives set here, how the key (if any) is found, and which images you're reusing. Then write the room as one RoomSpec JSON object inside <room></room>, compact (no
indentation or line breaks). Write nothing after </room>.
</output>`;

/** The cached system prompt for every room call of one game. */
export function roomSystemPrompt(storyboard: Storyboard): string {
  return `${GUIDE}\n\n<storyboard>\n${JSON.stringify(storyboard.raw, null, 2)}\n</storyboard>`;
}

/** The per-room prompt: which room to build, and the facts about it that other rooms depend on. */
export function roomPrompt(storyboard: Storyboard, room: StoryboardRoom, artBudget: number): string {
  const roomName = (id: string) => storyboard.rooms.find((r) => r.id === id)?.name ?? id;
  const isStart = storyboard.rooms[0].id === room.id;

  const doors = storyboard.doors.flatMap((door) => {
    if (!door.rooms.includes(room.id)) return [];
    const otherId = door.rooms[0] === room.id ? door.rooms[1] : door.rooms[0];
    const other = storyboard.rooms.find((r) => r.id === otherId)!;
    const side = sideToward(room.grid, other.grid)!;
    const look = door.description ? `; use "art": ${JSON.stringify(door.description)} exactly, so both sides match` : "";
    const where =
      side === "south"
        ? "on the open south edge, drawn as a dark exit strip on the floor (no art); keep the floor in front of it clear"
        : `on the ${side} wall${look}`;
    return [`- "${door.id}" to ${roomName(otherId)}, ${where}. It is ${door.locked ? "locked" : "unlocked"}.`];
  });

  const keys = storyboard.keys
    .filter((key) => key.room === room.id)
    .map((key) => {
      const spec = { kind: "key", name: key.name, art: key.appearance, unlocks: key.unlocks };
      const story = [key.howFound && `How it's found: ${key.howFound}`, key.hint && `Hint elsewhere: ${key.hint}`].filter(Boolean).join(" ");
      return `- ${JSON.stringify(spec)}${story ? `\n  ${story}` : ""}`;
    });

  const objectives = storyboard.objectives
    .filter((objective) => objective.room === room.id)
    .map((objective) => `- "objective": "${objective.id}" ("${objective.text}"), set by ${objective.trigger ?? "one of this room's story objects or characters"}.`);

  const { finale } = storyboard;
  const finaleNote =
    finale.room === room.id
      ? `- The game ends here. The main antagonist, ${finale.antagonist}, is in "characters" but hidden until the player
  finishes with ${finale.trigger}: make that a story object with "examine" (the final reveal), and give the
  antagonist "hostile": { "damage": ${PLAYER.maxHearts} }, "finale": { "after": "<that prop's id>" }, a "jumpscare" and a "scream", and
  no movement or dialogue (it rushes the player on its own). Stand it on open floor across the room from the
  trigger.${finale.appearance ? `
  Its look: ${finale.appearance}.` : ""}${finale.jumpscare ? `
  Its jumpscare face: ${finale.jumpscare}.` : ""}${finale.scream ? `
  Its scream: ${finale.scream}.` : ""}`
      : `- The main antagonist doesn't belong in this room; it appears only in the last one.`;

  return `Build the room "${room.id}" (${room.name}) from the storyboard.

Fixed by the map, so other rooms line up with yours:
- "id": "${room.id}", "grid": [${room.grid.join(", ")}], "outdoor": ${room.outdoor}.
- ${isStart ? "This is where the game starts: the player appears at \"start\"." : "The player arrives through a door; \"start\" is where she respawns, on open floor near the south side."}
- Doors: "doors" has exactly one entry per connection below, with "connection" set to its id and an
  "offset" along its wall from ${DOOR.edgeMargin} m to the wall's length minus ${DOOR.edgeMargin} m.
${doors.join("\n") || "- (none)"}
${keys.length === 0 ? "- Keys: none belong in this room." : `- Keys: put exactly these keys in this room, as written, and no others.\n${keys.join("\n")}`}
${objectives.length === 0 ? "- Objectives: none are set in this room." : `- Objectives: put exactly these on what sets them, and no others.\n${objectives.join("\n")}`}
${finaleNote}
- 1 to 5 things to interact with in all, props to examine or search and characters together: this room's
  story objects and characters from the storyboard.

Stay under about ${artBudget} distinct images in this room, this room's share of the game's ${LIMITS.artJobsWarning} (each distinct
sprite description, material, frame and character pose is one; a storyboard material written word for
word is shared with the other rooms that use it). That's a ceiling, not a target, and it limits distinct
images, not objects: color-only parts are free.`;
}
