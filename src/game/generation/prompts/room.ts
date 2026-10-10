// The room prompt. Every fact about the engine stated here must match the code: walls come from
// buildRoom.ts, doors from Door.ts, climbing from Player.ts, and the rules from checkLayout.ts.
import type { DoorSlot, RoomContext } from "../output/housePlan";
import { repairSection, type RepairContext } from "./repair";

const INDOOR_WALLS = `- The game adds the walls itself: the north wall along z=0 and the west and east walls along x=0
  and x=W, each 0.3 m thick and H tall. The south side (z=D, nearest the camera) has no wall so
  the camera can see in. Usable floor: x 0.3 to W-0.3, z 0.3 to D. Don't build walls yourself.`;

const OUTDOOR_WALLS = `- You are outdoors. The game adds the building's front face as a 0.3 m thick wall along z=0 (north),
  H tall; describe it in wallDescription. There are no other walls: the west, east and south edges
  are open ground with invisible boundaries. Usable ground: x 0 to W, z 0.3 to D. "floorDescription"
  describes the ground.`;

function doorLine({ connectionId, side, leadsTo }: DoorSlot) {
  const where =
    side === "south"
      ? `an exit strip on the floor along the open south edge (z=D). "offset" is its center x, between 1 and W-1`
      : side === "north"
        ? `a door 1.6 m wide and 3 m tall standing against the north wall. "offset" is its center x, between 1 and W-1`
        : `a door 1.6 m wide and 3 m tall standing against the ${side} wall (x=${side === "east" ? "W" : "0"}). "offset" is its center z, between 1 and D-1`;
  return `- "${connectionId}" leads to ${leadsTo}: ${where}.`;
}

