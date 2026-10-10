import { buildRoom } from "./buildRoom";
import { checkLayout } from "./checkLayout";
import type { RoomContext } from "./output/housePlan";
import type { Room, Texture } from "./output/output";
import { parseRoomPlan, type RoomPlan } from "./output/roomPlan";
import { roomPrompt } from "./prompts/room";
import type { RepairContext } from "./prompts/repair";
import { extractTagged, extractTaggedJson } from "./tagged";

export type AskFn = (prompt: string) => Promise<string>;

export interface GeneratedRoom {
  context: RoomContext;
  /** Claude's <notes>: what happened here, door offsets, footprint math. */
  notes: string;
  plan: RoomPlan;
  room: Room;
  textures: Texture[];
  warnings: string[];
  attempts: number;
  seconds: number;
}

// One try plus one repair. Claude fixes a specific list of problems well; if it can't after
// that, the caller should fall back to a known-good room rather than keep the player waiting.
const MAX_ATTEMPTS = 2;

/** Generates one validated room for its place in the house. Throws if no valid room comes back. */
export async function generateRoom(ask: AskFn, context: RoomContext): Promise<GeneratedRoom> {
  const started = Date.now();
  const layoutContext = { outdoor: context.room.outdoor, doors: context.doors };
  let repair: RepairContext | undefined;
  let problems: string[] = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await ask(roomPrompt(context, repair));

    let json: unknown;
    try {
      json = extractTaggedJson(response, "room");
    } catch (error) {
      problems = [`Your response could not be read: ${error instanceof Error ? error.message : String(error)}`];
      repair = { previous: response, problems };
      continue;
    }

    const parsed = parseRoomPlan(json);
    const layout = parsed.plan ? checkLayout(parsed.plan, layoutContext) : { errors: [], warnings: [] };
    problems = [...parsed.errors, ...layout.errors];
    if (parsed.plan && problems.length === 0) {
      const { room, textures } = buildRoom(parsed.plan, context.room);
      return {
        context,
        notes: extractTagged(response, "notes") ?? "",
        plan: parsed.plan,
        room,
        textures,
        warnings: layout.warnings,
        attempts: attempt,
        seconds: Math.round((Date.now() - started) / 1000),
      };
    }
    repair = { previous: JSON.stringify(json), problems };
  }

  throw new Error(`Room "${context.room.id}": no valid layout after ${MAX_ATTEMPTS} attempts. Last problems:\n- ${problems.join("\n- ")}`);
}
