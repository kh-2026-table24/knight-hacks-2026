// The planner prompt: story, rooms and connections for the whole map. The rules here must match
// parseHousePlan in output/housePlan.ts.
import { MIN_ROOMS } from "../output/housePlan";
import { repairSection, type RepairContext } from "./repair";

const roomCountRule = (roomCount?: number) =>
  roomCount
    ? `Plan exactly ${roomCount} rooms.`
    : `Plan as many rooms as the story needs, at least ${MIN_ROOMS}: the grounds outside, the main room just inside, and 2 or more side rooms. Every room should earn its place by revealing something new.`;

export const housePrompt = (theme: string, roomCount?: number, repair?: RepairContext) => `
You are planning the map for a short, atmospheric 3D exploration game: one building and its
grounds, explored room by room. There is no dialogue; the player pieces the story together from
what they find in each room.

<theme>
${theme}
</theme>
Combine every line of the theme into one coherent idea. The twist is what makes it memorable.

<rules>
- ${roomCountRule(roomCount)}
- The map is a grid of [x, z] cells: north is -z, east is +x. Each room takes one cell.
- rooms[0] is outdoors, at gridPosition [0, 0]: the grounds in front of the building, where the player starts.
- rooms[1] is indoors, at gridPosition [0, -1] (north of rooms[0]): the first room inside, entered
  through the building's front door. rooms[0] and rooms[1] must be connected.
- Any further rooms are side rooms, each in a free cell next to a room it connects to, usually rooms[1].
- A connection can only join rooms in neighboring cells (differing by 1 in exactly one coordinate),
  and every room must be reachable from rooms[0].
- Give every room a distinct purpose and mood. Each room should reveal part of the story; the
  deepest rooms hold the answers.
</rules>

<output_format>
First, inside <notes> tags, write 2 to 4 short lines on the story and how the rooms reveal it.

Then write the plan as JSON inside <house> tags, with nothing else inside the tags:
<house>
{"title": "...", "story": "3 to 5 sentences: what happened here and what the player will piece together",
 "rooms": [{"id": "grounds", "name": "...", "outdoor": true, "gridPosition": [0, 0],
            "brief": "2 to 3 sentences: what this place is, what happened in it, its key objects"}],
 "connections": [{"id": "grounds-hall", "roomIds": ["grounds", "hall"]}]}
</house>
Room ids are short lowercase slugs like "great-hall".
</output_format>
${repair ? repairSection(repair, "house", "fix the grid positions and connections rather than replanning the story") : ""}`;
