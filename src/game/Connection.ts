import type { Connection as ConnectionOutput } from "./generation/output/output";

export type Side = "north" | "south" | "east" | "west";

const OPPOSITE: Record<Side, Side> = { north: "south", south: "north", east: "west", west: "east" };

// Directions come from the rooms' grid cells, so both sides of a connection always agree:
// leaving a room through its north wall always arrives through the next room's south wall.
export class Connection {
  readonly id: string;
  readonly roomIds: [string, string];
  locked: boolean;
  private readonly sides = new Map<string, Side>();

  constructor(output: ConnectionOutput, grid: Map<string, [number, number]>) {
    this.id = output.id;
    this.roomIds = output.roomIds;
    this.locked = output.locked ?? false;

    const [a, b] = output.roomIds;
    const cellA = grid.get(a);
    const cellB = grid.get(b);
    if (!cellA || !cellB) throw new Error(`Connection ${output.id} joins an unknown room`);
    const dx = cellB[0] - cellA[0];
    const dz = cellB[1] - cellA[1];
    if (Math.abs(dx) + Math.abs(dz) !== 1) {
      throw new Error(`Connection ${output.id}: rooms ${a} and ${b} are not in adjacent grid cells`);
    }

    const sideOfA: Side = dx === 1 ? "east" : dx === -1 ? "west" : dz === -1 ? "north" : "south";
    this.sides.set(a, sideOfA);
    this.sides.set(b, OPPOSITE[sideOfA]);
  }

  /** The wall of `roomId` this connection leaves through. */
  sideIn(roomId: string) {
    return this.sides.get(roomId);
  }

  otherRoom(roomId: string) {
    return this.roomIds[0] === roomId ? this.roomIds[1] : this.roomIds[0];
  }
}
