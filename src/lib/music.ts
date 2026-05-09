// Pure music-theory helpers. No DOM, no audio — just numbers.
//
// We represent pitches as MIDI integers (0-127). Middle C = 60.

export const NOTE_NAMES = [
  "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
] as const;

export const NOTE_NAMES_FLAT = [
  "C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B",
] as const;

export type PitchClass = number; // 0-11

export function pitchClass(midi: number): PitchClass {
  return ((midi % 12) + 12) % 12;
}

export function octaveOf(midi: number): number {
  return Math.floor(midi / 12) - 1;
}

export function midiToName(midi: number, useFlats = false): string {
  const names = useFlats ? NOTE_NAMES_FLAT : NOTE_NAMES;
  return `${names[pitchClass(midi)]}${octaveOf(midi)}`;
}

export function nameToMidi(name: string): number | null {
  const m = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(name.trim());
  if (!m) return null;
  const letter = m[1].toUpperCase();
  const accidental = m[2];
  const oct = parseInt(m[3], 10);
  const base: Record<string, number> = {
    C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
  };
  let pc = base[letter];
  if (accidental === "#") pc += 1;
  else if (accidental === "b") pc -= 1;
  return (oct + 1) * 12 + pc;
}

// ---------- Scales ----------

export type ScaleMode =
  | "major"
  | "minor" // natural minor
  | "harmonic_minor"
  | "melodic_minor"
  | "dorian"
  | "phrygian"
  | "lydian"
  | "mixolydian"
  | "locrian"
  | "minor_pentatonic"
  | "major_pentatonic"
  | "blues";

export const SCALE_INTERVALS: Record<ScaleMode, number[]> = {
  major:            [0, 2, 4, 5, 7, 9, 11],
  minor:            [0, 2, 3, 5, 7, 8, 10],
  harmonic_minor:   [0, 2, 3, 5, 7, 8, 11],
  melodic_minor:    [0, 2, 3, 5, 7, 9, 11],
  dorian:           [0, 2, 3, 5, 7, 9, 10],
  phrygian:         [0, 1, 3, 5, 7, 8, 10],
  lydian:           [0, 2, 4, 6, 7, 9, 11],
  mixolydian:       [0, 2, 4, 5, 7, 9, 10],
  locrian:          [0, 1, 3, 5, 6, 8, 10],
  minor_pentatonic: [0, 3, 5, 7, 10],
  major_pentatonic: [0, 2, 4, 7, 9],
  blues:            [0, 3, 5, 6, 7, 10],
};

export interface Scale {
  tonic: PitchClass; // 0-11
  mode: ScaleMode;
}

export function scalePitchClasses(scale: Scale): Set<PitchClass> {
  return new Set(SCALE_INTERVALS[scale.mode].map((i) => (scale.tonic + i) % 12));
}

export function isInScale(midi: number, scale: Scale): boolean {
  return scalePitchClasses(scale).has(pitchClass(midi));
}

// Diatonic chord triads built on each degree of the scale (where defined).
// Returns chord roots and the chord type for each degree (1-indexed).
export function diatonicTriads(scale: Scale): Array<{ degree: number; rootPc: PitchClass; quality: ChordQuality }> {
  const intervals = SCALE_INTERVALS[scale.mode];
  if (intervals.length !== 7) return []; // pentatonics, blues — skip
  const result: Array<{ degree: number; rootPc: PitchClass; quality: ChordQuality }> = [];
  const pcs = intervals.map((i) => (scale.tonic + i) % 12);
  const set = new Set(pcs);
  for (let i = 0; i < 7; i++) {
    const root = pcs[i];
    const third = (root + 4) % 12;
    const minorThird = (root + 3) % 12;
    const fifth = (root + 7) % 12;
    const dimFifth = (root + 6) % 12;
    let quality: ChordQuality;
    if (set.has(third) && set.has(fifth)) quality = "maj";
    else if (set.has(minorThird) && set.has(fifth)) quality = "min";
    else if (set.has(minorThird) && set.has(dimFifth)) quality = "dim";
    else if (set.has(third) && set.has((root + 8) % 12)) quality = "aug";
    else continue;
    result.push({ degree: i + 1, rootPc: root, quality });
  }
  return result;
}

// ---------- Chords ----------

export type ChordQuality =
  | "maj"
  | "min"
  | "dim"
  | "aug"
  | "sus2"
  | "sus4"
  | "maj7"
  | "min7"
  | "7"      // dominant 7
  | "dim7"
  | "m7b5"
  | "maj6"
  | "min6";

