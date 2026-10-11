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
- Every sprite must be a solid physical thing with a clear outline: something that could stand on the
  floor, sit on something, or hang on a wall or from something. Never make a sprite (or an ambient
  particle) of weather or effects: spray, waves, splashes, fog, mist, smoke, steam, wind, rain, light
  beams, shadows, auras, sounds. Drawn as cutouts they look like cardboard shapes floating in the room.
  Show them instead with lights (flicker, pulse, a cold or colored glow), small solid particles (drips,
  embers, ash, dust motes, falling leaves), the room's ambience, wet or worn materials, and examine text.
- Set "solid": true on sprites that should block the player (a tree, a wardrobe, a cart, a body).
  Leave small things walk-through.
- Size a sprite at the real size of its subject (see the reference sizes below); the picture fills the
  panel, so its width:height should match the subject's.
- Hang pictures on the north wall: a panel at z of about ${(WALL_THICKNESS + 0.02).toFixed(2)}, raised with y (portraits, mirrors,
  shelves, hanging tools, a crucifix, scratched writing, a window).
- Lay decals flat on the floor with rotation [-1.5708, 0, 0] and y 0.01: rugs, bloodstains, puddles,
  chalk circles, scattered papers, leaves.
- Depth comes from layering: rows of sprites at different z, big things behind small ones, a few
  foreground pieces at the sides. Scatter small sprites to make a room feel lived in and abandoned.
- Name each sprite specifically ("cracked porcelain doll missing one eye"); the name is the art prompt
  unless the part has its own "art".
- "copies" places more of the same prop in one line: a row of pews, five gravestones, tussocks
  scattered over a yard. Use it for every repeated piece of scenery.

Outdoor rooms
- With no walls to hold the eye, outdoor rooms need more dressing than indoor ones: aim for 30 or more
  props, counting copies. Layer them: tall silhouettes along the north edge (trees, the building's face
  and its details, fences, ruins, cliffs), clusters in the middle around the paths (bushes, rocks,
  stumps, gravestones, posts), something in every open patch of ground (grass tufts, stones, leaves,
  puddle and mud decals), and a few low pieces at the east and west edges and near the camera.

Boxes and wedges are for architecture
- Use them for what the player walks on, around or behind in 3D: platforms, balconies, stairs, counters,
  long tables, pillars, low walls, hearths, raised stages, an altar, a well's rim. Their material is a
  tiled texture, so describe a surface ("damp red brick with crumbling mortar"), not an object.
- "color" gives a box or wedge a base color. With a material, the texture is recolored to it, lighter
  or darker, so one stone or wood texture can serve several props and rooms. Without a material the part
  is plain color and needs no image at all: painted trim, beams, plinths, a dark doorway recess.
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
  needs one idle pose. Characters are drawn facing right and turn to face the way they walk.
- Ambient particles add life for free: dust motes, embers, falling ash, drips, flies, fireflies, falling
  leaves.

Story and progression
- Each room has 1 to 4 props the player can use with [E]: the storyboard's story objects, each with
  "examine" or "contains". Everything else is scenery, with neither. Characters don't count toward this.
- Examine text is what she notices, in 1 to 4 short lines.
- A character has one conversation, played the first time she talks to them. Give it a purpose: it
  tells part of the story, hands over a key, or points toward one. Keep it to what matters, at most 8
  short lines.
- "afterwards" is what plays on every later [E]. A character who gave a key, or a prop that held one,
  needs 1 or 2 short lines that brush her off, as people in games do ("I've told you all I know, miss.").
  A character who only gives a hint can leave it out and repeat the hint.
- A key reaches the player by lying on the floor (a pickup), dropping from a prop the first time she
  examines it ("contains"; with no examine it drops on [E] Search), or being handed over at the end of a
  character's conversation ("gives"). Put a story object worth examining near anything that hides a key,
  and give hints that name the object as it looks and where it is, so the player can find it.
