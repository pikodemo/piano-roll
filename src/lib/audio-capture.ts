// Microphone capture + on-the-fly pitch detection.
//
// We sample the mic into an AnalyserNode and run a pitch detector on each
// frame, then quantize the result to the nearest semitone and stream pitch
// samples to the caller. On stop, the helper post-processes the sample stream
// into a list of notes (start/length/pitch).
//
// Pitch detection uses the `pitchfinder` library. We're on YIN today (clean,
// monophonic f0). The detector is factored out so we can swap in another
// monophonic algorithm (Macleod, AMDF, ACF2+, DynamicWavelet) or a future
// polyphonic detector for guitar without touching the capture loop.

import { YIN } from "pitchfinder";

export interface PitchSample {
  /** Detected MIDI note, or null for silence/unvoiced. */
  midi: number | null;
  /** Seconds since recording started. */
  time: number;
}

export interface DetectedNote {
  midi: number;
  /** Start time in seconds since recording began. */
  startSec: number;
  /** Length in seconds. */
  lengthSec: number;
}

export interface RecordHandle {
  stop: () => Promise<{ notes: DetectedNote[]; samples: PitchSample[] }>;
  // Live current pitch (last detected MIDI note, or null). For UI display.
  currentMidi: () => number | null;
}

const FFT_SIZE = 2048;
const MIN_RMS = 0.01;
const MIN_NOTE_FRAMES = 4; // ~70ms at 60Hz analysis rate
const PITCH_SETTLE_FRAMES = 2; // require N consecutive same-pitches to commit a change

export async function startRecording(): Promise<RecordHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      // Mic processing on most browsers is tuned for speech; if available,
      // turn it off so we get raw audio that the pitch detector can chew on.
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });
  const win = window as unknown as { AudioContext: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const Ctor = win.AudioContext || win.webkitAudioContext!;
  const ctx = new Ctor();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = FFT_SIZE;
  source.connect(analyser);

  // YIN: probabilityThreshold gates out unvoiced frames internally. We still
  // do our own RMS gate below so very quiet frames don't even run the detector.
  const detectPitch = YIN({
    sampleRate: ctx.sampleRate,
    probabilityThreshold: 0.2,
  });

  const buf = new Float32Array(analyser.fftSize);
  const samples: PitchSample[] = [];
  const t0 = ctx.currentTime;
  let lastDetected: number | null = null;
  let raf = 0;
  let stopped = false;

  const tick = () => {
    if (stopped) return;
    analyser.getFloatTimeDomainData(buf);
    const midi = detectMidi(buf, detectPitch);
    lastDetected = midi;
    samples.push({ midi, time: ctx.currentTime - t0 });
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  return {
    currentMidi: () => lastDetected,
    stop: async () => {
      stopped = true;
      cancelAnimationFrame(raf);
      try {
        for (const t of stream.getTracks()) t.stop();
        await ctx.close();
      } catch { /* already closed */ }
      const notes = postProcess(samples);
      return { notes, samples };
    },
  };
}

// ---------- Detection ----------

type Detector = (buf: Float32Array) => number | null;

function detectMidi(buf: Float32Array, detect: Detector): number | null {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  const rms = Math.sqrt(sum / buf.length);
  if (rms < MIN_RMS) return null;

  const freq = detect(buf);
  if (freq == null || freq <= 0) return null;
  return Math.round(12 * Math.log2(freq / 440) + 69);
}

// ---------- Sample → notes ----------

// Group consecutive same-pitch samples into notes. Filters out blips
// (anything shorter than MIN_NOTE_FRAMES) and requires a few consecutive
// frames at a new pitch before committing the change (prevents single-frame
// jumps from segmenting the note).
function postProcess(samples: PitchSample[]): DetectedNote[] {
  if (samples.length === 0) return [];
  const notes: DetectedNote[] = [];
  let runMidi: number | null = null;
  let runStart = 0;
  let pending: number | null = null;
  let pendingCount = 0;

  function flushRun(endTime: number) {
    if (runMidi == null) return;
    const len = endTime - runStart;
    notes.push({ midi: runMidi, startSec: runStart, lengthSec: len });
  }

  // Determine analysis frame rate from the median sample interval, so we can
  // express MIN_NOTE_FRAMES as seconds.
  const intervals: number[] = [];
  for (let i = 1; i < samples.length; i++) intervals.push(samples[i].time - samples[i - 1].time);
  intervals.sort((a, b) => a - b);
  const medianDt = intervals[Math.floor(intervals.length / 2)] || 0.016;
  const minSec = medianDt * MIN_NOTE_FRAMES;

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const m = s.midi;
    if (m === runMidi) {
      pending = null;
      pendingCount = 0;
      continue;
    }
    if (m === pending) {
      pendingCount++;
      if (pendingCount >= PITCH_SETTLE_FRAMES) {
        flushRun(s.time);
        runMidi = m;
        runStart = s.time;
        pending = null;
        pendingCount = 0;
      }
    } else {
      pending = m;
      pendingCount = 1;
    }
  }
  // Flush the final run at the last sample time.
  flushRun(samples[samples.length - 1].time);

  // Drop silence and very short runs.
  return notes.filter((n) => n.midi != null && n.lengthSec >= minSec);
}
