import type { Ambience, Footsteps } from "../../shared/spec";
import { SOUND_VARIATIONS, soundUrls, type SoundName } from "./sounds";
import { bats, drip, eerieMusic, heartbeat, rain, roomTone, staticBurst, wind } from "./synth";

const AMBIENCE_LOOPS: Record<Ambience, typeof wind> = { wind, rain, room: roomTone, drip };

export interface PlayOptions {
  /** 0 to 1. */
  volume?: number;
  /** Random pitch change either side, as a fraction (0.06 = ±6%), so repeats sound different. */
  pitchJitter?: number;
}

// Seconds between the house's own noises (a creak, static, bats overhead) while house noises are on.
const HOUSE_NOISE_GAP: [number, number] = [8, 22];

/**
 * All of the game's sound. Browsers only allow audio after the player clicks or presses a key, so
 * nothing is heard until then; anything played before that is silently skipped.
 *
 *   const audio = new GameAudio();
 *   await audio.load();
 *   audio.setAmbience("wind");
 *   audio.startMusic();
 *   audio.footstep("grass");
 *   audio.play("door-open");
 */
export class GameAudio {
  readonly context = new AudioContext();
  /** Volume buses: everything goes through master; the other three can be set separately. */
  readonly master = this.context.createGain();
  readonly sfx = this.context.createGain();
  readonly ambience = this.context.createGain();
  readonly music = this.context.createGain();

  private readonly buffers = new Map<SoundName, AudioBuffer[]>();
  private stopAmbience?: () => void;
  private currentAmbience?: Ambience;
  private stopMusicLoop?: () => void;
  private houseNoiseTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    this.master.connect(this.context.destination);
    for (const [bus, volume] of [
      [this.sfx, 0.8],
      [this.ambience, 0.6],
      [this.music, 0.5],
    ] as const) {
      bus.gain.value = volume;
      bus.connect(this.master);
    }
    // Keeps trying on every click and key press until the browser lets audio start, since one
    // attempt can be refused (e.g. a press that arrives while the page is still loading).
    const unlock = () => void this.context.resume();
    const events = ["pointerdown", "keydown", "touchend"] as const;
    for (const event of events) window.addEventListener(event, unlock);
    this.context.addEventListener("statechange", () => {
      if (this.context.state === "running") for (const event of events) window.removeEventListener(event, unlock);
    });
  }

  /** Downloads and decodes every recorded sound. Ones that fail to load are skipped with a warning. */
  async load() {
    const names = Object.keys(SOUND_VARIATIONS) as SoundName[];
    await Promise.all(
      names.map(async (name) => {
        const results = await Promise.allSettled(
          soundUrls(name).map(async (url) => this.context.decodeAudioData(await (await fetch(url)).arrayBuffer())),
        );
        const buffers = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
        if (buffers.length < results.length) console.warn(`[audio] ${results.length - buffers.length} of ${name}'s sounds failed to load`);
        this.buffers.set(name, buffers);
      }),
    );
  }

  private get running() {
    return this.context.state === "running";
  }

  /** Plays one of the sound's variations. */
  play(name: SoundName, { volume = 1, pitchJitter = 0.06 }: PlayOptions = {}) {
    const buffers = this.buffers.get(name);
    if (!this.running || !buffers?.length) return;
    const source = this.context.createBufferSource();
    source.buffer = buffers[Math.floor(Math.random() * buffers.length)];
    source.playbackRate.value = 1 + (Math.random() * 2 - 1) * pitchJitter;
    const gain = this.context.createGain();
    gain.gain.value = volume;
    source.connect(gain).connect(this.sfx);
    source.start();
  }

  footstep(floor: Footsteps) {
    this.play(`footstep-${floor}`, { volume: 0.5, pitchJitter: 0.1 });
  }

  bats() {
    if (this.running) bats(this.context, this.sfx);
  }

  static() {
    if (this.running) staticBurst(this.context, this.sfx);
  }

  /** One beat. Call it on a timer that speeds up as an enemy gets closer. */
  heartbeat(volume = 1) {
    if (this.running) heartbeat(this.context, this.sfx, volume);
  }

  /** The current room's background loop. Crossfades from the last one; null fades to silence. */
  setAmbience(kind: Ambience | null) {
    if (kind === (this.currentAmbience ?? null)) return;
    this.stopAmbience?.();
    this.currentAmbience = kind ?? undefined;
    this.stopAmbience = kind ? AMBIENCE_LOOPS[kind](this.context, this.ambience) : undefined;
  }

  startMusic() {
    this.stopMusicLoop ??= eerieMusic(this.context, this.music);
  }

  stopMusic() {
    this.stopMusicLoop?.();
    this.stopMusicLoop = undefined;
  }

  /** Every so often, a creak, a distant door, static, or (rarely) bats, so a quiet house never feels empty. */
  startHouseNoises() {
    if (this.houseNoiseTimer) return;
    const next = () => {
      const [min, max] = HOUSE_NOISE_GAP;
      this.houseNoiseTimer = setTimeout(() => {
        const roll = Math.random();
        if (roll < 0.5) this.play("creak", { volume: 0.35, pitchJitter: 0.2 });
        else if (roll < 0.7) this.play("door-close", { volume: 0.12, pitchJitter: 0.15 });
        else if (roll < 0.85) this.play("thud", { volume: 0.1, pitchJitter: 0.2 });
        else if (roll < 0.95) this.static();
        else this.bats();
        next();
      }, (min + Math.random() * (max - min)) * 1000);
    };
    next();
  }

  stopHouseNoises() {
    clearTimeout(this.houseNoiseTimer);
    this.houseNoiseTimer = undefined;
  }
}
