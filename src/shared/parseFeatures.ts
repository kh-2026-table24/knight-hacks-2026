import { PLAYER } from "./constants";
import { isFields, isNumber, type Obj, type Reader } from "./reader";
import {
  DEFAULTS,
  ITEM_KINDS,
  LIGHT_EFFECTS,
  LIGHT_TYPES,
  LIMITS,
  MOVEMENT_TYPES,
  type AmbientSpec,
  type CharacterArt,
  type CharacterSpec,
  type Damage,
  type FinaleSpec,
  type ItemSpec,
  type LightSpec,
  type Movement,
  type Vec2,
} from "./spec";

// Parsers for the building blocks that props and characters share: dialogue lines, items, damage,
// lights and ambient effects, plus characters themselves. parseSpec.ts handles the game and room level.

/** Parses an optional nested object field with `parse`, if present. */
export function nested<T>(o: Obj, key: string, parse: (r: Reader, value: unknown, path: string) => T | undefined, r: Reader): T | undefined {
  return o.has(key) ? parse(r, o.raw(key), o.at(key)) : undefined;
}

const CHARACTER_FIELDS = ["id", "name", "position", "size", "art", "solid", "movement", "dialogue", "afterwards", "gives", "objective", "hostile", "scream", "jumpscare", "finale", "light"];

export function parseCharacter(r: Reader, value: unknown, path: string): CharacterSpec | undefined {
  const o = r.object(value, path, CHARACTER_FIELDS);
  if (!o) return undefined;
  const id = o.slug("id");
  const name = o.text("name", { max: 60 });
  const position = o.vec3("position");
  const size = o.vec2("size");
  if (size) {
    const [[minW, maxW], [minH, maxH]] = [LIMITS.characterWidth, LIMITS.characterHeight];
    if (size[0] < minW || size[0] > maxW || size[1] < minH || size[1] > maxH) {
      o.error("size", `[width, height] must have width from ${minW} to ${maxW} and height from ${minH} to ${maxH}, got [${size.join(", ")}]`);
    }
  }
  if (!o.has("art")) o.error("art", "is required");
  const art = nested(o, "art", parseCharacterArt, r);
  const solid = o.bool("solid", { optional: true }) ?? false;
  const movement = nested(o, "movement", parseMovement, r);
  const dialogue = parseLines(r, o, "dialogue", LIMITS.dialogueLines);
  const afterwards = parseLines(r, o, "afterwards", LIMITS.afterwardsLines);
  const gives = nested(o, "gives", parseItem, r);
  if (o.has("gives") && !o.has("dialogue")) o.error("gives", `needs "dialogue": the item is handed over when the player finishes talking`);
  const objective = o.slug("objective", { optional: true });
  if (objective && !o.has("dialogue")) o.error("objective", `needs "dialogue": the objective is set when the player finishes talking`);
  const hostile = nested(o, "hostile", parseDamage, r);
  // Only hostile characters scream; on anyone else it's ignored. Left out, screamFor makes one from the art.
  const chosenScream = o.text("scream", { optional: true });
  const jumpscare = o.text("jumpscare", { optional: true });
  if (jumpscare && !hostile) o.error("jumpscare", `is only for hostile characters: it's the face they scare the player with`);
  const finale = nested(o, "finale", parseFinale, r);
  if (finale && !hostile) o.error("finale", `is only for a hostile character: the antagonist whose jumpscare ends the game`);
  const light = nested(o, "light", parseLight, r);
  if (o.failed || !id || !name || !position || !size || !art) return undefined;
  const scream = hostile && chosenScream;
  return {
    id, name, position, size, art, solid,
    ...(movement && { movement }), ...(dialogue && { dialogue }), ...(afterwards && { afterwards }), ...(gives && { gives }), ...(objective && { objective }),
    ...(hostile && { hostile }), ...(scream && { scream }),
    ...(jumpscare && { jumpscare }), ...(finale && { finale }), ...(light && { light }),
  };
}

function parseFinale(r: Reader, value: unknown, path: string): FinaleSpec | undefined {
  const after = r.object(value, path, ["after"])?.slug("after");
  return after ? { after } : undefined;
}

function parseCharacterArt(r: Reader, value: unknown, path: string): CharacterArt | undefined {
  const o = r.object(value, path, ["description", "idle", "moving"]);
  if (!o) return undefined;
  const description = o.text("description");
  const idle = o.strings("idle", { optional: true, min: 1, max: LIMITS.framesPerState }) ?? [...DEFAULTS.idle];
  const moving = o.strings("moving", { optional: true, min: 1, max: LIMITS.framesPerState });
  if (o.failed || !description) return undefined;
  return { description, idle, ...(moving && { moving }) };
}

const MOVEMENT_FIELDS: Record<Movement["type"], string[]> = {
  wander: ["type", "speed", "radius"],
  patrol: ["type", "speed", "points"],
  chase: ["type", "speed", "detectRadius"],
};

