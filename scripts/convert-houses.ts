// Converts houses made by the old generator (generated/houses/*.json, the SavedHouse format from before
// GameSpec) into GameSpec games in fixtures/games/, then validates each one. Run it again after changing
// the mapping; it overwrites what it wrote before.
//
//   npx tsx scripts/convert-houses.ts
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { errorsIn, formatIssues } from "../src/shared/issues";
import type { ConnectionSpec, LightSpec, PartSpec, PropSpec, RoomSpec, Vec3 } from "../src/shared/spec";
import { validateGame } from "../src/shared/validate";

const HOUSES_DIR = join(import.meta.dirname, "..", "generated", "houses");
const OUT_DIR = join(import.meta.dirname, "..", "fixtures", "games");

// The old format, as much of it as the conversion reads.
interface OldPart {
  type: "rectPrism" | "rightTriPrism" | "plane";
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  collisionsEnabled: boolean;
  textureId: string;
}
interface OldGroup {
  position: Vec3;
  rotation: Vec3;
  objects: OldPart[];
}
interface OldLight {
  type: "spot" | "point";
  color: string;
  strength: number;
  flicker?: boolean;
  position: Vec3;
}
interface OldRoom {
  id: string;
  gridPosition: [number, number];
  dimensions: Vec3;
  startPosition: Vec3;
  floorTextureId: string;
  lightLevel?: number;
  objects: { id: string }[];
  groups: OldGroup[];
  doors: { connectionId: string; offset: number }[];
  lights?: OldLight[];
}
interface OldHouse {
  title: string;
  story: string;
  rooms: { id: string; name: string; items: { name: string }[] }[];
  game: {
    textures: { id: string; prompt: string }[];
    connections: { id: string; roomIds: [string, string] }[];
    rooms: OldRoom[];
  };
}

const SHAPES = { rectPrism: "box", rightTriPrism: "wedge", plane: "panel" } as const;
// An old room light goes on the prop nearest to it, if one is this close (meters, across the floor).
const LIGHT_REACH = 2.5;

const slug = (text: string, max = 40) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, max)
    .replace(/^-+|-+$/g, "") || "item";

function convertLight(light: OldLight): LightSpec {
  return {
    type: light.type === "spot" ? "spot" : "glow",
    color: light.color,
    intensity: Math.min(8, Math.max(1, Math.round(light.strength * 5 * 10) / 10)),
    range: light.type === "spot" ? 3 : 6,
    effect: light.flicker ? "flicker" : "steady",
  };
}

// Footsteps and ambience are left out: the parser picks them from the floor and indoors/outdoors.
function convertRoom(room: OldRoom, house: OldHouse, prompt: (id: string) => string): Omit<RoomSpec, "footsteps" | "ambience"> {
  const meta = house.rooms.find((r) => r.id === room.id);
  // Old outdoor rooms only had the north wall.
  const outdoor = room.objects.length === 1;

  const used = new Set<string>();
  const props: PropSpec[] = room.groups.map((group, i) => {
    const name = meta?.items[i]?.name ?? prompt(group.objects[0].textureId);
    let id = slug(name, 32);
    while (used.has(id)) id = `${slug(name, 28)}-${i}`;
    used.add(id);

    const parts: PartSpec[] = group.objects.map((part) => {
      const shape = SHAPES[part.type];
      const described = prompt(part.textureId);
      return {
        shape,
        position: part.position,
        rotation: part.rotation,
        size: shape === "panel" ? [part.scale[0], part.scale[1], 0] : part.scale,
        solid: part.collisionsEnabled,
        // Boxes and wedges were tiled with a material; panels were a picture of the item.
        ...(shape === "panel" ? (described !== name ? { art: described } : {}) : { material: described }),
      };
    });
    return { id, name, position: group.position, rotationY: group.rotation[1], parts };
  });

  for (const light of room.lights ?? []) {
    const [x, , z] = light.position;
    const nearest = props
      .filter((p) => !p.light)
      .map((p) => ({ p, d: Math.hypot(p.position[0] - x, p.position[2] - z) }))
      .sort((a, b) => a.d - b.d)[0];
    if (nearest && nearest.d <= LIGHT_REACH) nearest.p.light = convertLight(light);
  }

  return {
    id: room.id,
    name: meta?.name ?? room.id,
    outdoor,
    grid: room.gridPosition,
    size: room.dimensions,
    start: [room.startPosition[0], room.startPosition[2]],
    baseLight: room.lightLevel ?? (room.lights?.length ? 0.2 : 0.3),
    walls: prompt(`${room.id}-walls`),
    floor: prompt(room.floorTextureId),
    doors: room.doors.map((d) => ({ connection: d.connectionId, offset: d.offset })),
    props,
    characters: [],
    pickups: [],
  };
}

let failed = false;
for (const file of (await readdir(HOUSES_DIR)).filter((n) => n.endsWith(".json")).sort()) {
  const house = JSON.parse(await readFile(join(HOUSES_DIR, file), "utf8")) as OldHouse;
  const prompts = new Map(house.game.textures.map((t) => [t.id, t.prompt]));
  const prompt = (id: string) => prompts.get(id) ?? id;
  const id = slug(house.title.replace(/^the\s+/i, ""), 40);

  const game = {
    version: 1,
    title: house.title,
    summary: house.story,
    rooms: house.game.rooms.map((room) => convertRoom(room, house, prompt)),
    connections: house.game.connections.map((c): ConnectionSpec => ({ id: c.id, rooms: c.roomIds, locked: false })),
  };

  const { spec, issues } = validateGame(game);
  const errors = errorsIn(issues);
  if (!spec || errors.length) {
    failed = true;
    console.log(`✗ ${file} → ${id}:\n${formatIssues(errors)}`);
    continue;
  }
  await writeFile(join(OUT_DIR, `${id}.json`), JSON.stringify(game, null, 2) + "\n");
  const warnings = issues.length ? `, ${issues.length} warning(s):\n${formatIssues(issues)}` : "";
  console.log(`✓ ${file} → fixtures/games/${id}.json (${game.rooms.length} rooms, ${game.rooms.reduce((n, r) => n + r.props.length, 0)} props)${warnings}`);
}
if (failed) process.exitCode = 1;
