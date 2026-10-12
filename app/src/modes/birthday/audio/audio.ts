import { happyBirthday, midiHz, type Note, type Score } from '../core/song';
import { BlowDetector, dbToPower, type BlowReading } from '../core/blow';

/**
 * Sound for the room, all made here: the song is rendered once into a buffer with an
 * OfflineAudioContext (so it plays back with no scheduling jitter at all), and the effects
 * are short synthesised sounds. Music, effects and ambience have their own buses, music
 * runs through a little room reverb, and a limiter keeps it all clean.
 *
 * Browsers only start audio from a gesture: `unlock()` is wired to the first key or tap.
 */

export class Audio {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private music!: GainNode;
  private sfx!: GainNode;
  private amb!: GainNode;
  private reverb!: ConvolverNode;
  private songBuf: AudioBuffer | null = null;
  private songRender: Promise<AudioBuffer> | null = null;
  private songSrc: AudioBufferSourceNode | null = null;
  private songGain: GainNode | null = null;
  private songStart = 0;
  score: Score;
  muted = false;
  /** the microphone, once she has allowed it */
  mic: { analyser: AnalyserNode; source: MediaStreamAudioSourceNode; detector: BlowDetector; time: Float32Array<ArrayBuffer>; db: Float32Array<ArrayBuffer>; power: Float32Array; stream: MediaStream } | null = null;
  onSongEnd?: () => void;

  constructor(name: string) {
    this.score = happyBirthday(name);
  }

