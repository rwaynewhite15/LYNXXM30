/**
 * Input: pointer-lock mouse look plus a latched keyboard state.
 *
 * Mouse deltas accumulate between frames and are drained by the game loop, so
 * a 240 Hz mouse on a 60 Hz display still traverses the right amount.
 *
 * Pointer lock is not always available — a sandboxed iframe without the
 * pointer-lock permission will refuse it, and so will some browser
 * configurations. When it is refused the class falls back to deriving deltas
 * from raw cursor movement over the canvas, which is less pleasant but keeps
 * the game playable instead of leaving the sight frozen.
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
    /** Set by the touch layer while the steer pad is held; null otherwise. */
    this.touchSteer = null;
    /**
     * 'mouse' or 'touch'. In touch mode the class ignores mouse events and
     * never asks for pointer lock — phones synthesise mousedown and mousemove
     * from taps, which would otherwise double-apply the sight movement the
     * touch layer is already sending and fire the gun on every drag.
     */
    this.pointerMode = 'mouse';
    /** True once pointer lock has been refused and we are tracking manually. */
    this.fallback = false;
    this.onLockChange = null;
    this.onFallback = null;
    this._lastClient = null;

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
      if (this.pointerMode === 'touch') return;
      if (this.locked) {
        this.look.dx += e.movementX || 0;
        this.look.dy += e.movementY || 0;
        this._lastClient = null;
        return;
      }
      if (!this.fallback || !this.enabled) return;
      // No lock: difference the cursor position ourselves. movementX/Y is
      // unreliable without lock across browsers, so don't trust it here.
      if (this._lastClient) {
        this.look.dx += e.clientX - this._lastClient.x;
        this.look.dy += e.clientY - this._lastClient.y;
      }
      this._lastClient = { x: e.clientX, y: e.clientY };
    };
    this._onDown = (e) => {
      if (!this.enabled || this.pointerMode === 'touch') return;
      // Keyboard events need the canvas focused, which matters inside an
      // iframe where the page does not get focus for free.
      this.canvas.focus?.({ preventScroll: true });
      if (!this.locked && !this.fallback) { this.requestLock(); return; }
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
    if (!this.enabled || this.fallback || this.pointerMode === 'touch') return;
    if (!this.canvas.requestPointerLock) { this._useFallback(); return; }
    let p;
    try {
      p = this.canvas.requestPointerLock({ unadjustedMovement: true });
    } catch {
      this._useFallback();
      return;
    }
    if (p && typeof p.catch === 'function') {
      p.catch(() => {
        // Retry without the option, then give up and track manually.
        try {
          const q = this.canvas.requestPointerLock();
          if (q && typeof q.catch === 'function') q.catch(() => this._useFallback());
        } catch { this._useFallback(); }
      });
    }
    // Some environments neither resolve nor reject: if the lock has not
    // arrived shortly, assume it is not coming.
    clearTimeout(this._lockTimer);
    this._lockTimer = setTimeout(() => {
      if (!this.locked && this.enabled) this._useFallback();
    }, 700);
  }

  _useFallback() {
    if (this.fallback) return;
    this.fallback = true;
    this._lastClient = null;
    if (this.onFallback) this.onFallback();
  }

  releaseLock() {
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  /* ------------------------------ virtual input ---------------------------- */
  /**
   * The touch layer drives the game through these rather than through a
   * parallel code path, so every control ends up in the same latched state the
   * keyboard and mouse produce and nothing downstream has to know the
   * difference.
   */

  /** Press and hold a key, as if the player were holding it down. */
  virtualDown(code) {
    if (!this.keys.has(code)) this.pressed.add(code);
    this.keys.add(code);
  }

  virtualUp(code) { this.keys.delete(code); }

  /** A single-frame key press, for taps on a momentary control. */
  virtualTap(code) { this.pressed.add(code); }

  virtualMouseDown(btn) {
    if (!this.buttons.has(btn)) this.clicked.add(btn);
    this.buttons.add(btn);
  }

  virtualMouseUp(btn) { this.buttons.delete(btn); }

  /** A single-frame mouse click, for tap-style buttons like the range-finder. */
  virtualMouseTap(btn) { this.clicked.add(btn); }

  /** Feeds sight movement from a source other than the mouse. */
  injectLook(dx, dy) {
    this.look.dx += dx;
    this.look.dy += dy;
  }

  /**
   * Steering order, -1 (port) to +1 (starboard).
   *
   * A touch pad supplies a proportional value; the keys are all-or-nothing.
   * The driving model already accepts a float, so the pad gives finer control
   * over a lane change than the keyboard does.
   */
  get steer() {
    if (this.touchSteer !== null && this.touchSteer !== undefined) return this.touchSteer;
    return (this.down('KeyD') || this.down('ArrowRight') ? 1 : 0)
         - (this.down('KeyA') || this.down('ArrowLeft') ? 1 : 0);
  }

  /**
   * Switches between the mouse and touch input paths.
   * @param {'mouse'|'touch'} mode
   */
  setPointerMode(mode) {
    this.pointerMode = mode;
    if (mode === 'touch') { this.buttons.clear(); this.locked = false; }
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
    clearTimeout(this._lockTimer);
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
  'KeyQ', 'KeyG',
  'KeyH', 'KeyP', 'Tab', 'Space', 'Digit1', 'Digit2', 'Digit3',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
]);