function parseMovement(r: Reader, value: unknown, path: string): Movement | undefined {
  const declared = isFields(value) ? MOVEMENT_FIELDS[value.type as Movement["type"]] : undefined;
  const o = r.object(value, path, declared ?? ["type", "speed", "radius", "points", "detectRadius"]);
  if (!o) return undefined;
  const type = o.oneOf("type", MOVEMENT_TYPES);
  const speed = o.num("speed", { above: 0 });
  if (speed !== undefined && speed > LIMITS.maxSpeed) {
    o.error("speed", `must be at most ${LIMITS.maxSpeed}, slower than the player's ${PLAYER.speed} so they can get away, got ${speed}`);
  }
  if (type === "wander") {
    const [min, max] = LIMITS.wanderRadius;
    const radius = o.num("radius", { min, max });
    if (!o.failed && speed !== undefined && radius !== undefined) return { type, speed, radius };
  } else if (type === "patrol") {
    const points = o.array("points", (v, p) => point(r, v, p), { min: 2, max: LIMITS.patrolPoints });
    if (!o.failed && speed !== undefined && points) return { type, speed, points };
  } else if (type === "chase") {
    const detectRadius = o.num("detectRadius", { above: 0, max: LIMITS.detectRadius });
    if (!o.failed && speed !== undefined && detectRadius !== undefined) return { type, speed, detectRadius };
  }
  return undefined;
}

function point(r: Reader, value: unknown, path: string): Vec2 | undefined {
  if (Array.isArray(value) && value.length === 2 && value.every(isNumber)) return [value[0], value[1]];
  r.error(path, `${path} must be an [x, z] pair of numbers`);
  return undefined;
}

/** An optional list of lines the player reads one at a time: dialogue, examine text, afterwards. */
export function parseLines(r: Reader, o: Obj, key: string, max: number): string[] | undefined {
  const raw = o.raw(key);
  // Games saved before dialogue became one conversation have a list of { speaker, lines }; they play as one.
  if (Array.isArray(raw) && raw.length > 0 && raw.every(isFields)) {
    return o.array(key, (v, p) => r.object(v, p, ["speaker", "lines"])?.strings("lines", { min: 1, maxLength: LIMITS.lineLength }))?.flat();
  }
  return o.strings(key, { optional: true, min: 1, max, maxLength: LIMITS.lineLength });
}

const ITEM_FIELDS: Record<ItemSpec["kind"], string[]> = {
  key: ["kind", "name", "art", "unlocks"],
};

export function parseItem(r: Reader, value: unknown, path: string): ItemSpec | undefined {
  const declared = isFields(value) ? ITEM_FIELDS[value.kind as ItemSpec["kind"]] : undefined;
  const o = r.object(value, path, declared ?? ["kind", ...new Set(Object.values(ITEM_FIELDS).flat())]);
  if (!o) return undefined;
  const kind = o.oneOf("kind", ITEM_KINDS);
  if (kind === "key") {
    const name = o.text("name", { max: 60 });
    const art = o.text("art");
    const unlocks = o.slug("unlocks");
    if (!o.failed && name && art && unlocks) return { kind, name, art, unlocks };
  }
  return undefined;
}

export function parseDamage(r: Reader, value: unknown, path: string): Damage | undefined {
  const o = r.object(value, path, ["damage"]);
  const damage = o?.num("damage", { int: true, min: 1, max: PLAYER.maxHearts });
  return damage === undefined ? undefined : { damage };
}

export function parseLight(r: Reader, value: unknown, path: string): LightSpec | undefined {
  const o = r.object(value, path, ["type", "color", "intensity", "range", "effect"]);
  if (!o) return undefined;
  const type = o.oneOf("type", LIGHT_TYPES);
  const color = o.color("color");
  const intensity = o.num("intensity", { above: 0, max: LIMITS.lightIntensity });
  const range = o.num("range", { above: 0, max: LIMITS.lightRange });
  const effect = o.oneOf("effect", LIGHT_EFFECTS, { optional: true }) ?? "steady";
  if (o.failed || !type || !color || intensity === undefined || range === undefined) return undefined;
  return { type, color, intensity, range, effect };
}

export function parseAmbient(r: Reader, value: unknown, path: string): AmbientSpec | undefined {
  const o = r.object(value, path, ["art", "size", "everySeconds", "lifetimeSeconds", "velocity", "gravity"]);
  if (!o) return undefined;
  const art = o.text("art");
  const size = o.vec2("size");
  if (size && !(size[0] > 0 && size[1] > 0)) o.error("size", `must be positive, got [${size.join(", ")}]`);
  const everySeconds = o.num("everySeconds", { min: LIMITS.ambientEvery });
  const lifetimeSeconds = o.num("lifetimeSeconds", { above: 0, max: LIMITS.ambientLifetime });
  const velocity = o.vec3("velocity", { optional: true }) ?? [0, 0, 0];
  const gravity = o.bool("gravity", { optional: true }) ?? true;
  if (o.failed || !art || !size || everySeconds === undefined || lifetimeSeconds === undefined) return undefined;
  return { art, size, everySeconds, lifetimeSeconds, velocity, gravity };
}
