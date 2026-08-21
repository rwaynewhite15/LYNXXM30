/**
 * Touch controls.
 *
 * Everything here funnels into the existing Input object's virtual channel, so
 * the game loop reads exactly the same latched state it does from a keyboard
 * and mouse and no gameplay code knows touch exists.
 *
 * The scheme follows what works on a phone held in landscape: the sight is
 * slewed by dragging anywhere on the view that isn't a control, the left thumb
 * gets a proportional steer pad, and the right thumb gets the weapons. Aiming
 * and firing are on separate controls deliberately — a tap-to-fire scheme
 * makes it impossible to track a target and shoot it at the same time.
 */

import { CONFIG } from '../config.js';

/** Magnification steps cycled by the ZOOM button. */
const ZOOM_KEYS = ['Digit1', 'Digit2', 'Digit3'];

/**
 * Pointer capture keeps a drag alive when the finger leaves the element, but
 * throws for a pointer id the browser does not consider active — which is what
 * a synthesised event in a test is. Neither case is worth failing over.
 */
function capture(el, id) {
  try { el.setPointerCapture?.(id); } catch { /* not an active pointer */ }
}
function release(el, id) {
  try { el.releasePointerCapture?.(id); } catch { /* already released */ }
}

export class TouchControls {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {import('./input.js').Input} input
   */
  constructor(canvas, input) {
    this.canvas = canvas;
    this.input = input;
    this.root = document.getElementById('touch');
    this.enabled = false;
    this.zoomIndex = 1;

    /** Pointer id currently slewing the sight, if any. */
    this._lookId = null;
    this._lookLast = { x: 0, y: 0 };
    /** Pointer id currently on the steer pad. */
    this._steerId = null;

    this.steerPad = document.getElementById('touch-steer');
    this.steerKnob = this.steerPad?.querySelector('.knob') ?? null;
    this.fireButton = this.root?.querySelector('[data-hold="fire"]') ?? null;

    /** Called when the ZOOM button changes step, so the HUD can respond. */
    this.onZoom = null;

    this._bindLook();
    this._bindSteer();
    this._bindButtons();
  }

