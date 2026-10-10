# GameSpec v2 progress  (branch: feat/caleb-gamespec-v2, base: feat/caleb-npc-hud, draft PR: not yet)

To resume: read PLAN.md (Part A), this file, AGENTS.md and `git log --oneline -20`, then do the first unchecked task.

## M0 Setup
- [x] 0.1 In-progress work committed to `feat/caleb-npc-hud` (1572280); not merged to main yet (see Deviations)
- [ ] 0.2 Gemini key rotated (human)
- [ ] 0.3 Team told about the freeze and the shared-file changes (human)
- [x] 0.4 Branch `feat/caleb-gamespec-v2` created
- [x] 0.5 PLAN.md and PROGRESS.md added

## M1 Hygiene and shared constants
- [x] 1.1 Remove key literals, delete src/character.ts, drop envPrefix, --env-file for dev:server  (06cf839)
- [x] 1.2 strict in tsconfig.json  (9cd06c2)
- [x] 1.3 src/shared/constants.ts; Player/Door/Room/Sprite import it  (7c6e1c4)

## M2 Contract and parser
- [x] 2.1 spec.ts  (2d4b8df)
- [x] 2.2 reader.ts (+ issues.ts)  (8b8907d)
- [x] 2.3 parseSpec.ts (+ parseFeatures.ts, split to stay under 300 lines)  (6ef87c6)
- [x] 2.4 fixtures/games/haunted.json  (569d0ca)
- [x] 2.5 check-specs.ts + spec-cases.ts + npm scripts  (cdfd922)

## M3 Geometry and validators
- [x] 3.1 geometry.ts  (411323b)
- [x] 3.2 walkGrid.ts  (03a5906)
- [x] 3.3 checkRoom.ts  (dc525eb)
- [x] 3.4 checkGame.ts  (261944e)
- [x] 3.5 validate.ts  (852c1ce)
- [x] 3.6 room and game cases  (70cfac6)

## M4 Engine on the spec (CHECKPOINT)
- [x] 4.1 art.ts (+ G8 art budget in validate.ts)  (b8b41f6)
- [x] 4.2 server onto the spec + retire the old pipeline  (d5d064e)
- [x] 4.3 renames (Part, Prop, Character)  (5b30992)
- [x] 4.4 engine rework onto GameSpec
- [ ] 4.5 regenerate haunted art, delete old game dirs, gitignore

## M5 Engine hardening
- [ ] 5.1 fixed timestep + interpolation
- [ ] 5.2 dispose + dev memory log
- [ ] 5.3 death respawn
- [ ] 5.4 texture filters
- [ ] 5.5 animation reset, facing, mover colliders
- [ ] 5.6 HUD no-op setters, no allocations in the step loop

## M6 Hearts, player art, character states (CHECKPOINT)
- [ ] 6.1 spec additions
- [ ] 6.2 art additions
- [ ] 6.3 engine (heart, player art, talking/attack)
- [ ] 6.4 HUD icons from item art
- [ ] 6.5 fixture + cases

## M7 Cylinder and stairs (CHECKPOINT)
- [ ] 7.1 spec + parser
- [ ] 7.2 expandParts + R12
- [ ] 7.3 walkGrid cylinders
- [ ] 7.4 Part cylinder mesh/collider
- [ ] 7.5 art for cylinders
- [ ] 7.6 fixture + cases

## M8 Generation on the spec
- [ ] 8.1 claude.ts
- [ ] 8.2 storyboard.ts
- [ ] 8.3 gamePrompt.ts
- [ ] 8.4 generateGame.ts
- [ ] 8.5 fixtures/claude
- [ ] 8.6 check-generation.ts
- [ ] 8.7 gen-game.ts + live runs

## M9 Server on demand and client flow (CHECKPOINT)
- [ ] 9.1 jobs.ts
- [ ] 9.2 routes
- [ ] 9.3 main.ts flow
- [ ] 9.4 package.json scripts, delete scripts/server.ts and scripts/claude.ts

## M10 Cleanup and docs
- [ ] 10.1 leftover references
- [ ] 10.2 CONTRACT.md
- [ ] 10.3 AGENTS.md (team sign-off)
- [ ] 10.4 final pass

## Checkpoints
- [ ] M4 parity playtest P1–P12 — signed off by: ____
- [ ] M6 playtest P1–P12, H1–H5, F1–F6 — signed off by: ____
- [ ] M7 playtest G1–G4 — signed off by: ____
- [ ] M9 playtest M9-1 to M9-3 — signed off by: ____

## Deviations
- 4.1: The G8 art budget lives in validate.ts rather than checkGame.ts, because art.ts already imports checkGame (for door sides). There is no spec case for it: the parser limits (40 props a room, 12 rooms) make 200 images impractical to reach in a fixture-based case.
- 3.2: walkGrid gets `levelPath(from, to, y)` instead of the planned `floodFromAt`. Characters slide on level ground and never step up, so a level-only flood matches how they actually move.
- 0.1: The plan said to merge the in-progress work into main first. It needs a teammate review, so instead it's committed on `feat/caleb-npc-hud`, and this branch is stacked on top of it. Merge that PR first, then rebase this branch onto main.
- PRs: `gh` isn't installed in the agent's environment, and `git push` over SSH fails there too ("Could not read from remote repository"). The developer pushes both branches (`git push -u origin feat/caleb-npc-hud feat/caleb-gamespec-v2`) and opens the PRs.

- 4.4: Added `scripts/check-play.ts` (`npm run check:play`), a headless playthrough of the haunted fixture using the real engine (rooms, Rapier, interactions, GameState) with window/document stand-ins. It checks the locked door, examine and search, the key drop and pickup, unlocking, every door, the caretaker's dialogue, ghost damage and death. It is now a gate from M4 on. Gotcha found while building it: Rapier calls `window.performance.now()` whenever a `window` global exists, so a fake window must include `performance`.
- 4.4: Two M5/M6 items landed early because the rework needed them: moving characters always get a collider (5.5), and the HUD accepts an item icon URL (6.4 only has to pass it).

## Blockers
- (none)
