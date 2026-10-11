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

/** Rain: a steady hiss of drops over a low rumble, swelling and easing. */
export function rain(ctx: AudioContext, out: AudioNode): Stop {
  return loop(ctx, out, (bus) => {
    const hiss = noise(ctx);
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 2500;
    band.Q.value = 0.4;
    const hissGain = ctx.createGain();
    hissGain.gain.value = 0.18;
    hiss.connect(band).connect(hissGain).connect(bus);

    const rumble = noise(ctx);
    const low = ctx.createBiquadFilter();
    low.type = "lowpass";
    low.frequency.value = 250;
    const rumbleGain = ctx.createGain();
    rumbleGain.gain.value = 0.3;
    rumble.connect(low).connect(rumbleGain).connect(bus);

    hiss.start();
    // Offset so the two copies of the noise loop don't line up.
    rumble.start(ctx.currentTime, 1);
    return [hiss, rumble, lfo(ctx, hissGain.gain, 0.04, 0.06)];
  });
}

/** Water dripping somewhere in the dark, over the room's low hum. */
export function drip(ctx: AudioContext, out: AudioNode): Stop {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stopTone = roomTone(ctx, out);
  const stopDrips = loop(ctx, out, (bus) => {
    const echo = ctx.createDelay();
    echo.delayTime.value = 0.23;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.3;
    echo.connect(feedback).connect(echo);
    echo.connect(bus);

    const plink = () => {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const pitch = 900 + Math.random() * 900;
      osc.frequency.setValueAtTime(pitch, now);
      osc.frequency.exponentialRampToValueAtTime(pitch * 2.2, now + 0.05);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, now);
      env.gain.exponentialRampToValueAtTime(0.08, now + 0.005);
      env.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
      osc.connect(env);
      env.connect(bus);
      env.connect(echo);
      osc.start(now);
      osc.stop(now + 0.15);
      timer = setTimeout(plink, 700 + Math.random() * 2800);
    };
    timer = setTimeout(plink, 500);
    return [];
  });
  return () => {
    clearTimeout(timer);
    stopTone();
    stopDrips();
  };
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

/** Repeats `fire` after a random gap of `min` to `max` seconds until stopped. */
function every(min: number, max: number, fire: () => void) {
  let timer: ReturnType<typeof setTimeout>;
  const next = () => {
    timer = setTimeout(() => {
      fire();
      next();
    }, (min + Math.random() * (max - min)) * 1000);
  };
  next();
  return () => clearTimeout(timer);
}

/** A short burst of filtered noise: the building block of crackles and thunder. */
function burst(ctx: AudioContext, out: AudioNode, { type, frequency, q = 1, volume, attack, decay, pan = 0 }: {
  type: BiquadFilterType;
  frequency: number;
  q?: number;
  volume: number;
  attack: number;
  decay: number;
  pan?: number;
}) {
  const now = ctx.currentTime;
  const src = noise(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = frequency;
  filter.Q.value = q;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, now);
  env.gain.exponentialRampToValueAtTime(volume, now + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, now + attack + decay);
  const panner = ctx.createStereoPanner();
  panner.pan.value = pan;
  src.connect(filter).connect(env).connect(panner).connect(out);
  src.start(now, Math.random() * 1.5);
  src.stop(now + attack + decay + 0.05);
}

/** The sea: slow waves rolling in and drawing back over rocks, with the hiss of foam on each one. */
export function sea(ctx: AudioContext, out: AudioNode): Stop {
  return loop(ctx, out, (bus) => {
    const body = noise(ctx);
    const low = ctx.createBiquadFilter();
    low.type = "lowpass";
    low.frequency.value = 500;
    const swell = ctx.createGain();
    swell.gain.value = 0.22;
    body.connect(low).connect(swell).connect(bus);

    const foam = noise(ctx);
    const high = ctx.createBiquadFilter();
    high.type = "highpass";
    high.frequency.value = 2200;
    const foamGain = ctx.createGain();
    foamGain.gain.value = 0.04;
    foam.connect(high).connect(foamGain).connect(bus);

    body.start();
    foam.start(ctx.currentTime, 0.7);
    // One wave every eight seconds or so; the foam peaks a little after the swell, as it breaks.
    return [body, foam, lfo(ctx, swell.gain, 0.12, 0.18), lfo(ctx, low.frequency, 0.12, 300), lfo(ctx, foamGain.gain, 0.12, 0.035)];
  }, 3);
}

/** A storm: heavy rain, and thunder rolling in every half minute or so, near or far. */
export function storm(ctx: AudioContext, out: AudioNode): Stop {
  const stopRain = rain(ctx, out);
  const stopThunder = every(12, 35, () => {
    const near = Math.random() < 0.35;
    // A crack for a near strike, then the long roll.
    if (near) burst(ctx, out, { type: "bandpass", frequency: 1800, q: 0.5, volume: 0.35, attack: 0.01, decay: 0.4, pan: Math.random() - 0.5 });
    burst(ctx, out, { type: "lowpass", frequency: near ? 220 : 120, volume: near ? 0.9 : 0.5, attack: near ? 0.05 : 0.6, decay: 3 + Math.random() * 3, pan: Math.random() * 1.2 - 0.6 });
  });
  return () => {
    stopThunder();
    stopRain();
  };
}