  /** create the context (on a gesture) and start the song rendering in the background */
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const Ctx = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx: AudioContext = new Ctx({ latencyHint: 'interactive' });
    this.ctx = ctx;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6; limiter.knee.value = 6; limiter.ratio.value = 8; limiter.attack.value = 0.003; limiter.release.value = 0.2;
    this.master = ctx.createGain(); this.master.gain.value = this.muted ? 0 : 0.9;
    this.master.connect(limiter).connect(ctx.destination);
    this.music = ctx.createGain(); this.music.gain.value = 0.9; this.music.connect(this.master);
    this.sfx = ctx.createGain(); this.sfx.gain.value = 0.8; this.sfx.connect(this.master);
    this.amb = ctx.createGain(); this.amb.gain.value = 0.0; this.amb.connect(this.master);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = impulse(ctx, 1.6, 2.6);
    const wet = ctx.createGain(); wet.gain.value = 0.22;
    this.reverb.connect(wet).connect(this.master);
    this.prerender();
    this.startAmbience();
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.05);
  }

  // ---------------------------------------------------------------- the song
  /**
   * Render the song into a buffer. An OfflineAudioContext needs no user gesture, so this
   * starts at load, behind the loading screen; the buffer plays in the live context later.
   */
  prerender(): Promise<AudioBuffer> {
    // never throw into the caller: a browser without offline audio just has no song
    try { return this.renderSong(); } catch (e) { return Promise.reject(e); }
  }

  private renderSong() {
    if (this.songRender) return this.songRender;
    const sr = 44100;
    const off = new OfflineAudioContext(2, Math.ceil(this.score.duration * sr), sr);
    const out = off.createGain(); out.gain.value = 0.8;
    const verb = off.createConvolver(); verb.buffer = impulse(off, 2.2, 2.2);
    const wet = off.createGain(); wet.gain.value = 0.32;
    out.connect(off.destination); out.connect(verb); verb.connect(wet).connect(off.destination);
    for (const n of this.score.notes) playNote(off, out, n);
    this.songRender = off.startRendering().then((b) => (this.songBuf = b));
    return this.songRender;
  }

  get songPlaying() { return !!this.songSrc; }
  /** seconds into the song, or -1 */
  get songTime() { return this.songSrc && this.ctx ? this.ctx.currentTime - this.songStart : -1; }

  private playToken = 0;

  async playSong() {
    if (!this.ctx) return;
    this.stopSong(0.05);
    const token = ++this.playToken;
    let buf: AudioBuffer;
    try { buf = this.songBuf ?? await this.prerender(); } catch { return; }
    // stopped (or restarted) while the song was still rendering
    if (token !== this.playToken) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(1, ctx.currentTime + 0.3);
    src.connect(g).connect(this.music);
    this.songStart = ctx.currentTime + 0.02;
    src.start(this.songStart);
    this.songSrc = src; this.songGain = g;
    this.duck(true);
    src.onended = () => {
      if (this.songSrc !== src) return;
      this.songSrc = null; this.songGain = null;
      this.duck(false);
      this.onSongEnd?.();
    };
  }

  stopSong(fade = 0.6) {
    this.playToken++;
    if (!this.songSrc || !this.ctx) return;
    const src = this.songSrc, g = this.songGain!;
    this.songSrc = null; this.songGain = null;
    g.gain.setTargetAtTime(0, this.ctx.currentTime, fade / 3);
    src.stop(this.ctx.currentTime + fade + 0.05);
    this.duck(false);
  }

  /** the room tone dips while the song plays */
  private duck(on: boolean) {
    if (this.ctx) this.amb.gain.setTargetAtTime(on ? 0.15 : 0.5, this.ctx.currentTime, 0.4);
  }

  // ---------------------------------------------------------------- ambience: crickets through the window
  private startAmbience() {
    const ctx = this.ctx!;
    const len = 8, buf = ctx.createBuffer(2, ctx.sampleRate * len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      // a few crickets, each chirping in short trains at its own pitch and rate
      for (let c = 0; c < 4; c++) {
        const f = 4200 + c * 380 + ch * 60, period = 0.9 + c * 0.37, start = c * 0.3 + ch * 0.11;
        for (let t0 = start; t0 < len - 0.3; t0 += period) {
          for (let p = 0; p < 3; p++) {
            const ts = t0 + p * 0.045;
            for (let i = 0; i < 0.03 * ctx.sampleRate; i++) {
              const t = i / ctx.sampleRate, k = Math.floor((ts + t) * ctx.sampleRate);
              if (k >= d.length) break;
              d[k] += Math.sin(2 * Math.PI * f * t) * Math.sin(Math.PI * t / 0.03) * 0.03;
            }
          }
        }
      }
    }
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2500;
    src.connect(hp).connect(this.amb);
    src.start();
    this.amb.gain.setTargetAtTime(0.5, ctx.currentTime, 2);
  }

  // ---------------------------------------------------------------- effects
  private noise(dur: number) {
    const ctx = this.ctx!, b = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const s = ctx.createBufferSource(); s.buffer = b;
    return s;
  }

  private env(g: GainNode, t: number, a: number, peak: number, d: number) {
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  /** a soft breath in */
  inhale(dur = 0.8) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this.noise(dur + 0.1), bp = ctx.createBiquadFilter(), g = ctx.createGain();
    bp.type = 'bandpass'; bp.Q.value = 0.7;
    bp.frequency.setValueAtTime(600, t); bp.frequency.linearRampToValueAtTime(1400, t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.18, t + dur * 0.7); g.gain.linearRampToValueAtTime(0, t + dur);
    n.connect(bp).connect(g).connect(this.sfx); n.start(t); n.stop(t + dur + 0.1);
  }

  /** the long "fffff" of blowing */
  blow(dur = 1.0) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this.noise(dur + 0.2), bp = ctx.createBiquadFilter(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
    bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 0.5;
    lp.type = 'lowpass'; lp.frequency.setValueAtTime(5000, t); lp.frequency.linearRampToValueAtTime(2500, t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.4, t + 0.08); g.gain.setValueAtTime(0.38, t + dur * 0.7); g.gain.linearRampToValueAtTime(0, t + dur);
    n.connect(bp).connect(lp).connect(g).connect(this.sfx); n.start(t); n.stop(t + dur + 0.2);
  }

  /** a candle going out: a tiny soft puff */
  puff() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this.noise(0.25), lp = ctx.createBiquadFilter(), g = ctx.createGain();
    lp.type = 'lowpass'; lp.frequency.value = 900;
    this.env(g, t, 0.005, 0.25, 0.18);
    n.connect(lp).connect(g).connect(this.sfx); n.start(t); n.stop(t + 0.25);
  }

  /** a match strike and the candle catching */
  strike() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this.noise(0.35), hp = ctx.createBiquadFilter(), g = ctx.createGain();
    hp.type = 'highpass'; hp.frequency.value = 2500;
    this.env(g, t, 0.01, 0.2, 0.3);
    n.connect(hp).connect(g).connect(this.sfx); n.start(t); n.stop(t + 0.35);
  }

  /** bright chime arpeggio (a wish, a surprise) */
  chime(root = 79, steps = [0, 4, 7, 12, 16]) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    steps.forEach((s, i) => this.bell(midiHz(root + s), t + i * 0.08, 0.16 - i * 0.015));
  }

  private bell(f: number, t: number, amp: number) {
    const ctx = this.ctx!;
    for (const [ratio, a, d] of [[1, 1, 1.6], [2.76, 0.35, 0.6], [5.4, 0.15, 0.3]] as const) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = f * ratio;
      this.env(g, t, 0.004, amp * a, d);
      o.connect(g); g.connect(this.sfx); g.connect(this.reverb);
      o.start(t); o.stop(t + d + 0.05);
    }
  }

  /** a soft hand clap */
  clap() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this.noise(0.12), bp = ctx.createBiquadFilter(), g = ctx.createGain();
    bp.type = 'bandpass'; bp.frequency.value = 1200; bp.Q.value = 1.2;
    this.env(g, t, 0.002, 0.35, 0.09);
    n.connect(bp).connect(g); g.connect(this.sfx); g.connect(this.reverb);
    n.start(t); n.stop(t + 0.12);
  }

  /** a party popper */
  pop() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this.noise(0.4), lp = ctx.createBiquadFilter(), g = ctx.createGain();
    lp.type = 'lowpass'; lp.frequency.setValueAtTime(6000, t); lp.frequency.exponentialRampToValueAtTime(400, t + 0.3);
    this.env(g, t, 0.001, 0.55, 0.32);
    n.connect(lp).connect(g); g.connect(this.sfx); g.connect(this.reverb);
    n.start(t); n.stop(t + 0.4);
  }

  /** a switch or button click */
  click() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'square'; o.frequency.setValueAtTime(1800, t); o.frequency.exponentialRampToValueAtTime(600, t + 0.02);
    this.env(g, t, 0.001, 0.08, 0.03);
    o.connect(g).connect(this.sfx); o.start(t); o.stop(t + 0.05);
  }

  /** a soft whoosh as she twirls */
  whoosh() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this.noise(0.9), bp = ctx.createBiquadFilter(), g = ctx.createGain();
    bp.type = 'bandpass'; bp.Q.value = 2;
    bp.frequency.setValueAtTime(500, t); bp.frequency.exponentialRampToValueAtTime(2200, t + 0.45); bp.frequency.exponentialRampToValueAtTime(600, t + 0.85);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.16, t + 0.35); g.gain.linearRampToValueAtTime(0, t + 0.85);
    n.connect(bp).connect(g).connect(this.sfx); n.start(t); n.stop(t + 0.9);
  }

  /** a balloon squeak-bump */
  boing() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(420, t + 0.12); o.frequency.exponentialRampToValueAtTime(260, t + 0.3);
    this.env(g, t, 0.01, 0.18, 0.3);
    o.connect(g).connect(this.sfx); o.start(t); o.stop(t + 0.35);
  }

  // ---------------------------------------------------------------- microphone
  /** ask for the mic; resolves true when it is listening */
  async enableMic(): Promise<boolean> {
    this.unlock();
    if (!this.ctx || !navigator.mediaDevices?.getUserMedia) return false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      const src = this.ctx.createMediaStreamSource(stream);
      const analyser = this.ctx.createAnalyser();
      analyser.fftSize = 1024; analyser.smoothingTimeConstant = 0.2;
      src.connect(analyser);
      this.disableMic();             // never two live streams
      this.mic = {
        analyser, source: src, stream, detector: new BlowDetector(),
        time: new Float32Array(analyser.fftSize), db: new Float32Array(analyser.frequencyBinCount), power: new Float32Array(analyser.frequencyBinCount),
      };
      return true;
    } catch { return false; }
  }

  disableMic() {
    this.mic?.stream.getTracks().forEach((t) => t.stop());
    this.mic?.source.disconnect();
    this.mic = null;
  }

  /** read the mic for this frame */
  listen(dt: number): BlowReading | null {
    const m = this.mic;
    if (!m || !this.ctx) return null;
    m.analyser.getFloatTimeDomainData(m.time);
    m.analyser.getFloatFrequencyData(m.db);
    return m.detector.feed(m.time, dbToPower(m.db, m.power), this.ctx.sampleRate, dt);
  }
}

