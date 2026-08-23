/**
 * Coupled Oscillator Clock Sync Engine & Dark Timer
 */
export class SyncEngine {
  constructor(audioManager, toneGenerator, dspAnalyzer) {
    this.am = audioManager;
    this.toneGen = toneGenerator;
    this.dsp = dspAnalyzer;

    // Config parameters
    this.zone = 'A'; // 'A', 'B', or 'C'
    this.period = 0.5; // in seconds
    this.pulseDuration = 0.05; // in seconds
    this.isMaster = false;

    // State flags
    this.isSyncing = false;
    this.isCalibrated = false;
    this.t0 = 0; // Reference timestamp anchored on performance.now()
    this.nextPulseTime = 0;

    this.syncLoopTimer = null;
    this.convergenceCount = 0;
    this.callbacks = {};
  }

  on(event, fn) {
    this.callbacks[event] = fn;
  }

  emit(event, ...data) {
    if (this.callbacks[event]) {
      this.callbacks[event](...data);
    }
  }

  /**
   * Set Range Interval & Zone
   * @param {string} rangeStr '10m', '20m', '50m', '70m', '100m', '150m', '200m'
   */
  configureRange(rangeStr) {
    if (['10m', '20m', '50m'].includes(rangeStr)) {
      this.zone = 'A';
      this.period = 0.5;
      this.pulseDuration = 0.05;
    } else if (['70m', '100m'].includes(rangeStr)) {
      this.zone = 'B';
      this.period = 1.0;
      this.pulseDuration = 0.10;
    } else { // '150m', '200m'
      this.zone = 'C';
      this.period = 2.0;
      this.pulseDuration = 0.10;
    }
  }

  /**
   * Get timestamp for start of next common clock cycle
   * @returns {number} Delay in milliseconds from performance.now()
   */
  getTimeToNextCycleStart() {
    if (!this.t0) return 0;
    const now = performance.now();
    const periodMs = this.period * 1000;
    const elapsed = now - this.t0;
    const currentCycle = Math.floor(elapsed / periodMs);
    const nextCycleTime = this.t0 + (currentCycle + 1) * periodMs;
    return Math.max(0, nextCycleTime - now);
  }
}
