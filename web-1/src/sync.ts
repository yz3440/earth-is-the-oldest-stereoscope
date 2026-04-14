// Stereo time-sync state machine.
//
// We treat the videos as timelapses: each video frame represents
// `1 / timelapse_fps` real-world seconds. The encoded playback fps is whatever
// the source video carries (typically 30). So:
//
//   speedup = playback_fps / timelapse_fps        (real-seconds per video-second)
//   real_utc = startUTC + video.currentTime * speedup
//   video.currentTime = (real_utc - startUTC) / speedup
//
// Both videos are kept in sync against a single virtual UTC clock. When a
// video is in its valid range we let it play() naturally and only re-seek if
// drift exceeds a small threshold; outside its range we pause it.

export interface VideoTrack {
  el: HTMLVideoElement;
  startUTC: number;   // seconds since epoch
  speedup: number;    // playback_fps / timelapse_fps
  duration: number;   // video-seconds
}

export class StereoSync {
  left: VideoTrack | null = null;
  right: VideoTrack | null = null;
  isPlaying = false;
  playbackRate = 1.0;
  buffering = false;
  private virtualUTC = 0;
  private lastWall = 0;
  private driftThreshold = 0.1; // video-seconds

  setTracks(left: VideoTrack, right: VideoTrack) {
    this.left = left;
    this.right = right;
    this.virtualUTC = this.globalStartUTC();
    this.lastWall = 0;
    this.applyVirtual(true);
  }

  hasTracks(): boolean {
    return this.left != null && this.right != null;
  }

  globalStartUTC(): number {
    if (!this.left || !this.right) return 0;
    return Math.min(this.left.startUTC, this.right.startUTC);
  }

  globalEndUTC(): number {
    if (!this.left || !this.right) return 0;
    return Math.max(
      this.left.startUTC + this.left.duration * this.left.speedup,
      this.right.startUTC + this.right.duration * this.right.speedup,
    );
  }

  overlapStartUTC(): number {
    if (!this.left || !this.right) return 0;
    return Math.max(this.left.startUTC, this.right.startUTC);
  }

  overlapEndUTC(): number {
    if (!this.left || !this.right) return 0;
    return Math.min(
      this.left.startUTC + this.left.duration * this.left.speedup,
      this.right.startUTC + this.right.duration * this.right.speedup,
    );
  }

  currentUTC(): number {
    return this.virtualUTC;
  }

  setUTC(utc: number) {
    this.virtualUTC = Math.max(this.globalStartUTC(), Math.min(this.globalEndUTC(), utc));
    this.applyVirtual(true);
  }

  // Drive sync from an external master clock (viewer-2's shared timeline).
  // The caller owns the clock; we just keep both videos lined up against the
  // given UTC. `applyVirtual(false)` re-seeks only when drift exceeds the
  // soft threshold, so this is cheap to call every frame.
  syncToExternalUTC(utc: number, playing: boolean, rate: number) {
    this.virtualUTC = utc;
    this.isPlaying = playing;
    if (this.playbackRate !== rate) this.setPlaybackRate(rate);
    this.applyVirtual(false);
  }

  setPlaybackRate(rate: number) {
    this.playbackRate = rate;
    if (this.left) this.left.el.playbackRate = rate;
    if (this.right) this.right.el.playbackRate = rate;
  }

  play() {
    if (!this.left || !this.right) return;
    if (this.virtualUTC >= this.globalEndUTC()) {
      // Restart from beginning
      this.virtualUTC = this.globalStartUTC();
      this.applyVirtual(true);
    }
    this.isPlaying = true;
    this.lastWall = 0;
    this.applyVirtual(false);
  }

  pause() {
    this.isPlaying = false;
    this.left?.el.pause();
    this.right?.el.pause();
  }

  togglePlay() {
    if (this.isPlaying) this.pause();
    else this.play();
  }

  // True if any in-range video is still seeking or hasn't buffered enough
  // to advance playback. While buffering we hold the master clock so we
  // don't drift past the available data and trigger a seek loop.
  private isBuffering(): boolean {
    for (const t of [this.left, this.right]) {
      if (!t) continue;
      const target = (this.virtualUTC - t.startUTC) / t.speedup;
      if (target < 0 || target >= t.duration) continue; // out of range — irrelevant
      if (t.el.seeking) return true;
      // HAVE_FUTURE_DATA = 3
      if (t.el.readyState < 3) return true;
    }
    return false;
  }

  // Advance the master clock from wall time and resync both videos.
  tick(now: number) {
    if (!this.left || !this.right) return;
    if (this.isPlaying) {
      if (this.lastWall === 0) this.lastWall = now;
      const dtWall = (now - this.lastWall) / 1000;
      this.lastWall = now;
      this.buffering = this.isBuffering();
      if (!this.buffering) {
        // Use left.speedup as the master rate.
        this.virtualUTC += dtWall * this.playbackRate * this.left.speedup;
        if (this.virtualUTC >= this.globalEndUTC()) {
          this.virtualUTC = this.globalEndUTC();
          this.pause();
        }
      }
    } else {
      this.buffering = false;
    }
    this.applyVirtual(false);
  }

  private applyVirtual(forceSeek: boolean) {
    if (this.left) this.applyOne(this.left, forceSeek);
    if (this.right) this.applyOne(this.right, forceSeek);
  }

  private applyOne(t: VideoTrack, forceSeek: boolean) {
    const target = (this.virtualUTC - t.startUTC) / t.speedup;
    const inRange = target >= 0 && target < t.duration;
    if (!inRange) {
      if (!t.el.paused) t.el.pause();
      // Park at the boundary frame so the texture isn't undefined.
      const clamped = target < 0 ? 0 : Math.max(0, t.duration - 1 / 30);
      if (Math.abs(t.el.currentTime - clamped) > 0.05 && !t.el.seeking) {
        t.el.currentTime = clamped;
      }
      return;
    }

    // Never issue a new seek while one is in flight — that's the seek loop.
    if (t.el.seeking) return;

    if (forceSeek) {
      t.el.currentTime = target;
      t.el.playbackRate = this.playbackRate;
      if (this.isPlaying) {
        t.el.play().catch((err) => console.warn('[stereo-sync] play() failed:', err));
      } else if (!t.el.paused) {
        t.el.pause();
      }
      return;
    }

    if (this.isPlaying) {
      if (t.el.paused) {
        // Seek only if we're meaningfully off; otherwise let the video
        // resume from wherever it actually is. This avoids a seek-loop
        // when virtualUTC is being held by isBuffering().
        if (Math.abs(t.el.currentTime - target) > this.driftThreshold) {
          t.el.currentTime = target;
        }
        t.el.playbackRate = this.playbackRate;
        t.el.play().catch((err) => console.warn('[stereo-sync] play() failed:', err));
      } else {
        const drift = t.el.currentTime - target;
        if (Math.abs(drift) > this.driftThreshold) {
          t.el.currentTime = target;
        }
      }
    } else {
      if (!t.el.paused) t.el.pause();
    }
  }
}
