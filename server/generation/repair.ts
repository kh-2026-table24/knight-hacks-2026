import { isFields } from "../../src/shared/reader";

export interface RepairContext {
  /** The previous attempt's JSON, or its raw text if it didn't parse. */
  previous: string;
  problems: string[];
}

/** Appended to a prompt when the previous answer failed validation and needs writing again in full. */
export const repairSection = ({ previous, problems }: RepairContext, tag: string, howToFix: string) => `
<previous_attempt>
${previous}
</previous_attempt>

<problems>
${problems.map((p) => `- ${p}`).join("\n")}
</problems>

Your previous attempt (above) failed the checks with the problems listed. Fix every problem while
changing as little else as possible: ${howToFix}. Respond in the same format; keep the notes to a
short list of your changes, then give the complete corrected <${tag}>.
`;

/**
 * Appended to a room prompt to fix a built room with a patch rather than a new room: Claude writes only
 * what changes, which costs a fraction of writing the whole room again.
 */
export const patchSection = ({ previous, problems }: RepairContext) => `
This room has already been built; here it is as it stands:

<current_room>
${previous}
</current_room>

<problems>
${problems.map((p) => `- ${p}`).join("\n")}
</problems>

Fix every problem while changing as little else as possible: move, resize, replace or remove things,
and keep the room's story and look. Answer with only a patch, as one compact JSON object inside
<patch></patch>, with any of these fields:

{
  "room": { room fields to replace, such as "start" },
  "props": [complete prop objects: each replaces the prop with the same id, or is added if it's new],
  "characters": [complete character objects, by id, likewise],
  "pickups": [complete pickup objects, by id, likewise],
  "doors": [complete door objects, by "connection", likewise],
  "remove": ["ids of props, characters or pickups to delete"]
}

Leave out everything you don't change. Write nothing after </patch>.
`;

// Each list in a room, and the field that identifies its entries.
const LISTS = [
  ["props", "id"],
  ["characters", "id"],
  ["pickups", "id"],
  ["doors", "connection"],
] as const;

/** The room with a patch (see patchSection) applied. Throws if the patch isn't an object. */
export function applyPatch(room: unknown, patch: unknown): Record<string, unknown> {
  if (!isFields(patch)) throw new Error("The patch must be a JSON object");
  const next: Record<string, unknown> = { ...(isFields(room) ? room : {}), ...(isFields(patch.room) ? patch.room : {}) };
  const remove = new Set(Array.isArray(patch.remove) ? patch.remove : []);
  for (const [list, field] of LISTS) {
    const keyOf = (entry: unknown) => (isFields(entry) ? entry[field] : undefined);
    const current = Array.isArray(next[list]) ? (next[list] as unknown[]) : [];
    const changes = Array.isArray(patch[list]) ? (patch[list] as unknown[]) : [];
    const replacing = new Map(changes.map((entry) => [keyOf(entry), entry]));
    const kept = current.filter((entry) => !remove.has(keyOf(entry))).map((entry) => replacing.get(keyOf(entry)) ?? entry);
    const added = changes.filter((entry) => !current.some((old) => keyOf(old) === keyOf(entry)));
    next[list] = [...kept, ...added];
  }
  return next;
}
