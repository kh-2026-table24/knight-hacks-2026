import { doorSides, playOrder } from "./checkGame";
import { DOOR } from "./constants";
import type { CharacterArt, CharacterSpec, DoorSpec, GameSpec, IntroSpec, ItemSpec, PartSpec, PropSpec, RoomSpec, AmbientSpec, Vec2 } from "./spec";

// Art is described inline in a GameSpec ("material": "dark oak planks"), so there's no texture table to
// keep in sync. These functions derive every image a game needs and a stable id for each. The server
// generates images by id and the client requests them by id, both from the same derivation, so a
// reference can't dangle. Identical descriptions share one image, even across rooms.

/**
 * surface: a seamless tile. cutout: a picture on a transparent background. character: a cutout of a
 * figure facing right. picture: a whole scene, edge to edge (the intro's). scare: a hostile character's
 * face as a cutout, for its jumpscare.
 */
export type ArtKind = "surface" | "cutout" | "character" | "picture" | "scare";

export interface ArtJob {
  id: string;
  kind: ArtKind;
  /** surface: the material. cutout: the subject. character, and every later animation frame: the pose. */
  prompt: string;
  /** What the picture is of, for character frames and later animation frames. */
  subject?: string;
  aspectRatio: string;
  /** Later animation frames: the id of the first frame, drawn first and passed as a reference. */
  referenceId?: string;
  /** Shared UI art the client loads directly; never generated. */
  builtinUrl?: string;
}

// Aspect ratios Gemini can generate. Cutouts use the closest one to what they're drawn on.
const ASPECT_RATIOS = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9", "1:4", "4:1", "1:8", "8:1"];

export function closestAspectRatio(aspect: number) {
  const distance = (ratio: string) => {
    const [w, h] = ratio.split(":").map(Number);
    return Math.abs(Math.log(w / h) - Math.log(aspect));
  };
  return ASPECT_RATIOS.reduce((best, ratio) => (distance(ratio) < distance(best) ? ratio : best));
}

// cyrb53: a small, well-spread string hash, so ids are stable across runs without a dependency.
export function hash(text: string) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0").slice(-8);
}

export const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32).replace(/-$/, "") || "art";

function job(kind: ArtKind, prompt: string, aspect: number, extra: Pick<ArtJob, "subject" | "referenceId"> = {}): ArtJob {
  const aspectRatio = kind === "surface" ? "1:1" : closestAspectRatio(aspect);
  const key = [kind, prompt, extra.subject ?? "", aspectRatio, extra.referenceId ?? ""].join("|");
  // Named after the subject when there is one, so a character's frames sit together in the assets folder.
  return { id: `${kind}-${slug(extra.subject ?? prompt)}-${hash(key)}`, kind, prompt, aspectRatio, ...extra };
}

/** What a solid part is made of: its own material, else its prop's. Undefined for a plain-colored part (a color and no material). */
export const materialOf = (prop: Pick<PropSpec, "material" | "name">, part: Pick<PartSpec, "material" | "color">) =>
  part.material ?? prop.material ?? (part.color ? undefined : prop.name);

