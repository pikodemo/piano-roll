// Microphone capture + on-the-fly pitch detection.
//
// We sample the mic into an AnalyserNode, run autocorrelation on each frame,
// quantize the result to the nearest semitone, and stream pitch samples to
// the caller. On stop, the helper post-processes the sample stream into a
// list of notes (start/length/pitch).
//
// The pitch detector is the textbook autocorrelation-with-parabolic-
// -interpolation used in the WebAudio examples. Good enough for sung melodies
// with mostly-stable pitch; not robust to noisy or polyphonic input.

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

  const buf = new Float32Array(analyser.fftSize);
  const samples: PitchSample[] = [];
  const t0 = ctx.currentTime;
  let lastDetected: number | null = null;
  let raf = 0;
  let stopped = false;

  const tick = () => {
    if (stopped) return;
    analyser.getFloatTimeDomainData(buf);
    const freq = autoCorrelate(buf, ctx.sampleRate);
    const midi = freq > 0 ? Math.round(12 * Math.log2(freq / 440) + 69) : null;
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

// ---------- Autocorrelation ----------

// Standard time-domain autocorrelation pitch detector. Returns a frequency in
// Hz, or -1 when the input is too quiet / unvoiced to score.
function autoCorrelate(buf: Float32Array, sampleRate: number): number {
  const SIZE = buf.length;

  let sum = 0;
  for (let i = 0; i < SIZE; i++) sum += buf[i] * buf[i];
  const rms = Math.sqrt(sum / SIZE);
  if (rms < MIN_RMS) return -1;

  // Trim quiet ends (everything below `threshold`).
  const threshold = 0.2;
  let r1 = 0, r2 = SIZE - 1;
  for (let i = 0; i < SIZE / 2; i++) {
    if (Math.abs(buf[i]) < threshold) { r1 = i; break; }
  }
  for (let i = 1; i < SIZE / 2; i++) {
    if (Math.abs(buf[SIZE - i]) < threshold) { r2 = SIZE - i; break; }
  }
  const trimmed = buf.subarray(r1, r2);
  const N = trimmed.length;
  if (N < 64) return -1;

  // Limit lag search to musically plausible periods (~ 75 Hz – 1500 Hz).
  const maxLag = Math.min(N - 1, Math.floor(sampleRate / 75));
  const minLag = Math.max(2, Math.floor(sampleRate / 1500));

  // Compute autocorrelation only for lags in [minLag, maxLag].
  const c = new Float32Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i < N - lag; i++) s += trimmed[i] * trimmed[i + lag];
    c[lag] = s;
  }

  // Find the first descending region, then the global maximum after that.
  let d = minLag;
  while (d < maxLag && c[d] > c[d + 1]) d++;
  let maxVal = -Infinity, maxPos = -1;
  for (let i = d; i <= maxLag; i++) {
    if (c[i] > maxVal) { maxVal = c[i]; maxPos = i; }
  }
  if (maxPos <= 0 || maxVal <= 0) return -1;

  // Parabolic interpolation for sub-sample precision.
  let T = maxPos;
  if (maxPos > 0 && maxPos < maxLag) {
    const x1 = c[maxPos - 1], x2 = c[maxPos], x3 = c[maxPos + 1];
    const a = (x1 + x3 - 2 * x2) / 2;
    const b = (x3 - x1) / 2;
    if (a !== 0) T = T - b / (2 * a);
  }

  return sampleRate / T;
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
