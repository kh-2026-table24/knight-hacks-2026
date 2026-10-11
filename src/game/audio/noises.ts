// The house's random distant noises, recorded with ElevenLabs (scripts/gen-noises.ts) into
// public/audio/noises/<name>.mp3. One plays every so often, from somewhere off to one side: indoor
// ones inside buildings, outdoor ones under the open sky.
export const NOISES = {
  whisper: { seconds: 3.5, outdoor: false },
  knock: { seconds: 3, outdoor: false },
  scratching: { seconds: 3.5, outdoor: false },
  "music-box": { seconds: 4, outdoor: false },
  "footsteps-above": { seconds: 4, outdoor: false },
  "child-laugh": { seconds: 3, outdoor: false },
  chains: { seconds: 3.5, outdoor: false },
  moan: { seconds: 4, outdoor: false },
  crow: { seconds: 3, outdoor: true },
  owl: { seconds: 3.5, outdoor: true },
  howl: { seconds: 4.5, outdoor: true },
  bell: { seconds: 5, outdoor: true },
} as const;

export type NoiseName = keyof typeof NOISES;

export const noiseUrl = (name: NoiseName) => `/audio/noises/${name}.mp3`;