/** The art behind each thing in a game. The engine asks these for texture ids; collectArt gathers all of them. */
export const artFor = {
  surface: (material: string) => job("surface", material, 1),

  door: (room: Pick<RoomSpec, "walls">, door: Pick<DoorSpec, "art">) => job("cutout", door.art ?? `door set into ${room.walls}, front view`, DOOR.width / DOOR.height),

  /** A panel's frames: its picture first, then any further frames drawn from it. */
  panel(prop: Pick<PropSpec, "name">, part: Pick<PartSpec, "art" | "frames" | "size">): ArtJob[] {
    const aspect = part.size[0] / part.size[1];
    const base = job("cutout", part.art ?? prop.name, aspect);
    return [base, ...(part.frames ?? []).map((pose) => job("cutout", pose, aspect, { subject: base.prompt, referenceId: base.id }))];
  },

  /** A character's frames per state. idle[0] is drawn first and every other frame is drawn from it. */
  character(art: CharacterArt, size: Vec2): { idle: ArtJob[]; moving: ArtJob[] } {
    const aspect = size[0] / size[1];
    const base = job("character", art.idle[0], aspect, { subject: art.description });
    const frame = (pose: string) => job("character", pose, aspect, { subject: art.description, referenceId: base.id });
    return { idle: [base, ...art.idle.slice(1).map(frame)], moving: (art.moving ?? []).map(frame) };
  },

  item: (item: ItemSpec) => job("cutout", item.art, 1),

  ambient: (ambient: Pick<AmbientSpec, "art" | "size">) => job("cutout", ambient.art, ambient.size[0] / ambient.size[1]),

  intro: (intro: IntroSpec) => job("picture", intro.art, 16 / 9),

  /** A hostile character's jumpscare face: who it is, and what its face is like up close if the spec says. */
  scare: ({ art, jumpscare }: Pick<CharacterSpec, "jumpscare" | "art">) => job("scare", jumpscare ? `${art.description}; up close, ${jumpscare}` : art.description, 3 / 4),
};

/** Every image one room needs, in the order worth loading them: surfaces, then the rest. */
export function roomArt(spec: Pick<GameSpec, "rooms" | "connections">, room: RoomSpec): ArtJob[] {
  // South doors are exit strips on the floor, drawn without a picture.
  const sides = doorSides(spec.rooms, spec.connections).get(room.id);
  const out = [artFor.surface(room.walls), artFor.surface(room.floor)];
  for (const door of room.doors) {
    const side = sides?.get(door.connection);
    if (side && side !== "south") out.push(artFor.door(room, door));
  }
  for (const prop of room.props) {
    for (const part of prop.parts) {
      const material = materialOf(prop, part);
      out.push(...(part.shape === "panel" ? artFor.panel(prop, part) : material ? [artFor.surface(material)] : []));
    }
    if (prop.contains) out.push(artFor.item(prop.contains));
    if (prop.ambient) out.push(artFor.ambient(prop.ambient));
  }
  for (const character of room.characters) {
    const frames = artFor.character(character.art, character.size);
    out.push(...frames.idle, ...frames.moving);
    if (character.hostile) out.push(artFor.scare(character));
    if (character.gives) out.push(artFor.item(character.gives));
  }
  for (const pickup of room.pickups) out.push(artFor.item(pickup.item));
  return out;
}

/** Every image the game needs, by id. */
export function collectArt(spec: Pick<GameSpec, "rooms" | "connections" | "intro">): Map<string, ArtJob> {
  const jobs = new Map<string, ArtJob>();
  if (spec.intro) {
    const intro = artFor.intro(spec.intro);
    jobs.set(intro.id, intro);
  }
  for (const room of spec.rooms) for (const art of roomArt(spec, room)) jobs.set(art.id, art);
  return jobs;
}

/**
 * Every image the game needs, once each, with the play-order position of the first room that needs it
 * (0 is the start). The intro's picture comes first: it's on screen before any room.
 */
export function artInPlayOrder(spec: Pick<GameSpec, "rooms" | "connections" | "intro">): { job: ArtJob; room: number }[] {
  const seen = new Map<string, { job: ArtJob; room: number }>();
  if (spec.intro) {
    const intro = artFor.intro(spec.intro);
    seen.set(intro.id, { job: intro, room: 0 });
  }
  playOrder(spec).forEach((room, i) => {
    for (const job of roomArt(spec, room)) if (!seen.has(job.id)) seen.set(job.id, { job, room: i });
  });
  return [...seen.values()];
}

/** The ids one room needs, without repeats. */
export const artIdsForRoom = (spec: Pick<GameSpec, "rooms" | "connections">, room: RoomSpec) => [...new Set(roomArt(spec, room).map((art) => art.id))];