// ---------------------------------------------------------------- synthesis
/** a stereo reverb tail: decaying noise, a little different per ear */
function impulse(ctx: BaseAudioContext, seconds: number, decay: number) {
  const len = Math.ceil(ctx.sampleRate * seconds), b = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay) * (i < 60 ? i / 60 : 1);
  }
  return b;
}

/** schedule one note of the arrangement on an offline context */
function playNote(ctx: BaseAudioContext, out: AudioNode, n: Note) {
  const f = midiHz(n.midi), t = n.t;
  const pan = ctx.createStereoPanner();
  pan.pan.value = n.voice === 'bass' ? 0 : Math.max(-0.6, Math.min(0.6, (n.midi - 66) / 30));
  pan.connect(out);
  const partial = (ratio: number, amp: number, decay: number, type: OscillatorType = 'sine', detune = 0, attack = 0.004) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = f * ratio; o.detune.value = detune;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp, t + attack);
    g.gain.setTargetAtTime(0, t + attack, decay);
    o.connect(g).connect(pan);
    o.start(t); o.stop(t + attack + decay * 6);
  };
  const v = n.vel;
  switch (n.voice) {
    case 'box':
      // music box: a pure tine with a bright, quickly dying overtone
      partial(1, 0.32 * v, 0.9); partial(3.0, 0.07 * v, 0.18); partial(5.97, 0.03 * v, 0.07);
      break;
    case 'bell':
      partial(1, 0.18 * v, 0.7); partial(2.76, 0.07 * v, 0.25); partial(5.4, 0.03 * v, 0.1);
      break;
    case 'piano': {
      // a soft felt piano: harmonics that fade faster the higher they are, slightly stretched
      const sustain = Math.min(1.6, n.dur * 0.9 + 0.2);
      for (let k = 1; k <= 6; k++) partial(k * (1 + 0.0004 * k * k), (0.34 / Math.pow(k, 1.35)) * v, sustain / (0.6 + k * 0.45), 'sine', k % 2 ? 2 : -2, 0.006);
      break;
    }
    case 'bass':
      partial(1, 0.35 * v, n.dur * 0.6, 'triangle'); partial(2, 0.08 * v, n.dur * 0.3);
      break;
    case 'pad': {
      // strings: two detuned saws through a soft low-pass, slow in and out
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400; lp.Q.value = 0.3;
      lp.connect(pan);
      for (const det of [-7, 7]) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.05 * v, t + 0.45);
        g.gain.setValueAtTime(0.05 * v, t + Math.max(0.5, n.dur - 0.3));
        g.gain.linearRampToValueAtTime(0, t + n.dur + 0.6);
        o.connect(g).connect(lp);
        o.start(t); o.stop(t + n.dur + 0.7);
      }
      break;
    }
  }
}
