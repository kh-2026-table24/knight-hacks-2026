import { sideToward, type Side } from "./geometry";
import type { Issue } from "./issues";
import type { ConnectionSpec, GameSpec, KeySpec, RoomSpec } from "./spec";

// Rules that span rooms: unique ids, the map (grid cells, connections, reachability) and whether every
// locked door can be opened with a key the player can actually get to first.

export interface LockGraph {
  start: string;
  connections: Pick<ConnectionSpec, "id" | "rooms" | "locked">[];
  /** For each locked connection, the rooms holding a key to it. */
  keyRooms: Map<string, string[]>;
}

/** Walks the map from the start, opening each locked connection once a key for it has been reached. */
export function solveLocks(graph: LockGraph): { reached: Set<string>; opened: Set<string> } {
  const opened = new Set(graph.connections.filter((c) => !c.locked).map((c) => c.id));
  const reached = new Set([graph.start]);
  for (let changed = true; changed; ) {
    changed = false;
    for (const { id, rooms: [a, b] } of graph.connections) {
      if (opened.has(id) && reached.has(a) !== reached.has(b)) {
        reached.add(a).add(b);
        changed = true;
      }
      if (!opened.has(id) && (graph.keyRooms.get(id) ?? []).some((room) => reached.has(room))) {
        opened.add(id);
        changed = true;
      }
    }
  }
  return { reached, opened };
}

/**
 * The rooms in the order a player gets to them: everything open from the start, nearest first, then
 * what lies behind each locked door once its key has been reached. Art is made in this order.
 */
export function playOrder(spec: Pick<GameSpec, "rooms" | "connections">): RoomSpec[] {
  const keyRooms = new Map<string, string[]>();
  for (const room of spec.rooms) for (const { key } of keysIn(room)) keyRooms.set(key.unlocks, [...(keyRooms.get(key.unlocks) ?? []), room.id]);
  const opened = new Set(spec.connections.filter((c) => !c.locked).map((c) => c.id));
  const order = [spec.rooms[0].id];
  for (let grew = true; grew; ) {
    grew = false;
    // Breadth first through open doors; `order` grows while it's walked.
    for (let i = 0; i < order.length; i++) {
      for (const { id, rooms } of spec.connections) {
        const other = rooms[0] === order[i] ? rooms[1] : rooms[1] === order[i] ? rooms[0] : undefined;
        if (other && opened.has(id) && !order.includes(other)) order.push(other);
      }
    }
    for (const { id } of spec.connections) {
      if (!opened.has(id) && keyRooms.get(id)?.some((room) => order.includes(room))) {
        opened.add(id);
        grew = true;
      }
    }
  }
  // A valid game reaches every room; anything else still goes last rather than missing.
  return [...order.flatMap((id) => spec.rooms.filter((room) => room.id === id)), ...spec.rooms.filter((room) => !order.includes(room.id))];
}

/** Every key in a room, wherever it is: lying around, inside a prop, or handed over by a character. */
export function keysIn(room: RoomSpec): { key: KeySpec; path: string }[] {
  return [
    ...room.pickups.map((p, i) => ({ item: p.item, path: `pickups[${i}](${p.id}).item` })),
    ...room.props.map((p, i) => ({ item: p.contains, path: `props[${i}](${p.id}).contains` })),
    ...room.characters.map((c, i) => ({ item: c.gives, path: `characters[${i}](${c.id}).gives` })),
  ].flatMap(({ item, path }) => (item?.kind === "key" ? [{ key: item, path }] : []));
}

/** For each room, the wall each of its connections leaves through. Connections that don't join two neighboring rooms are skipped. */
export function doorSides(rooms: RoomSpec[], connections: ConnectionSpec[]): Map<string, Map<string, Side>> {
  const grid = new Map(rooms.map((r) => [r.id, r.grid]));
  const sides = new Map(rooms.map((r) => [r.id, new Map<string, Side>()]));
  for (const { id, rooms: [a, b] } of connections) {
    const cellA = grid.get(a);
    const cellB = grid.get(b);
    const side = cellA && cellB && a !== b ? sideToward(cellA, cellB) : undefined;
    if (!side) continue;
    sides.get(a)!.set(id, side);
    sides.get(b)!.set(id, sideToward(cellB!, cellA!)!);
  }
  return sides;
}