- Write in the story's voice, but clearly: every line should make sense the first time it's read.
  Atmosphere comes from concrete details, not riddles. One ominous or poetic line in a conversation is
  plenty, and a hint is never a riddle. Not "The island keeps what the wind drops." but "The gale blew
  something from the house into the hollow by the chapel door."
- A hostile character or a hazard should belong to the story. Keep threats away from the start and the
  doorways, and leave a way around.

Fitting it together
- Keep open paths at least 1.2 m wide from the start to every door, character, key and story object, and
  keep the floor just inside each door clear (the player appears ${DOOR.arrivalDistance} m in front of it).
- Things must not pass through each other; things on top of something sit at its top's height.
- Images cost money and time, so reuse them, but never at the cost of a full, varied room. There is no
  limit on how many objects you place; the limit is on distinct images. Every distinct description (a
  sprite's art, a material, a frame, a character pose) is one generated image, and the exact same text
  anywhere in the game, in any room, reuses that image for free.
  - Repeated objects share one description, word for word (six pews, five gravestones, a row of jars),
    and vary by position, rotationY and size.
  - "tint" recolors a picture or material without a new image, by multiplying its colors. Use it for
    variants of the same thing: the same "high-backed carved chair" at "#9a8670" and at "#5e5a6e" reads as
    two different chairs; the same "cracked lime plaster" walls at "wallsTint" "#b8a890" in one room and
    "#7d8a8a" in another reads as two rooms. Subtle tints (close to white) age or warm a thing; strong
    ones change it. Tints only darken, so describe the brightest version. A box or wedge's "color" can
    also lighten.
  - Never stretch one image over different kinds of things. A chair is not a table, a crate is not a
    cabinet, a portrait is not a mirror: each different kind of object gets its own specific
    description. A room built from two or three repeated images looks fake; one built from a dozen
    distinct things, repeated and tinted, looks real.
  - Keep box materials to a few per room, and reuse the storyboard's surfaces across rooms, tinted or
    colored where a room should feel different.
</building_with_it>

<reference_sizes>
For judging scale only. This is not a list of things to put in the room: build the room from the
storyboard, and use these to size whatever you place. Sizes are width x height in meters unless noted.

- People and creatures: adult 1.7-1.8 tall, child 1.1-1.3 tall, cat 0.5 x 0.3, dog 0.8 x 0.6, crow 0.3 x 0.3,
  sheep 1.2 x 0.9, horse 2.4 x 1.7.
- The building: door ${DOOR.width} x ${DOOR.height} (the engine's), window 0.9 x 1.2 with its sill 0.9 up, fireplace 1.5 x 1.2,
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
- Outdoors: tree 3-8 tall (trunk 0.3-0.8 wide), bush 1-2 x 0.8-1.5, grass tuft 0.4 x 0.3, rock 0.3-1.5,
  boulder 1.5-3, gravestone 0.6 x 0.9-1.2, mausoleum 3 x 3.5, fence section 2.0 x 1.1, gate 1.2-3 x 1.5-2,
  lamp post 0.3 x 3.5, well 1.5 x 0.8 (its rim), cart 2.5 x 1.5, bench 1.5 x 0.8, statue 0.8 x 2.5,
  garden shed 3 x 2.5.
</reference_sizes>

<output>
Plan the room before you write it: what the player sees when she enters, the focal point, the zones of
the room and what fills each one, the lights, the story objects and what they say, the characters, and
how the key (if any) is found. Then answer with only the RoomSpec, as one compact JSON object (no
indentation or line breaks) inside <room></room>. Leave out fields whose default you'd be writing.
Write nothing after </room>.
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
- 1 to 4 props the player can examine or search: this room's story objects from the storyboard.
${room.outdoor ? "- It's outdoors: dress it fully, in layers, using copies for repeated scenery.\n" : ""}
Aim for about ${artBudget} distinct images in this room or fewer (each distinct sprite description,
material, frame and character pose is one; a storyboard material written word for word is shared with
the other rooms that use it). That
limits distinct images, not objects: fill the room as fully as it needs, with repeats and tints.`;
}
