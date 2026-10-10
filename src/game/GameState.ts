import { PLAYER } from "../shared/constants";
import type { KeySpec } from "../shared/spec";

/**
 * Everything about a game in progress that changes as it's played, kept in one place so the state
 * machine can read, reset and save it. Things inside rooms are keyed "roomId/id" (see stateKey).
 */
export class GameState {
  hearts: number = PLAYER.maxHearts;
  /** Keys the player carries. */
  readonly keys: KeySpec[] = [];
  /** Locked connections the player has opened. */
  readonly unlocked = new Set<string>();
  /** Placed pickups the player has taken. */
  readonly collected = new Set<string>();
  /** Props and characters that have already dropped their item. */
  readonly given = new Set<string>();
  /** How many conversations the player has finished with each prop or character. */
  readonly conversations = new Map<string, number>();
}

export const stateKey = (roomId: string, id: string) => `${roomId}/${id}`;
