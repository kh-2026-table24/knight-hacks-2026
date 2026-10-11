import { SCREAMS, type Ambience, type Footsteps, type Scream } from "../../shared/spec";
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
const SFX_VOLUME = 0.8;
const AMBIENCE_VOLUME = 0.6;
const MUSIC_VOLUME = 0.5;
// Jumpscare screams (scripts/gen-screams.ts makes them), each laid over the same sting.
const screamUrl = (name: Scream | "sting") => `/audio/screams/${name}.mp3`;
// While a scream plays, the music and the room's background drop to this, so it hits out of near silence.
const SCARE_DUCK = 0.15;

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
  private readonly screams = new Map<Scream | "sting", AudioBuffer>();
  private stopAmbience?: () => void;
  private currentAmbience?: Ambience;
  private stopMusicLoop?: () => void;
  private houseNoiseTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    this.master.connect(this.context.destination);
    for (const [bus, volume] of [
      [this.sfx, SFX_VOLUME],
      [this.ambience, AMBIENCE_VOLUME],
      [this.music, MUSIC_VOLUME],
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
    const screams = [...SCREAMS, "sting"] as const;
    await Promise.all([
      ...screams.map(async (name) => {
        try {
          this.screams.set(name, await this.context.decodeAudioData(await (await fetch(screamUrl(name))).arrayBuffer()));
        } catch {
          console.warn(`[audio] the ${name} scream failed to load`);
        }
      }),
      ...names.map(async (name) => {
        const results = await Promise.allSettled(
          soundUrls(name).map(async (url) => this.context.decodeAudioData(await (await fetch(url)).arrayBuffer())),
        );
        const buffers = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
        if (buffers.length < results.length) console.warn(`[audio] ${results.length - buffers.length} of ${name}'s sounds failed to load`);
        this.buffers.set(name, buffers);
      }),
    ]);
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

  /** A jumpscare: the sting and the voice's scream at once, with the music and background ducked under them. */
  scream(voice: Scream) {
    if (!this.running) return;
    const now = this.context.currentTime;
    let longest = 0;
    for (const [buffer, volume] of [
      [this.screams.get("sting"), 0.45],
      [this.screams.get(voice), 0.85],
    ] as const) {
      if (!buffer) continue;
      const source = this.context.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = 1 + (Math.random() * 2 - 1) * 0.05;
      const gain = this.context.createGain();
      gain.gain.value = volume;
      source.connect(gain).connect(this.sfx);
      source.start(now);
      longest = Math.max(longest, buffer.duration);
    }
    if (!longest) return this.static();
    for (const [bus, level] of [
      [this.music, MUSIC_VOLUME],
      [this.ambience, AMBIENCE_VOLUME],
    ] as const) {
      bus.gain.cancelScheduledValues(now);
      bus.gain.setValueAtTime(bus.gain.value, now);
      bus.gain.linearRampToValueAtTime(level * SCARE_DUCK, now + 0.05);
      bus.gain.setValueAtTime(level * SCARE_DUCK, now + longest * 0.8);
      bus.gain.linearRampToValueAtTime(level, now + longest + 2);
    }
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

  /** Loops a recorded track (e.g. the menu theme) on the music bus, fading in. Returns a stop that fades it out. */
  async playTrack(url: string, fade = 2): Promise<() => void> {
    const buffer = await this.context.decodeAudioData(await (await fetch(url)).arrayBuffer());
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = this.context.createGain();
    const now = this.context.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(1, now + fade);
    source.connect(gain).connect(this.music);
    source.start();
    return () => {
      const at = this.context.currentTime;
      gain.gain.cancelScheduledValues(at);
      gain.gain.setValueAtTime(gain.gain.value, at);
      gain.gain.linearRampToValueAtTime(0, at + fade);
      source.stop(at + fade);
    };
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
