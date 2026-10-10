import { Connection } from "./Connection";
import { Room } from "./Room";
import { TextureLibrary } from "./TextureLibrary";
import type { SavedGame } from "./generation/output/output";

export class Game {
  readonly id: string;
  readonly textures: TextureLibrary;
  readonly connections: Map<string, Connection>;
  readonly rooms: Map<string, Room>;
  readonly startRoom: Room;

  constructor(output: SavedGame) {
    if (output.rooms.length === 0) throw new Error("Game has no rooms");
    this.id = output.id;
    this.textures = new TextureLibrary(output.textures);

    const grid = new Map(output.rooms.map((r) => [r.id, r.gridPosition]));
    this.connections = new Map(output.connections.map((c) => [c.id, new Connection(c, grid)]));
    this.rooms = new Map(
      output.rooms.map((r) => [r.id, new Room(r, this.textures, (id) => this.connections.get(id)?.sideIn(r.id))]),
    );
    this.startRoom = this.rooms.get(output.rooms[0].id)!;
  }
}
