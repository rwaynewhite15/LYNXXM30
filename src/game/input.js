/**
 * Input: pointer-lock mouse look plus a latched keyboard state.
 *
 * Mouse deltas accumulate between frames and are drained by the game loop, so
 * a 240 Hz mouse on a 60 Hz display still traverses the right amount.
 */

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();      // edge-triggered, cleared each frame
    this.look = { dx: 0, dy: 0 };
    this.buttons = new Set();
    this.clicked = new Set();
    this.locked = false;
    this.enabled = false;
    this.onLockChange = null;

    this._onKeyDown = (e) => {
      if (!this.enabled) return;
      // Let the browser keep its own shortcuts.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const code = e.code;
      if (!this.keys.has(code)) this.pressed.add(code);
      this.keys.add(code);
      if (HANDLED.has(code)) e.preventDefault();
    };
    this._onKeyUp = (e) => { this.keys.delete(e.code); };
    this._onBlur = () => { this.keys.clear(); this.buttons.clear(); };

    this._onMove = (e) => {
      if (!this.locked) return;
      this.look.dx += e.movementX || 0;
      this.look.dy += e.movementY || 0;
    };
    this._onDown = (e) => {
      if (!this.enabled) return;
      if (!this.locked) { this.requestLock(); return; }
      if (!this.buttons.has(e.button)) this.clicked.add(e.button);
      this.buttons.add(e.button);
      e.preventDefault();
    };
    this._onUp = (e) => { this.buttons.delete(e.button); };
    this._onContext = (e) => { if (this.enabled) e.preventDefault(); };
    this._onLock = () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (this.onLockChange) this.onLockChange(this.locked);
    };

    addEventListener('keydown', this._onKeyDown);
    addEventListener('keyup', this._onKeyUp);
    addEventListener('blur', this._onBlur);
    addEventListener('mousemove', this._onMove);
    canvas.addEventListener('mousedown', this._onDown);
    addEventListener('mouseup', this._onUp);
    canvas.addEventListener('contextmenu', this._onContext);
    document.addEventListener('pointerlockchange', this._onLock);
  }

  requestLock() {
    if (!this.enabled) return;
    const p = this.canvas.requestPointerLock?.({ unadjustedMovement: true });
    if (p && typeof p.catch === 'function') {
      p.catch(() => this.canvas.requestPointerLock?.());
    }
  }

  releaseLock() {
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  /** True while held. */
  down(code) { return this.keys.has(code); }
  /** True on the frame the key went down. */
  hit(code) { return this.pressed.has(code); }
  /** True while a mouse button is held (0 left, 2 right). */
  mouse(btn) { return this.buttons.has(btn); }
  /** True on the frame a mouse button went down. */
  click(btn) { return this.clicked.has(btn); }

  /** Returns and clears this frame's mouse delta. */
  drainLook() {
    const out = { dx: this.look.dx, dy: this.look.dy };
    this.look.dx = 0;
    this.look.dy = 0;
    return out;
  }

  endFrame() {
    this.pressed.clear();
    this.clicked.clear();
  }

  dispose() {
    removeEventListener('keydown', this._onKeyDown);
    removeEventListener('keyup', this._onKeyUp);
    removeEventListener('blur', this._onBlur);
    removeEventListener('mousemove', this._onMove);
    removeEventListener('mouseup', this._onUp);
    document.removeEventListener('pointerlockchange', this._onLock);
  }
}

/** Keys the game consumes, so the page doesn't scroll under the player. */
const HANDLED = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyC', 'KeyV', 'KeyX', 'KeyT', 'KeyR',
  'KeyH', 'KeyP', 'Tab', 'Space', 'Digit1', 'Digit2', 'Digit3',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
]);
