/**
 * Player settings that survive a reload.
 *
 * Everything here is a phone concern first: which hand holds the device, how
 * far a thumb has to travel to sweep the sight, whether the handset buzzes.
 * Desktop inherits the same store but only really uses the graphics preset.
 *
 * Storage is wrapped throughout — a private window, blocked site data, or an
 * embedded context all throw on access rather than returning null, and none of
 * that should stop the game loading.
 */

const KEY = 'xm30.settings';

const DEFAULTS = {
  /** 'right' puts the weapons under the right thumb, 'left' mirrors it. */
  handedness: 'right',
  /** Multiplier on touch look gain. 1 is the tuned default. */
  lookSensitivity: 1,
  /** Haptic feedback on firing, hits and kills. */
  haptics: true,
  /** Keep the screen awake while a run is in progress. */
  keepAwake: true,
};

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    // Only accept keys we know, so an old or hand-edited blob cannot inject
    // anything unexpected into the settings object.
    const out = { ...DEFAULTS };
    for (const k of Object.keys(DEFAULTS)) {
      if (parsed[k] !== undefined && typeof parsed[k] === typeof DEFAULTS[k]) out[k] = parsed[k];
    }
    return out;
  } catch {
    return { ...DEFAULTS };
  }
}

export const Settings = {
  values: read(),

  get(key) { return this.values[key]; },

  set(key, value) {
    if (!(key in DEFAULTS)) return;
    this.values[key] = value;
    try { localStorage.setItem(KEY, JSON.stringify(this.values)); } catch { /* ignore */ }
    for (const fn of listeners) fn(key, value);
  },

  toggle(key) {
    this.set(key, !this.values[key]);
    return this.values[key];
  },

  reset() {
    this.values = { ...DEFAULTS };
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  },

  /** Notified whenever a setting changes. */
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
};

const listeners = new Set();

/**
 * Short haptic patterns. Kept here rather than at each call site so one
 * setting silences all of them, and so a device without the API is a no-op
 * instead of a crash.
 */
export const Haptics = {
  _fire() {
    if (!Settings.get('haptics') || !navigator.vibrate) return false;
    return true;
  },
  fire()   { if (this._fire()) navigator.vibrate(14); },
  coax()   { if (this._fire()) navigator.vibrate(6); },
  hit()    { if (this._fire()) navigator.vibrate(55); },
  kill()   { if (this._fire()) navigator.vibrate([0, 22, 45, 22]); },
  strike() { if (this._fire()) navigator.vibrate([0, 40, 30, 60]); },
};

export { DEFAULTS as SETTING_DEFAULTS };
