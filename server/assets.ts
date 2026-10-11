import { GoogleGenAI } from "@google/genai";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { collectArt, type ArtJob } from "../src/shared/art";
import type { GameSpec } from "../src/shared/spec";
import { gameDir } from "./games";
import { getSecret } from "./secrets";

// The key comes from .env.local locally and from Secret Manager on Cloud Run (see secrets.ts). The client
// is made on first use, so the server can still serve games and already-generated assets without a key.
let client: GoogleGenAI | undefined;
async function gemini() {
  client ??= new GoogleGenAI({ apiKey: await getSecret("GEMINI_IMAGE_KEY", "gemini-image-key") });
  return client;
}
const MODEL = "gemini-nano-banana-2.1";
const MAX_CONCURRENT = 6; // Gemini calls in flight at once

// Shared by every prompt so all of a game's assets look like they belong together.
const STYLE =
  "Dark, eerie 2D pixel art for a horror video game: muted desaturated colors, crisp hard-edged pixels, dark outlines, no anti-aliasing, no blur.";

// Cutouts are drawn on a green screen that is then made transparent. Green rather than white so
// pale subjects (ghosts, bones, candles) don't get erased along with the background.
const KEY_COLOR = "pure bright green (#00FF00)";
const isKeyColor = (r: number, g: number, b: number) => g >= 180 && r <= 120 && b <= 120;

const CUTOUT_LONG_SIDE = 128; // pixels along a cutout's longer side
const SURFACE_SIZE = 64; // surfaces are square tiles

type Kind = "cutout" | "surface";

const assetsDir = (gameId: string) => join(gameDir(gameId), "assets");

// The art plan for each game; games.ts keeps one GameSpec object per game file, so this stays warm.
const plans = new WeakMap<GameSpec, Map<string, ArtJob>>();
function planOf(game: GameSpec) {
  let plan = plans.get(game);
  if (!plan) plans.set(game, (plan = collectArt(game)));
  return plan;
}

/** The finished PNG for an art id: from disk if it's been made before, otherwise generated now. Undefined if the game has no such art. */
export async function getAsset(gameId: string, game: GameSpec, artId: string): Promise<Buffer | undefined> {
  const job = planOf(game).get(artId);
  if (!job || job.builtinUrl) return undefined;
  const file = join(assetsDir(gameId), `${job.id}.png`);
  return once(file, async () => {
    const existing = await readIfExists(file);
    if (existing) return existing;
    const png = await processImage(await original(gameId, game, job), job.kind === "surface" ? "surface" : "cutout");
    await writeFile(file, png);
    return png;
  });
}

/** Gemini's original JPEG for an art id, kept so later animation frames can use it as a reference. */
function original(gameId: string, game: GameSpec, job: ArtJob): Promise<Buffer> {
  const file = join(assetsDir(gameId), `${job.id}.jpg`);
  return once(file, async () => {
    const existing = await readIfExists(file);
    if (existing) return existing;

    const referenceJob = job.referenceId ? planOf(game).get(job.referenceId) : undefined;
    // If the first frame fails, still draw this one, just without the reference.
    const reference = referenceJob ? await original(gameId, game, referenceJob).catch(() => undefined) : undefined;
    const prompt = reference ? framePrompt(job.subject ?? job.prompt, job.prompt) : promptFor(job);

    const started = Date.now();
    console.log(`[${gameId}] generating ${job.id}${reference ? ` (from ${job.referenceId})` : ""}`);
    const jpeg = Buffer.from(await limit(() => askGemini(prompt, reference?.toString("base64"), job.aspectRatio)), "base64");
    console.log(`[${gameId}] generated ${job.id} in ${((Date.now() - started) / 1000).toFixed(1)}s`);

    await mkdir(assetsDir(gameId), { recursive: true });
    await writeFile(file, jpeg);
    return jpeg;
  });
}

/** The prompt for drawing a job from scratch, without a reference frame. */
function promptFor(job: ArtJob) {
  if (job.kind === "surface") return surfacePrompt(job.prompt);
  if (job.kind === "character") return characterPrompt(job.subject ?? job.prompt, job.prompt);
  return cutoutPrompt(job.subject ? `${job.subject}, ${job.prompt}` : job.prompt);
}

export async function askGemini(prompt: string, reference: string | undefined, aspectRatio: string): Promise<string> {
  const interaction = await (await gemini()).interactions.create({
    model: MODEL,
    input: reference
      ? [
          { type: "image", data: reference, mime_type: "image/jpeg" },
          { type: "text", text: prompt },
        ]
      : prompt,
    // The smallest size Gemini offers; every image is shrunk to 128px or less anyway.
    response_format: { type: "image", mime_type: "image/jpeg", aspect_ratio: aspectRatio, image_size: "512" },
  });
  const data = interaction.output_image?.data;
  if (!data) throw new Error("Gemini did not return an image");
  return data;
}

