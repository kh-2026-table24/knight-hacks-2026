import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sideToward } from "../../src/shared/geometry";
import { DOOR, INTERACT, PLAYER, WALL_THICKNESS } from "../../src/shared/constants";
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

Sprites (panels) are the main tool
- A panel is a flat painted cutout facing the camera, and its picture is generated from its description.
  Sprites are cheap to make and carry most of the look, so build most of the room from them: furniture
  seen from the front (wardrobes, beds, cabinets, clocks, chairs), trees, bushes, gravestones, statues,
  bodies and figures, carts, barrels, crates, debris and rubble, bones, bottles, candles, lamps.
- Set "solid": true on sprites that should block the player (a tree, a wardrobe, a cart, a body).
  Leave small things walk-through.
- Size a sprite at the real size of its subject; the picture fills the panel, so its width:height should
  match the subject's.
- Hang pictures on the north wall: a panel at z of about ${(WALL_THICKNESS + 0.02).toFixed(2)}, raised with y (portraits, mirrors,
  shelves, hanging tools, a crucifix, scratched writing, a window).
- Lay decals flat on the floor with rotation [-1.5708, 0, 0] and y 0.01: rugs, bloodstains, puddles,
  chalk circles, scattered papers, leaves.
- Depth comes from layering: rows of sprites at different z, big things behind small ones, a few
  foreground pieces at the sides. Scatter small sprites to make a room feel lived in and abandoned.
- Name each sprite specifically ("cracked porcelain doll missing one eye"); the name is the art prompt
  unless the part has its own "art".

Boxes and wedges are for architecture
- Use them for what the player walks on, around or behind in 3D: platforms, balconies, stairs, counters,
  long tables, pillars, low walls, hearths, raised stages, an altar, a well's rim. Their material is a
  tiled texture, so describe a surface ("damp red brick with crumbling mortar"), not an object.
- Combine both: a box hearth with a sprite fire in front of it, a box counter with sprite jars on top.
- Stairs: step boxes rising ${(PLAYER.stepHeight - 0.05).toFixed(2)} m or less each, or a wedge whose depth is at least its height.

Light and motion
- baseLight sets the darkness; 0.1 to 0.3 is right for most rooms. Then add 2 to 5 pools of light with
  darkness between them; contrast is what makes a room frightening. A glow shines all around (candles,
  lanterns, fires, ghosts); a spot is a cone of light from above (a hanging lamp, moonlight through a
  hole). flicker suits flames, pulse suits the supernatural. A soft spot on a story object is a fair way
  to draw the eye to it.
- Make still things feel alive with light, not animation. A candle, a hearth, a lantern, a glowing
  sigil, a television left on: give it a flickering or pulsing light and leave the sprite still. Light
  effects cost no images; every animation frame is another generated image.
- Save "frames" (and character "idle"/"moving" lists longer than one pose) for things that actually move:
  characters walking or turning, a hanged body swinging, a rocking chair, a door creaking open and shut.
  An animation is 4 to 6 frames, never more. Frames play slowly, about 3 a second, so make each one a
  clear, distinct pose and describe it as a change from the first. A character that only stands there
  needs one idle pose.
- Ambient particles add life for free: dust motes, embers, falling ash, drips, flies, fireflies, falling
  leaves.

Story and progression
- The player learns the story by examining things and talking. Examine text is what she notices, in a
  few short lines; a second or third conversation can go deeper (the last one repeats).
- A key reaches the player by lying on the floor (a pickup), dropping from a prop after its last examine
  conversation ("contains"; with no examine it drops on [E] Search), or being handed over by a character
  after their last conversation ("gives"). Put a story object worth examining near anything that hides
  a key, and give hints that name the object as it looks, so the player can find it.
- Characters speak in their own voice, briefly; one thought per line. A hostile character or a hazard
  should belong to the story. Keep threats away from the start and the doorways, and leave a way around.
  Give every hostile character a "scream" that fits who or what it was in the story.

Fitting it together
- Keep open paths at least 1.2 m wide from the start to every door, character, key and story object, and
  keep the floor just inside each door clear (the player appears ${DOOR.arrivalDistance} m in front of it).
- Things must not pass through each other; things on top of something sit at its top's height.
- Images are expensive, so reuse them, but never at the cost of a full, varied room. There is no limit
  on how many objects you place; the limit is on distinct images. Every distinct description (a sprite's
  art, a material, a frame, a character pose) is one generated image, and the exact same text anywhere
  in the game, in any room, reuses that image for free.
  - Repeated objects share one description, word for word (six pews, five gravestones, a row of jars),
    and vary by position, rotationY and size.
  - "tint" recolors a picture or material without a new image, by multiplying its colors. Use it for
    variants of the same thing: the same "high-backed carved chair" at "#9a8670" and at "#5e5a6e" reads as
    two different chairs; the same "cracked lime plaster" walls at "wallsTint" "#b8a890" in one room and
    "#7d8a8a" in another reads as two rooms. Subtle tints (close to white) age or warm a thing; strong
    ones change it. Tints only darken, so describe the brightest version.
  - Never stretch one image over different kinds of things. A chair is not a table, a crate is not a
    cabinet, a portrait is not a mirror: each different kind of object gets its own specific
    description. A room built from two or three repeated images looks fake; one built from a dozen
    distinct things, repeated and tinted, looks real.
  - Keep box materials to a few per room, and reuse the storyboard's surfaces across rooms, tinted where
    a room should feel different.
- Reference sizes: door ${DOOR.width} x ${DOOR.height} m, adult 1.8 m, chair seat 0.45 m, table 0.75 m high, bed 2 x 1.5 m,
  wardrobe 1.2 x 2.1 m, bookcase 1 x 2 m, coffin 2 x 0.7 m, gravestone 0.8 x 1.1 m, tree 3-6 m tall,
  candle 0.3 m, barrel 0.6 x 0.9 m.
</building_with_it>

<output>
Answer in two parts. First, inside <design></design>, plan the room as a designer would: what the player
sees when she enters, the focal point, the zones of the room and what fills each one (with rough
positions and sizes), the lights, the story objects and what they say, the characters, and how the key
(if any) is found. Then write the room as one RoomSpec JSON object inside <room></room>. Write nothing
after </room>.
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

  return `Build the room "${room.id}" (${room.name}) from the storyboard.

Fixed by the map, so other rooms line up with yours:
- "id": "${room.id}", "grid": [${room.grid.join(", ")}], "outdoor": ${room.outdoor}.
- ${isStart ? "This is where the game starts: the player appears at \"start\"." : "The player arrives through a door; \"start\" is where she respawns, on open floor near the south side."}
- Doors: "doors" has exactly one entry per connection below, with "connection" set to its id and an
  "offset" along its wall from ${DOOR.edgeMargin} m to the wall's length minus ${DOOR.edgeMargin} m.
${doors.join("\n") || "- (none)"}
${keys.length === 0 ? "- Keys: none belong in this room." : `- Keys: put exactly these keys in this room, as written, and no others.\n${keys.join("\n")}`}

Aim for about ${artBudget} distinct images in this room or fewer (each distinct sprite description,
material, frame and character pose is one; a storyboard material written word for word is shared with
the other rooms that use it). That
limits distinct images, not objects: fill the room as fully as it needs, with repeats and tints.`;
}
