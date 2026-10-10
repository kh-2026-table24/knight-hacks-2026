import { generateRoom, type AskFn, type GeneratedRoom } from "./generateRoom";
import { rollLayout } from "./layouts";
import { doorSlots, parseHousePlan, type HousePlan } from "./output/housePlan";
import type { Game } from "./output/output";
import { housePrompt } from "./prompts/house";
import type { RepairContext } from "./prompts/repair";
import { extractTagged, extractTaggedJson } from "./tagged";
import { rollTheme } from "./theme";

export interface HouseOptions {
  /** Defaults to a random roll. */
  theme?: string;
  /** Exact number of rooms; omit to let the planner choose (4 to 6). */
  roomCount?: number;
  /** Used for room layout calls instead of `ask`, e.g. to send them to a stronger model. */
  askRoom?: AskFn;
  onPlan?: (plan: HousePlan, notes: string) => void;
  onRoom?: (room: GeneratedRoom) => void;
}

export interface GeneratedHouse {
  theme: string;
  plan: HousePlan;
  /** The planner's <notes>. */
  notes: string;
  rooms: GeneratedRoom[];
  game: Game;
  seconds: number;
}

/** What scripts/gen-house.ts saves and generate.ts loads: the game plus what Claude was thinking. */
export interface SavedHouse {
  theme: string;
  title: string;
  story: string;
  notes: string;
  seconds: number;
  rooms: {
    id: string;
    name: string;
    brief: string;
    layout: string;
    notes: string;
    warnings: string[];
    attempts: number;
    seconds: number;
    items: { name: string; position: number[]; parts: number }[];
  }[];
  game: Game;
}

const MAX_PLAN_ATTEMPTS = 2;

async function planHouse(ask: AskFn, theme: string, roomCount?: number) {
  let repair: RepairContext | undefined;
  let problems: string[] = [];
  for (let attempt = 1; attempt <= MAX_PLAN_ATTEMPTS; attempt++) {
    const response = await ask(housePrompt(theme, roomCount, repair));
    let json: unknown;
    try {
      json = extractTaggedJson(response, "house");
    } catch (error) {
      problems = [`Your response could not be read: ${error instanceof Error ? error.message : String(error)}`];
      repair = { previous: response, problems };
      continue;
    }
    const parsed = parseHousePlan(json, roomCount);
    if (parsed.plan) return { plan: parsed.plan, notes: extractTagged(response, "notes") ?? "" };
    problems = parsed.errors;
    repair = { previous: JSON.stringify(json), problems };
  }
  throw new Error(`No valid house plan after ${MAX_PLAN_ATTEMPTS} attempts. Last problems:\n- ${problems.join("\n- ")}`);
}

/** Plans the map, then lays out every room in parallel, so the wait is one plan plus the slowest room. */
export async function generateHouse(ask: AskFn, options: HouseOptions = {}): Promise<GeneratedHouse> {
  const started = Date.now();
  const theme = options.theme ?? rollTheme();
  const { plan, notes } = await planHouse(ask, theme, options.roomCount);
  options.onPlan?.(plan, notes);

  // allSettled, so one failed room doesn't hide the others' results from onRoom.
  const results = await Promise.allSettled(
    plan.rooms.map(async (room) => {
      const generated = await generateRoom(options.askRoom ?? ask, {
        theme,
        house: plan,
        room,
        layout: rollLayout(room.outdoor),
        doors: doorSlots(plan, room.id),
      });
      options.onRoom?.(generated);
      return generated;
    }),
  );
  const failures = results.flatMap((r) => (r.status === "rejected" ? [r.reason instanceof Error ? r.reason.message : String(r.reason)] : []));
  if (failures.length) throw new Error(failures.join("\n\n"));
  const rooms = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));

  return {
    theme,
    plan,
    notes,
    rooms,
    game: {
      textures: rooms.flatMap((r) => r.textures),
      connections: plan.connections.map((c) => ({ id: c.id, roomIds: c.roomIds })),
      rooms: rooms.map((r) => r.room),
    },
    seconds: Math.round((Date.now() - started) / 1000),
  };
}

export function toSavedHouse(house: GeneratedHouse): SavedHouse {
  return {
    theme: house.theme,
    title: house.plan.title,
    story: house.plan.story,
    notes: house.notes,
    seconds: house.seconds,
    rooms: house.rooms.map((r) => ({
      id: r.context.room.id,
      name: r.context.room.name,
      brief: r.context.room.brief,
      layout: r.context.layout,
      notes: r.notes,
      warnings: r.warnings,
      attempts: r.attempts,
      seconds: r.seconds,
      items: r.plan.items.map((item) => ({ name: item.name, position: item.position, parts: item.parts.length })),
    })),
    game: house.game,
  };
}
