const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

// Signal chain: voices → masterGain → compressor → destination
// The compressor tames kick/snare peaks so the lead doesn't get masked.
const masterGain = audioCtx.createGain();
masterGain.gain.value = 0.40; // tuned for ~50% phone volume

const compressor = audioCtx.createDynamicsCompressor();
compressor.threshold.value = -16; // dB
compressor.knee.value = 8;
compressor.ratio.value = 3.5;
compressor.attack.value = 0.003;
compressor.release.value = 0.1;

masterGain.connect(compressor);
compressor.connect(audioCtx.destination);

// Cached white-noise buffer (1s mono) reused for snare / hi-hat
const NOISE_BUFFER = (() => {
  const buf = audioCtx.createBuffer(1, audioCtx.sampleRate, audioCtx.sampleRate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
  return buf;
})();

let isPlaying = false;
let isMuted = localStorage.getItem('neonBlocksMuted') === 'true';
let timerID;

const tempo = 150;
const eighth = (60 / tempo) / 2; // seconds per 8th note → 0.2s
const lookahead = 25.0;          // ms between scheduler ticks
const scheduleAheadTime = 0.1;   // s of audio scheduled ahead

const NOTE = {
  // Bass octaves (2-3)
  C2: 65.41,  D2: 73.42,  E2: 82.41,  G2: 98.00,  A2: 110.00, B2: 123.47,
  C3: 130.81, D3: 146.83, E3: 164.81, 'F#3': 184.99, G3: 196.00,
  // Sub-melody octave (4)
  A3: 220.00, B3: 246.94,
  C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.00,
  // Melody (4-5)
  A4: 440.00, B4: 493.88,
  C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99,
  A5: 880.00,
  Rest: 0,
};

// Korobeiniki melody (square wave) — durations in 8th notes
const melody = [
  ['E5', 2], ['B4', 1], ['C5', 1], ['D5', 2], ['C5', 1], ['B4', 1],
  ['A4', 2], ['A4', 1], ['C5', 1], ['E5', 2], ['D5', 1], ['C5', 1],
  ['B4', 3], ['C5', 1], ['D5', 2], ['E5', 2],
  ['C5', 2], ['A4', 2], ['A4', 4],

  ['D5', 3], ['F5', 1], ['A5', 2], ['G5', 1], ['F5', 1],
  ['E5', 3], ['C5', 1], ['E5', 2], ['D5', 1], ['C5', 1],
  ['B4', 2], ['B4', 1], ['C5', 1], ['D5', 2], ['E5', 2],
  ['C5', 2], ['A4', 2], ['A4', 4],
];

// Sub-melody = melody one octave down (triangle for warmth)
const melodySub = melody.map(([n, d]) => [octaveDown(n), d]);

function octaveDown(noteName) {
  if (noteName === 'Rest') return 'Rest';
  const sharp = noteName.includes('#');
  const root = sharp ? noteName.slice(0, 2) : noteName[0];
  const oct = parseInt(noteName.slice(-1), 10);
  return `${root}${oct - 1}`;
}

// Bass line (triangle) — root-fifth pattern, quarter notes
// Phrase 1: Em B7 Em Em ‖ Phrase 2: Dm C G Am
const bass = [
  ['E2', 2], ['B2', 2], ['E2', 2], ['B2', 2],
  ['B2', 2], ['F#3', 2], ['B2', 2], ['F#3', 2],
  ['E2', 2], ['B2', 2], ['E2', 2], ['B2', 2],
  ['E2', 2], ['B2', 2], ['E2', 2], ['B2', 2],

  ['D2', 2], ['A2', 2], ['D2', 2], ['A2', 2],
  ['C3', 2], ['G3', 2], ['C3', 2], ['G3', 2],
  ['G2', 2], ['D3', 2], ['G2', 2], ['D3', 2],
  ['A2', 2], ['E3', 2], ['A2', 2], ['E3', 2],
];

// Drum patterns — one measure (8 eighth notes), loops automatically
//   Kick on beats 1 & 3, snare on 2 & 4, hat every eighth
const kickPat  = [['K', 2], ['Rest', 2], ['K', 2], ['Rest', 2]];
const snarePat = [['Rest', 2], ['S', 2], ['Rest', 2], ['S', 2]];
const hatPat   = [['H', 1], ['H', 1], ['H', 1], ['H', 1], ['H', 1], ['H', 1], ['H', 1], ['H', 1]];

const tracks = [
  { kind: 'lead', notes: melody,                          gain: 0.10,  staccato: 0.55, pos: 0, nextTime: 0 },
  { kind: 'tone', notes: melodySub, waveform: 'triangle', gain: 0.030, staccato: 0.55, pos: 0, nextTime: 0 },
  { kind: 'tone', notes: bass,      waveform: 'triangle', gain: 0.07,  staccato: 1.0,  pos: 0, nextTime: 0 },
  { kind: 'drum', notes: kickPat,   gain: 0.32, pos: 0, nextTime: 0 },
  { kind: 'drum', notes: snarePat,  gain: 0.13, pos: 0, nextTime: 0 },
  { kind: 'drum', notes: hatPat,    gain: 0.045, pos: 0, nextTime: 0 },
];

function scheduler() {
  for (const track of tracks) {
    while (track.nextTime < audioCtx.currentTime + scheduleAheadTime && isPlaying) {
      const [event, dur] = track.notes[track.pos];
      if (!isMuted && event !== 'Rest') {
        if (track.kind === 'lead') {
          playLead(NOTE[event], dur, track.nextTime, track.gain, track.staccato);
        } else if (track.kind === 'tone') {
          playTone(track.waveform, NOTE[event], dur, track.nextTime, track.gain, track.staccato);
        } else {
          playDrum(event, track.nextTime, track.gain);
        }
      }
      track.nextTime += dur * eighth;
      track.pos = (track.pos + 1) % track.notes.length;
    }
  }
  if (isPlaying) timerID = setTimeout(scheduler, lookahead);
}

function playTone(waveform, freq, dur, when, peak, staccato = 1.0) {
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = waveform;
  osc.frequency.value = freq;
  osc.connect(g);
  g.connect(masterGain);

  const slotSec = dur * eighth;
  const noteSec = Math.max(0.04, slotSec * staccato);

  g.gain.setValueAtTime(peak, when);
  g.gain.exponentialRampToValueAtTime(0.0005, when + noteSec);

  osc.start(when);
  osc.stop(when + noteSec + 0.01);
}

// Rich detuned-saw lead with lowpass filter — modern synth, cuts through the mix
function playLead(freq, dur, when, peak, staccato = 0.55) {
  const osc1 = audioCtx.createOscillator();
  const osc2 = audioCtx.createOscillator();
  const filter = audioCtx.createBiquadFilter();
  const g = audioCtx.createGain();

  osc1.type = 'sawtooth';
  osc1.frequency.value = freq;
  osc1.detune.value = -8; // cents

  osc2.type = 'sawtooth';
  osc2.frequency.value = freq;
  osc2.detune.value = +8;

  filter.type = 'lowpass';
  filter.frequency.value = 3000;
  filter.Q.value = 1.0;

  osc1.connect(filter);
  osc2.connect(filter);
  filter.connect(g);
  g.connect(masterGain);

  // Staccato: play only `staccato` portion of the slot, leave rest as silence
  const slotSec = dur * eighth;
  const noteSec = Math.max(0.05, slotSec * staccato);

  // Quick AD envelope (no sustain) for clean staccato bite
  const attack = 0.006;
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(peak, when + attack);
  g.gain.exponentialRampToValueAtTime(0.0005, when + noteSec);

  osc1.start(when);
  osc2.start(when);
  osc1.stop(when + noteSec + 0.01);
  osc2.stop(when + noteSec + 0.01);
}

function playDrum(type, when, peak) {
  if (type === 'K') return playKick(when, peak);
  if (type === 'S') return playSnare(when, peak);
  if (type === 'H') return playHat(when, peak);
}

function playKick(when, peak) {
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = 'triangle';
  // Pitch sweep: 140Hz → 45Hz over 80ms gives the "thump"
  osc.frequency.setValueAtTime(140, when);
  osc.frequency.exponentialRampToValueAtTime(45, when + 0.08);
  g.gain.setValueAtTime(peak, when);
  g.gain.exponentialRampToValueAtTime(0.001, when + 0.18);
  osc.connect(g);
  g.connect(masterGain);
  osc.start(when);
  osc.stop(when + 0.2);
}

function playSnare(when, peak) {
  const noise = audioCtx.createBufferSource();
  noise.buffer = NOISE_BUFFER;
  const filter = audioCtx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = 1500;
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(peak, when);
  g.gain.exponentialRampToValueAtTime(0.001, when + 0.12);
  noise.connect(filter);
  filter.connect(g);
  g.connect(masterGain);
  noise.start(when);
  noise.stop(when + 0.13);
}

function playHat(when, peak) {
  const noise = audioCtx.createBufferSource();
  noise.buffer = NOISE_BUFFER;
  const filter = audioCtx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = 7000;
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(peak, when);
  g.gain.exponentialRampToValueAtTime(0.001, when + 0.04);
  noise.connect(filter);
  filter.connect(g);
  g.connect(masterGain);
  noise.start(when);
  noise.stop(when + 0.05);
}

export async function startMusic() {
  if (isPlaying) return;
  // Browsers (esp. mobile Safari) auto-suspend the context when the tab goes
  // hidden. We MUST await the resume so audioCtx.currentTime is correct before
  // we schedule notes against it.
  if (audioCtx.state === 'suspended') {
    try { await audioCtx.resume(); } catch (_) {}
  }
  isPlaying = true;
  const start = audioCtx.currentTime + 0.1;
  for (const track of tracks) {
    track.nextTime = start;
    track.pos = 0;
  }
  scheduler();
}

export function stopMusic() {
  isPlaying = false;
  clearTimeout(timerID);
}

export function toggleMute() {
  isMuted = !isMuted;
  localStorage.setItem('neonBlocksMuted', String(isMuted));
  return isMuted;
}

export function isMutedNow() {
  return isMuted;
}

// Unlock Web Audio API on first interaction (required by browsers, especially Safari)
const unlockAudio = () => {
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  document.removeEventListener('click', unlockAudio);
  document.removeEventListener('touchstart', unlockAudio);
};
document.addEventListener('click', unlockAudio, { once: true });
document.addEventListener('touchstart', unlockAudio, { once: true });
