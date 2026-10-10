# Plan: GameSpec v2, a restructure for an agentic loop

## Context

Paradise Chateau is a prototype that generates "2.5D PS1/DS-style" horror games. It works, but its data contract is split three ways:

- `HousePlan` and `RoomPlan` are what Claude writes.
- The low-level `Game` JSON in `src/game/generation/output/output.ts` is what the runtime plays.
- The interactive features (NPCs, movement, dialogue, emitters, items, keys, locked doors) exist only in the low-level format and only get exercised by hand-written `server/prompts/test-output.ts`.
- Nothing validates the format the runtime trusts: `main.ts` casts it.
- The earlier analysis found about 8 runtime bugs, a committed API key, and several places where docs or prompts disagree with the code.

**Goal:** one contract, **GameSpec**, that is the single JSON a game consists of. The engine stays (lighting, retro filter, character look, walk grid, green-screen asset pipeline, HUD, dialogue box); it gets re-pointed at GameSpec and hardened.

**Generation:**
1. **Storyboard:** Claude writes a storyboard.
2. **Game:** the storyboard plus the game-authoring instructions go to Claude, and **one call returns the entire GameSpec JSON**.
3. **Validate:** the server checks it. If there are errors, Claude repairs only the broken rooms.
4. **Play:** the server saves `game.json`, and the frontend fetches it, parses it, and turns it into the game.

The game server generates on demand.

**Decisions already made:**
- The contract lives in `src/shared/`.
- Shapes: box, wedge, panel, cylinder (with `taper`), stairs.
- The server generates games on demand; the client shows a "Generating…" overlay.
- A heart pickup stays on the floor when the player is at full health.
- Generation is a storyboard call, then **one game call** that returns the whole GameSpec; repairs re-emit only the rooms that failed.
- Art is described inline (no texture table).

**Out of scope:** the state machine, the storyboard conversation and UI, branching dialogue, flags and conditions, audio, save/load, an event bus, NPC-vs-NPC damage, projectiles, multi-floor rooms, non-grid maps.

---

## Part A: Agent loop protocol

### A1. Setup (milestone M0, done by humans before the loop starts)
1. Commit the current uncommitted work on `main` (NPC movement, dialogue, HUD; 13 modified files plus untracked `src/game/ui/`, `camera.ts`, `characters.ts`, `public/ui/`, `scripts/gen-ui.ts`, `scripts/ui-originals/`, `server/games/haunted-2/`) to a branch, open a PR, have a teammate glance at it, and merge it to `main`.
2. **Rotate the Gemini key** `AQ.Ab8RN6…`. It's in commits `7f30bfc` and `31b48fe`, which have been pushed to GitHub. Put the new key in `.env.local` as `GEMINI_IMAGE_KEY`. Rotating is enough; there's no need to rewrite history.
3. Get the whole team to approve the **approved file list** (A4) and agree on a freeze: teammates stay out of `src/game/`, `src/shared/`, `server/` and `scripts/` until M10 merges. They can work on the storyboard conversation, UI art or audio in new files.
4. `git fetch origin && git switch main && git pull --ff-only && git switch -c feat/caleb-gamespec-v2`.
5. Copy this plan into the repo as `docs/gamespec-v2/PLAN.md` and create `docs/gamespec-v2/PROGRESS.md` (format in A3). Commit as `chore(docs): add GameSpec v2 plan`.

### A2. The loop (each iteration)
1. Read `docs/gamespec-v2/PLAN.md`, `PROGRESS.md`, `AGENTS.md` and `git log --oneline -20`. Confirm with `git branch --show-current` that the branch is `feat/caleb-gamespec-v2`; if it isn't, stop.
2. Pick the **first unchecked task** in PROGRESS.md and do exactly what this plan specifies for it.
3. Run the gates: always `npm run build`; from M2 on, `npm run check`; from M4 on, `npm run check:play` (a headless playthrough of the haunted fixture, added during M4); from M8 on, `npm run check:gen`.
4. If they fail, fix and retry. **After 3 failed fix attempts on the same gate, stop** and write a blocker entry.
5. Commit, one commit per task: `<type>(<area>): <summary>` (for example `feat(shared): add GameSpec parser`). End the message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
6. Tick the task in PROGRESS.md with the short commit hash, note any deviation, then commit PROGRESS.md (it can go in the same commit as the task).
7. At a **checkpoint** (end of M4, M6, M7, M9), stop and ask a human to run the playtest checklist. Don't start the next milestone until it's signed off in PROGRESS.md.
8. At the end of each milestone, `git fetch origin`; if `main` moved, `git rebase origin/main`. If the rebase conflicts in a file outside A4, stop.
9. After M1, push the branch and open a **draft PR**. Its description lists every pre-existing file modified (see A4) and is updated at each milestone.

**Stop conditions (stop and write a blocker in PROGRESS.md):**
- A gate keeps failing after 3 attempts.
- A file outside A4 needs changing.
- A new npm dependency seems necessary. **No new dependencies are allowed.**
- A live Claude or Gemini spend beyond the budget: no live generation before M8; at most 2 live games in M8 and 2 in M9; the fixture's art generates once in M4.
- The spec here is contradictory. In that case use the plan's stated default, log the deviation, and keep going; stop only if no default exists.

**Resuming after the context resets:** step A2.1 is enough. PROGRESS.md plus git history hold all the state.

**Kickoff prompt** (for a long session or `/loop`):
> Execute docs/gamespec-v2/PLAN.md. Follow Part A exactly: read PLAN.md, PROGRESS.md, AGENTS.md and recent git log; do the next unchecked task; run its gates; commit; tick it in PROGRESS.md; continue. Stop at checkpoints and stop conditions and report.

### A3. PROGRESS.md format
```md
# GameSpec v2 progress  (branch: feat/caleb-gamespec-v2, draft PR: #__)
## M1 Hygiene and shared constants
- [x] 1.1 Remove key literals …  (a1b2c3d)
- [ ] 1.2 …
## Checkpoints
- [ ] M4 parity playtest — signed off by: ____
## Deviations
- 3.3: <what differed from the plan and why>
## Blockers
- <date> <task>: <what is needed from a human>
```

### A4. Approved file list (needed for AGENTS.md Hard Rule 2)
**New:** everything under `src/shared/`, `fixtures/`, `server/generation/`, `docs/gamespec-v2/`; `src/game/GameState.ts`, `src/game/Pickup.ts`, `src/game/Interactions.ts`, `server/jobs.ts`, `scripts/check-specs.ts`, `scripts/spec-cases.ts`, `scripts/check-generation.ts`, `scripts/gen-game.ts`.

**Modified:** `src/main.ts`, `src/style.css`, `src/game/{Game,GameComposer,Room,Door,Connection,Player,TextureLibrary}.ts`, `src/game/ui/Hud.ts`, `server/{index,games,assets}.ts`, `.gitignore`, and these shared contract files that need whole-team sign-off: `package.json`, `tsconfig.json`, `vite.config.ts`, `AGENTS.md`.

**Renamed** (`git mv`, so history is kept): `src/game/Object.ts→Part.ts`, `Group.ts→Prop.ts`, `Sprite.ts→Character.ts`.

**Moved:** `src/game/generation/{tagged,theme,layouts}.ts` and `prompts/repair.ts` → `server/generation/`.

**Deleted:** `src/character.ts`, the rest of `src/game/generation/**`, `server/prompts/**`, `scripts/{server,claude,gen-house}.ts`, `server/games/{dev,haunted-1,haunted-2}/`.

**Do not touch:** `src/game/{RetroFilter,worldUVs,camera,characters}.ts` (reuse only), `scripts/{gemini,gemini-text,gen-ui}.ts`, `index.html`, `public/**`. `scripts/gen-ui.ts` imports `askGemini`, `cutoutPrompt` and `processImage` from `server/assets.ts`, so **keep those exports and their signatures**.

### A5. Code conventions (from AGENTS.md and the user's preferences)
- **Imports:** named imports from `three` and `@dimforge/rapier3d-compat`, never `THREE.` or a namespace import. Use `import type` for types (`verbatimModuleSyntax` is on).
- **TypeScript:** strict, and no `any` without a `// reason:` comment. Network or LLM data comes in as `unknown` and gets narrowed.
- **Files:** named exports only, one main concept per file, under about 300 lines; split before going over.
- **Style:** comment the *why*, and match the existing comment density and naming.
- **Frame loop:** no allocations inside it (scratch vectors at module scope), and `dispose()` anything that is removed for good.