  /**
   * Touch capability, not screen size: a touchscreen laptop should still get
   * the controls, and a small desktop window should not.
   */
  static available() {
    return (navigator.maxTouchPoints ?? 0) > 0
      || matchMedia('(pointer: coarse)').matches;
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.root) this.root.hidden = !on;
    document.body.classList.toggle('touch', on);
    if (!on) {
      this.input.touchSteer = null;
      this._releaseAll();
    }
  }

  /** Relabels the primary action, which differs between the two seats. */
  setSeat(seat) {
    if (!this.fireButton) return;
    this.fireButton.textContent = seat === 'spotter' ? 'MARK' : 'FIRE';
    this.fireButton.classList.toggle('mark', seat === 'spotter');
  }

  /* --------------------------------- look ---------------------------------- */

  _bindLook() {
    const start = (e) => {
      if (!this.enabled || this._lookId !== null) return;
      // Controls sit above the canvas and stop propagation themselves; this
      // only ever sees drags on the sight picture.
      this._lookId = e.pointerId;
      this._lookLast.x = e.clientX;
      this._lookLast.y = e.clientY;
      capture(this.canvas, e.pointerId);
    };

    const move = (e) => {
      if (!this.enabled || e.pointerId !== this._lookId) return;
      const dx = e.clientX - this._lookLast.x;
      const dy = e.clientY - this._lookLast.y;
      this._lookLast.x = e.clientX;
      this._lookLast.y = e.clientY;
      // A finger travels far less than a mouse, so the same pixel delta has to
      // cover more of the sight picture.
      const k = CONFIG.touch.lookGain;
      this.input.injectLook(dx * k, dy * k);
      e.preventDefault();
    };

    const end = (e) => {
      if (e.pointerId !== this._lookId) return;
      this._lookId = null;
      release(this.canvas, e.pointerId);
    };

    this.canvas.addEventListener('pointerdown', start);
    this.canvas.addEventListener('pointermove', move, { passive: false });
    this.canvas.addEventListener('pointerup', end);
    this.canvas.addEventListener('pointercancel', end);
  }

  /* --------------------------------- steer --------------------------------- */

  _bindSteer() {
    const pad = this.steerPad;
    if (!pad) return;

    const apply = (clientX) => {
      const r = pad.getBoundingClientRect();
      const half = r.width / 2;
      const raw = (clientX - (r.left + half)) / half;
      const clamped = Math.max(-1, Math.min(1, raw));
      // A small dead zone stops a resting thumb from creeping the vehicle.
      const dead = CONFIG.touch.steerDeadZone;
      const value = Math.abs(clamped) < dead
        ? 0
        : Math.sign(clamped) * (Math.abs(clamped) - dead) / (1 - dead);
      this.input.touchSteer = value;
      if (this.steerKnob) this.steerKnob.style.transform = `translateX(${clamped * half}px)`;
      pad.classList.toggle('active', true);
    };

    pad.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      this._steerId = e.pointerId;
      capture(pad, e.pointerId);
      apply(e.clientX);
      e.preventDefault();
      e.stopPropagation();
    });

    pad.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this._steerId) return;
      apply(e.clientX);
      e.preventDefault();
      e.stopPropagation();
    }, { passive: false });

    const release = (e) => {
      if (e.pointerId !== this._steerId) return;
      this._steerId = null;
      this.input.touchSteer = null;
      if (this.steerKnob) this.steerKnob.style.transform = 'translateX(0px)';
      pad.classList.remove('active');
      release(pad, e.pointerId);
    };
    pad.addEventListener('pointerup', release);
    pad.addEventListener('pointercancel', release);
    pad.addEventListener('pointerleave', release);
  }

  /* -------------------------------- buttons -------------------------------- */

  _bindButtons() {
    if (!this.root) return;
    this._held = new Map();

    for (const btn of this.root.querySelectorAll('[data-hold], [data-tap]')) {
      const hold = btn.dataset.hold;
      const tap = btn.dataset.tap;

      btn.addEventListener('pointerdown', (e) => {
        if (!this.enabled) return;
        e.preventDefault();
        e.stopPropagation();
        btn.classList.add('pressed');
        capture(btn, e.pointerId);
        if (hold) {
          this._press(hold);
          this._held.set(e.pointerId, hold);
        } else if (tap) {
          this._tap(tap);
        }
      });

      const up = (e) => {
        btn.classList.remove('pressed');
        const code = this._held.get(e.pointerId);
        if (code) {
          this._release(code);
          this._held.delete(e.pointerId);
        }
        release(btn, e.pointerId);
      };
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      btn.addEventListener('pointerleave', up);
      // Stop a long press turning into a text selection or context menu.
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    }
  }

  _press(code) {
    if (code === 'fire') this.input.virtualMouseDown(0);
    else this.input.virtualDown(code);
  }

  _release(code) {
    if (code === 'fire') this.input.virtualMouseUp(0);
    else this.input.virtualUp(code);
  }

  _tap(code) {
    if (code === 'lase') { this.input.virtualMouseTap(2); return; }
    if (code === 'zoom') {
      this.zoomIndex = (this.zoomIndex + 1) % ZOOM_KEYS.length;
      this.input.virtualTap(ZOOM_KEYS[this.zoomIndex]);
      if (this.onZoom) this.onZoom(this.zoomIndex);
      return;
    }
    this.input.virtualTap(code);
  }

  /** Drops every held control — used when the controls are hidden or paused. */
  _releaseAll() {
    for (const code of this._held?.values() ?? []) this._release(code);
    this._held?.clear();
    for (const btn of this.root?.querySelectorAll('.pressed') ?? []) {
      btn.classList.remove('pressed');
    }
  }

  /** Called when the game pauses, so a held FIRE doesn't survive the pause. */
  releaseHeld() { this._releaseAll(); }
}
