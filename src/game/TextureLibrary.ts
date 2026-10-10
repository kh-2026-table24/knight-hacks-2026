import { ImageLoader, NearestFilter, RepeatWrapping, SRGBColorSpace, Texture } from "three";
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
      // Pixel art: keep pixel edges sharp when magnified.
      texture.magFilter = NearestFilter;
      texture.needsUpdate = true;
      this.textures.set(id, texture);
    }
  }

  get(id: string | undefined) {
    return id === undefined ? undefined : this.textures.get(id);
  }

  /** Swap in an image, either a URL to load or an already-drawn canvas. */
  async setImage(id: string, image: string | HTMLCanvasElement) {
    const texture = this.textures.get(id);
    if (!texture) return;
    const source = typeof image === "string" ? await imageLoader.loadAsync(image) : image;
    // The GPU copy was sized for the placeholder, so drop it before swapping images.
    texture.dispose();
    texture.image = source;
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
