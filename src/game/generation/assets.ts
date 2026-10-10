import type { TextureLibrary } from "../TextureLibrary";
import { ObjectType, type Game, type Group, type Object as ObjectOutput, type Sprite } from "./output/output";

// Shared by every prompt so all of a game's assets look like they belong together.
const STYLE =
  "Dark, eerie 2D pixel art for a horror video game: muted desaturated colors, crisp hard-edged pixels, dark outlines, no anti-aliasing, no blur.";

// Cutouts are drawn on a green screen that is then made transparent. Green rather than white so
// pale subjects (ghosts, bones, candles) don't get erased along with the background.
const KEY_COLOR = "pure bright green (#00FF00)";
const isKeyColor = (r: number, g: number, b: number) => g >= 180 && r <= 120 && b <= 120;

const CUTOUT_LONG_SIDE = 128; // pixels along a cutout's longer side
const SURFACE_SIZE = 64; // surfaces are square tiles
const MAX_CONCURRENT = 6; // Gemini calls in flight at once

// Aspect ratios Gemini can generate. Cutouts use the closest one to the plane they're drawn on.
const ASPECT_RATIOS = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9", "1:4", "4:1", "1:8", "8:1"];

type Kind = "cutout" | "surface";

export interface AssetJob {
  id: string;
  prompt: string;
  kind: Kind;
  aspectRatio: string;
  /** For later animation frames: the texture id of the first frame, drawn first and passed as a reference. */
  referenceId?: string;
}

export type Draw = (prompt: string, reference?: string, aspectRatio?: string) => Promise<string>;

/**
 * Generates every texture the game uses and swaps each into the library as soon as it's ready.
 * The game stays playable meanwhile, showing placeholders.
 */
export async function generateAssets(game: Game, textures: TextureLibrary) {
  // Imported lazily so an SDK problem can't stop the game from loading.
  const { askGemini } = await import("../../character");
  const jobs = planAssets(game);
  console.log(`Generating ${jobs.length} assets`);

  const failed = await runAssetJobs(jobs, askGemini, async (job, base64) => {
    await textures.setImage(job.id, await toCanvas(base64, job.kind));
  });
  console.log(`Assets done: ${jobs.length - failed.length} generated, ${failed.length} failed`, failed);
}

/** Runs jobs in parallel (up to MAX_CONCURRENT at once). Animation frames wait only for their own first frame. */
export async function runAssetJobs(jobs: AssetJob[], draw: Draw, onImage: (job: AssetJob, base64: string) => Promise<void>) {
  const limit = limiter(MAX_CONCURRENT);
  const byId = new Map(jobs.map((j) => [j.id, j]));
  const started = new Map<string, Promise<string>>();

  const start = (job: AssetJob): Promise<string> => {
    const existing = started.get(job.id);
    if (existing) return existing;
    const referenceJob = job.referenceId ? byId.get(job.referenceId) : undefined;
    const reference = referenceJob ? start(referenceJob) : undefined;
    const result = (async () => {
      // If the first frame failed, still draw this one, just without the reference.
      const ref = reference ? await reference.catch(() => undefined) : undefined;
      const prompt = ref ? framePrompt(job.prompt) : job.kind === "surface" ? surfacePrompt(job.prompt) : cutoutPrompt(job.prompt);
      return limit(() => draw(prompt, ref, job.aspectRatio));
    })();
    started.set(job.id, result);
    return result;
  };

  const results = await Promise.allSettled(jobs.map(async (job) => onImage(job, await start(job))));
  return results.flatMap((r, i) => (r.status === "rejected" ? [{ id: jobs[i].id, error: r.reason as unknown }] : []));
}

/** Works out what to generate for each texture id, based on what it's drawn on. Unused textures are skipped. */
export function planAssets(game: Game): AssetJob[] {
  const prompts = new Map(game.textures.map((t) => [t.id, t.prompt]));
  const jobs = new Map<string, AssetJob>();
  const add = (id: string | undefined, kind: Kind, aspect: number, referenceId?: string) => {
    if (id === undefined || jobs.has(id)) return;
    const prompt = prompts.get(id);
    if (prompt === undefined) return;
    jobs.set(id, { id, prompt, kind, aspectRatio: kind === "surface" ? "1:1" : closestAspectRatio(aspect), referenceId });
  };

  const items = drawables(game);
  // Animation frames first, so each is tied to its first frame even if it's also used elsewhere.
  for (const item of items) {
    if (!item.animations) continue;
    const frames = [...new Set([...item.animations.idle, ...Object.values(item.animations).flat()])];
    const [first, ...rest] = frames;
    add(first, "cutout", aspectOf(item));
    for (const id of rest) add(id, "cutout", aspectOf(item), first);
  }
  for (const item of items) add(item.textureId, item.type === ObjectType.Plane ? "cutout" : "surface", aspectOf(item));
  for (const room of game.rooms) add(room.floorTextureId, "surface", 1);
  return [...jobs.values()];
}