export const CHORD_INTERVALS: Record<ChordQuality, number[]> = {
  maj:    [0, 4, 7],
  min:    [0, 3, 7],
  dim:    [0, 3, 6],
  aug:    [0, 4, 8],
  sus2:   [0, 2, 7],
  sus4:   [0, 5, 7],
  maj7:   [0, 4, 7, 11],
  min7:   [0, 3, 7, 10],
  "7":    [0, 4, 7, 10],
  dim7:   [0, 3, 6, 9],
  m7b5:   [0, 3, 6, 10],
  maj6:   [0, 4, 7, 9],
  min6:   [0, 3, 7, 9],
};

export const CHORD_LABELS: Record<ChordQuality, string> = {
  maj: "", min: "m", dim: "dim", aug: "aug",
  sus2: "sus2", sus4: "sus4",
  maj7: "maj7", min7: "m7", "7": "7",
  dim7: "dim7", m7b5: "m7b5",
  maj6: "6", min6: "m6",
};

export interface Chord {
  rootPc: PitchClass;
  quality: ChordQuality;
  inversion: number; // 0 = root, 1 = first, 2 = second, ...
}

export function chordLabel(chord: Chord, useFlats = false): string {
  const names = useFlats ? NOTE_NAMES_FLAT : NOTE_NAMES;
  const inv = chord.inversion === 0 ? "" : ` (inv ${chord.inversion})`;
  return `${names[chord.rootPc]}${CHORD_LABELS[chord.quality]}${inv}`;
}

// Build the actual MIDI notes for a chord, voiced near a target MIDI pitch.
// `nearMidi` is used as a "soft" anchor: the lowest note of the voicing is the
// closest available octave of the bass note.
export function chordVoicing(chord: Chord, nearMidi: number): number[] {
  const intervals = CHORD_INTERVALS[chord.quality];
  // Build pitch-class sequence with the inversion applied: rotate the intervals
  // and bump the rotated ones up an octave so the order stays ascending.
  const inv = ((chord.inversion % intervals.length) + intervals.length) % intervals.length;
  const rotated: number[] = [];
  for (let i = 0; i < intervals.length; i++) {
    const idx = (i + inv) % intervals.length;
    let semis = intervals[idx];
    if (idx < inv) semis += 12;
    rotated.push(semis);
  }
  // Choose an octave for the bass that minimizes distance to `nearMidi`.
  const bassPc = (chord.rootPc + rotated[0]) % 12;
  const targetOct = Math.round((nearMidi - bassPc) / 12);
  const bassMidi = bassPc + 12 * targetOct;
  return rotated.map((semi) => bassMidi + (semi - rotated[0]));
}

// "Simplicity" score for a chord, given a working scale and the pinned note.
// Lower is simpler. Used to sort suggestions in the chord cycler.
export function chordSimplicityScore(chord: Chord, scale: Scale | null | undefined, pinMidi: number): number {
  let score = 0;
  // Diatonic chords (rooted on a scale degree, with the diatonic quality) get
  // a heavy bonus so they always come first when a scale is set.
  if (scale) {
    const triad = diatonicTriads(scale).find((t) => t.rootPc === chord.rootPc && t.quality === chord.quality);
    if (triad) score -= 1000;
  }
  // Triads (3 tones) come before 7ths (4 tones).
  score += CHORD_INTERVALS[chord.quality].length * 10;
  // Then prefer common qualities to less-common ones.
  const qualityRank: Record<ChordQuality, number> = {
    maj: 0, min: 0,
    "7": 2, maj7: 2, min7: 2,
    sus4: 3, sus2: 4,
    dim: 5, aug: 5,
    dim7: 6, m7b5: 6, maj6: 6, min6: 6,
  };
  score += qualityRank[chord.quality];
  // Tie-break: prefer chords where the pinned pitch is the root, then a 3rd,
  // then a 5th, then a 7th, then less-stable positions.
  const offset = ((pitchClass(pinMidi) - chord.rootPc) % 12 + 12) % 12;
  const positionRank: Record<number, number> = {
    0: 0,            // root
    3: 1, 4: 1,      // 3rds
    7: 2,            // perfect 5th
    10: 3, 11: 3,    // 7ths
    5: 4, 9: 4,      // 4ths / 6ths
    2: 5,            // 2nd
    6: 6, 8: 6,      // tritones, #5
    1: 7,            // semitone (rare)
  };
  score += positionRank[offset] ?? 8;
  return score;
}

