// Sounds made in code with Web Audio rather than recorded: the endless loops (wind, room tone, music),
// which never repeat, and a few horror sounds there are no free recordings of in the packs we use.
// Each returns a function that stops it; one-shots stop on their own.

type Stop = () => void;

let noiseBuffer: AudioBuffer | undefined;
/** Two seconds of white noise, looped wherever noise is needed. */
function noise(ctx: AudioContext) {
  if (!noiseBuffer || noiseBuffer.sampleRate !== ctx.sampleRate) {
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer;
  source.loop = true;
  return source;
}

/** A slow sine wobble added to `param`: `depth` either side, once every 1/`rate` seconds. */
function lfo(ctx: AudioContext, param: AudioParam, rate: number, depth: number) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = rate;
  gain.gain.value = depth;
  osc.connect(gain).connect(param);
  osc.start();
  return osc;
}

/** Fades a loop in, and returns a stop that fades it out before stopping its sources. */
function loop(ctx: AudioContext, out: AudioNode, build: (bus: GainNode) => AudioScheduledSourceNode[], fade = 2): Stop {
  const bus = ctx.createGain();
  bus.gain.setValueAtTime(0, ctx.currentTime);
  bus.gain.linearRampToValueAtTime(1, ctx.currentTime + fade);
  bus.connect(out);
  const sources = build(bus);
  return () => {
    const now = ctx.currentTime;
    bus.gain.cancelScheduledValues(now);
    bus.gain.setValueAtTime(bus.gain.value, now);
    bus.gain.linearRampToValueAtTime(0, now + fade);
    for (const s of sources) s.stop(now + fade);
  };
}

/** Outdoors: gusting wind. */
export function wind(ctx: AudioContext, out: AudioNode): Stop {
  return loop(ctx, out, (bus) => {
    const src = noise(ctx);
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 450;
    band.Q.value = 0.7;
    const gust = ctx.createGain();
    gust.gain.value = 0.25;
    src.connect(band).connect(gust).connect(bus);
    src.start();
    return [src, lfo(ctx, band.frequency, 0.07, 250), lfo(ctx, gust.gain, 0.11, 0.15)];
  });
}

/** Indoors: the low rumble and hum of a quiet old building. */
export function roomTone(ctx: AudioContext, out: AudioNode): Stop {
  return loop(ctx, out, (bus) => {
    const src = noise(ctx);
    const low = ctx.createBiquadFilter();
    low.type = "lowpass";
    low.frequency.value = 160;
    const rumble = ctx.createGain();
    rumble.gain.value = 0.35;
    src.connect(low).connect(rumble).connect(bus);
    src.start();

    const hum = ctx.createOscillator();
    hum.frequency.value = 50;
    const humGain = ctx.createGain();
    humGain.gain.value = 0.015;
    hum.connect(humGain).connect(bus);
    hum.start();
    return [src, hum, lfo(ctx, rumble.gain, 0.05, 0.12)];
  });
}

// A minor and its flattened second: the notes the music's high bell tones are picked from.
const BELL_NOTES = [440, 466.16, 523.25, 587.33, 659.25, 698.46, 880];

/** Eerie music: a dark, slowly shifting drone with a faint bell note now and then. */
export function eerieMusic(ctx: AudioContext, out: AudioNode): Stop {
  let bellTimer: ReturnType<typeof setTimeout> | undefined;
  const stop = loop(
    ctx,
    out,
    (bus) => {
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 380;
      filter.Q.value = 4;
      const drone = ctx.createGain();
      drone.gain.value = 0.05;
      filter.connect(drone).connect(bus);
      // A low A, a tritone above it and an octave slightly out of tune with it: unresolved and uneasy.
      const oscs = [55, 77.78, 110.6].map((frequency, i) => {
        const osc = ctx.createOscillator();
        osc.type = i === 1 ? "triangle" : "sawtooth";
        osc.frequency.value = frequency;
        osc.connect(filter);
        osc.start();
        return osc;
      });

      const bell = () => {
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        osc.frequency.value = BELL_NOTES[Math.floor(Math.random() * BELL_NOTES.length)];
        const env = ctx.createGain();
        env.gain.setValueAtTime(0, now);
        env.gain.linearRampToValueAtTime(0.035, now + 1.5);
        env.gain.exponentialRampToValueAtTime(0.0001, now + 7);
        osc.connect(env).connect(bus);
        osc.start(now);
        osc.stop(now + 7);
        bellTimer = setTimeout(bell, 5000 + Math.random() * 7000);
      };
      bellTimer = setTimeout(bell, 3000);

      return [...oscs, lfo(ctx, filter.frequency, 0.03, 220), lfo(ctx, oscs[1].detune, 0.02, 25)];
    },
    4,
  );
  return () => {
    clearTimeout(bellTimer);
    stop();
  };
}

