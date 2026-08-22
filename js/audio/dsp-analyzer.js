/**
 * DSP Analyzer for Acoustic Frequency and Pattern Detection
 */
export class DSPAnalyzer {
  constructor(audioManager) {
    this.am = audioManager;
    this.isListening = false;
    this.callbacks = {};
    this.analysisInterval = null;

    // Buffer history for pattern matching
    this.freqHistory = [];
    this.pulseHistory528 = [];
    
    // FSK buffer state
    this.fskDecoding = false;
    this.fskBits = [];
    this.fskTimer = null;
  }

  on(event, fn) {
    this.callbacks[event] = fn;
  }

  emit(event, ...data) {
    if (this.callbacks[event]) {
      this.callbacks[event](...data);
    }
  }

  start() {
    if (this.isListening) return;
    this.isListening = true;

    const sampleRate = this.am.ctx.sampleRate;
    const fftSize = this.am.analyser.fftSize;
    const bufferLength = this.am.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const binWidth = sampleRate / fftSize;

    // Helper to get amplitude at target frequency
    const getFreqEnergy = (targetFreq) => {
      const binIndex = Math.round(targetFreq / binWidth);
      if (binIndex < 0 || binIndex >= bufferLength) return 0;
      // Average surrounding 3 bins for robustness
      const b0 = dataArray[Math.max(0, binIndex - 1)];
      const b1 = dataArray[binIndex];
      const b2 = dataArray[Math.min(bufferLength - 1, binIndex + 1)];
      return (b0 + b1 * 2 + b2) / 4;
    };

    let p528Active = false;
    let p528StartTime = 0;

    let p432Counter = 0;
    let p4000BurstCount = 0;
    let p5000BurstCount = 0;
    let p4900Counter = 0;

    let lastBurst4000Time = 0;
    let lastBurst5000Time = 0;

    this.analysisInterval = setInterval(() => {
      if (!this.am.analyser) return;
      this.am.analyser.getByteFrequencyData(dataArray);

      const now = performance.now();

      // 1. Detect 528Hz Sync Pulse
      const energy528 = getFreqEnergy(528);

      // Emit real-time 528Hz energy level update for volume visualizer chart
      this.emit('energy528Update', { time: now, energy: energy528 });

      if (energy528 > 140) { // Threshold
        if (!p528Active) {
          p528Active = true;
          p528StartTime = now;
        }
      } else {
        if (p528Active) {
          p528Active = false;
          const duration = (now - p528StartTime) / 1000;
          this.emit('pulse528', { startTime: p528StartTime, duration });
        }
      }

      // 2. Detect 432Hz Lock Tone (continuous tone for ~3s)
      const energy432 = getFreqEnergy(432);
      if (energy432 > 150) {
        p432Counter++;
        if (p432Counter >= 15) { // ~300ms of sustained 432Hz
          p432Counter = 0;
          this.emit('lock432');
        }
      } else {
        p432Counter = Math.max(0, p432Counter - 1);
      }

      // 3. Detect 4000Hz Start Signal (3 bursts)
      const energy4000 = getFreqEnergy(4000);
      if (energy4000 > 150) {
        if (now - lastBurst4000Time > 150) { // New burst
          p4000BurstCount++;
          lastBurst4000Time = now;
          if (p4000BurstCount >= 3) {
            p4000BurstCount = 0;
            this.emit('cmdStart');
          }
        }
      } else if (now - lastBurst4000Time > 700) {
        p4000BurstCount = 0;
      }

      // 4. Detect 5000Hz Pause Signal (3 bursts)
      const energy5000 = getFreqEnergy(5000);
      if (energy5000 > 150) {
        if (now - lastBurst5000Time > 150) {
          p5000BurstCount++;
          lastBurst5000Time = now;
          if (p5000BurstCount >= 3) {
            p5000BurstCount = 0;
            this.emit('cmdPause');
          }
        }
      } else if (now - lastBurst5000Time > 700) {
        p5000BurstCount = 0;
      }

      // 5. Detect 4900Hz Next Song Signal
      const energy4900 = getFreqEnergy(4900);
      if (energy4900 > 150) {
        p4900Counter++;
        if (p4900Counter >= 8) { // ~160ms continuous tone
          p4900Counter = 0;
          this.emit('cmdNextTrack');
        }
      } else {
        p4900Counter = Math.max(0, p4900Counter - 1);
      }

      // 6. Detect Progress Seek 4500Hz Prefix & FSK Decoding
      const energy4500 = getFreqEnergy(4500);
      if (energy4500 > 150 && !this.fskDecoding) {
        this.fskDecoding = true;
        this.decodeFSKProgress(getFreqEnergy);
      }

      // 7. Detect Part Voice Toggle Frequencies (Part 1..8)
      // Part k Enable: 4000 + (k-1)*60 + 30
      // Part k Mute:   4000 + (k-1)*60 + 60
      for (let k = 1; k <= 8; k++) {
        const freqEnable = 4000 + (k - 1) * 60 + 30;
        const freqMute = 4000 + (k - 1) * 60 + 60;

        if (getFreqEnergy(freqEnable) > 160) {
          this.emit('partToggle', { part: k, enable: true });
        } else if (getFreqEnergy(freqMute) > 160) {
          this.emit('partToggle', { part: k, enable: false });
        }
      }

    }, 20); // 20ms polling loop (~50Hz sampling rate)
  }

  /**
   * Decode 10-bit FSK Progress timestamp (4700Hz='0', 4800Hz='1')
   */
  decodeFSKProgress(getFreqEnergy) {
    const bits = [];
    let count = 0;

    // Skip prefix 0.05s
    setTimeout(() => {
      const bitTimer = setInterval(() => {
        const e0 = getFreqEnergy(4700);
        const e1 = getFreqEnergy(4800);

        if (e1 > e0 && e1 > 100) {
          bits.push('1');
        } else {
          bits.push('0');
        }

        count++;
        if (count >= 10) {
          clearInterval(bitTimer);
          this.fskDecoding = false;
          const timeSec = parseInt(bits.join(''), 2);
          this.emit('cmdProgressSync', timeSec);
        }
      }, 20); // 20ms per bit
    }, 50);
  }

  stop() {
    this.isListening = false;
    if (this.analysisInterval) {
      clearInterval(this.analysisInterval);
      this.analysisInterval = null;
    }
  }
}
