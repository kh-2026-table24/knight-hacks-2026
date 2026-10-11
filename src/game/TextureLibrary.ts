import { ImageLoader, NearestFilter, RepeatWrapping, SRGBColorSpace, Texture } from "three";
import type { ArtJob } from "../shared/art";

const imageLoader = new ImageLoader();

// Every art id gets one shared Texture up front, showing a flat placeholder. load() swaps the generated
// images in as the server finishes them, and everything using a texture updates with it.
export class TextureLibrary {
  private readonly textures = new Map<string, Texture>();
  private readonly requested = new Set<string>();
  /** Loaded, or given up on (it keeps its placeholder). */
  private readonly settled = new Set<string>();

  constructor(private readonly jobs: Map<string, ArtJob>) {
    for (const id of jobs.keys()) {
      const texture = new Texture(placeholderImage());
      texture.colorSpace = SRGBColorSpace;
      texture.wrapS = texture.wrapT = RepeatWrapping;
      // Pixel art: keep pixel edges sharp when magnified.
      texture.magFilter = NearestFilter;
      texture.needsUpdate = true;
      this.textures.set(id, texture);
    }
  }

  get ids() {
    return [...this.jobs.keys()];
  }

  get(id: string | undefined) {
    return id === undefined ? undefined : this.textures.get(id);
  }

  /** Where an art id's image comes from: shared UI art directly, everything else from the game server. */
  urlOf(gameId: string, id: string) {
    return this.jobs.get(id)?.builtinUrl ?? `/api/games/${encodeURIComponent(gameId)}/assets/${encodeURIComponent(id)}`;
  }

  /** Whether an image has loaded or been given up on, so there's nothing more to wait for. */
  isSettled(id: string) {
    return this.settled.has(id) || !this.textures.has(id);
  }

  /** Requests the images not asked for yet and swaps each in as it arrives. Resolves with the ids that failed. */
  async load(gameId: string, ids: string[]): Promise<string[]> {
    const fresh = ids.filter((id) => !this.requested.has(id));
    for (const id of fresh) this.requested.add(id);
    const results = await Promise.allSettled(fresh.map((id) => this.setImage(id, this.urlOf(gameId, id))));
    for (const id of fresh) this.settled.add(id);
    return fresh.filter((_, i) => results[i].status === "rejected");
  }

  /** Images the server couldn't make: they keep their placeholder, and nothing waits on them. */
  giveUp(ids: string[]) {
    for (const id of ids) {
      this.requested.add(id);
      this.settled.add(id);
    }
  }

  private async setImage(id: string, url: string) {
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
