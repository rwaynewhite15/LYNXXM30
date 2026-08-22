/**
 * Phone-native runtime behaviour: keeping the screen on, standing down when
 * the handset is put away, and locking the orientation where the browser
 * allows it.
 *
 * None of these APIs are universally available — Safari has no Screen Wake
 * Lock on older versions and no orientation lock on iPhone at all — so every
 * one of them is treated as optional and failure is silent.
 */

import { Settings } from './settings.js';

export class MobileRuntime {
  /**
   * @param {object} game  needs `state`, `pause()`, and nothing else
   */
  constructor(game) {
    this.game = game;
    this._wakeLock = null;

    // A phone call, a notification, or the screen locking should stand the
    // run down rather than letting the vehicle drive into a wall unattended.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.releaseWakeLock();
        if (this.game.state === 'running') this.game.pause(true);
      } else if (this.game.state === 'running') {
        // A wake lock does not survive the page being hidden; take it again.
        this.requestWakeLock();
      }
    });

    // Losing focus without being hidden — a split-screen app taking over.
    addEventListener('blur', () => {
      if (this.game.state === 'running') this.game.pause(true);
    });
  }

  async requestWakeLock() {
    if (!Settings.get('keepAwake')) return;
    if (!navigator.wakeLock || this._wakeLock) return;
    try {
      this._wakeLock = await navigator.wakeLock.request('screen');
      this._wakeLock.addEventListener('release', () => { this._wakeLock = null; });
    } catch {
      // Denied, unsupported, or the document is not visible. Nothing to do.
      this._wakeLock = null;
    }
  }

  releaseWakeLock() {
    try { this._wakeLock?.release(); } catch { /* already gone */ }
    this._wakeLock = null;
  }

  /**
   * Asks for landscape once the page is fullscreen. Only fullscreen documents
   * may lock orientation, and iPhone Safari has neither, so this is a nicety
   * rather than something the layout may depend on.
   */
  async lockLandscape() {
    try {
      await screen.orientation?.lock?.('landscape');
      return true;
    } catch {
      return false;
    }
  }

  unlockOrientation() {
    try { screen.orientation?.unlock?.(); } catch { /* ignore */ }
  }
}
