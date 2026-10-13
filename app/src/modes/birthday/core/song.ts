/**
 * "Happy Birthday to You", arranged here and synthesised in the browser (audio/synth.ts).
 * The tune is public domain; the arrangement and the sound are this project's own, so
 * there is no recording anyone else holds rights in.
 *
 * Form: a music-box intro, a gentle first verse (music box over a waltzing piano), and a
 * fuller second verse (piano melody, strings, bass and a celesta counter-line) that slows
 * into a held last chord with a sparkle on top.
 *
 * Pure data: notes in seconds, plus the lyric lines with their times, so the room can
 * show the words in step with the music (and her name on "dear ___").
 */

export type Voice = 'box' | 'piano' | 'bass' | 'pad' | 'bell';

export interface Note { t: number; dur: number; midi: number; vel: number; voice: Voice }
export interface Lyric { t: number; end: number; text: string; name?: boolean }
export interface Score { notes: Note[]; lyrics: Lyric[]; duration: number; bpm: number }

// F major. MIDI 60 = middle C.
const C4 = 60, D4 = 62, E4 = 64, F4 = 65, G4 = 67, A4 = 69, Bb4 = 70, C5 = 72;

/** melody in beats (quarter = 1), 3/4. `ferm` marks the held note on the name. */
const MELODY: Array<[number, number, boolean?]> = [
  [C4, 0.75], [C4, 0.25],
  [D4, 1], [C4, 1], [F4, 1],
  [E4, 2], [C4, 0.75], [C4, 0.25],
  [D4, 1], [C4, 1], [G4, 1],
  [F4, 2], [C4, 0.75], [C4, 0.25],
  [C5, 1], [A4, 1], [F4, 1],
  [E4, 1], [D4, 1, true], [Bb4, 0.75], [Bb4, 0.25],
  [A4, 1], [F4, 1], [G4, 1],
  [F4, 3],
];

/** one chord per bar (bars 1..8; the pickup has none): root and the notes above it */
const CHORDS: Array<[number, number[]]> = [
  [F4 - 24, [F4, A4, C5]],           // F
  [C4 - 12, [E4, G4, Bb4]],          // C7
  [C4 - 12, [E4, G4, Bb4]],          // C7
  [F4 - 24, [F4, A4, C5]],           // F
  [F4 - 24, [Eb(), A4, C5]],         // F7
  [Bb4 - 36, [D4 + 12, F4, Bb4]],    // Bb
  [C4 - 12, [E4, G4, Bb4]],          // F/C → C7, kept as C7: the line resolves home next bar
  [F4 - 24, [F4, A4, C5]],           // F
];
function Eb() { return 63 + 12; }

/** which words go with which melody notes, per line */
const LINES = ['Happy birthday to you', 'Happy birthday to you', 'Happy birthday dear {name}', 'Happy birthday to you'];

