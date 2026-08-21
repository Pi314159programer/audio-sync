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
   * Start Coupled Oscillator Acoustic Sync Calibration Phase
   * @param {boolean} isMaster 
   */
  async startCalibration(isMaster) {
    this.isMaster = isMaster;
    this.isSyncing = true;
    this.isCalibrated = false;
    this.convergenceCount = 0;

    await this.am.startMicrophone();
    this.dsp.start();

    const now = performance.now();
    this.t0 = now;
    this.nextPulseTime = now + 100; // start in 100ms

    // Bind DSP pulse listener for coupled oscillator phase alignment
    this.dsp.on('pulse528', (data) => {
      if (!this.isSyncing) return;

      const heardMidpoint = data.startTime + (data.duration * 1000) / 2;
      const expectedNext = heardMidpoint + (this.period * 1000);

      // Adaptive phase nudge (Kuramoto coupling parameter alpha = 0.4)
      const currentNext = this.nextPulseTime;
      const phaseDiff = expectedNext - currentNext;
      this.nextPulseTime = currentNext + phaseDiff * 0.4;

      this.convergenceCount++;

      // Auto-lock check for Master after ~8-12 cycles of alignment
      if (this.isMaster && this.convergenceCount >= 10) {
        this.lockCalibrationMaster();
      }
    });

    // Bind 432Hz lock tone listener
    this.dsp.on('lock432', () => {
      if (this.isSyncing && !this.isMaster) {
        this.lockCalibrationSlave();
      }
    });

    // Core acoustic pulse emission loop
    const runPulseLoop = () => {
      if (!this.isSyncing) return;

      const currentTime = performance.now();
      if (currentTime >= this.nextPulseTime) {
        // Emit 528Hz acoustic pulse
        this.toneGen.play528Pulse(this.pulseDuration);
        this.nextPulseTime += this.period * 1000;
      }

      this.syncLoopTimer = setTimeout(runPulseLoop, 15);
    };

    runPulseLoop();
  }

  /**
   * Master Lock Calibration: Emit 3s 432Hz tone and anchor dark timer
   */
  lockCalibrationMaster() {
    if (!this.isSyncing) return;
    this.isSyncing = false;
    if (this.syncLoopTimer) clearTimeout(this.syncLoopTimer);

    // Play 432Hz 3-second lock tone
    this.toneGen.play432LockTone();

    // After 3s lock tone + 2 cycles, stop emission and complete calibration
    setTimeout(() => {
      this.t0 = performance.now();
      this.isCalibrated = true;
      this.emit('syncComplete');
    }, 3000 + (this.period * 2000));
  }

  /**
   * Slave Lock Calibration: Triggered upon detecting 432Hz tone
   */
  lockCalibrationSlave() {
    if (!this.isSyncing) return;
    this.isSyncing = false;
    if (this.syncLoopTimer) clearTimeout(this.syncLoopTimer);

    // Wait 2 cycles after detecting 432Hz tone before stopping pulses & setting dark clock
    setTimeout(() => {
      this.t0 = performance.now();
      this.isCalibrated = true;
      this.emit('syncComplete');
    }, this.period * 2000);
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