// Shrinks Gemini's 512px+ JPEG to pixel-art size with nearest-neighbor sampling, and for cutouts
// makes the green screen transparent. Removes green everywhere, not just from the edges, so gaps
// (between legs, inside handles) come out transparent too.
export async function processImage(jpeg: Buffer, kind: Kind, longSide = CUTOUT_LONG_SIDE): Promise<Buffer> {
  const { width = 1, height = 1 } = await sharp(jpeg).metadata();
  const aspect = width / height;
  const [w, h] =
    kind === "surface"
      ? [SURFACE_SIZE, SURFACE_SIZE]
      : aspect >= 1
        ? [longSide, Math.round(longSide / aspect)]
        : [Math.round(longSide * aspect), longSide];

  const { data, info } = await sharp(jpeg)
    .resize(w, h, { kernel: "nearest", fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (kind === "cutout") removeGreenScreen(data, info.width, info.height);
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

// Edge pixels blend subject and green, so they survive the key and leave a green outline. Only pixels
// touching the transparent area are cleaned up, so genuinely green subjects (moss, zombies) keep their color.
function removeGreenScreen(data: Buffer, width: number, height: number) {
  const px = width * height;
  const transparent = (p: number) => data[p * 4 + 3] === 0;
  const touchesTransparent = (p: number) => {
    const x = p % width;
    const y = (p / width) | 0;
    return (
      (x > 0 && transparent(p - 1)) ||
      (x < width - 1 && transparent(p + 1)) ||
      (y > 0 && transparent(p - width)) ||
      (y < height - 1 && transparent(p + width))
    );
  };
  const greenish = (p: number) => {
    const [r, g, b] = [data[p * 4], data[p * 4 + 1], data[p * 4 + 2]];
    return g > r + 30 && g > b + 30;
  };

  for (let p = 0; p < px; p++) if (isKeyColor(data[p * 4], data[p * 4 + 1], data[p * 4 + 2])) data[p * 4 + 3] = 0;

  // Peel off up to two pixels of green fringe.
  for (let pass = 0; pass < 2; pass++) {
    const fringe: number[] = [];
    for (let p = 0; p < px; p++) if (!transparent(p) && greenish(p) && touchesTransparent(p)) fringe.push(p);
    for (const p of fringe) data[p * 4 + 3] = 0;
  }

  // Neutralize any green tint left on the outline.
  for (let p = 0; p < px; p++) {
    if (transparent(p) || !touchesTransparent(p)) continue;
    const i = p * 4;
    data[i + 1] = Math.min(data[i + 1], Math.max(data[i], data[i + 2]));
  }

  // Transparent pixels keep their color, and the GPU blends it into the edges when the texture is
  // drawn small (mipmaps), outlining everything in green at a distance. Black blends in as a dark edge.
  for (let p = 0; p < px; p++) if (transparent(p)) data.fill(0, p * 4, p * 4 + 3);
}

// Prompts -------------------------------------------------------------------------------------

export function cutoutPrompt(prompt: string) {
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
    // Busy surfaces make walls, floors and props blur into one noise pattern; keep them calm so
    // cutouts and the room's contrast read, and keep the stated color so rooms aren't all one hue.
    "Simple and low in detail: one material with a subtle repeating pattern and a narrow range of tones, in the color described.",
    "No single objects, no border, no frame, no text, no perspective.",
  ].join(" ");
}

// Characters face right so the engine can flip them to face the way they walk.
function characterPrompt(subject: string, pose: string) {
  return [
    STYLE,
    `A single full-body game character sprite of ${subject}, ${pose}.`,
    "Facing right in a three-quarter view, centered, with the whole figure visible and filling most of the image.",
    `Solid flat ${KEY_COLOR} background everywhere around the figure, and no bright green on the figure itself.`,
    "No text, no border, no cast shadow, no ground, no scenery.",
  ].join(" ");
}

function framePrompt(subject: string, pose: string) {
  return [
    STYLE,
    "The attached image is the first frame of a sprite animation.",
    `Draw another frame of the same animation: ${subject}, ${pose}.`,
    "Keep the exact same subject, art style, pixel size, outlines, color palette, proportions and scale,",
    "and keep it in the same place in the image so the frames line up when played in sequence. Change only the pose or motion described.",
    `Solid flat ${KEY_COLOR} background, the same as the attached image. No text, no border, no cast shadow, no scenery.`,
  ].join(" ");
}

// Helpers -------------------------------------------------------------------------------------

// Requests for something already being made share the same work instead of generating it twice.
const pending = new Map<string, Promise<Buffer>>();
function once(key: string, make: () => Promise<Buffer>): Promise<Buffer> {
  let result = pending.get(key);
  if (!result) {
    result = make().finally(() => pending.delete(key));
    pending.set(key, result);
  }
  return result;
}

async function readIfExists(file: string) {
  try {
    return await readFile(file);
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return undefined;
    throw error;
  }
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
const limit = limiter(MAX_CONCURRENT);
