// Generates the HUD art shared by every game (hearts, item icons, the dialogue frame) into public/ui/.
// Run once; the results are committed and reused.
//
//   npx tsx scripts/gen-ui.ts            generate anything missing
//   npx tsx scripts/gen-ui.ts heart key  regenerate just these
import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { askGemini, cutoutPrompt, processImage } from "../server/assets";

const OUT_DIR = join(import.meta.dirname, "..", "public", "ui");
// Gemini's originals, kept so the PNGs can be reprocessed without paying to regenerate them.
const ORIGINALS_DIR = join(import.meta.dirname, "ui-originals");

const ASSETS: Record<string, { prompt: string; aspectRatio: string; longSide: number }> = {
  heart: {
    prompt: "a single red heart icon for a game's health bar, chunky and bold with a thick dark outline and one small highlight, front view",
    aspectRatio: "1:1",
    longSide: 32,
  },
  key: {
    prompt: "a single old brass skeleton key icon for a game's inventory, chunky and bold with a thick dark outline, lying diagonally",
    aspectRatio: "1:1",
    longSide: 32,
  },
  frame: {
    prompt:
      "an empty rectangular dialogue box: an ornate dark iron frame with gothic corner flourishes, worn and pitted, " +
      "around a solid flat black interior. The frame is thin and even on all four sides and its outer edge fills the whole image",
    aspectRatio: "4:1",
    longSide: 480,
  },
};

const requested = process.argv.slice(2);
for (const name of requested) if (!ASSETS[name]) throw new Error(`Unknown UI asset "${name}"; choose from ${Object.keys(ASSETS).join(", ")}`);
await mkdir(OUT_DIR, { recursive: true });
await mkdir(ORIGINALS_DIR, { recursive: true });

await Promise.all(
  Object.entries(ASSETS).map(async ([name, { prompt, aspectRatio, longSide }]) => {
    const file = join(OUT_DIR, `${name}.png`);
    const exists = await access(file).then(() => true, () => false);
    if (requested.length ? !requested.includes(name) : exists) return;

    console.log(`generating ${name}`);
    const jpeg = Buffer.from(await askGemini(cutoutPrompt(prompt), undefined, aspectRatio), "base64");
    await writeFile(join(ORIGINALS_DIR, `${name}.jpg`), jpeg);
    await writeFile(file, await processImage(jpeg, "cutout", longSide));
    console.log(`saved public/ui/${name}.png`);
  }),
);