export const roomPrompt = ({ theme, house, room, layout, doors }: RoomContext, repair?: RepairContext) => `
You are the level designer for a small, atmospheric 3D exploration game. Lay out ONE room of the
place below as a blockout: simple geometric stand-ins (boxes, wedges, flat panels). Art is applied
later, so silhouette, placement and composition matter; modeled detail does not. There is no
dialogue, so the room tells its part of the story through which objects are there, where they
are, and what state they're in.

<story>
${house.title}: ${house.story}

Theme:
${theme}
</story>

<this_room>
${room.name} (${room.outdoor ? "outdoors" : "indoors"}): ${room.brief}
Layout style: ${layout}
</this_room>

<world>
- Units are meters. +x is east (right), +y is up, +z is south (toward the camera).
- The room spans x from 0 to W and z from 0 to D, with the ground at y=0 and the ceiling at y=H.
  You choose W and D (each 8 to 20) and H (3 to 8).
${room.outdoor ? OUTDOOR_WALLS : INDOOR_WALLS}
- The camera floats above and south of the player, looking north, so the north side reads like a
  theater stage. Keep anything taller than 1.5 m out of the 3 m nearest z=D.
- The player is 0.7 m wide and 1.8 m tall. They walk on the ground and on anything they can climb
  onto: steps up to 0.35 m high, and slopes up to 50° (a wedge whose depth is at least its height).
  They can drop off edges. Platforms, terraces and balconies reached that way are walkable if
  there is 1.8 m of headroom above them.
</world>

<doors>
${doors.map(doorLine).join("\n")}
The game draws doors itself; don't model them. Choose each "offset" to suit the composition. The
player arrives standing on the floor 1 m in front of a door (1.8 m north of the south edge for an
exit strip), so that spot, and a path from the start to it, must be open floor at y=0.
</doors>

<building_blocks>
Every object is an item made of 1 to 5 parts. Use just enough parts to give it a recognizable
silhouette: a table is a top on legs, a chair a seat and a back, a bed a frame and a headboard, a
statue a plinth, a body and a head, a lamp post a base, a pole and a lamp. Simple things (a crate,
a bookshelf, a hedge) stay one box. Skip small details: no handles, drawers, trim or clutter.

Part types:
- "rectPrism": box.
- "rightTriPrism": wedge. Full height at its north (-z) end, sloping down to zero at its south (+z)
  end. Use it for stairs and ramps; the player climbs it if its depth is at least its height.
- "plane": flat panel facing south (+z) with no thickness. Use it for windows, paintings and signs
  on walls, and for rugs, paths and stains on the ground (rotation [-1.5708, 0, 0], y 0.01).
  Careful: a panel laid flat this way is not centered on its position. It covers x from
  position.x - width/2 to position.x + width/2, and z from position.z - height to position.z
  (it extends north from its position by its height).

Part fields: "type"; "position" [x, y, z] of the part's bottom-center relative to the item's
origin; "scale" [width, height, depth] (panels use depth 0); optional "rotation" [rx, ry, rz] in
radians; optional "collisions" (default true; set false for rugs and wall panels); optional
"material" to give one part a different surface than the rest of its item.

Item fields:
- "name": specific and evocative, because art will be generated from it. "music box with a tiny
  dancer, lid open" or "iron-bound sea chest, lid forced open", not "box" or "chest".
- "position": [x, y, z] in room coordinates where the item's origin (its bottom-center) goes.
  y is 0 for things on the ground; raise it for things on platforms or mounted on walls.
- "rotationY": radians. An item's front faces south (+z) by default. Use 1.5708 against the west
  wall and -1.5708 against the east wall; that also swaps its width and depth.
- "material": what its boxes and wedges are made of, as a surface: "scarred dark oak planks",
  "rusted riveted iron", "cracked white porcelain". Art for boxes is a tiled material texture, so
  describe the material, not the object. Required whenever the item has a box or wedge part.
- "parts": the 1 to 5 primitives. Panels are drawn as a picture of the item from its name.

Examples (only the shape of the data matters):
{"name": "stone stage with worn steps", "material": "worn grey limestone blocks", "position": [8, 0, 1.6], "rotationY": 0, "parts": [
  {"type": "rectPrism", "position": [0, 0, 0], "scale": [6, 0.9, 2.5]},
  {"type": "rightTriPrism", "position": [0, 0, 2], "scale": [2, 0.9, 1.5]}]}
{"name": "marble pedestal holding a music box, lid open", "material": "veined white marble", "position": [13, 0, 2], "rotationY": 0, "parts": [
  {"type": "rectPrism", "position": [0, 0, 0], "scale": [0.5, 1, 0.5]},
  {"type": "rectPrism", "position": [0, 1, 0], "scale": [0.4, 0.25, 0.3], "material": "red lacquered wood with gold trim"}]}
{"name": "scarred oak supper table", "material": "scarred dark oak planks", "position": [6, 0, 5], "rotationY": 0, "parts": [
  {"type": "rectPrism", "position": [0, 0.7, 0], "scale": [1.6, 0.1, 0.9]},
  {"type": "rectPrism", "position": [-0.7, 0, -0.35], "scale": [0.1, 0.7, 0.1]},
  {"type": "rectPrism", "position": [0.7, 0, -0.35], "scale": [0.1, 0.7, 0.1]},
  {"type": "rectPrism", "position": [-0.7, 0, 0.35], "scale": [0.1, 0.7, 0.1]},
  {"type": "rectPrism", "position": [0.7, 0, 0.35], "scale": [0.1, 0.7, 0.1]}]}
{"name": "tall arched window streaked with grime", "position": [3, 1.2, 0.31], "rotationY": 0, "parts": [
  {"type": "plane", "position": [0, 0, 0], "scale": [1.2, 2, 0], "collisions": false}]}
</building_blocks>

<rules>
Playability. A program checks these, and failures are sent back to you:
- Every part stays within the usable floor and below the ceiling.
- startPosition is [x, 0, z] on open ground in the south third of the room, at least 1 m from any object.
- Every item can be walked up to from the start, and every door's arrival spot is open, reachable floor.
- Items don't pass through each other. Resting on or touching is fine.
- 8 to 24 items. Round numbers to 2 decimal places.

Composition:
- Follow the layout style above, adapted to this room's brief.
- Give the room one clear focal point and place it where the camera sees it best.
- Put windows and paintings on walls as panels; they're cheap and carry the theme.
- Place props with intent, each one something a player would want to walk up to and inspect.

Art (every surface becomes a small pixel-art texture, so contrast is what makes things readable):
- wallDescription and floorDescription name only the base material and its color, nothing lying
  on it or hanging from it ("damp green-black fieldstone", not "stone walls strewn with petals").
- Make the floor, the walls and the props clearly different from each other in color and
  brightness, for example a dark floor, mid-tone walls, and props that are lighter or in an
  accent color. Give the focal point the most striking material.
- Neighboring props should not share a material unless they're a matched set.

Theme:
- Every object is evidence of what this room is for and what happened in it.
- Include 2 to 4 signature props that only make sense for this room in this story.
- Make the twist visible where it fits: what is there, where it is, its state (knocked over, left
  open, out of place, missing).
</rules>

<output_format>
First, inside <notes> tags, write in a few short lines: what the room is and what happened here,
the door offsets, then each item's x and z footprint range so you can check that items fit and
don't overlap.

Then write the room as JSON inside <room> tags, with nothing else inside the tags and no comments:
<room>
{"title": "...", "wallDescription": "base wall material and color", "floorDescription": "base floor material and color",
 "dimensions": [W, H, D], "startPosition": [x, 0, z],
 "doors": [{"connectionId": "...", "offset": 0}],
 "items": [...]}
</room>
Note the order: dimensions is [width, height, depth].
</output_format>
${repair ? repairSection(repair, "room", "move, shrink or rotate the offending items, or move a door, rather than redesigning the room") : ""}`;
