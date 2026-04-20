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
  startUTC: number;           // seconds since epoch
  speedup: number;            // real-sec per video-sec (linear approx, used for playbackRate)
  duration: number;           // video-seconds
  videoFps: number;           // encoded fps
  frameRealTimesSec: Float32Array; // per-frame real-sec since video start
}

/**
 * Invert the piecewise-linear frame_idx → real-sec map:
 * given real-sec since video start, return a fractional frame index plus
 * the local slope in real-seconds-per-frame (used to match `playbackRate`
 * to the anchor table's *local* rate — a globally-fit constant `playbackRate`
 * would accumulate drift in every segment where the local rate differs
 * from the average, triggering the seek-on-drift path every few seconds).
 *
 * Mirrors build_frame_real_times() in video-processing/04_simulate_rotation.py.
 *
 * Assumes `arr` is monotonic (the calibrator guarantees it). Binary search
 * for the bracket, linearly interpolate. Clamps outside the range.
 */
const MIN_PLAYBACK_RATE = 0.1;
const MAX_PLAYBACK_RATE = 8.0;
function clampPlaybackRate(r: number): number {
  if (!Number.isFinite(r) || r <= 0) return MIN_PLAYBACK_RATE;
  return Math.max(MIN_PLAYBACK_RATE, Math.min(MAX_PLAYBACK_RATE, r));
}

function frameIdxAndSlopeForRealSec(
  arr: Float32Array,
  realSec: number,
): { frameIdx: number; secPerFrame: number } {
  const n = arr.length;
  if (n === 0) return { frameIdx: 0, secPerFrame: 1 };
  if (realSec <= arr[0]) {
    const span = n >= 2 ? arr[1] - arr[0] : 1;
    return { frameIdx: 0, secPerFrame: span > 0 ? span : 1 };
  }
  if (realSec >= arr[n - 1]) {
    const span = n >= 2 ? arr[n - 1] - arr[n - 2] : 1;
    return { frameIdx: n - 1, secPerFrame: span > 0 ? span : 1 };
  }
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= realSec) lo = mid;
    else hi = mid;
  }
  const span = arr[hi] - arr[lo];
  const secPerFrame = span > 0 ? span / (hi - lo) : 1;
  const frameIdx = span > 0 ? lo + (realSec - arr[lo]) / span * (hi - lo) : lo;
  return { frameIdx, secPerFrame };
}

export class StereoSync {
  left: VideoTrack | null = null;
  right: VideoTrack | null = null;
  isPlaying = false;
  // Master clock rate in sim-seconds per wall-second (e.g. 120 means 120x).
  // Each track's HTMLVideoElement.playbackRate is derived per-track as
  // `simRate / track.speedup` so tracks with different timelapse fps stay in
  // sync against the same virtual UTC clock.
  simRate = 1.0;
  buffering = false;
  private virtualUTC = 0;
  private lastWall = 0;
  // Tolerated drift before we re-seek. Large because mid-playback seeks
  // momentarily blank the <video> element and appear as black flashes in
  // the stereo texture. With per-tick local-rate `playbackRate` updates the
  // steady-state drift is ~0, so this only trips on genuine scrubs.
  private driftThreshold = 1.5; // video-seconds

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
  syncToExternalUTC(utc: number, playing: boolean, simRate: number) {
    this.virtualUTC = utc;
    this.isPlaying = playing;
    if (this.simRate !== simRate) this.setSimRate(simRate);
    this.applyVirtual(false);
  }

  setSimRate(simRate: number) {
    this.simRate = simRate;
    // No need to update playbackRate here; applyOne() refreshes it every tick
    // from the *local* anchor slope.
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
      const realSec = this.virtualUTC - t.startUTC;
      const { frameIdx } = frameIdxAndSlopeForRealSec(t.frameRealTimesSec, realSec);
      const target = frameIdx / t.videoFps;
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
        this.virtualUTC += dtWall * this.simRate;
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
    // Piecewise-linear inverse: sim-UTC → real-sec since video start → fractional
    // frame via the calibrator anchors → video-time.
    const realSec = this.virtualUTC - t.startUTC;
    const { frameIdx, secPerFrame } = frameIdxAndSlopeForRealSec(t.frameRealTimesSec, realSec);
    const target = frameIdx / t.videoFps;
    const desiredRate = this.simRate / (secPerFrame * t.videoFps);
    const inRange = target >= 0 && target < t.duration;
    const trace = (why: string, to: number) => {
      const tag = t.el.src.split('/').slice(-2).join('/');
      console.warn(
        `[seek:${tag}] ${why} virtualUTC=${this.virtualUTC.toFixed(0)} startUTC=${t.startUTC.toFixed(0)} realSec=${realSec.toFixed(2)} target=${to.toFixed(3)} duration=${t.duration.toFixed(2)} simRate=${this.simRate}`,
      );
    };
    if (!inRange) {
      if (!t.el.paused) t.el.pause();
      const clamped = target < 0 ? 0 : Math.max(0, t.duration - 1 / 30);
      if (Math.abs(t.el.currentTime - clamped) > 0.05 && !t.el.seeking) {
        trace('out-of-range', clamped);
        t.el.currentTime = clamped;
      }
      return;
    }

    if (t.el.seeking) return;

    // At sim rates so slow that the browser's playback-rate floor (~0.0625)
    // would run the video visibly faster than asked, don't fight the clamp.
    // Instead pause the element and seek to the integer-target frame; each
    // frame then holds for the full wall-time the sim expects, and the
    // cross-fade layer in main.ts smooths the seek transitions.
    const pauseAndSeek = this.isPlaying && desiredRate < MIN_PLAYBACK_RATE;

    if (forceSeek) {
      trace('forceSeek', target);
      t.el.currentTime = target;
      if (pauseAndSeek) {
        if (!t.el.paused) t.el.pause();
      } else {
        t.el.playbackRate = clampPlaybackRate(desiredRate);
        if (this.isPlaying) {
          t.el.play().catch((err) => console.warn('[stereo-sync] play() failed:', err));
        } else if (!t.el.paused) {
          t.el.pause();
        }
      }
      return;
    }

    if (pauseAndSeek) {
      if (!t.el.paused) t.el.pause();
      // Only seek when the integer target frame has changed — otherwise we'd
      // re-seek every tick and trigger a flash storm.
      const targetInt = Math.floor(frameIdx) / t.videoFps;
      if (Math.abs(t.el.currentTime - targetInt) > 0.5 / t.videoFps) {
        trace('pauseAndSeek', targetInt);
        t.el.currentTime = targetInt;
      }
      return;
    }

    if (this.isPlaying) {
      t.el.playbackRate = clampPlaybackRate(desiredRate);
      if (t.el.paused) {
        if (Math.abs(t.el.currentTime - target) > this.driftThreshold) {
          trace('drift-paused', target);
          t.el.currentTime = target;
        }
        t.el.play().catch((err) => console.warn('[stereo-sync] play() failed:', err));
      } else {
        const drift = t.el.currentTime - target;
        if (Math.abs(drift) > this.driftThreshold) {
          trace('drift', target);
          t.el.currentTime = target;
        }
      }
    } else {
      if (!t.el.paused) t.el.pause();
    }
  }
}