export function happyBirthday(name = 'Mithra', bpm = 92): Score {
  const notes: Note[] = [];
  const lyrics: Lyric[] = [];
  const beat = 60 / bpm;
  // a beat-to-seconds clock with a fermata and a closing ritardando
  let tSec = 0;
  const push = (beats: number, stretch = 1) => { const d = beats * beat * stretch; const t0 = tSec; tSec += d; return [t0, d] as const; };

  // ---- intro: two bars of music box arpeggio over F, then C7 with a breath
  const introArp = [F4 + 12, A4 + 12, C5 + 12, A4 + 12, C5 + 12, F4 + 24];
  for (const m of introArp) { const [t, d] = push(0.5); notes.push({ t, dur: d * 2.2, midi: m, vel: 0.5, voice: 'box' }); }
  const c7 = [G4 + 12, Bb4 + 12, C5 + 12, E4 + 24];
  for (let i = 0; i < c7.length; i++) {
    const [t, d] = push(i === c7.length - 1 ? 1.5 : 0.5, i === c7.length - 1 ? 1.2 : 1);
    notes.push({ t, dur: d * 2.5, midi: c7[i], vel: 0.45, voice: 'box' });
  }
  push(0.5);   // a breath before the singing starts

  // ---- two verses
  for (let verse = 0; verse < 2; verse++) {
    const full = verse === 1;
    let bar = -1, beatInBar = 2;     // the pickup sits on beat 3 of an empty bar
    let line = 0, lineStart = tSec;
    const lastBars = full ? 2 : 0;   // the second verse slows over its last two bars
    for (let i = 0; i < MELODY.length; i++) {
      const [midi, len, ferm] = MELODY[i];
      const barNow = bar;
      // ritardando: the stretch grows across the closing bars of the last verse
      const rit = full && barNow >= 8 - lastBars ? 1 + 0.18 * (barNow - (8 - lastBars) + beatInBar / 3) : 1;
      const stretch = rit * (ferm ? 1.9 : 1);
      const [t, d] = push(len, stretch);
      const last = i === MELODY.length - 1;
      const dur = last ? d * 2.4 : d * 0.98;
      if (full) {
        notes.push({ t, dur, midi, vel: 0.62 + (ferm ? 0.08 : 0), voice: 'piano' });
        notes.push({ t, dur, midi: midi + 12, vel: 0.16, voice: 'bell' });
      } else {
        notes.push({ t, dur: Math.max(dur, 0.6), midi: midi + 12, vel: 0.62, voice: 'box' });
      }
      // accompaniment: on the downbeat of each bar, a waltz figure for the whole bar
      if (beatInBar === 0 && bar >= 0) {
        const [root, triad] = CHORDS[bar];
        const barLen = 3 * beat * rit * (bar === 5 ? 1.3 : 1);
        notes.push({ t, dur: barLen * 1.1, midi: root + 12, vel: full ? 0.42 : 0.3, voice: 'piano' });
        if (full) notes.push({ t, dur: barLen * 1.05, midi: root, vel: 0.45, voice: 'bass' });
        for (const b of [1, 2]) {
          const tb = t + (barLen / 3) * b;
          for (const m of triad) notes.push({ t: tb, dur: barLen / 3 * 0.9, midi: m - 12, vel: full ? 0.2 : 0.16, voice: 'piano' });
        }
        if (full) for (const m of triad) notes.push({ t, dur: barLen * 1.02, midi: m, vel: 0.13, voice: 'pad' });
      }
      // lyric lines break after "you" / the name: notes 0-5, 6-11, 12-18, 19-24
      const ends = [5, 11, 18, 24];
      if (i === ends[line]) {
        const text = LINES[line].replace('{name}', () => name);
        // the very last line lingers over the closing chord; the others give way to the next
        lyrics.push({ t: lineStart - 0.15, end: tSec + (last && full ? 2.5 : -0.15), text, name: line === 2 });
        line++; lineStart = tSec;
      }
      beatInBar += len;
      while (beatInBar >= 3 - 1e-6) { beatInBar -= 3; bar++; }
    }
    if (!full) push(1);   // a beat between the verses
  }
  // ---- the last chord holds, with a celesta sparkle running up over it
  const end = tSec;
  for (const m of [F4, A4, C5, F4 + 12]) notes.push({ t: end - 0.05, dur: 3.2, midi: m, vel: 0.22, voice: 'pad' });
  const sparkle = [F4 + 24, A4 + 24, C5 + 24, F4 + 36, A4 + 36, C5 + 36];
  sparkle.forEach((m, i) => notes.push({ t: end + 0.1 + i * 0.09, dur: 1.4, midi: m, vel: 0.2 - i * 0.02, voice: 'bell' }));
  notes.sort((a, b) => a.t - b.t);
  return { notes, lyrics, duration: end + 3.6, bpm };
}

/** equal temperament, A4 = 440 Hz */
export const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
