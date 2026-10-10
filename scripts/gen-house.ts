// Generates a house with Claude, prints what it came up with, and saves it for the game to load.
// Needs the Claude server running (npm run server).
//
//   npx tsx scripts/gen-house.ts                  2 rooms, random theme
//   npx tsx scripts/gen-house.ts auto             planner picks 4-6 rooms
//   npx tsx scripts/gen-house.ts 2 "a lighthouse where the keeper vanished"
import { mkdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { askClaude, ROOM_MODEL } from "../src/game/generation/askClaude";
import { generateHouse, toSavedHouse } from "../src/game/generation/generateHouse";
import { rollTheme } from "../src/game/generation/theme";

// For now the default is the 2-room test house: the grounds outside plus the main room.
const DEFAULT_ROOMS = 2;
const OUT_DIR = join(import.meta.dirname, "..", "generated", "houses");

const [countArg, ...themeWords] = process.argv.slice(2);
const roomCount = countArg === "auto" ? undefined : Number(countArg ?? DEFAULT_ROOMS);
if (roomCount !== undefined && (!Number.isInteger(roomCount) || roomCount < 2)) {
  console.error(`Room count must be "auto" or an integer of at least 2, got "${countArg}"`);
  process.exit(1);
}
const theme = themeWords.length ? themeWords.join(" ") : rollTheme();

const indent = (text: string) => text.split("\n").map((line) => `  ${line}`).join("\n");
const heading = (text: string) => console.log(`\n━━ ${text} ━━`);
const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50);

console.log(`Theme\n${indent(theme)}\n\nPlanning ${roomCount ?? "4-6"} rooms...`);

try {
  const house = await generateHouse(askClaude, {
    askRoom: (prompt) => askClaude(prompt, ROOM_MODEL),
    theme,
    roomCount,
    onPlan(plan, notes) {
      heading(plan.title);
      console.log(indent(plan.story));
      if (notes) console.log(`\nPlanner notes\n${indent(notes)}`);
      console.log("\nRooms");
      for (const r of plan.rooms) console.log(`  ${r.id} [${r.gridPosition}] ${r.outdoor ? "outdoor" : "indoor"}: ${r.name}\n${indent(indent(r.brief))}`);
      console.log(`Connections: ${plan.connections.map((c) => c.roomIds.join(" <-> ")).join(", ")}`);
      console.log(`\nLaying out ${plan.rooms.length} rooms in parallel...`);
    },
    onRoom({ context, notes, plan, warnings, attempts, seconds }) {
      heading(`${context.room.name} (${context.room.id}): ${seconds}s, ${attempts} attempt(s)`);
      console.log(`Layout style: ${context.layout}`);
      console.log(`Size [W, H, D]: ${plan.dimensions.join(" x ")}   start: [${plan.startPosition}]`);
      console.log(`Walls: ${plan.wallDescription}\nFloor: ${plan.floorDescription}`);
      console.log(`Doors: ${plan.doors.map((d) => `${d.connectionId} @ ${d.offset}`).join(", ") || "none"}`);
      if (notes) console.log(`Notes\n${indent(notes)}`);
      console.table(plan.items.map((item) => ({ name: item.name, position: item.position.join(", "), parts: item.parts.length })));
      if (warnings.length) console.log(`Warnings\n${indent(warnings.join("\n"))}`);
    },
  });

  const name = `${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}-${slug(house.plan.title)}`;
  const path = join(OUT_DIR, `${name}.json`);
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(path, JSON.stringify(toSavedHouse(house), null, 2));
  console.log(`\nDone in ${house.seconds}s. Saved ${relative(process.cwd(), path)}`);
  console.log(`The game loads the newest house; to pick this one, open http://localhost:5173/?house=${name}`);
} catch (error) {
  if (error instanceof TypeError && String(error.message).includes("fetch")) {
    console.error("\nCould not reach the Claude server. Start it first with: npm run server");
  } else {
    console.error(`\nGeneration failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  process.exit(1);
}