---

## Part B: Target architecture

```
src/shared/            THE CONTRACT; client, server and scripts all import it. Pure TypeScript; may import three, never the DOM.
  constants.ts         single source for every number the engine, validator and prompts share
  spec.ts              GameSpec types (normalized form), LIMITS, DEFAULTS
  reader.ts            small helper for parsing unknown JSON with path tracking
  parseSpec.ts         unknown → GameSpec (shape, ranges, defaults, unknown-field detection); also parseRoom
  geometry.ts          deterministic expansion: walls, door placement, door sides, part placement, stairs and cylinders, bounds
  walkGrid.ts          walkable-height grid and flood fill (ported from generation/walkGrid.ts)
  checkRoom.ts         per-room layout rules (ported from generation/checkLayout.ts, extended)
  checkGame.ts         whole-game rules: ids, room graph, solveLocks()
  validate.ts          validateGame(): parse + room checks + game checks; Issue type, formatIssues()
  art.ts               derives every art job and stable art id from a spec; shared by server and client
src/game/              ENGINE (reads GameSpec; no formats of its own)
  Game.ts  GameState.ts  GameComposer.ts  Interactions.ts  Room.ts  Prop.ts  Part.ts  Character.ts  Pickup.ts
  Door.ts  Connection.ts  Player.ts  TextureLibrary.ts  RetroFilter.ts  worldUVs.ts  camera.ts  characters.ts  ui/Hud.ts
server/
  index.ts             routes: POST /api/games, GET /api/games/:id, GET /api/games/:id/assets/:artId
  games.ts             load fixtures and saved games, validate, save
  jobs.ts              generation jobs (in memory) with progress
  assets.ts            Gemini generation driven by art.ts jobs
  generation/          claude.ts storyboard.ts gamePrompt.ts generateGame.ts tagged.ts theme.ts layouts.ts repair.ts
fixtures/
  games/haunted.json   the regression game (converted from test-output.ts); served as ?game=haunted
  claude/*.txt         canned Claude responses for offline generation checks
scripts/  check-specs.ts  spec-cases.ts  check-generation.ts  gen-game.ts  (+ the existing gemini/gen-ui scripts)
```

**Data flow:** `storyboard (Claude) → GameSpec (one Claude call) → validateGame → [room-scoped repair] → server/games/<id>/game.json → client validateGame → Game/Room/… → render`. The same `validateGame` and `art.ts` run on both server and client. The server validates so the frontend never receives a broken game; the client validates again because it's cheap and guards against hand-edited files.

---

## Part C: The contract (`src/shared/spec.ts`)

The types below are the **normalized** form: after parsing, every field that has a default is filled in. Claude's JSON may leave those fields out. `game.json` is always saved normalized; parsing it again gives the same result.

```ts
export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

// Units are meters; rotations are radians.
// Room space: x 0..W (east +), z 0..D (south +; z = D is nearest the camera), y up, floor top at y = 0.

export interface GameSpec {
  version: 1;
  title: string;
  /** 2–5 sentences: what happened here. Nothing reads it at runtime yet; the story phase builds on it. */
  summary: string;
  /** M6. The protagonist's look. Without it the player is a grey placeholder figure. */
  player?: { art: CharacterArt; size: Vec2 };            // size default [1, 1.8]
  /** rooms[0] is where the game starts. */
  rooms: RoomSpec[];
  connections: ConnectionSpec[];
}

export interface ConnectionSpec {
  id: string;                                            // slug, unique in the game
  /** Two rooms whose grid cells differ by 1 in exactly one coordinate. */
  rooms: [string, string];
  /** Opened by a key item whose `unlocks` is this id; opens from both sides. Default false. */
  locked: boolean;
}

export interface RoomSpec {
  id: string;                                            // slug, unique in the game
  name: string;
  /** Outdoors only the north wall (the building's face) is built; indoors the north, west and east walls. The south side is always open. */
  outdoor: boolean;
  /** [x, z] map cell; north is -z, east is +x. One room per cell. */
  grid: Vec2;
  /** [W, H, D]. */
  size: Vec3;
  /** [x, z] floor spot: the game starts here (rooms[0]) and the player respawns here. */
  start: Vec2;
  /** Brightness before any lights: 0 pitch black … 1 fully lit. Default 0.25. */
  baseLight: number;
  /** Material descriptions, e.g. "damp green-black fieldstone". They become tiled surface textures. */
  walls: string;
  floor: string;
  doors: DoorSpec[];
  props: PropSpec[];                                     // default []
  characters: CharacterSpec[];                           // default []
  pickups: PickupSpec[];                                 // default []
}

export interface DoorSpec {
  connection: string;
  /** Position along the wall: x for north/south doors, z for east/west. From DOOR.edgeMargin to (wall length − edgeMargin). */
  offset: number;
  /** Cutout art. Default: `door set into ${room.walls}, front view`. */
  art?: string;
}

export type Shape = "box" | "wedge" | "panel" | "cylinder" | "stairs";   // cylinder and stairs arrive in M7

export interface PartSpec {
  shape: Shape;
  /** Bottom-center of the part, in its prop's frame. */
  position: Vec3;
  rotation: Vec3;                                        // default [0, 0, 0]
  /** [width, height, depth]. Panels use depth 0. Cylinders: elliptical, with x radius = width/2 and z radius = depth/2. */
  size: Vec3;
  /** Blocks movement. Default true for box/wedge/cylinder/stairs, false for panels. */
  solid: boolean;
  /** Solid shapes only: overrides the prop's material for this part. */
  material?: string;
  /** Panels only: cutout art for this panel. Default: the prop's name. */
  art?: string;
  /** Panels only: extra animation frames after `art`, written as changes ("a shorter, guttering flame"). Played at 6 fps, looping. */
  frames?: string[];
  /** Cylinders only (M7): top radius ÷ bottom radius, from 0 (a cone) to 1. Default 1. */
  taper?: number;
}

export interface PropSpec {
  id: string;                                            // slug, unique within the room
  /** Specific and evocative ("iron-bound sea chest, lid forced open"). It's the default art for its panels. */
  name: string;
  /** Room coordinates of the prop's origin, its bottom-center. y > 0 for things on platforms or mounted on walls. */
  position: Vec3;
  /** Default 0, with the front facing south (+z). ±1.5708 puts it against the west/east wall and swaps width and depth. */
  rotationY: number;
  /** Surface of its solid parts. Required unless every solid part has its own material. */
  material?: string;
  parts: PartSpec[];                                     // 1..LIMITS.partsPerProp; a stairs part counts as 1
  /** Light given off from the prop's tallest part. */
  light?: LightSpec;
  /** [E] Examine: each press plays the next conversation; the last one repeats. */
  examine?: Conversation[];
  /** Dropped once, when the player first finishes the last examine conversation. With no examine, [E] says "Search" and drops it straight away. */
  contains?: ItemSpec;
  /** Touching it hurts (fire, spikes). */
  hazard?: { damage: number };
  /** Decorative particles it keeps emitting (wax drips, embers). */
  ambient?: AmbientSpec;
}

export interface CharacterSpec {
  id: string;                                            // slug, unique within the room
  name: string;                                          // default speaker for its conversations
  /** Feet position; y is the floor or platform it stands on. Characters never fall. */
  position: Vec3;
  /** [width, height]. */
  size: Vec2;
  art: CharacterArt;
  /** Blocks the player. Default false. */
  solid: boolean;
  movement?: Movement;
  /** [E] Talk: each press plays the next conversation; the last one repeats. */
  dialogue?: Conversation[];
  /** Dropped once, when the player first finishes the last conversation. Needs dialogue. */
  gives?: ItemSpec;
  hostile?: { damage: number };
  /** Without a light of its own, a character carries the standard character glow. */
  light?: LightSpec;
}

export interface CharacterArt {
  /** The subject, drawn once as the reference image ("hunched elderly caretaker in a stained apron holding a dim lantern"). */
  description: string;
  /** One pose per frame. Default ["standing still"]. Frame idle[0] is the reference for every other frame. */
  idle: string[];
  moving?: string[];
  talking?: string[];                                    // M6
  attack?: string[];                                     // M6
}

export type Movement =
  | { type: "wander"; speed: number; radius: number }          // drifts around where it was placed
  | { type: "patrol"; speed: number; points: Vec2[] }          // [x, z] points at the character's own height, visited in order, looping
  | { type: "chase"; speed: number; detectRadius: number };    // locks on within detectRadius, gives up beyond 1.5× it, walks home

export interface Conversation {
  /** Defaults to the character's name; for examine text, no speaker. */
  speaker?: string;
  lines: string[];                                       // shown one at a time
}

export type ItemSpec =
  | { kind: "key"; name: string; art: string; unlocks: string }   // unlocks = a locked connection's id
  | { kind: "heart" };                                            // M6: restores 1 heart; drawn with /ui/heart.png

export interface PickupSpec { id: string; item: ItemSpec; position: Vec3 }   // collected when the player comes within PICKUP range

export interface LightSpec {
  type: "glow" | "spot";
  color: string;                                         // "#rrggbb"
  intensity: number;                                     // 1 a candle, 3 a lantern, 6 a fireplace
  range: number;                                         // reach of a glow, or radius of a spot's pool of light
  effect: "steady" | "flicker" | "pulse";                // default "steady"
}

export interface AmbientSpec {
  art: string;
  size: Vec2;
  everySeconds: number;                                  // ±50% random jitter at runtime
  lifetimeSeconds: number;
  velocity: Vec3;                                        // default [0, 0, 0]
  gravity: boolean;                                      // default true; false for things that float (embers)
}
```

