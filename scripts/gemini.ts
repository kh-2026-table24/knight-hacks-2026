import { GoogleGenAI } from "@google/genai";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";

// Image generation needs the billed project's key (the free-tier key allows 0 images/day).
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_IMAGE_KEY });

const MODEL = "gemini-nano-banana-2.1";
const SPRITES_DIR = "public/sprites"; // Vite serves this at /sprites/...

// Wraps the user's prompt so results come out as usable game sprites.
function spritePrompt(prompt: string): string {
  return [
    `A 2D game sprite of: ${prompt}.`,
    "Pixel art style, single subject, centered, full body visible.",
    "Plain solid white background, no text, no shadows, no scenery.",
  ].join(" ");
}

// Returns the generated sprite as a base64-encoded JPEG (this model only outputs JPEG).
// Pass raw: true when the prompt is already a full sprite prompt (e.g. written by Claude).
// Pass reference (a base64 JPEG) to have Gemini redraw that same character, e.g. from another angle.
export async function generateSprite(
  prompt: string,
  { raw = false, reference }: { raw?: boolean; reference?: string } = {},
): Promise<string> {
  const text = raw ? prompt : spritePrompt(prompt);
  const interaction = await ai.interactions.create({
    model: MODEL,
    input: reference
      ? [
          { type: "image", data: reference, mime_type: "image/jpeg" },
          { type: "text", text },
        ]
      : text,
    response_format: { type: "image", mime_type: "image/jpeg", aspect_ratio: "1:1", image_size: "512" },
  });

  const data = interaction.output_image?.data;
  if (!data) throw new Error("Gemini did not return an image");
  return data;
}

// Saves the full-size original as <name>.jpg and a size×size PNG as <name>-<size>.png.
// Gemini's smallest output is 512×512, so we shrink with nearest-neighbor to keep pixel edges sharp.
// Returns the URL path of the resized sprite for the game.
export async function saveSprite(name: string, base64: string, size = 64): Promise<string> {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const original = Buffer.from(base64, "base64");
  mkdirSync(SPRITES_DIR, { recursive: true });
  writeFileSync(join(SPRITES_DIR, `${slug}.jpg`), original);

  const fileName = `${slug}-${size}.png`;
  await sharp(original).resize(size, size, { kernel: "nearest" }).png().toFile(join(SPRITES_DIR, fileName));
  return `/sprites/${fileName}`;
}

// Test directly: npm run sprite -- "a knight with a blue shield" 64
// (Skipped when imported by server.ts.)
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const prompt = process.argv[2] ?? "a small knight with a sword";
  const size = Number(process.argv[3] ?? 64);
  try {
    console.log(`> ${prompt} (${size}×${size})\n`);
    const path = await saveSprite(prompt, await generateSprite(prompt), size);
    console.log(`Saved sprite to public${path}`);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}
