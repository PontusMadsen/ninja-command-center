/**
 * Spotify screen module — shows now-playing info on a triptych display.
 * Only active when Spotify is playing. Hides when paused/stopped.
 */

import logger from '../logger.js';

export default class SpotifyScreen {
  constructor({ sendCommand, screen = 2, getNowPlaying }) {
    this.sendCommand = sendCommand;
    this.screen = screen;
    this.getNowPlaying = getNowPlaying;
    this.timer = null;
    this.active = false;
    this.lastTrackId = null;
    this.onShow = null;   // callback when spotify appears
    this.onHide = null;   // callback when spotify disappears
  }

  start() {
    logger.info({ screen: this.screen }, 'Spotify screen started');
    this.timer = setInterval(() => this.tick(), 1000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  tick() {
    const np = this.getNowPlaying();

    if (!np?.playing) {
      if (this.active) {
        this.active = false;
        this.lastTrackId = null;
        logger.info('Spotify screen hidden');
        if (this.onHide) this.onHide();
      }
      return;
    }

    if (!this.active) {
      this.active = true;
      logger.info({ track: np.track, artist: np.artist }, 'Spotify screen shown');
      if (this.onShow) this.onShow();
    }

    this.sendCommand({
      screen: this.screen,
      type: 'spotify',
      track: np.track,
      artist: np.artist,
      album: np.album,
      album_art_url: np.albumArtSmall || np.albumArt,
      progress_ms: np.progressMs,
      duration_ms: np.durationMs,
      track_id: np.trackId,
    });

    this.lastTrackId = np.trackId;
  }

  isActive() {
    return this.active;
  }
}