/** A short crackle of radio static. */
export function staticBurst(ctx: AudioContext, out: AudioNode, seconds = 0.6) {
  const now = ctx.currentTime;
  const src = noise(ctx);
  const high = ctx.createBiquadFilter();
  high.type = "highpass";
  high.frequency.value = 1800;
  const env = ctx.createGain();
  // Jagged on/off volume so it crackles instead of hissing.
  env.gain.setValueAtTime(0, now);
  for (let t = 0; t < seconds; t += 0.03) env.gain.setValueAtTime(Math.random() < 0.6 ? 0.08 + Math.random() * 0.12 : 0, now + t);
  env.gain.setValueAtTime(0, now + seconds);
  src.connect(high).connect(env).connect(out);
  src.start(now);
  src.stop(now + seconds);
}

/** Bats taking off: fluttering wings and a few high squeaks. */
export function bats(ctx: AudioContext, out: AudioNode, seconds = 1.6) {
  const now = ctx.currentTime;
  const src = noise(ctx);
  const band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = 2200;
  band.Q.value = 1.5;
  // Wing beats: the noise pulses about 20 times a second, fading out as they fly off.
  // 0.5 ± 0.5, so each beat goes from silent to full.
  const wings = ctx.createGain();
  wings.gain.value = 0.5;
  const flap = ctx.createOscillator();
  flap.type = "square";
  flap.frequency.value = 19;
  const flapDepth = ctx.createGain();
  flapDepth.gain.value = 0.5;
  flap.connect(flapDepth).connect(wings.gain);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, now);
  env.gain.exponentialRampToValueAtTime(0.25, now + 0.1);
  env.gain.exponentialRampToValueAtTime(0.0001, now + seconds);
  src.connect(band).connect(wings).connect(env).connect(out);
  src.start(now);
  flap.start(now);
  src.stop(now + seconds);
  flap.stop(now + seconds);

  for (let i = 0; i < 4 + Math.floor(Math.random() * 4); i++) {
    const at = now + Math.random() * seconds * 0.8;
    const squeak = ctx.createOscillator();
    squeak.frequency.setValueAtTime(5500 + Math.random() * 2500, at);
    squeak.frequency.exponentialRampToValueAtTime(3000 + Math.random() * 800, at + 0.05);
    const squeakEnv = ctx.createGain();
    squeakEnv.gain.setValueAtTime(0.0001, at);
    squeakEnv.gain.exponentialRampToValueAtTime(0.04, at + 0.008);
    squeakEnv.gain.exponentialRampToValueAtTime(0.0001, at + 0.06);
    squeak.connect(squeakEnv).connect(out);
    squeak.start(at);
    squeak.stop(at + 0.07);
  }
}

/** One heartbeat (lub-dub). Repeat it faster as danger gets closer. */
export function heartbeat(ctx: AudioContext, out: AudioNode, volume = 1) {
  const now = ctx.currentTime;
  for (const [delay, level] of [
    [0, 0.6],
    [0.28, 0.4],
  ]) {
    const at = now + delay;
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(70, at);
    osc.frequency.exponentialRampToValueAtTime(35, at + 0.15);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(level * volume, at + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, at + 0.18);
    osc.connect(env).connect(out);
    osc.start(at);
    osc.stop(at + 0.2);
  }
}
