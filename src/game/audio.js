/**
 * Synthesised audio. No sample files — everything is generated with WebAudio
 * so the project stays a single self-contained folder.
 */

import { CONFIG } from '../config.js';

export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = CONFIG.audio.enabled;
    this._noise = null;
    this._engine = null;
  }

  /** Must be called from a user gesture, or the context stays suspended. */
  start() {
    if (!this.enabled || this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) { this.enabled = false; return; }
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = CONFIG.audio.masterGain;
    this.master.connect(this.ctx.destination);
    this._noise = this._makeNoiseBuffer(2.0);
    this._startEngine();
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }

  _makeNoiseBuffer(seconds) {
    const n = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _burst({ gain = 0.5, attack = 0.002, decay = 0.25, filter = 900, q = 0.9, type = 'lowpass', rate = 1 }) {
    if (!this.ctx) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noise;
    src.playbackRate.value = rate;
    const bp = this.ctx.createBiquadFilter();
    bp.type = type;
    bp.frequency.value = filter;
    bp.Q.value = q;
    const g = this.ctx.createGain();
    const t = this.ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0008, t + attack + decay);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t, Math.random() * 1.2);
    src.stop(t + attack + decay + 0.05);
  }

  /** Low, hard 50 mm report with a tail. */
  cannon() {
    this._burst({ gain: 0.85, attack: 0.001, decay: 0.30, filter: 260, type: 'lowpass' });
    this._burst({ gain: 0.34, attack: 0.001, decay: 0.9, filter: 130, type: 'lowpass', rate: 0.6 });
    if (!this.ctx) return;
    // A short pitched thump gives the report some body.
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const t = this.ctx.currentTime;
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.22);
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    osc.connect(g).connect(this.master);
    osc.start(t); osc.stop(t + 0.3);
  }

  coax() { this._burst({ gain: 0.30, attack: 0.001, decay: 0.07, filter: 1800, type: 'bandpass', q: 1.4 }); }
  impact() { this._burst({ gain: 0.42, attack: 0.002, decay: 0.34, filter: 420, type: 'lowpass' }); }
  explosion() {
    this._burst({ gain: 0.75, attack: 0.002, decay: 0.75, filter: 300, type: 'lowpass', rate: 0.75 });
  }
  incoming() { this._burst({ gain: 0.55, attack: 0.001, decay: 0.55, filter: 520, type: 'lowpass' }); }
  clang() { this._burst({ gain: 0.5, attack: 0.001, decay: 0.5, filter: 2400, type: 'bandpass', q: 3 }); }

  /** Short confirmation tone for the range-finder. */
  blip() {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const t = this.ctx.currentTime;
    osc.type = 'square';
    osc.frequency.value = 1380;
    g.gain.setValueAtTime(0.08, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    osc.connect(g).connect(this.master);
    osc.start(t); osc.stop(t + 0.08);
  }

  /** A continuous diesel rumble whose pitch follows road speed. */
  _startEngine() {
    const src = this.ctx.createBufferSource();
    src.buffer = this._noise;
    src.loop = true;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 150;
    const g = this.ctx.createGain();
    g.gain.value = 0.16;
    src.connect(lp).connect(g).connect(this.master);
    src.start();

    const osc = this.ctx.createOscillator();
    const og = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = 42;
    og.gain.value = 0.045;
    osc.connect(og).connect(this.master);
    osc.start();

    this._engine = { src, lp, g, osc, og };
  }

  /** @param {number} throttle 0..1 */
  setEngine(throttle) {
    if (!this._engine || !this.ctx) return;
    const e = this._engine;
    const t = this.ctx.currentTime;
    e.lp.frequency.setTargetAtTime(120 + throttle * 260, t, 0.25);
    e.g.gain.setTargetAtTime(0.11 + throttle * 0.14, t, 0.3);
    e.osc.frequency.setTargetAtTime(34 + throttle * 46, t, 0.3);
  }
}