// Return every (root, quality) chord whose pitch classes contain the given
// pitch, sorted simplest-first. Inversions are not enumerated here — the
// `chordVoicingContaining` helper already produces a different voicing per
// chord by anchoring the pinned note in place.
export function chordsContaining(
  midi: number,
  opts?: { qualities?: ChordQuality[]; scale?: Scale | null },
): Chord[] {
  const targetPc = pitchClass(midi);
  const qualities: ChordQuality[] = opts?.qualities ?? [
    "maj", "min", "7", "maj7", "min7", "sus4", "sus2", "dim", "aug", "m7b5", "dim7", "maj6", "min6",
  ];
  const out: Chord[] = [];
  for (let root = 0; root < 12; root++) {
    for (const quality of qualities) {
      const intervals = CHORD_INTERVALS[quality];
      const pcs = intervals.map((iv) => (root + iv) % 12);
      if (!pcs.includes(targetPc)) continue;
      out.push({ rootPc: root, quality, inversion: 0 });
    }
  }
  out.sort((a, b) => chordSimplicityScore(a, opts?.scale, midi) - chordSimplicityScore(b, opts?.scale, midi));
  return out;
}

// Voice the chord such that `pinMidi` is exactly one of the resulting MIDI
// pitches. The other tones are placed in the nearest octave to `pinMidi` so
// the voicing is a tight cluster around the pinned note.
export function chordVoicingContaining(chord: Chord, pinMidi: number): number[] {
  const pinPc = pitchClass(pinMidi);
  const targetOffset = ((pinPc - chord.rootPc) % 12 + 12) % 12;
  const intervals = CHORD_INTERVALS[chord.quality];
  // If the pin's pitch class isn't a chord tone, fall back to the unpinned
  // voicing (defensive — caller should never pass a non-member pin).
  if (!intervals.includes(targetOffset)) return chordVoicing(chord, pinMidi);
  const rootMidi = pinMidi - targetOffset;
  const tones = intervals.map((i) => {
    if (i === targetOffset) return pinMidi;
    let m = rootMidi + i;
    while (m < pinMidi - 6) m += 12;
    while (m > pinMidi + 6) m -= 12;
    return m;
  });
  return Array.from(new Set(tones)).sort((a, b) => a - b);
}

// Chord-stack helper: returns the chord-tone semitone offsets *above* the root
// (i.e. without the root itself). Useful when stacking a chord on top of an
// existing melody note that already plays the root.
export function chordOffsetsAbove(quality: ChordQuality): number[] {
  return CHORD_INTERVALS[quality].filter((o) => o !== 0);
}

// Returns the diatonic chord rooted at the given pitch within `scale`, or
// `null` if the pitch isn't a scale tone. For 7-note diatonic modes we use
// the triad on that degree; pentatonic / blues scales return null.
export function diatonicChordAt(rootMidi: number, scale: Scale): Chord | null {
  const triads = diatonicTriads(scale);
  if (triads.length === 0) return null;
  const target = pitchClass(rootMidi);
  const t = triads.find((x) => x.rootPc === target);
  if (!t) return null;
  return { rootPc: t.rootPc, quality: t.quality, inversion: 0 };
}

// ---------- Interval harmonization ----------

// Chromatic intervals, in semitones, that are commonly useful for harmony.
export const HARMONY_INTERVALS = {
  "min3 ↓": -3,
  "maj3 ↓": -4,
  "P4 ↓":  -5,
  "P5 ↓":  -7,
  "min6 ↓": -8,
  "maj6 ↓": -9,
  "octave ↓": -12,
  "min3 ↑": 3,
  "maj3 ↑": 4,
  "P4 ↑":  5,
  "P5 ↑":  7,
  "min6 ↑": 8,
  "maj6 ↑": 9,
  "octave ↑": 12,
} as const;

// Snap a chromatic offset so the resulting note is in the given scale.
// Returns the original offset if no scale is provided. If a scale is provided
// but no in-scale neighbor is within 2 semitones, returns the chromatic value.
export function snapToScale(sourceMidi: number, semitoneOffset: number, scale: Scale | null): number {
  const target = sourceMidi + semitoneOffset;
  if (!scale) return target;
  if (isInScale(target, scale)) return target;
  for (let delta = 1; delta <= 2; delta++) {
    if (isInScale(target + delta, scale)) return target + delta;
    if (isInScale(target - delta, scale)) return target - delta;
  }
  return target;
}

// ---------- Misc ----------

export function clampMidi(midi: number): number {
  return Math.max(0, Math.min(127, Math.round(midi)));
}
