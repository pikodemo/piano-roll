// Tiny Web Audio synth + scheduler. Enough to audition arrangements.

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

export interface PlayOptions {
  velocity?: number; // 0-1
  type?: OscillatorType;
}

// Trigger a single note; returns a cancel function.
export function playNote(midi: number, durationSec: number, opts: PlayOptions = {}): () => void {
  const c = getCtx();
  const now = c.currentTime;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = opts.type ?? "triangle";
  osc.frequency.value = midiToFreq(midi);
  const peak = (opts.velocity ?? 0.8) * 0.18;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(peak, now + 0.005);
  gain.gain.linearRampToValueAtTime(peak * 0.7, now + Math.min(0.05, durationSec * 0.4));
  gain.gain.linearRampToValueAtTime(0, now + durationSec);
  osc.connect(gain).connect(c.destination);
  osc.start(now);
  osc.stop(now + durationSec + 0.05);
  return () => {
    try { osc.stop(); } catch { /* already stopped */ }
  };
}

// Schedule a list of (midi, startBeat, lengthBeat) events at a given BPM,
// starting at `c.currentTime + offset`. Returns a cancel function that stops
// every scheduled oscillator.
export interface ScheduledNote { midi: number; startBeat: number; lengthBeat: number; velocity?: number }

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
  const oscs: OscillatorNode[] = [];
  let endTime = 0;
  for (const ev of events) {
    const t0 = start + ev.startBeat * beatSec;
    const dur = ev.lengthBeat * beatSec;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "triangle";
    osc.frequency.value = midiToFreq(ev.midi);
    const peak = (ev.velocity ?? 0.8) * 0.16;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(peak, t0 + 0.005);
    gain.gain.linearRampToValueAtTime(peak * 0.7, t0 + Math.min(0.05, dur * 0.4));
    gain.gain.linearRampToValueAtTime(0, t0 + dur);
    osc.connect(gain).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
    oscs.push(osc);
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
    for (const osc of oscs) {
      try { osc.stop(); } catch { /* already stopped */ }
    }
  };
}
