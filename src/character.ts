import { GoogleGenAI } from "@google/genai";

// Generates a character sprite sheet entirely in the browser's memory: nothing is written to disk.
// Gemini is called directly from the browser. Claude goes through the local server (npm run server),
// which uses your Claude subscription.
const SERVER_URL = "http://localhost:3001/api/claude";
const MODEL = "gemini-nano-banana-2.1";

// Image generation needs the billed project's key. Hardcoded so it works for everyone without a .env.local.
const GEMINI_IMAGE_KEY = "AQ.Ab8RN6JjAh5PSt7pfmSDeO0wQtZvkWAlF6jdxuO6H0d9unzJrA";
const ai = new GoogleGenAI({ apiKey: GEMINI_IMAGE_KEY });

async function askClaude(prompt: string): Promise<string> {
  const res = await fetch(SERVER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  const data = (await res.json()) as { text?: string; error?: string };
  if (!res.ok) throw new Error(data.error ?? `Server error ${res.status}`);
  return data.text ?? "";
}

// Returns a base64 JPEG. Pass reference (base64 JPEG) to have Gemini redraw that same character.
export async function askGemini(prompt: string, reference?: string, aspectRatio = "1:1"): Promise<string> {
  const interaction = await ai.interactions.create({
    model: MODEL,
    input: reference
      ? [
          { type: "image", data: reference, mime_type: "image/jpeg" },
          { type: "text", text: prompt },
        ]
      : prompt,
    response_format: { type: "image", mime_type: "image/jpeg", aspect_ratio: aspectRatio },
  });

  const data = interaction.output_image?.data;
  if (!data) throw new Error("Gemini did not return an image");
  return data;
}

// Step 1: asks Claude to write an image-generation prompt for a front-facing 2D pixel-art character.
// The result is passed straight to Gemini, so Claude must reply with the prompt only.
export async function writeCharacterPrompt(character: string, size = 64): Promise<string> {
  const request = [
    `Write a prompt for an AI image generator to create a 2D ${size}x${size} pixel art game sprite of ${character}.`,
    "The character must face forward, looking directly at the viewer (towards the screen).",
    "Describe the character's colors and key features in concrete detail so the same character can be redrawn later from other angles.",
    "Require: full body visible, centered, plain solid white background, no text, no shadows, no scenery.",
    "Reply with ONLY the prompt text: no preamble, no quotes, no markdown.",
  ].join(" ");

  const prompt = (await askClaude(request)).trim();
  if (!prompt) throw new Error("Claude returned an empty prompt");
  return prompt;
}

const VIEWS = {
  left: "facing left: a side profile view with the head pointing to the left edge of the image",
  right: "facing right: a side profile view with the head pointing to the right edge of the image",
  back: "facing away from the viewer: a back view showing the back of the head, back, and tail, with the face not visible",
} as const;

export type Direction = "front" | keyof typeof VIEWS;

// Frame order in the sheet, left to right. A direction's frame starts at x = index * size.
export const SHEET_ORDER: Direction[] = ["front", "left", "right", "back"];

// Step 3: redraws the character from the front-facing reference image in another direction.
function directionPrompt(prompt: string, view: string): string {
  return [
    "The attached image is a pixel art game sprite of a character facing forward.",
    `Redraw this exact same character ${view}.`,
    "Keep the identical art style, pixel size, outline, color palette, proportions, and accessories, at the same scale and centered in the frame.",
    "Plain solid pure white background, no text, no shadows, no scenery.",
    `Character description for reference: ${prompt}`,
  ].join(" ");
}

const WHITE = 235; // channels at or above this count as background (allows for JPEG noise)

// Decodes a base64 JPEG into its RGBA pixels and makes the white background transparent.
// The fill spreads inward from the edges, so white inside the character (eye highlights) stays opaque.
async function decodeFrame(base64: string): Promise<ImageData> {
  const bitmap = await createImageBitmap(await (await fetch(`data:image/jpeg;base64,${base64}`)).blob());
  const ctx = new OffscreenCanvas(bitmap.width, bitmap.height).getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0);
  const image = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  const { data, width, height } = image;

  const isWhite = (p: number) => data[p * 4] >= WHITE && data[p * 4 + 1] >= WHITE && data[p * 4 + 2] >= WHITE;
  const seen = new Uint8Array(width * height);
  const stack: number[] = [];
  for (let x = 0; x < width; x++) stack.push(x, (height - 1) * width + x);
  for (let y = 0; y < height; y++) stack.push(y * width, y * width + width - 1);
  while (stack.length) {
    const p = stack.pop()!;
    if (seen[p] || !isWhite(p)) continue;
    seen[p] = 1;
    data[p * 4 + 3] = 0;
    const x = p % width;
    if (x > 0) stack.push(p - 1);
    if (x < width - 1) stack.push(p + 1);
    if (p >= width) stack.push(p - width);
    if (p < width * (height - 1)) stack.push(p + width);
  }
  return image;
}

export interface SpriteSheet {
  image: ImageBitmap; // every direction in one image, a horizontal strip in SHEET_ORDER
  size: number; // width and height of one frame
}

// Step 4: packs every direction into one in-memory pixel buffer, shrinking each frame to size×size
// with nearest-neighbor sampling so pixel edges stay sharp.
export async function buildSpriteSheet(frames: Record<Direction, string>, size = 64): Promise<SpriteSheet> {
  const sheet = new ImageData(size * SHEET_ORDER.length, size);
  const decoded = await Promise.all(SHEET_ORDER.map((direction) => decodeFrame(frames[direction])));

  decoded.forEach((frame, i) => {
    for (let y = 0; y < size; y++) {
      const srcY = Math.floor(((y + 0.5) * frame.height) / size);
      for (let x = 0; x < size; x++) {
        const srcX = Math.floor(((x + 0.5) * frame.width) / size);
        const src = (srcY * frame.width + srcX) * 4;
        const dst = (y * sheet.width + i * size + x) * 4;
        sheet.data.set(frame.data.subarray(src, src + 4), dst);
      }
    }
  });
  return { image: await createImageBitmap(sheet), size };
}

// Steps 1-4: Claude writes the prompt, Gemini draws the front view and redraws it facing left, right and back,
// then all four are packed into one sprite sheet.
export async function generateCharacter(character: string, size = 64): Promise<SpriteSheet> {
  const prompt = await writeCharacterPrompt(character, size);
  const front = await askGemini(prompt);
  const [left, right, back] = await Promise.all(
    Object.values(VIEWS).map((view) => askGemini(directionPrompt(prompt, view), front)),
  );
  return buildSpriteSheet({ front, left, right, back }, size);
}

// Draws one direction's frame from the sheet at (x, y).
export function drawFrame(ctx: CanvasRenderingContext2D, sheet: SpriteSheet, direction: Direction, x: number, y: number) {
  const { image, size } = sheet;
  ctx.drawImage(image, SHEET_ORDER.indexOf(direction) * size, 0, size, size, x, y, size, size);
}