**`LIMITS`** (enforced by the parser; looser than what the prompts ask for):
- Rooms per game ≤ 12. Room W and D from 6 to 30; H from 3 to 10. Props per room ≤ 40.
- Parts per prop ≤ 16. Characters per room ≤ 4. Pickups per room ≤ 6. Prop lights per room ≤ 8.
- Conversations ≤ 6; lines per conversation ≤ 8; each line ≤ 220 characters.
- Light intensity in (0, 10]; range in (0, 20].
- Movement speed in (0, 4]. Chase speed must stay ≤ 0.8 × player speed so the player can escape.
- detectRadius in (0, 12]; wander radius in [0.5, 8]. Damage is an integer from 1 to `PLAYER.maxHearts`.
- Frames per state ≤ 4. Character width from 0.2 to 3; height from 0.2 to 4.
- Ambient `everySeconds` ≥ 0.5; `lifetimeSeconds` in (0, 10].
- Ids are slugs: `/^[a-z0-9]+(-[a-z0-9]+)*$/`.

**`DEFAULTS`:** every default noted above, in one object, so the parser and the prompts read the same values.

**Ids at runtime:** prop, character and pickup ids only need to be unique **within a room**. That's less for Claude to track, and a room-scoped repair can't collide with another room. The engine uses `${roomId}/${id}` as the game-wide key (in GameState and in logs).

### C1. `src/shared/constants.ts`
Move these values out of where they live now. They must stay numerically identical.

| Constant | Value | Currently in |
|---|---|---|
| `PLAYER = { radius: 0.35, height: 1.8, stepHeight: 0.35, maxSlopeDeg: 50, speed: 5, maxHearts: 4, invulnerableSeconds: 1.2, touchMargin: 0.1, gravity: 20 }` | | `Player.ts` and `walkGrid.ts` |
| `RESPAWN_INVULNERABLE_SECONDS = 2` | new | |
| `DOOR = { width: 1.6, height: 3, inset: 0.31, exitDepth: 0.8, arrivalDistance: 1, edgeMargin: 1 }` | | `Door.ts`, `checkLayout.ts`, `buildRoom.ts` |
| `WALL_THICKNESS = 0.3` | | `buildRoom.ts` |
| `INTERACT = { range: 1.0, maxHeightAboveFeet: 2.0 }` | new | |
| `PICKUP = { range: 0.6, below: 0.3, delaySeconds: 0.75 }` | `delaySeconds` from `Room.ts` | |
| `REACH = 1.5` (validator: how close the player must get to a prop with no interaction) | | `checkLayout.ts` |
| `STAIRS = { maxStep: 0.3, minTread: 0.25 }`, `CYLINDER_SEGMENTS = 8` | new (M7) | |
| `FRAME_SECONDS = 1 / 6`, `PHYSICS_STEP = 1 / 60`, `MAX_FRAME_DT = 0.25` | | `Sprite.ts` / new |

---

## Part D: Derived data (`src/shared/geometry.ts`)

Everything here is deterministic. The validator and the engine call the same functions, so they can never disagree.

- **`doorSide(spec, roomId, connectionId): Side`**: logic from `Connection.ts` (grid difference → north/south/east/west).
- **`roomWalls(room): PlacedPart[]`**: from `buildRoom.wallItems` (indoor N/W/E, outdoor N only; full height H; `WALL_THICKNESS`).
- **`placeDoor(room, door, side)`**: from `Door.ts` `placeDoor`. Returns `{ kind: "standing" | "exitStrip", position, rotation, size }`.
- **`arrivalPoint(room, door, side): Vec2`**: one function, replacing both `Door.arrivalPoint` and `checkLayout.arrivalPoint`.
- **`expandParts(prop): PrimitivePart[]`**: turns stairs into boxes (M7) and passes the other shapes through. A `PrimitivePart` is a `PartSpec` whose shape is box/wedge/panel/cylinder, with the stairs step transform composed in.
  - Stairs rise toward −z, like a wedge.
  - `n = ceil(h / STAIRS.maxStep)`. Step `i` (from 0 to n−1) is a box of size `[w, h·(i+1)/n, d/n]` at local z = `d/2 − (i+0.5)·d/n`.
  - Each step's offset is rotated by the part's rotation and added to the part's position.
- **`placeProp(prop, label): PlacedPart[]`**: from `buildRoom.placeItem`, run on `expandParts`. Each result holds world position, quaternion and world `Box3`. Cylinders use their bounding box.
- **`propBounds(prop): Box3`**: the union of its placed parts. Used for interaction range and reachability.
- **`lightPartIndex(prop)`**: from `buildRoom.lightPartIndex` (the tallest part).

---

## Part E: Validation

### E1. Issue format and wording
```ts
export interface Issue { severity: "error" | "warning"; room?: string; path: string; message: string }
// path example: rooms[2](study).props[3](oak-desk).parts[1].size
```
- `room` is set for room-scoped issues, so generation can ask Claude to re-emit just that room. Issues without `room` are game-level (map, connections, locks) and trigger a full repair.
- **Messages are written for Claude to act on.** Each one says what's wrong, then how to fix it. Name the thing by id and name, round numbers to 2 decimal places, keep it to one or two sentences. Copy the tone of the existing `checkLayout.ts` messages.
  - Example: `props[4](oak-desk) can't be examined: no walkable spot comes within 1 m of it. Open a 1.2 m wide path to it or move it.`
- **Unknown fields are errors**, and the message lists the allowed fields. This catches the `dialogue`/`dialogues` kind of typo.
- `formatIssues(issues)` renders a bulleted list. It's used in repair prompts, server 500 responses, the client overlay and the check scripts.

### E2. Layers
1. **`parseGameSpec(value)` / `parseRoom(value, path)`** (in `parseSpec.ts`, using the `reader.ts` helpers): types, enums, ranges, slugs, required fields, defaults, unknown fields, and per-shape field rules (rule S8).
2. **`checkRoom(room, ctx)`**: the R rules. `ctx` holds the room's door sides and connection ids.
3. **`checkGame(spec)`**: the G rules, including `solveLocks`.
4. **`validateGame(value)`** runs 1 → 2 (for each room, only if that room parsed) → 3 (only if every room parsed). It returns `{ spec: GameSpec | null, issues }`; `spec` is non-null when there are no errors.

### E3. Rules
**Shape (S):**
- S1 required fields and types.
- S2 unknown field.
- S3 numeric ranges (LIMITS).
- S4 slug ids.
- S5 enums.
- S6 array lengths.
- S7 hex colors.
- S8 per-shape fields:
  - `art`/`frames` only on panels; `material` only on solid shapes; `taper` only on cylinders.
  - Panels have depth 0; other shapes have positive size.
  - A prop with a solid part that has no material, and no prop material, is an error.
- S9 `version === 1`.
- S10 a character's `gives` requires `dialogue`.
- S11 chase speed ≤ `0.8 × PLAYER.speed`.

