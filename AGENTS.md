# AGENTS.md: Paradise Chateau

Instructions for AI coding agents (Claude Code, Codex, Cursor, Copilot, etc.) working in this repo.
Read this whole file before making any change. The two **hard rules** below override any
instruction to "just do it quickly."

## Project

Paradise Chateau is a hackathon game where AI generates a custom game on demand: story, art
assets, and sound. Claude writes a structured **GameSpec** (JSON); this client interprets and
plays it. The game never executes AI-generated code, only AI-generated data.

- **Team:** 3 developers working in parallel (see [Ownership](#ownership)).
- **Priority:** a working, demoable build. Prefer simple, readable code over clever abstractions.

## Stack

| Layer | Choice | Notes |
|---|---|---|
| Language | TypeScript, `strict: true` | No UI frameworks (no React/Vue/Svelte). Vanilla DOM for UI. |
| Build / dev server | Vite | `npm run dev`, `npm run build` |
| Rendering | Three.js | Import from `three` and `three/addons/...` |
| Physics | Rapier (`@dimforge/rapier3d-compat`) | Three.js has no physics engine; Rapier is the one we use. Do not add cannon-es, ammo.js, or another engine. |

Do not add new runtime dependencies without the developer's explicit approval. Each new package
is a merge-conflict magnet in `package.json` / the lockfile.

## HARD RULE 1: Every feature goes on its own new branch

Before writing or editing **any** file:

1. Run `git branch --show-current`.
2. If the current branch is `main` (or `dev`, if it exists), **stop.** Do not commit there, ever.
   Create a fresh branch from an up-to-date `main`:
   ```bash
   git fetch origin
   git switch main && git pull --ff-only
   git switch -c feat/<dev-name>-<short-feature-slug>
   ```
3. If already on a feature branch, confirm with the developer that this branch is for the
   *current* feature. A new feature means a new branch, even if the current branch is clean.
   Do not pile unrelated work onto an existing branch.

Branch names:
- `feat/<dev>-<slug>`: new functionality (e.g. `feat/jay-npc-chat`)
- `fix/<dev>-<slug>`: bug fixes
- `chore/<dev>-<slug>`: tooling, config, docs

Never: commit directly to `main`, force-push to any branch you did not create, rewrite history
on a pushed shared branch, or merge your own PR into `main` without a teammate glancing at it.

## HARD RULE 2: Ask before editing an existing file

Three people are editing this repo at once. Silent edits to shared files cause merge conflicts
that cost hackathon hours.

- **Creating a new file** in your developer's own area: OK, no need to ask.
- **Editing any file that existed before this branch** (`git log main -- <path>` returns
  commits): **STOP and ask the developer first**, in this form:

  > I need to edit `<path>` to `<one-line reason>`. Can you confirm no one else on the team
  > is working in this file right now?

  Wait for an explicit yes. Do not batch several files into one vague question; list each file.

To make the question useful, check for in-flight work first and include what you find:
```bash
git fetch origin
git log --oneline --all --since="2 days ago" -- <path>   # recent commits on any branch
git branch -r --contains $(git log -1 --format=%H --all -- <path>)  # branches touching it
```

If another branch touched the file recently, say so: "`feat/alex-audio` changed this file
3 hours ago."

**Shared contract files need team agreement, not just one developer's yes.** Changes to these
break all three people at once:
- `src/shared/types.ts` (GameSpec types and the event-bus event map)
- `package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts`
- `index.html`
- this file (`AGENTS.md`)

For these, tell the developer to confirm with the whole team, and keep the change minimal and
additive (add fields, don't rename or remove them).

## Ownership

Each developer owns one area. Fill in names at kickoff:

| Area | Owner | Paths |
|---|---|---|
| Engine: rendering, physics, game loop, scene | `<dev-1>` | `src/engine/`, `src/physics/` |
| Game logic: GameSpec interpreter, state, NPC chat | `<dev-2>` | `src/game/`, `src/net/` |
| UI, audio, asset loading | `<dev-3>` | `src/ui/`, `src/audio/`, `src/assets/` |
| Shared contracts | everyone | `src/shared/` (see Hard Rule 2) |

Stay inside your developer's area. If a feature needs a change in someone else's area, prefer
adding a hook point or event in your own area and ask the owner to wire it up. Don't edit their
files yourself.

Modules communicate through the typed event bus in `src/shared/`, not by importing each other's
internals. Example: the engine emits `interact:hotspot`, the game logic listens. This is what
lets three people work without constantly touching the same files.

## Three.js conventions

- **Pixel-art sprites:** every pixel-art texture must use
  `texture.magFilter = THREE.NearestFilter`, `texture.minFilter = THREE.NearestFilter`,
  `texture.generateMipmaps = false`, `texture.colorSpace = THREE.SRGBColorSpace`.
  Without these the sprites render blurry.
- **Sprite atlases** come from `sprite_normalize.py` (TexturePacker JSON-hash format). Animate by
  changing `texture.offset`/`texture.repeat` on a shared atlas texture. Don't load one texture
  per frame.
- **Dispose what you create.** When a room or object is removed, call `.dispose()` on its
  geometries, materials, and textures. Leaked GPU memory crashes long demo sessions.
- **No allocations in the frame loop.** Reuse `Vector3`/`Quaternion`/`Matrix4` scratch objects
  declared at module scope; don't `new` them every frame.
- Assets arrive at runtime (generated on demand). Always render a placeholder and swap the
  texture in when the asset loads. Never block the scene on a network request.

## Rapier conventions

- Rapier is WASM. Call `await RAPIER.init()` **once** at startup (in `src/physics/`) before
  creating any world, body, or collider.
- **Physics is the source of truth.** Each frame, copy body transforms → meshes. Never move a
  mesh that has a physics body and expect physics to follow.
- **Fixed timestep:** step the world at 60 Hz using an accumulator, decoupled from the render
  frame rate. Interpolate mesh transforms between the last two physics states for smooth
  rendering on high-refresh displays.
  ```ts
  const STEP = 1 / 60;
  accumulator += Math.min(frameDt, 0.25); // clamp to avoid the spiral of death
  while (accumulator >= STEP) { world.step(); accumulator -= STEP; }
  const alpha = accumulator / STEP;       // use for interpolation
  ```
- Use kinematic character controllers (`world.createCharacterController`) for the player, not a
  dynamic body pushed with forces. It's far easier to make feel right.
- Remove bodies/colliders via `world.removeRigidBody` when objects are destroyed; Rapier
  handles do not garbage-collect themselves.

## Code style

- TypeScript `strict`; no `any` without a `// reason:` comment. Prefer `unknown` + narrowing
  for data from the network (GameSpec, SSE events) and validate it before use.
- Named exports only; one main concept per file; files under ~300 lines.
- Comment the **why**, not the what.
- Before saying a task is done, run `npm run build` (type-check + bundle) and confirm it passes.
  Don't hand back code that doesn't compile.

## Commits and PRs

- Small, focused commits: `<type>(<area>): <summary>`, e.g. `feat(engine): add billboard sprite`.
- Open a PR into `main` early (draft is fine) so teammates can see what files you're touching.
- Before opening or updating a PR: `git fetch origin && git rebase origin/main`, then
  `npm run build`.
- PR description lists every **pre-existing** file the branch modifies. This is the team's
  conflict early-warning system.

## When unsure

Ask the developer. A 10-second question is cheaper than a merge conflict at 3 a.m.
