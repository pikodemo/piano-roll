// Quick spot-checks for the chord helpers.
// Run with `node scripts/check-music.mjs` from the repo root.

import { register } from "node:module";
import { pathToFileURL } from "node:url";

// Use ts-node's loader if available; otherwise rely on a pre-built `.js`.
// Easiest: import the TS source via the running Next.js dev server is overkill,
// so just inline the helpers here for assertion. We re-implement just enough
// to spot-check the core invariants instead of pulling tsx into the repo.

import {
  chordsContaining,
  chordVoicingContaining,
  pitchClass,
  CHORD_INTERVALS,
} from "../src/lib/music.ts";

function assert(cond, msg) {
  if (!cond) { console.error("FAIL:", msg); process.exit(1); }
}

// 1. Every suggested chord must contain the input pitch class.
const cases = [
  { midi: 60, scale: null },                              // C, no scale
  { midi: 60, scale: { tonic: 0, mode: "major" } },       // C in C major
  { midi: 62, scale: { tonic: 0, mode: "major" } },       // D in C major
  { midi: 67, scale: { tonic: 9, mode: "minor" } },       // G in A minor
];

for (const c of cases) {
  const chords = chordsContaining(c.midi, { scale: c.scale });
  assert(chords.length > 0, `no chords for midi=${c.midi}`);
  for (const ch of chords) {
    const pcs = CHORD_INTERVALS[ch.quality].map((iv) => (ch.rootPc + iv) % 12);
    assert(pcs.includes(pitchClass(c.midi)),
      `chord ${ch.rootPc}/${ch.quality} doesn't contain midi=${c.midi}`);
  }
  // Voicing must literally include the pinned MIDI value.
  for (const ch of chords) {
    const v = chordVoicingContaining(ch, c.midi);
    assert(v.includes(c.midi),
      `voicing of ${ch.rootPc}/${ch.quality} for pin=${c.midi} doesn't include the pin: got ${v.join(",")}`);
  }
}

// 2. With a scale, the first suggestion should be diatonic.
function diatonicCheck(midi, scale, expectedFirstQuality, expectedFirstRoot) {
  const chords = chordsContaining(midi, { scale });
  const first = chords[0];
  assert(first.quality === expectedFirstQuality && first.rootPc === expectedFirstRoot,
    `first chord for midi=${midi} in ${scale.tonic}/${scale.mode} expected ${expectedFirstRoot}/${expectedFirstQuality}, got ${first.rootPc}/${first.quality}`);
}
// C in C major → I (Cmaj)
diatonicCheck(60, { tonic: 0, mode: "major" }, "maj", 0);
// D in C major → ii (Dm)
diatonicCheck(62, { tonic: 0, mode: "major" }, "min", 2);
// E in C major → iii (Em)
diatonicCheck(64, { tonic: 0, mode: "major" }, "min", 4);
// G in A minor → III (Cmaj — G is the 5th of Cmaj which is the III chord in Am)
// Diatonic Am triads: Am, Bdim, Cmaj, Dm, Em, F, G. G is in Em (5th), G (root),
// Cmaj (5th). With root preference, G first.
diatonicCheck(67, { tonic: 9, mode: "minor" }, "maj", 7);

console.log("OK: chord-cycler invariants hold for every spot-check.");