export function checkGame(spec: GameSpec): Issue[] {
  const issues: Issue[] = [];
  const error = (path: string, message: string, room?: string) => issues.push({ severity: "error", path, message, ...(room && { room }) });
  const warn = (path: string, message: string) => issues.push({ severity: "warning", path, message });
  const roomPath = (i: number) => `rooms[${i}](${spec.rooms[i].id})`;
  const connectionPath = (c: ConnectionSpec) => `connections[${spec.connections.indexOf(c)}](${c.id})`;

  const roomIndex = new Map<string, number>();
  const cells = new Map<string, string>();
  spec.rooms.forEach((room, i) => {
    if (roomIndex.has(room.id)) error(`${roomPath(i)}.id`, `${roomPath(i)}.id "${room.id}" is used by another room too; room ids must be unique`);
    else roomIndex.set(room.id, i);

    const cell = room.grid.join(",");
    const other = cells.get(cell);
    if (other) error(`${roomPath(i)}.grid`, `${roomPath(i)}.grid [${room.grid.join(", ")}] is the same cell as room "${other}"; every room needs its own cell`);
    else cells.set(cell, room.id);

    // Props, characters and pickups share one namespace: the game's state refers to them as room/id.
    const ids = new Set<string>();
    const things = [
      ...room.props.map((p, j) => ({ id: p.id, path: `props[${j}]` })),
      ...room.characters.map((c, j) => ({ id: c.id, path: `characters[${j}]` })),
      ...room.pickups.map((p, j) => ({ id: p.id, path: `pickups[${j}]` })),
    ];
    for (const { id, path } of things) {
      if (ids.has(id)) error(`${roomPath(i)}.${path}`, `${roomPath(i)}.${path} uses the id "${id}", which something else in this room already has; ids must be unique within a room`, room.id);
      ids.add(id);
    }
  });

  const connectionIds = new Set<string>();
  const pairs = new Set<string>();
  const valid: ConnectionSpec[] = [];
  for (const c of spec.connections) {
    const path = connectionPath(c);
    if (connectionIds.has(c.id)) error(path, `${path} reuses the connection id "${c.id}"; connection ids must be unique`);
    connectionIds.add(c.id);
    const [a, b] = c.rooms;
    const ia = roomIndex.get(a);
    const ib = roomIndex.get(b);
    if (ia === undefined || ib === undefined || a === b) {
      error(path, `${path} must join two different rooms that exist, got "${a}" and "${b}"`);
      continue;
    }
    const [cellA, cellB] = [spec.rooms[ia].grid, spec.rooms[ib].grid];
    if (!sideToward(cellA, cellB)) {
      error(path, `${path}: ${a} [${cellA.join(", ")}] and ${b} [${cellB.join(", ")}] are not in neighboring grid cells (they must differ by 1 in exactly one coordinate)`);
      continue;
    }
    const pair = [a, b].sort().join("|");
    if (pairs.has(pair)) error(path, `${path}: ${a} and ${b} are already connected; use one connection per pair of rooms`);
    pairs.add(pair);
    valid.push(c);
  }

  const start = spec.rooms[0].id;
  const map = solveLocks({ start, connections: valid.map((c) => ({ ...c, locked: false })), keyRooms: new Map() });
  spec.rooms.forEach((room, i) => {
    if (!map.reached.has(room.id)) error(roomPath(i), `${roomPath(i)} can't be reached from ${start}: connect it to a neighboring room`);
  });

  const keyRooms = new Map<string, string[]>();
  spec.rooms.forEach((room, i) => {
    for (const { key, path } of keysIn(room)) {
      const full = `${roomPath(i)}.${path}`;
      const target = spec.connections.find((c) => c.id === key.unlocks);
      if (!target) error(full, `${full} unlocks "${key.unlocks}", but there is no connection with that id`, room.id);
      else if (!target.locked) error(full, `${full} unlocks "${key.unlocks}", which isn't locked; lock that connection or remove the key`, room.id);
      keyRooms.set(key.unlocks, [...(keyRooms.get(key.unlocks) ?? []), room.id]);
    }
  });
  for (const c of valid.filter((c) => c.locked)) {
    const count = keyRooms.get(c.id)?.length ?? 0;
    if (count === 0) {
      error(connectionPath(c), `${connectionPath(c)} is locked but nothing opens it: add a key with "unlocks": "${c.id}" (a pickup, a prop's "contains" or a character's "gives") in a room the player reaches before this door`);
    } else if (count > 1) {
      warn(connectionPath(c), `${connectionPath(c)} has ${count} keys; one is enough`);
    }
  }

  // Locks only matter once the map itself is connected; a key behind its own door is a dead end.
  const solved = solveLocks({ start, connections: valid, keyRooms });
  for (const c of valid) {
    if (!c.locked || solved.opened.has(c.id) || !c.rooms.some((r) => solved.reached.has(r))) continue;
    const holders = keyRooms.get(c.id);
    if (holders?.length) {
      error(connectionPath(c), `${connectionPath(c)} can never be opened: its key is in ${holders.join(", ")}, which the player can only reach through this door or another locked one. Put the key in a room reachable before it.`);
    }
  }
  return issues;
}
