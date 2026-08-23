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

    // Helper to get peak energy amplitude around target frequency (5-bin peak search)
    const getFreqEnergy = (targetFreq) => {
      const centerIndex = Math.round(targetFreq / binWidth);
      if (centerIndex < 0 || centerIndex >= bufferLength) return 0;

      let maxE = 0;
      for (let offset = -2; offset <= 2; offset++) {
        const idx = centerIndex + offset;
        if (idx >= 0 && idx < bufferLength) {
          const val = dataArray[idx];
          if (val > maxE) maxE = val;
        }
      }
      return maxE;
    };

    let p4000BurstCount = 0;
    let p5000BurstCount = 0;
    let p4900Counter = 0;

    let lastBurst4000Time = 0;
    let lastBurst5000Time = 0;

    this.analysisInterval = setInterval(() => {
      if (!this.am.analyser) return;
      this.am.analyser.getByteFrequencyData(dataArray);

      const now = performance.now();

      // 1. Detect 4000Hz Start Signal (3 bursts)
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
   * Decode 10-bit FSK Progress timestamp (0.5s 4500Hz header + 10x0.2s bits + 0.5s footer)
   */
  decodeFSKProgress(getFreqEnergy) {
    const bits = [];
    let count = 0;

    // Skip remainder of 0.5s header (~400ms after initial 4500Hz detection)
    setTimeout(() => {
      // Sample middle of each 0.2s bit (every 200ms)
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
          const timeSec = parseInt(bits.join(''), 2);
          this.emit('cmdProgressSync', timeSec);
          // Wait for 0.5s footer to finish before enabling decoding again
          setTimeout(() => {
            this.fskDecoding = false;
          }, 450);
        }
      }, 200); // 200ms per bit
    }, 400);
  }

  stop() {
    this.isListening = false;
    if (this.analysisInterval) {
      clearInterval(this.analysisInterval);
      this.analysisInterval = null;
    }
  }
}