type Drawable = Pick<ObjectOutput, "type" | "scale" | "textureId"> & Partial<Pick<Sprite, "animations" | "actions">>;

// Everything that can carry a texture: room objects, grouped objects, doors, and sprites spawned by emitters.
function drawables(game: Game): Drawable[] {
  const out: Drawable[] = [];
  const add = (item: Drawable) => {
    out.push(item);
    const emitted = item.actions?.emit?.sprite;
    if (emitted) add(emitted);
  };
  const addGroup = (group: Group) => {
    group.objects.forEach(add);
    group.groups?.forEach(addGroup);
  };
  for (const room of game.rooms) {
    room.objects.forEach(add);
    room.groups?.forEach(addGroup);
    room.doors?.forEach(add);
  }
  return out;
}

const aspectOf = (item: Drawable) => (item.scale[1] > 0 ? item.scale[0] / item.scale[1] : 1);

function closestAspectRatio(aspect: number) {
  const distance = (ratio: string) => {
    const [w, h] = ratio.split(":").map(Number);
    return Math.abs(Math.log(w / h) - Math.log(aspect));
  };
  return ASPECT_RATIOS.reduce((best, ratio) => (distance(ratio) < distance(best) ? ratio : best));
}

function cutoutPrompt(prompt: string) {
  return [
    STYLE,
    `A single game sprite of ${prompt}.`,
    "Centered, with the whole subject visible and filling most of the image.",
    `Solid flat ${KEY_COLOR} background everywhere around the subject, and no bright green on the subject itself.`,
    "No text, no border, no cast shadow, no ground, no scenery.",
  ].join(" ");
}

function surfacePrompt(prompt: string) {
  return [
    STYLE,
    `A seamless tileable texture of ${prompt}.`,
    "Viewed straight on, filling the entire image edge to edge with even flat lighting.",
    "No single objects, no border, no frame, no text, no perspective.",
  ].join(" ");
}

function framePrompt(prompt: string) {
  return [
    STYLE,
    "The attached image is the first frame of a sprite animation.",
    `Draw another frame of the same animation: ${prompt}.`,
    "Keep the exact same subject, art style, pixel size, outlines, color palette, proportions and scale,",
    "and keep it in the same place in the image so the frames line up when played in sequence. Change only the pose or motion described.",
    `Solid flat ${KEY_COLOR} background, the same as the attached image. No text, no border, no cast shadow, no scenery.`,
  ].join(" ");
}

// Shrinks Gemini's 1024px+ JPEG to pixel-art size with nearest-neighbor sampling, and for cutouts
// makes the green screen transparent. Removes green everywhere, not just from the edges, so gaps
// (between legs, inside handles) come out transparent too.
async function toCanvas(base64: string, kind: Kind) {
  const bitmap = await createImageBitmap(await (await fetch(`data:image/jpeg;base64,${base64}`)).blob());
  const aspect = bitmap.width / bitmap.height;
  const [width, height] =
    kind === "surface"
      ? [SURFACE_SIZE, SURFACE_SIZE]
      : aspect >= 1
        ? [CUTOUT_LONG_SIDE, Math.round(CUTOUT_LONG_SIDE / aspect)]
        : [Math.round(CUTOUT_LONG_SIDE * aspect), CUTOUT_LONG_SIDE];

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bitmap, 0, 0, width, height);

  if (kind === "cutout") {
    const image = ctx.getImageData(0, 0, width, height);
    const d = image.data;
    for (let i = 0; i < d.length; i += 4) if (isKeyColor(d[i], d[i + 1], d[i + 2])) d[i + 3] = 0;
    ctx.putImageData(image, 0, 0);
  }
  return canvas;
}

function limiter(max: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= max) await new Promise<void>((resolve) => waiting.push(resolve));
    active++;
    try {
      return await task();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}