**Room (R)**, ported from `checkLayout.ts` and extended:
- R1 every placed part is inside the interior (indoor: x from T to W−T, z from T to D; outdoor: x from 0 to W, z from T to D; y from 0 to H; tolerance 0.05).
- R2 solid parts of different props don't overlap (the existing `penetratesOnAxis` rule; at most 8 reported).
- R3 `start` is standable floor that isn't inside anything (existing logic). There's no y-check any more, since `start` is [x, z].
- R4 every prop comes within `REACH` of a reached floor cell.
- R5 doors:
  - exactly one door for each connection that touches the room, and none for other connections;
  - offset within `[edgeMargin, wall − edgeMargin]`;
  - the arrival point is standable at floor level and reachable (existing logic, using `geometry.arrivalPoint`).
- R6 characters:
  - the position is standable at its y and reachable from the start;
  - if it has dialogue, it is within `INTERACT.range` of a reached cell and passes the height rule (E4);
  - patrol points are standable at the character's y and reachable by flood fill from the character;
  - warning if the wander circle goes outside the interior.
- R7 pickups:
  - reachable under the PICKUP rule (E4);
  - warning if not resting on anything (y isn't 0 or the top of a solid directly underneath, within 0.05).
- R8 interactable props (`examine` or `contains`) pass the INTERACT rule (E4).
- R9 warning if a hostile character starts within its `detectRadius` (or 2 m if it doesn't chase) of `start` or a door arrival point. Also warning if a hazard's bounds plus 0.5 m cover the start or an arrival point.
- R10 prop lights ≤ 8. Error if prop lights + character lights + character glows > 12 (shader cost).
- R11 warning for a tall prop near the camera (existing). Warning if there are fewer than 5 props.
- R12 (M7) stairs tread `d/n` < `STAIRS.minTread` is an error; the message gives the minimum depth.

**Game (G):**
- G1 there is at least 1 room.
- G2 room ids and connection ids are unique; prop, character and pickup ids are unique within each room.
- G3 grid cells are unique; each connection joins two existing, different, adjacent rooms; no pair of rooms is connected twice.
- G4 every room is reachable from rooms[0], ignoring locks.
- G5 every key's `unlocks` names an existing connection with `locked: true`.
- G6 every locked connection has at least one key (warning if more than one).
- G7 `solveLocks`: every room must end up reachable. The error names the locked connection and where its key is (or that it has none).
- G8 art budget: warning above 120 art jobs, error above 200.

**`solveLocks(graph)`** takes rooms, connections, and `keyRooms: Map<connectionId, roomId[]>`. `checkGame` builds `keyRooms` by scanning each room's key sources.
```
open = unlocked connections; reach = BFS(rooms[0], open)
repeat: for each locked c with an endpoint in reach and any keyRooms[c] ⊆ reach → open c; reach = BFS(...)
until no change → unreachable rooms are errors
```
Within a room, keys can always be reached thanks to R6, R7 and R8. Key sources are pickups, `prop.contains` and `character.gives`.

### E4. Shared reach rules (the engine uses the same constants)
- **INTERACT** (for [E]): some reached cell at standing height `y` must have an XZ distance to the target's footprint ≤ `INTERACT.range`, and the target's bottom must be ≤ `y + INTERACT.maxHeightAboveFeet`. For props, the footprint is `propBounds`; for characters, a circle of radius `size[0]/2`.
- **PICKUP:** some reached cell must have an XZ distance to the pickup ≤ `PICKUP.range`, with the pickup's y between `y − PICKUP.below` and `y + PLAYER.height`.
- **walkGrid additions:** `heightsAt(x, z)` and `floodFromAt(x, z, y)` (for characters on platforms). `someReached` stays as it is.

---

## Part F: Art (`src/shared/art.ts`)

```ts
export type ArtKind = "surface" | "cutout" | "character";
export interface ArtJob {
  id: string; kind: ArtKind;
  prompt: string;                 // surface: the material; cutout: the subject; character/frames: the pose
  subject?: string;               // character: the description; also set on animation frames
  aspectRatio: string;            // from the closest Gemini ratio; "1:1" for surfaces
  referenceId?: string;           // frames after the first: the id of the base frame
  builtinUrl?: string;            // heart: "/ui/heart.png"; never sent to the server
}
```
- **Art id** = `${kind}-${slug(prompt).slice(0, 32)}-${hash8}`, where `hash8` is a cyrb53 hash (written into art.ts; no new dependency) of `kind|prompt|subject|aspectRatio|referenceId`. Identical materials across rooms dedupe on their own.
- **`artFor` helpers**, used by both `collectArt` and the engine so every id is computed in one place:
  - `surface(material)`
  - `roomWalls(room)`, `roomFloor(room)`
  - `door(room, door)`: a cutout, aspect from DOOR
  - `panel(prop, part)` → frame ids `[base, ...frames]`. The aspect comes from the part's w:h; panels in a prop with the same art share a job.
  - `character(art, size)` → `{ idle, moving, talking, attack }` id arrays. Every frame except `idle[0]` references `idle[0]`.
  - `item(item)`: key → cutout 1:1; heart → builtin.
  - `ambient(spec)`.
- **`collectArt(spec): Map<id, ArtJob>`** walks everything, including `contains`/`gives` items and the player.
- **`artIdsForRoom(spec, roomId)`** returns the ids for one room, so the client can load the current room first.
- **`closestAspectRatio`** and `ASPECT_RATIOS` move here from `server/assets.ts`.
- **Prompts, in `server/assets.ts`:**
  - `surfacePrompt` and `cutoutPrompt` are unchanged.
  - New `characterPrompt(subject, pose)`: full body, **facing right in a three-quarter view** (so flipping the image horizontally reads correctly), green screen.
  - `framePrompt(subject, pose)` gives the reference image plus "same subject … change only the pose: <pose>".

---

## Part G: Engine design

- **`Part.ts`** (was `Object.ts`). Built from a `PrimitivePart`, a texture and an optional light.
  - **Keep:** geometry per shape, `applyWorldUVs`, collider descriptions, collision groups, `MOVER_LIFT`, `SELF_GLOW`, light creation and flicker/pulse, `setVelocity` / `syncFromPhysics`.
  - **Add:**
    - an `owner: Prop | Character | Pickup | Door | null` pointer, so a touched collider can be mapped to the thing it belongs to;
    - `dispose()` (disposes geometry and material; shared textures are left alone);
    - cylinders (M7) built from convex-hull points, with an apex for taper 0. Use the same `ConvexGeometry` + `ColliderDesc.convexHull` path the wedge already uses; its flat faces keep world UVs working.
- **`Prop.ts`** (was `Group.ts`).
  - Structure: a `Group` (from three) at the prop's position and rotationY, with child Parts from `expandParts`.
  - Light: goes on the tallest part.
  - Panel animation: frames cycled every `FRAME_SECONDS`, swapping `map` and `emissiveMap` directly (the trick from `Sprite.animate`).
  - Holds `examine`, `contains`, `hazard`, `ambient`, and `bounds` (from `propBounds`).
  - Colliders: hazard parts that aren't solid get **sensor** colliders. Examine and contains work by proximity, so they need no sensor.
- **`Character.ts`** (was `Sprite.ts`).
  - **Keep:** move / aimChase / pickTarget / arrive, the character look (black base color, emissive picture, `CHARACTER_STRETCH`, glow unless it has its own light), and `NPC_QUERY_GROUPS`.
  - **Remove:** item, emit and collision handling.
  - **Add:** idle/moving (talking/attack in M6) frame sets.
  - A moving character always gets a collider (a sensor if it isn't solid), so the controller works and walls stop it.
  - `home` is fixed when the character is placed; `resetToHome()`.
- **`Pickup.ts`**: a plane showing the item's art.
  - Placed pickups have no physics body; they're collected by proximity.
  - Dropped pickups get a dynamic body in `DYNAMIC_COLLISION_GROUPS` with the drop velocity `[0, 3, 0]`, spawned at the dropper's top center, 0.5 m toward the camera (the existing `SPAWN_OFFSET` logic). They can be collected after `PICKUP.delaySeconds`.
- **`Door.ts` / `Connection.ts`**: use `geometry.placeDoor`, `arrivalPoint` and `doorSide`. `Connection.locked` becomes a getter: `spec.locked && !state.unlocked.has(id)`.
- **`Room.ts`**: built from a `RoomSpec`.
  - Contents: floor (existing), invisible boundary colliders (existing), walls via `geometry.roomWalls`, props, characters, placed pickups (skipping any in `state.collected`), doors, ambient emitters, dropped pickups (kept while the room is unloaded).
  - Queries: `ownerOf(handle)`, `interactTarget(playerPos, feetY)` (the closest within the INTERACT rule; characters win ties), `pickupsInReach(playerPos, feetY)`.
  - Updates: `update(dt, paused, playerPos)`, `drop(source, item)`, `resetCharacters()`.
  - Ambient spawns and taken pickups are disposed when removed.
- **`GameState.ts`**: plain data, so the state machine can read, reset and save it later.
  ```ts
  hearts; keys: KeyItem[]; unlocked: Set<connId>; collected: Set<"room/pickupId">;
  given: Set<"room/propOrCharId">; conversations: Map<"room/id", number /* finished count */>
  ```
- **`Interactions.ts`** (split out of GameComposer, which keeps the renderer, loop, room swap and resize).
  - **Touch is passive.** Doors fire on first contact (locked flow: "It's locked." / "You unlock it with the X."). Hazard props and hostile characters hurt while touched, gated by invulnerability.
  - **Pickups:** a key goes into `state.keys` and the HUD. A heart (M6) applies only if `hearts < max`; otherwise it stays.
  - **[E] is deliberate.** The target comes from `room.interactTarget`, and the hint is `[E] Talk` / `[E] Examine` / `[E] Search` (only updated when it changes).
    - Talk/examine plays `conversations[min(count, last)]`, then increments the count.
    - When the count first reaches the conversation total and there's a `contains`/`gives` not yet in `state.given`, `room.drop(...)` runs and the source is added to `given`.
    - Search with no examine plays `You find the <name>.` ("You find a heart." for hearts), then drops.
  - **Death:** "Everything goes dark…" → hearts back to max → `room.resetCharacters()` → respawn at `start` with `RESPAWN_INVULNERABLE_SECONDS`.
- **`GameComposer.ts`**:
  - **Fixed 60 Hz step**:
    ```
    acc += min(dt, MAX_FRAME_DT)
    while (acc >= PHYSICS_STEP) {
      player.step(); world.step(); room.update(); interactions.step();
      acc -= PHYSICS_STEP
    }
    alpha = acc / PHYSICS_STEP; player.render(alpha); room.render(alpha); camera follows the render position
    ```
  - **Interpolation:** the Player and Characters keep their previous and current logical positions; their meshes show the blend at `alpha`. Dropped pickups just sync from physics each step.
  - The double `clearRoom()` in `swapRooms`/`loadRoom` is removed.
- **`Player.ts`**: constants come from `constants.ts`; hearts move to GameState; it keeps the invulnerability timer and blink. M6 adds idle/moving art and facing flip.
- **`TextureLibrary.ts`**:
  - Built from `collectArt` jobs and keyed by art id.
  - `minFilter = NearestFilter` and `generateMipmaps = false` (AGENTS.md rule); `builtinUrl` loads directly.
  - `load(gameId, ids)` takes ids in priority order.
- **`Hud.ts`**:
  - `setItems({ name, iconUrl }[])`, with a fallback to `/ui/key.png` if the image fails to load.
  - `setHint`, `setHearts` and `setItems` do nothing when the value hasn't changed.
  - `showMessage(text | null)`: a centered overlay for "Generating…" and errors (style in `style.css`).
- **Facing (M5):** a Character flips `mesh.scale.x` by the sign of its last movement in x; the Player by its last input in x. They keep their facing when they stop.
- **Animation state change (M5):** reset the frame index and apply frame 0 immediately. This fixes the rat stuck on its stepping frame.

---

## Part H: Generation (`server/generation/`)

**Pipeline:** storyboard call → **one game call that returns the whole GameSpec** → `validateGame` → repair if needed → save → the frontend fetches and plays it.

- **`claude.ts`**: `askClaude(prompt, model)`, taken from `scripts/server.ts` (Agent SDK `query` with `tools: []`, `maxTurns: 1`, `effort: "medium"`, and `ANTHROPIC_API_KEY` stripped so it uses the subscription). Exports `AskFn = (prompt: string) => Promise<string>`, `STORY_MODEL = "claude-sonnet-5-5"` and `GAME_MODEL = "claude-opus-5-5"`. Opus is used for the game because spatial layout is the hard part.
- **`storyboard.ts`**: `interface Storyboard { text: string }` and `generateStoryboard(ask, { idea? })`, **one Sonnet call**.
  - **Input:** the player's idea, or a rolled theme (`theme.rollTheme()`) if there isn't one.
  - **Output:** prose inside `<storyboard>` tags, with light headings:
    - title and premise;
    - what happened;
    - the rooms in order (4–8, each with what it reveals and its key objects);
    - the characters (who they are, where they are, what they know or give, which ones are hostile);
    - the lock-and-key chain;
    - the final discovery.
  - Adapted from the story parts of `prompts/house.ts` (via `git show`), with "There is no dialogue" removed.
  - This is the seam for the future conversational storyboard: anything that produces a `Storyboard` can replace this function.
- **`gamePrompt.ts`**: `gamePrompt(storyboard, layoutStyles, roomCount?)`, **one prompt that documents the whole GameSpec**. It's adapted from `prompts/house.ts` and `prompts/room.ts` (via `git show`). **Every number is interpolated from `constants.ts` / `LIMITS` / `DEFAULTS`**, never typed in by hand. Sections:
  1. **Role:** a 2.5D PS1-style horror game whose story is told through objects, examine text and characters.
  2. **`<storyboard>`:** the storyboard text.
  3. **`<map>`:**
     - grid cells (north −z, east +x), one room per cell, connections only between neighboring cells, every room reachable from rooms[0];
     - rooms[0] is the start (usually the outdoor grounds at [0,0], with the first indoor room north of it at [0,−1]);
     - 0–2 locked connections, each key placed in a room the player can reach before that lock;
     - room count from the storyboard, or exactly `roomCount`.
  4. **`<world>`:** coordinates, camera, the walls the engine builds (indoor/outdoor), what the player can climb and reach.
     Also each room's sound: `footsteps` and `ambience`, listing the options from `FOOTSTEPS` and `AMBIENCES` in spec.ts with their one-line meanings. Ask for the footsteps that match the floor, and an ambience that fits the setting (e.g. drip for a cellar, rain when the story has a storm).
  5. **`<doors>`:** each connection needs a door in both rooms, and the grid decides the wall. Give the rule with a worked example: A at [0,0] and B at [0,−1] puts the door on A's north wall and B's south wall (an exit strip). Also cover offsets and arrival spots.
  6. **`<building_blocks>`:** box, wedge, panel, cylinder, stairs, plus part and prop fields. Reuse the existing examples and add one each for cylinder and stairs.
  7. **`<interaction>`:** examine, contains, characters (art description and poses, movement, dialogue, gives, hostile), pickups (key, heart), ambient, hazard. One example each.
  8. **`<rules>`:** a summary of the R/G rules that a program checks, plus composition, light, art and theme guidance. "Give each room a different layout style from this list": a roll of indoor styles plus one outdoor style from `layouts.ts`.
  9. **`<output_format>`:** `<notes>` (short: per room, its story beat, door offsets and prop footprints, so Claude can check fits), then `<game>` with the full GameSpec JSON.
- **`generateGame.ts`**: `generateGame(ask, { idea?, storyboard?, roomCount?, onProgress? }) → { spec, log }`
  ```
  storyboard = options.storyboard ?? await generateStoryboard(...)              stage "storyboard"
  json = extractTaggedJson(await askGame(gamePrompt(...)), "game")              stage "designing"
  for attempt in 1..3:                                                          stage "checking"
    issues = validateGame(json).issues + generationRules(json, roomCount)
    if no errors → return
    if every error has a `room` → room repair:                                  stage "repairing"
        ask(roomRepairPrompt(json, errors grouped by room)) → <rooms>[corrected room objects]</rooms>
        → each one must parse with parseRoom and keep its id and grid; replace those rooms in json by id
        (if Claude returns unknown ids, a changed grid, or unreadable JSON, use the full repair instead)
    else → full repair: ask(gamePrompt(...) + repairSection(previous JSON, issues)) → a new <game>
  throw with formatIssues(...)  // after 3 attempts
  ```
  - **Generation-only rules** (`generationRules`; the engine doesn't need them): the room count is from 2 to `LIMITS.rooms`, or exactly `roomCount` if one was asked for.
  - **`roomRepairPrompt`:** includes the whole current game JSON for context (connections, other rooms) but asks only for the failing rooms by id. Message: "Return only these rooms, complete and corrected. Change as little as possible; keep their ids, grid and doors' connections." Built with `repairSection` from `repair.ts`.
  - **`onProgress`:** `{ stage: "storyboard" | "designing" | "checking" | "repairing", attempt }`.
  - **`GenerationLog`:** the idea or theme, storyboard, notes, every attempt (its kind, issues, seconds), final warnings, total seconds (the same idea as `SavedHouse`).
- **Moved unchanged:** `tagged.ts`, `theme.ts`, `layouts.ts`, `repair.ts`.
- **`server/jobs.ts`:**
  - `start(options) → id` (`YYYYMMDD-HHmmss-xxxx`); at most 2 jobs run at once.
  - Status: `{ status: "generating", ...progress } | { status: "failed", error } | { status: "ready" }`.
  - On success, save `server/games/<id>/game.json` and `generation.json`. On failure, save `generation.json` with the error.
- **`server/index.ts` routes:**
  - `POST /api/games` with `{ idea?, storyboard?, roomCount? }` → `202 { id }`. A `storyboard` skips the storyboard call; this is where the future storyboard conversation hands off.
  - `GET /api/games/:id` → `200` the GameSpec, `202` progress, `500 { status: "failed", error }`, or `404`.
  - `GET /api/games/:id/assets/:artId` → PNG, as today.
- **`server/games.ts`:**
  - Load `fixtures/games/<id>.json` (always read fresh, which fixes the stale-cache problem) or `server/games/<id>/game.json`.
  - Run `validateGame` on load; if it fails, return 500 with `formatIssues`.
  - Assets go to `server/games/<id>/assets/<artId>.{jpg,png}`.
- **Client `main.ts`:**
  - `?game=` defaults to `haunted`. `?game=new` (optionally with `&idea=...`) → POST → `history.replaceState` to `?game=<id>` → poll every 2 s. The overlay shows `Writing the storyboard…` / `Designing the game…` / `Checking…` / `Repairing (attempt N)…`.
  - When the game is ready: `validateGame`. On errors, show them in the overlay; otherwise start the game and load art in priority order.
- **`scripts/gen-game.ts`:** CLI for `npm run gen -- [roomCount] "idea"`. It prints the storyboard, progress and any issues, saves through `games.ts`, and prints the `?game=` URL.

---

## Part I: Milestones

Each milestone ends with the build and checks green and the game playable. Sizes are S, M or L.

### M1: Hygiene and shared constants (S)
1.1 Remove the hardcoded key.
- `server/assets.ts` reads `process.env.GEMINI_IMAGE_KEY` and throws a clear error on first use if it's missing.
- Delete `src/character.ts`.
- `vite.config.ts`: remove `envPrefix` and its comment.
- `package.json` `dev:server` → `tsx watch --env-file=.env.local server/index.ts`. Check that the variable loads by logging only whether it's present, never its value.

1.2 Add `"strict": true` to `tsconfig.json` (it already passes `--strict`).

1.3 Create `src/shared/constants.ts` (C1). Change `Player.ts`, `Door.ts`, `Room.ts` (`PICKUP_DELAY`) and `Sprite.ts` (`FRAME_SECONDS`) to import from it, with values unchanged. Leave the old generation files alone; they're deleted in M4.

**Done when:**
- `npm run build` passes.
- `grep -rn "AQ\.Ab8" src server scripts` finds nothing.
- `npm run dev` starts and the dev game loads from the cached assets on disk (no Gemini call).
- Quick walk-around: doors work and the ghost chases.

### M2: Contract and parser (M)
2.1 `src/shared/spec.ts` exactly as in Part C, **without** the items marked M6/M7. Include `LIMITS` and `DEFAULTS`.

2.2 `src/shared/reader.ts`: a small typed reader with path tracking.
- Methods: `text`, `num({min,max,int})`, `bool`, `vec2`, `vec3`, `slug`, `oneOf`, `array(fn, {min,max})`, `optional`, `object(allowedKeys)` (reports unknown keys).
- Same style as the helpers in `roomPlan.ts` (`isFields`, `vec3`).

2.3 `src/shared/parseSpec.ts`: `parseGameSpec` (plus an exported `parseRoom(value, path)`, which room-scoped repair uses), covering rules S1–S11 and filling defaults.

2.4 `fixtures/games/haunted.json`: convert `server/prompts/test-output.ts` using the **conversion table** below.

2.5 `scripts/check-specs.ts` and `scripts/spec-cases.ts`. Cases are `{ name, expect: string[] /* substrings */, mutate(spec) }`, applied to a deep copy of haunted. Add S-rule cases:
- a missing room `size`;
- an unknown field `dialogues` on a character;
- light intensity 15;
- id `"Great Hall"`;
- a panel with `material`;
- a solid part with no material anywhere;
- chase speed 5;
- `gives` without dialogue.

Add `"check": "tsx scripts/check-specs.ts"` to `package.json`. The script exits 1 if anything fails and prints the warnings for the valid fixtures. Also change `build` to `tsc && tsc -p server && tsc -p scripts && vite build`, so new scripts get type-checked. `tsc -p scripts` passes today.

**Conversion table (test-output → haunted.json):**
- **Textures:** drop the `textures` table. Each `textureId` becomes the description of the thing it textured:
  - wallpaper → foyer and study `walls`;
  - floorboards → their `floor`;
  - stone-wall / stone-floor → cellar;
  - `wood` → material "dark worn oak wood grain";
  - `door` → `doors[].art` "heavy wooden door with iron hinges".
- **Room fields:** walls (`*-back/left/right-wall`) are deleted because the engine builds them. Rooms get `start` as [x, z]: foyer [8, 14], cellar [7, 10], study [6, 8]. `lightLevel` becomes `baseLight`.
- **Foyer props:**
  - `balcony` (floor, railing and two pillars as 4 parts at their current room positions; the prop sits at the origin [0,0,0]).
  - `staircase` (the 10 step boxes + the stringer wedge + the handrail with solid false, kept in the group's frame: position [16.5, 0, 10.2]).
  - `hearth` (box, glow light, flicker) and a **separate** `chimney-breast` prop. Splitting them keeps the glow at the fire, because the light goes on a prop's tallest part.
  - `couch` (seat and back).
  - `grandfather-clock` (panel with solid true; add `examine` [{lines: ["Its hands are stopped at midnight."]}]).
  - `portrait` (panel; add `examine`).
  - `rug` (flat panel, rotation [−1.5708,0,0], y 0.01).
  - `mantel-candle` (panel, art "single melting candle with a tall flame", frames ["the same candle with a short flickering flame"], glow flicker, ambient {art "single drop of melted candle wax", size [0.08,0.12], everySeconds 4, lifetimeSeconds 2, velocity [0,−0.3,0]}).
  - `butler-corpse` (panel with solid true; examine [{lines: ["The butler. Something is clutched in his cold hand."]}]; contains {kind key, name "Brass Key", art "old ornate brass key", unlocks "foyer-cellar"}).
  - Parlor set, flattened to room space:
    - `parlor-table`: [9.5, 0, 9], rotationY 0.3, spot light;
    - `parlor-chair-left`: [8.258, 0, 9.384], rotationY 1.8708, seat and back;
    - `parlor-chair-right`: [10.742, 0, 8.616], rotationY −1.2708.
- **Foyer characters:** `ghost`: art {description "pale translucent ghost woman in a nightgown", idle ["floating", "floating slightly higher"]}, size [1,2], chase 2/5, hostile 1, glow pulse light.
- **Cellar:** props `barrel-1`, `barrel-2` and `crate` (spot light). Character `rat`: art {description "mangy black rat with red eyes", idle ["still"], moving ["scurrying, legs back", "scurrying, legs forward"]}, size [0.6,0.3], wander 1.5/2, hostile 1.
- **Study:**
  - props `bookshelf`, `desk`, `desk-chair`, `study-portrait`;
  - character `caretaker`: art {description "hunched elderly caretaker in a stained apron holding a dim lantern", idle ["standing, lantern raised"]}, size [1,1.9], solid true, flicker glow light, patrol points [[9,5.5],[10.5,8],[7,8.5]], dialogue = the existing 3 lines.
- **Connections:** unchanged (foyer-cellar is locked). Door offsets are unchanged.

**Done when:** `npm run build` and `npm run check` pass (haunted parses with no errors; every case produces its expected substring).

### M3: Geometry and validators (L)
3.1 `src/shared/geometry.ts` (Part D, without stairs and cylinder).

3.2 `src/shared/walkGrid.ts`: port `src/game/generation/walkGrid.ts` with constants imported, and add `heightsAt` and `floodFromAt`.

3.3 `src/shared/checkRoom.ts`: port `checkLayout.ts` (keep its message wording) and add R5–R11 as specified, using `geometry.arrivalPoint` and the E4 reach rules.

3.4 `src/shared/checkGame.ts`: G1–G8 and an exported `solveLocks`.

3.5 `src/shared/validate.ts`: `validateGame`, the `Issue` type, `formatIssues`.

3.6 Cases in `spec-cases.ts`:
- **Room:** a prop pushed out of the room; two props overlapping; start inside the couch; a missing door for foyer-study; a door blocked (crate in front of the cellar door's arrival point); a character inside the bookshelf; a patrol point inside the desk; a pickup on top of the 3 m balcony with no way up; an examine prop out of reach.
- **Game:** a duplicate room id; non-adjacent grid cells; an unreachable room; a locked connection with no key; the key moved into the cellar (behind its own lock); a key unlocking an unknown connection; a duplicate prop id within a room.

The old `src/game/generation/` stays untouched and still compiles.

**Done when:** build and check pass. If haunted triggers a real rule violation, fix the fixture minimally and log it as a deviation; never loosen a rule just to pass.

### M4: Engine on the spec (L), CHECKPOINT
The order matters, because every commit must build. Between 4.2 and 4.4 the server serves a GameSpec while the client still expects the old format, so the game isn't playable mid-milestone. That's allowed; it must be playable at the end.

4.1 `src/shared/art.ts` (Part F, without heart, player, talking or attack). In `check-specs`, assert that ids are deterministic (two runs match), that haunted's job count is stable, and that the shared wood surface produces one job.

4.2 **Move the server onto the spec and retire the old pipeline, in one commit.** This has to be one step because `server/games.ts` imports `SavedHouse` and `testOutput`, and the old generation code imports `Connection`, which changes in 4.4.
- `server/games.ts` and `server/index.ts`: load fixtures and saved specs and validate them (Part H). An unknown id returns 404 for now.
- `server/assets.ts`: `getAsset(spec, artId)` through `collectArt`, plus `characterPrompt` and `framePrompt(subject, pose)`. Keep `processImage`, `removeGreenScreen`, `once`, `limiter` and `askGemini` unchanged, and keep the `gen-ui.ts` exports.
- `git mv` `tagged.ts`, `theme.ts`, `layouts.ts` and `prompts/repair.ts` into `server/generation/`.
- Delete `buildRoom.ts`, `checkLayout.ts`, `walkGrid.ts`, `housePlan.ts`, `roomPlan.ts`, `generateHouse.ts`, `generateRoom.ts`, `askClaude.ts`, `prompts/house.ts`, `prompts/room.ts`, `scripts/gen-house.ts` and `server/prompts/**`.
- **Keep `output.ts` for now;** the engine still imports it until 4.4.
- The old prompts stay available through `git show` for M8.
- Generation is unavailable until M8; that's expected.

4.3 `git mv` `Object.ts→Part.ts`, `Group.ts→Prop.ts`, `Sprite.ts→Character.ts`. Rename the classes and update imports. Make no behaviour change, and build before going on.

4.4 **Rework the engine onto GameSpec** as in Part G (without the M5/M6 items):
- `Part`, `Prop`, `Character`, the new `Pickup`, `Door`, `Connection`, `GameState`, `Game` from a GameSpec, `Room` from a RoomSpec;
- split out `Interactions.ts`; GameComposer keeps the renderer, loop, swaps and resize; death stays as it is today until M5;
- `TextureLibrary` keyed by art id;
- `main.ts`: `validateGame` (errors go to `hud.showMessage`), default `?game=haunted`, art loaded current room first; `Hud.showMessage` plus its CSS.

This can be several commits if each one builds. Otherwise commit it as one. Delete `src/game/generation/` (now just `output.ts`) at the end of this step.

4.5 Delete `server/games/{dev,haunted-1,haunted-2}/`. Load `?game=haunted` once to generate its art (about 25 Gemini images; the one allowed spend). Commit `server/games/haunted/assets/`. In `.gitignore`, ignore `server/games/*` except `!server/games/haunted/`.

**Done when:** build and check pass, `grep -rn "generation/output" src server scripts` finds nothing, and a **human signs off the parity playtest P1–P12.**

### M5: Engine hardening (M)
- 5.1 Fixed timestep and interpolation (Part G, GameComposer).
- 5.2 `Part.dispose()` for ambient spawns, taken pickups and expired drops. In dev only (`import.meta.env.DEV`), log `renderer.info.memory` every 30 s.
- 5.3 Death respawn with invulnerability and `room.resetCharacters()`.
- 5.4 TextureLibrary: Nearest min filter, no mipmaps.
- 5.5 Character: animation state change resets the frame; facing flip; moving characters always have a collider.
- 5.6 HUD setters do nothing when the value hasn't changed; no allocations in the step loop (scratch vectors in `Interactions`, `Room.update` and `Character.move`).

**Done when:** build and check pass; P1–P12 still pass; H1–H5 pass (the agent can check H1 and H3 from logs; the rest go to the M6 checkpoint).

### M6: Hearts, player art, character states (M), CHECKPOINT
- 6.1 Spec additions: `ItemSpec` heart, `GameSpec.player`, `CharacterArt.talking`/`attack`. Update the parser (with defaults) and validators (hearts are not key sources; they count toward pickups).
- 6.2 `art.ts`: the builtin heart, player frames, talking and attack frames.
- 6.3 Engine:
  - A heart pickup, placed or dropped, heals 1 and stays if hearts are full.
  - Player art: idle/moving, facing flip, character look and stretch.
  - A Character plays its talking frames during its own conversation, and its attack frames for 0.5 s after dealing damage (falling back to idle if it has none).
- 6.4 HUD inventory icon = the key's art URL (`/api/games/<id>/assets/<artId>`), with a fallback to `/ui/key.png`.
- 6.5 Fixture:
  - `player` art {description "a pale young woman in a rain-soaked coat holding a candle", idle ["standing"], moving ["walking, left foot forward", "walking, right foot forward"]};
  - a heart pickup in the cellar at [4, 0, 6];
  - the desk gets `contains` heart and `examine` [{lines: ["A drawer hangs open."]}];
  - the ghost gets `attack` ["lunging forward, arms outstretched"];
  - the caretaker gets `talking` ["mouth open, gesturing with the lantern"].
  - Add cases: a heart with `unlocks` (unknown field error), and a character with 5 idle frames (limit error).

**Done when:** build and check pass, and a **human signs off P1–P12, H1–H5 and F1–F6.**

### M7: Cylinder and stairs (M), CHECKPOINT
- 7.1 Spec and parser: shapes `cylinder` (`taper` 0..1, default 1) and `stairs`; S8 rules for both.
- 7.2 `geometry.expandParts` (stairs into boxes, as in Part D) and R12 (tread too shallow).
- 7.3 `walkGrid.sample` for cylinders. The footprint is an ellipse with radii w/2 and d/2: convert the local point to normalized coordinates; inside the ellipse the distance is 0; outside, use the distance to the radial projection on the ellipse. The top is a surface only inside the top ellipse (radii × taper), so a cone is never standable.
- 7.4 `Part`: cylinder mesh and collider from the same convex-hull points (`CYLINDER_SEGMENTS`, an apex at taper 0). Stairs never reach `Part`, because they're already expanded.
- 7.5 `art.ts`: cylinders use the surface (material) art.
- 7.6 Fixture: the barrels become cylinders (size [1, 1.3, 1]). Add a `stone-column` prop in the foyer at [12, 0, 7] (one cylinder part, size [0.6, 4, 0.6], taper 0.85, material "cracked grey marble"). It's clear of the parlor chairs, the staircase and every door arrival point. Replace the 10 staircase boxes with one `stairs` part, size [3, 3, 4.5], at local [0, 0, −2.25], keeping the stringer and handrail. Add cases: stairs [3, 3, 1] (too steep), taper 1.5, `art` on a cylinder.

**Done when:** build and check pass, and a **human signs off G1–G4.**

### M8: Generation on the spec (L)
- 8.1 `claude.ts`.
- 8.2 `storyboard.ts`: prompt and extraction from `<storyboard>`.
- 8.3 `gamePrompt.ts`: every section from Part H, with numbers interpolated. Reuse the wording of the old prompts (`git show HEAD~N:src/game/generation/prompts/room.ts` etc.) wherever it still applies. Keep the prompt under about 300 lines; examples are the most valuable part.
- 8.4 `generateGame.ts`: the flow, `generationRules`, `roomRepairPrompt`, the full-repair fallback, progress, log.
- 8.5 `fixtures/claude/`:
  - `storyboard.txt`;
  - `game.txt` (`<notes>` plus `<game>` wrapping haunted.json);
  - `game-broken-room.txt` (haunted with the study desk pushed out of the room);
  - `rooms-fix.txt` (`<rooms>` with only the corrected study);
  - `game-broken-locks.txt` (haunted with the corpse's key removed, a game-level G6 error).
- 8.6 `scripts/check-generation.ts`: runs `generateGame` with a fake `AskFn` that matches prompts to canned responses. Two scenarios:
  - **Room repair:** game → `game-broken-room.txt`; room repair → `rooms-fix.txt`. Assert that it validates, took 2 attempts, the repair prompt asked only for `study` and contained the R1 message, and the final spec deep-equals haunted after normalization.
  - **Full repair:** game → `game-broken-locks.txt`; full repair → `game.txt`. Assert that the full-repair path ran and the result validates.
  
  Add `"check:gen": "tsx scripts/check-generation.ts"` to `package.json`.
- 8.7 `scripts/gen-game.ts` and `"gen"` in `package.json`. **Live budget: at most 2 games.** Record each live run's total seconds, attempts and output size in PROGRESS.md (this informs the latency risk in Part K).

**Done when:**
- build, `npm run check` and `npm run check:gen` pass;
- one live game validates, loads, and can be completed (each locked door opened with its key);
- `generation.json` is reviewed for warnings, and anything notable goes in PROGRESS.md.

### M9: Server on demand and client flow (M), CHECKPOINT
- 9.1 `server/jobs.ts`.
- 9.2 `server/index.ts` routes (Part H).
- 9.3 `main.ts`: the `?game=new` flow, polling, overlay, failure messages.
- 9.4 `package.json`: remove the `server` and `claude` scripts; keep `dev`, `build`, `check`, `check:gen`, `gen`, `sprite`, `gemini-text`. Delete `scripts/server.ts` and `scripts/claude.ts`.

**Done when:** build and the checks pass, and a **human signs off M9-1 to M9-3.** Live budget: at most 2 games.

### M10: Cleanup and docs (S)
- 10.1 `grep` for any leftover references to deleted files, old field names (`textureId`, `collisionsEnabled`, `hostileToIds`, `lightLevel`, `dimensions`), and ports 3001/`askClaude`. Remove them.
- 10.2 `docs/gamespec-v2/CONTRACT.md`: a human-readable reference with every field, its default, limits and runtime meaning, and the reach rules. It must match `spec.ts` and `constants.ts`.
- 10.3 `AGENTS.md`, with whole-team sign-off:
  - replace the Ownership paths and Stack notes with the real layout (`src/shared` contract, `src/game` engine, `server/generation`);
  - remove `sprite_normalize.py` and the atlas notes;
  - mention fixtures and the check scripts;
  - say that the fixed timestep and disposal are implemented.
- 10.4 Final pass: build, check, check:gen, one live game end to end, the full checklist. Update the PR description with every pre-existing file modified, then mark the PR ready for review.

---

## Part J: Verification

**Automated gates** (the agent runs them every task):
- `npm run build`: client `tsc` (strict) + `tsc -p server` + `tsc -p scripts` (from M2) + `vite build`.
- `npm run check`: haunted validates with no errors; every case in `spec-cases.ts` produces its expected substrings; art ids are deterministic.
- `npm run check:gen` (from M8): offline generation with canned responses, including the repair path.

**Playtest checklists** (run by a human at checkpoints; run `npm run dev`, then open `http://localhost:5173/?game=haunted`):
- **P1** It loads with placeholders, then the art streams in, current room first; the console shows how many loaded and which failed.
- **P2** Walk around the foyer: the couch, hearth and clock block you, and the room edges hold.
- **P3** Climb the staircase to the balcony, walk along it, drop off the edge.
- **P4** The candle animates and flickers, and wax drips fall and disappear about every 4 s.
- **P5** The ghost chases within 5 m, hits for 1 heart (player blinks), gives up when you're far away, and walks home.
- **P6** [E] Examine on the clock and portrait shows their text; the hint label is correct.
- **P7** [E] on the corpse shows its examine text, then the key pops out; walking over it adds "Brass Key" to the HUD.
- **P8** The north door says "It's locked." without the key; with it, you get the unlock message and go to the cellar; coming back, it stays unlocked.
- **P9** The cellar is dark, the rat wanders and hurts on touch, and the crate has a spot light.
- **P10** In the study: you arrive in front of the door; the caretaker patrols, stops while talking, and [E] Talk plays 3 lines.
- **P11** Leave and come back to rooms: the key doesn't reappear, the corpse doesn't drop again, characters stay where they were.
- **P12** Die: "Everything goes dark…", respawn at the room start with full hearts. From M5 on, you're briefly invulnerable and the ghost is back home.

**Hardening (M5):**
- **H1** 10 minutes idle in the foyer: geometry and texture counts in the dev log stay flat.
- **H2** At a high refresh rate, or with the CPU throttled to 4× in DevTools, movement stays smooth and dropped items don't fall through floors.
- **H3** The rat stops on its idle frame.
- **H4** Distant cutouts don't erode or flicker.
- **H5** Characters face the way they walk.

**Features (M6):**
- **F1** A heart at full health stays put; after a hit, it heals 1.
- **F2** The desk drops a heart after you read it.
- **F3** The HUD key icon is the generated key art.
- **F4** The player has art and flips with movement.
- **F5** The ghost shows its attack pose when it hits.
- **F6** The caretaker shows the talking pose during dialogue.

**Geometry (M7):**
- **G1** The barrels and column are round, and collisions with them feel round.
- **G2** The stairs part is climbable step by step and looks like real steps.
- **G3** The layout check agrees with the game: anything the validator calls reachable is reachable.
- **G4** No visible UV seams on the cylinders.

**On-demand generation (M9):**
- **M9-1** `?game=new&idea=a drowned lighthouse`: the overlay goes through storyboard → designing → checking (→ repairing), then the game loads, is playable and can be completed.
- **M9-2** Reloading `?game=<id>` loads it instantly from disk.
- **M9-3** A forced failure (for example the env key unset) shows a readable error in the overlay, and `generation.json` is written.

---

## Part K: Risks and mitigations
- **Merge conflicts in a 3-person repo:** freeze plus one branch plus an early draft PR listing the files touched; rebase at every milestone boundary.
- **Parity regressions:** the haunted fixture is the regression target and checkpoints are human-verified; the engine classes are adapted, not rewritten.
- **Spend:** checks are offline; canned Claude responses; fixture art is committed; explicit live budgets.
- **Generation quality with a richer schema:** one example per feature in the prompt; the `<notes>` footprint scratchpad; validator messages written for Claude; up to 3 attempts; room-scoped repair.
- **Latency of one long call:** a 5–6 room game is a long output, so expect a wait of a few minutes. Mitigations: the overlay shows the stage; repairs only re-emit the broken rooms; at most 2 jobs run at once. 8.7 measures the real numbers. If the wait turns out too long for a demo, the game call can later be split into per-room calls that fill the same GameSpec, with no change to the contract or the frontend. Don't do that unless the measurements call for it.
- **Output size limit:** if a game hits the model's output cap (the JSON is cut off, `extractTaggedJson` fails), the full-repair path can't help. Lower the room count in the prompt (`LIMITS.rooms`) rather than adding chunking.
- **The panel-flat-on-floor convention** (a flat panel extends north from its position): keep it as it is (consistent with walkGrid, placeProp and the prompt's existing explanation) and document it in CONTRACT.md.