/** A fire: a soft roar, and pops and crackles of wood from all around it. */
export function fire(ctx: AudioContext, out: AudioNode): Stop {
  let stopCrackles: Stop = () => {};
  const stopRoar = loop(ctx, out, (bus) => {
    const roar = noise(ctx);
    const low = ctx.createBiquadFilter();
    low.type = "lowpass";
    low.frequency.value = 350;
    const roarGain = ctx.createGain();
    roarGain.gain.value = 0.18;
    roar.connect(low).connect(roarGain).connect(bus);
    roar.start();
    stopCrackles = every(0.04, 0.5, () => {
      const pop = Math.random() < 0.08;
      burst(ctx, bus, {
        type: "bandpass",
        frequency: pop ? 900 : 2500 + Math.random() * 3500,
        q: 2,
        volume: pop ? 0.4 : 0.05 + Math.random() * 0.15,
        attack: 0.002,
        decay: pop ? 0.12 : 0.02 + Math.random() * 0.03,
        pan: Math.random() * 0.8 - 0.4,
      });
    });
    return [roar, lfo(ctx, roarGain.gain, 0.3, 0.05)];
  });
  return () => {
    stopCrackles();
    stopRoar();
  };
}

/** Old wiring: the mains hum and the high buzz of fluorescent tubes, which now and then stutter. */
export function hum(ctx: AudioContext, out: AudioNode): Stop {
  let stopFlicker: Stop = () => {};
  const stopHum = loop(ctx, out, (bus) => {
    const level = ctx.createGain();
    level.gain.value = 1;
    level.connect(bus);
    const sources: AudioScheduledSourceNode[] = [];
    for (const [frequency, volume] of [
      [60, 0.05],
      [120, 0.035],
      [180, 0.015],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.frequency.value = frequency;
      const g = ctx.createGain();
      g.gain.value = volume;
      osc.connect(g).connect(level);
      osc.start();
      sources.push(osc);
    }
    // The tubes: a buzzy sawtooth at twice the mains, heard only high up.
    const buzz = ctx.createOscillator();
    buzz.type = "sawtooth";
    buzz.frequency.value = 120;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 3200;
    band.Q.value = 3;
    const buzzGain = ctx.createGain();
    buzzGain.gain.value = 0.02;
    buzz.connect(band).connect(buzzGain).connect(level);
    buzz.start();
    sources.push(buzz);
    // A tube struggling: the buzz cuts out and comes back a few times.
    stopFlicker = every(6, 20, () => {
      const now = ctx.currentTime;
      for (let i = 0; i < 2 + Math.floor(Math.random() * 4); i++) {
        const at = now + i * (0.06 + Math.random() * 0.1);
        buzzGain.gain.setValueAtTime(0.002, at);
        buzzGain.gain.setValueAtTime(0.03, at + 0.04);
      }
      buzzGain.gain.setValueAtTime(0.02, now + 1);
    });
    return sources;
  });
  return () => {
    stopFlicker();
    stopHum();
  };
}

/** A still night: crickets chirping from the dark on both sides, over a faint breeze. */
export function night(ctx: AudioContext, out: AudioNode): Stop {
  const stops: Stop[] = [];
  const stopBreeze = loop(ctx, out, (bus) => {
    const air = noise(ctx);
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 600;
    band.Q.value = 0.5;
    const airGain = ctx.createGain();
    airGain.gain.value = 0.05;
    air.connect(band).connect(airGain).connect(bus);
    air.start();

    // Each cricket has its own pitch, place and rhythm: a chirp of a few pulses, then a pause.
    for (let c = 0; c < 4; c++) {
      const pitch = 3800 + Math.random() * 1400;
      const pan = Math.random() * 1.6 - 0.8;
      const volume = 0.012 + Math.random() * 0.018;
      stops.push(
        every(0.6, 1.4, () => {
          const now = ctx.currentTime;
          const osc = ctx.createOscillator();
          osc.frequency.value = pitch;
          const env = ctx.createGain();
          env.gain.value = 0;
          const pulses = 3 + Math.floor(Math.random() * 3);
          for (let i = 0; i < pulses; i++) {
            const at = now + i * 0.045;
            env.gain.setValueAtTime(0, at);
            env.gain.linearRampToValueAtTime(volume, at + 0.008);
            env.gain.linearRampToValueAtTime(0, at + 0.03);
          }
          const panner = ctx.createStereoPanner();
          panner.pan.value = pan;
          osc.connect(env).connect(panner).connect(bus);
          osc.start(now);
          osc.stop(now + pulses * 0.045 + 0.05);
        }),
      );
    }
    return [air, lfo(ctx, airGain.gain, 0.06, 0.03)];
  }, 3);
  return () => {
    for (const stop of stops) stop();
    stopBreeze();
  };
}
