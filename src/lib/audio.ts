// Tiny Web Audio synth + scheduler. Enough to audition arrangements.
//
// Each voice on the project picks an `instrument`. The synthesis here is all
// hand-rolled with Web Audio building blocks — oscillators, gain nodes, a
// biquad filter, and a touch of FM for the bell.

let ctx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!ctx) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new Ctor();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// ---------- Instruments ----------

export type InstrumentId =
  | "triangle"
  | "sine"
  | "saw"
  | "square"
  | "pluck"
  | "bass"
  | "pad"
  | "bell";

export const INSTRUMENT_NAMES: Record<InstrumentId, string> = {
  triangle: "Triangle",
  sine:     "Sine",
  saw:      "Saw",
  square:   "Square",
  pluck:    "Pluck",
  bass:     "Bass",
  pad:      "Pad",
  bell:     "Bell",
};

export const INSTRUMENT_LIST: InstrumentId[] = [
  "triangle", "sine", "saw", "square", "pluck", "bass", "pad", "bell",
];

export const DEFAULT_INSTRUMENT: InstrumentId = "triangle";

interface VoiceHandle { stop: () => void }

// Generic AD(S)R oscillator voice with linear ramps.
function envOsc(
  c: AudioContext,
  type: OscillatorType,
  freq: number,
  t0: number,
  dur: number,
  peak: number,
  attack: number,
  sustain: number,
  release: number,
): VoiceHandle {
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const a = Math.max(0.002, attack);
  const r = Math.max(0.02, release);
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(peak, t0 + a);
  gain.gain.linearRampToValueAtTime(peak * sustain, t0 + Math.min(0.08, dur * 0.4));
  gain.gain.setValueAtTime(peak * sustain, t0 + dur);
  gain.gain.linearRampToValueAtTime(0, t0 + dur + r);
  osc.connect(gain).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + r + 0.05);
  return { stop: () => { try { osc.stop(); } catch { /* already stopped */ } } };
}

// Plucked string-like: short attack, exponential decay, no sustain.
function pluckVoice(c: AudioContext, freq: number, t0: number, dur: number, peak: number): VoiceHandle {
  const osc = c.createOscillator();
  const gain = c.createGain();
  const filter = c.createBiquadFilter();
  osc.type = "triangle";
  osc.frequency.value = freq;
  filter.type = "lowpass";
  filter.frequency.value = freq * 6;
  // Decay is independent of `dur` so a short note still rings naturally.
  const decay = Math.max(0.6, dur * 1.5);
  gain.gain.setValueAtTime(peak, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + decay);
  osc.connect(filter).connect(gain).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + decay + 0.05);
  return { stop: () => { try { osc.stop(); } catch { /* already stopped */ } } };
}

// Bass: square one octave down, low-pass filtered for fatness.
function bassVoice(c: AudioContext, freq: number, t0: number, dur: number, peak: number): VoiceHandle {
  const osc = c.createOscillator();
  const gain = c.createGain();
  const filter = c.createBiquadFilter();
  osc.type = "square";
  osc.frequency.value = freq * 0.5; // octave down
  filter.type = "lowpass";
  filter.frequency.value = 700;
  filter.Q.value = 1.5;
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(peak, t0 + 0.005);
  gain.gain.linearRampToValueAtTime(peak * 0.85, t0 + Math.min(0.06, dur * 0.4));
  gain.gain.setValueAtTime(peak * 0.85, t0 + dur);
  gain.gain.linearRampToValueAtTime(0, t0 + dur + 0.08);
  osc.connect(filter).connect(gain).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.12);
  return { stop: () => { try { osc.stop(); } catch { /* already stopped */ } } };
}

// Pad: detuned-saw cluster, slow attack/release, low-pass for warmth.
function padVoice(c: AudioContext, freq: number, t0: number, dur: number, peak: number): VoiceHandle {
  const detunes = [-12, -4, 4, 12]; // cents
  const oscs = detunes.map((cents) => {
    const o = c.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = freq;
    o.detune.value = cents;
    return o;
  });
  const gain = c.createGain();
  const filter = c.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = freq * 4;
  filter.Q.value = 0.7;
  // Attack capped at 0.3s but never longer than half the note, so very short
  // notes still produce sound.
  const attack = Math.min(0.3, Math.max(0.05, dur * 0.5));
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(peak, t0 + attack);
  gain.gain.setValueAtTime(peak, t0 + dur);
  gain.gain.linearRampToValueAtTime(0, t0 + dur + 0.5);
  for (const o of oscs) {
    o.connect(filter);
    o.start(t0);
    o.stop(t0 + dur + 0.6);
  }
  filter.connect(gain).connect(c.destination);
  return { stop: () => { for (const o of oscs) try { o.stop(); } catch { /* already stopped */ } } };
}

