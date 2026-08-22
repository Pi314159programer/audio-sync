/**
 * Tone Generator using Web Audio API Oscillators
 */
export class ToneGenerator {
  constructor(audioManager) {
    this.am = audioManager;
  }

  /**
   * Helper to play a single tone burst
   * @param {number} freq Frequency in Hz
   * @param {number} duration Duration in seconds
   * @param {number} [startTime] Context start time offset in seconds
   */
  playTone(freq, duration, startTime = null) {
    if (!this.am.ctx) return;
    const ctx = this.am.ctx;
    const now = startTime !== null ? startTime : ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);

    // Fast attack & decay envelope to avoid clicks
    const rampTime = 0.005;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.8, now + rampTime);
    gain.gain.setValueAtTime(0.8, now + duration - rampTime);
    gain.gain.linearRampToValueAtTime(0, now + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + duration);
  }

  /**
   * Play 528Hz Sync Pulse Burst
   */
  play528Pulse(duration = 0.05, startTime = null) {
    this.playTone(528, duration, startTime);
  }

  /**
   * Play 3s 432Hz Calibration Complete Lock Tone
   */
  play432LockTone(startTime = null) {
    this.playTone(432, 3.0, startTime);
  }

  /**
   * Play Start Play Tone Sequence (4000 Hz)
   * 0.1s 4000Hz - 0.1s silence - 0.1s 4000Hz - 0.1s silence - 0.1s 4000Hz
   */
  playStartSignal(startTime = null) {
    const ctx = this.am.ctx;
    const base = startTime !== null ? startTime : ctx.currentTime;
    this.playTone(4000, 0.1, base);
    this.playTone(4000, 0.1, base + 0.2);
    this.playTone(4000, 0.1, base + 0.4);
  }

  /**
   * Play Pause Tone Sequence (5000 Hz)
   * 0.1s 5000Hz - 0.1s silence - 0.1s 5000Hz - 0.1s silence - 0.1s 5000Hz
   */
  playPauseSignal(startTime = null) {
    const ctx = this.am.ctx;
    const base = startTime !== null ? startTime : ctx.currentTime;
    this.playTone(5000, 0.1, base);
    this.playTone(5000, 0.1, base + 0.2);
    this.playTone(5000, 0.1, base + 0.4);
  }

  /**
   * Play Progress Calibration Binary FSK Signal (3.0s total)
   * 0.5s 4500Hz header + 10 bits (0.2s each of 4700Hz='0' or 4800Hz='1') + 0.5s 4500Hz footer
   * @param {number} timeSeconds Current playback time in seconds
   * @param {number} [startTime] AudioContext start time offset
   */
  playProgressSignal(timeSeconds, startTime = null) {
    if (!this.am.ctx) return;
    const ctx = this.am.ctx;
    const base = startTime !== null ? startTime : ctx.currentTime;

    // 0.5s 4500Hz Header
    this.playTone(4500, 0.5, base);

    // Encode seconds (0..1023) into 10 bits
    const integerSec = Math.min(1023, Math.max(0, Math.floor(timeSeconds)));
    const binStr = integerSec.toString(2).padStart(10, '0');

    let offset = base + 0.5;
    for (let i = 0; i < 10; i++) {
      const bit = binStr[i];
      const freq = bit === '1' ? 4800 : 4700;
      this.playTone(freq, 0.2, offset);
      offset += 0.2;
    }

    // 0.5s 4500Hz Footer (starts at base + 2.5s, ends at base + 3.0s)
    this.playTone(4500, 0.5, offset);
  }

  /**
   * Play Next Track Signal (4900 Hz, 0.5s)
   */
  playNextTrackSignal(startTime = null) {
    this.playTone(4900, 0.5, startTime);
  }

  /**
   * Play Part Toggle Audio Tone (0.25s total)
   * @param {number} part Index (1-8)
   * @param {boolean} enable True for Enable Audio, False for Mute Audio
   */
  playPartToggleSignal(part, enable, startTime = null) {
    // Part k Enable Freq = 4000 + (k-1)*60 + 30
    // Part k Mute Freq   = 4000 + (k-1)*60 + 60
    const offsetFreq = enable ? 30 : 60;
    const freq = 4000 + (part - 1) * 60 + offsetFreq;

    const ctx = this.am.ctx;
    const base = startTime !== null ? startTime : ctx.currentTime;

    this.playTone(freq, 0.05, base);
    this.playTone(freq, 0.05, base + 0.10);
    this.playTone(freq, 0.05, base + 0.20);
  }

  /**
   * Play 5 Transmitted Musical Tones in sequence (0.3s tone + 0.1s gap)
   * @param {number[]} tones Frequencies array of 5 tones
   * @param {Function} [onComplete] Callback when sequence finishes
   */
  playFiveTones(tones = [261, 293, 329, 392, 440], onComplete = null) {
    if (!this.am.ctx) return;
    const ctx = this.am.ctx;
    const base = ctx.currentTime;
    const toneDuration = 0.3;
    const gap = 0.1;

    const list = Array.isArray(tones) && tones.length === 5 ? tones : [261, 293, 329, 392, 440];

    list.forEach((freq, idx) => {
      const startTime = base + idx * (toneDuration + gap);
      this.playTone(freq, toneDuration, startTime);
    });

    const totalTimeMs = (list.length * (toneDuration + gap)) * 1000;
    if (onComplete) {
      setTimeout(onComplete, totalTimeMs + 100);
    }
  }
}
