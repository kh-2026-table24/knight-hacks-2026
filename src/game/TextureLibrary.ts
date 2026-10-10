import { ImageLoader, RepeatWrapping, SRGBColorSpace, Texture } from "three";
import type { Texture as TextureOutput } from "./generation/output/output";

const imageLoader = new ImageLoader();

// Every texture id gets one shared Texture up front, showing a flat placeholder.
// setImage swaps the generated image in later, and everything using it updates.
export class TextureLibrary {
  readonly prompts: Map<string, string>;
  private readonly textures = new Map<string, Texture>();

  constructor(outputs: TextureOutput[]) {
    this.prompts = new Map(outputs.map((t) => [t.id, t.prompt]));
    for (const { id } of outputs) {
      const texture = new Texture(placeholderImage());
      texture.colorSpace = SRGBColorSpace;
      texture.wrapS = texture.wrapT = RepeatWrapping;
      texture.needsUpdate = true;
      this.textures.set(id, texture);
    }
  }

  get(id: string | undefined) {
    return id === undefined ? undefined : this.textures.get(id);
  }

  async setImage(id: string, url: string) {
    const texture = this.textures.get(id);
    if (!texture) return;
    const image = await imageLoader.loadAsync(url);
    // The GPU copy was sized for the placeholder, so drop it before swapping images.
    texture.dispose();
    texture.image = image;
    texture.needsUpdate = true;
  }
}

function placeholderImage() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#808080";
  ctx.fillRect(0, 0, 1, 1);
  return canvas;
}