// Bell: simple FM voice — sine carrier with sine modulator at 3:1 ratio.
function bellVoice(c: AudioContext, freq: number, t0: number, dur: number, peak: number): VoiceHandle {
  const carrier = c.createOscillator();
  const modulator = c.createOscillator();
  const modGain = c.createGain();
  const gain = c.createGain();
  carrier.type = "sine";
  carrier.frequency.value = freq;
  modulator.type = "sine";
  modulator.frequency.value = freq * 3;
  modGain.gain.value = freq * 5;
  modulator.connect(modGain).connect(carrier.frequency);
  const decay = Math.max(1.0, dur * 1.5);
  gain.gain.setValueAtTime(peak, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + decay);
  carrier.connect(gain).connect(c.destination);
  carrier.start(t0);
  modulator.start(t0);
  carrier.stop(t0 + decay + 0.05);
  modulator.stop(t0 + decay + 0.05);
  return {
    stop: () => {
      try { carrier.stop(); } catch { /* already stopped */ }
      try { modulator.stop(); } catch { /* already stopped */ }
    },
  };
}

// Dispatch table — each instrument decides its own envelope shape and
// per-instrument gain so loudness stays in the same ballpark.
function trigger(
  c: AudioContext,
  instrument: InstrumentId,
  midi: number,
  t0: number,
  dur: number,
  vel: number,
): VoiceHandle {
  const freq = midiToFreq(midi);
  const v = vel; // 0-1
  switch (instrument) {
    case "triangle": return envOsc(c, "triangle", freq, t0, dur, v * 0.18, 0.005, 0.7, 0.08);
    case "sine":     return envOsc(c, "sine",     freq, t0, dur, v * 0.28, 0.015, 0.85, 0.1);
    case "saw":      return envOsc(c, "sawtooth", freq, t0, dur, v * 0.12, 0.005, 0.7, 0.06);
    case "square":   return envOsc(c, "square",   freq, t0, dur, v * 0.10, 0.005, 0.7, 0.06);
    case "pluck":    return pluckVoice(c, freq, t0, dur, v * 0.30);
    case "bass":     return bassVoice (c, freq, t0, dur, v * 0.30);
    case "pad":      return padVoice  (c, freq, t0, dur, v * 0.10);
    case "bell":     return bellVoice (c, freq, t0, dur, v * 0.25);
  }
}

// ---------- Public API ----------

export interface PlayOptions {
  velocity?: number;          // 0-1
  instrument?: InstrumentId;  // defaults to "triangle"
}

// Trigger a single note; returns a cancel function.
export function playNote(midi: number, durationSec: number, opts: PlayOptions = {}): () => void {
  const c = getCtx();
  const handle = trigger(
    c,
    opts.instrument ?? DEFAULT_INSTRUMENT,
    midi,
    c.currentTime + 0.005,
    durationSec,
    opts.velocity ?? 0.8,
  );
  return handle.stop;
}

export interface ScheduledNote {
  midi: number;
  startBeat: number;
  lengthBeat: number;
  velocity?: number;
  instrument?: InstrumentId;
}

// Schedule a list of (midi, startBeat, lengthBeat) events at a given BPM,
// starting at `c.currentTime + offset`. Returns a cancel function that stops
// every scheduled voice.
export function scheduleNotes(
  events: ScheduledNote[],
  bpm: number,
  startOffsetSec = 0.05,
  onTick?: (currentBeat: number) => void,
  onEnd?: () => void,
): () => void {
  const c = getCtx();
  const start = c.currentTime + startOffsetSec;
  const beatSec = 60 / bpm;
  const handles: VoiceHandle[] = [];
  let endTime = 0;
  for (const ev of events) {
    const t0 = start + ev.startBeat * beatSec;
    const dur = ev.lengthBeat * beatSec;
    const handle = trigger(
      c,
      ev.instrument ?? DEFAULT_INSTRUMENT,
      ev.midi,
      t0,
      dur,
      ev.velocity ?? 0.8,
    );
    handles.push(handle);
    endTime = Math.max(endTime, t0 + dur);
  }

  // Tick loop for the playhead.
  let raf = 0;
  let stopped = false;
  const tick = () => {
    if (stopped) return;
    const t = c.currentTime;
    if (t >= endTime + 0.05) {
      onEnd?.();
      return;
    }
    if (onTick) {
      const b = Math.max(0, (t - start) / beatSec);
      onTick(b);
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
    for (const h of handles) h.stop();
  };
}
