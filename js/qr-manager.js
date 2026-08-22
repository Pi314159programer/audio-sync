import { FountainEncoder, FountainDecoder } from './fountain.js';

/**
 * Optical Dynamic QR Code Generator and Camera Scanner Manager with Fountain Code & Clock Sync
 */
export class QRManager {
  constructor() {
    this.html5QrCode = null;
    this.dynamicTimer = null;
    this.frameSeq = 0;
    this.fountainEncoder = null;
    this.fountainDecoder = new FountainDecoder();
  }

  /**
   * Determine clock period (in seconds) & frequency based on range zone
   */
  getPeriodFromRange(range) {
    if (['10m', '20m', '50m'].includes(range)) return 0.5;  // Zone A: 2 Hz
    if (['70m', '100m'].includes(range)) return 1.0;       // Zone B: 1 Hz
    return 2.0;                                            // Zone C: 0.5 Hz
  }

  /**
   * Compress payload into minimal JSON structure
   */
  compressPayload(payload) {
    const extractId = (url) => {
      const match = url.match(/^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/);
      return (match && match[2] && match[2].length === 11) ? match[2] : url;
    };

    return {
      r: payload.range || '50m',
      p: payload.partCount || 4,
      v: (payload.urls || []).map(extractId)
    };
  }

  /**
   * Decompress payload on scanning
   */
  /**
   * Decompress payload on scanning
   */
  decompressPayload(compact) {
    return {
      range: compact.r || '50m',
      partCount: compact.p || 4,
      urls: (compact.v || []).map(id => id.length === 11 ? `https://www.youtube.com/watch?v=${id}` : id),
      period: compact.per || 0.5,
      m: compact.m || 0,
      pulse: !!compact.pulse
    };
  }

  /**
   * Start Optical Dynamic QR Code Stream for Master Configuration, Fountain Code Audio, & Clock Sync
   * @param {string} containerId Canvas element ID
   * @param {Object} payloadObject Master configuration
   * @param {ArrayBuffer} [audioFileBuffer] Optional uploaded 800KB audio file
   * @param {string} [fileName] Audio file name
   */
  startDynamicQR(containerId, payloadObject, audioFileBuffer = null, fileName = 'audio.mp3') {
    this.stopDynamicQR();
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '';

    // Instantiate persistent QRCode instance once to avoid DOM destruction flicker/white screen
    let qrcodeInstance = null;
    if (window.QRCode) {
      qrcodeInstance = new window.QRCode(container, {
        text: 'init',
        width: 230,
        height: 230,
        colorDark: "#0f172a",
        colorLight: "#ffffff",
        correctLevel: window.QRCode.CorrectLevel.L
      });
    }

    const baseCompact = this.compressPayload(payloadObject);
    const periodSec = this.getPeriodFromRange(payloadObject.range);
    const periodMs = periodSec * 1000;

    // Initialize Fountain Encoder with 120-byte block size for ultra-low density, large module QR codes
    if (audioFileBuffer && audioFileBuffer.byteLength > 0) {
      this.fountainEncoder = new FountainEncoder(audioFileBuffer, fileName, 'audio/mp3', 120);
    } else {
      this.fountainEncoder = null;
    }

    const masterT0 = performance.now();
    this.frameSeq = 0;

    const drawFrame = () => {
      this.frameSeq++;

      const now = performance.now();
      const elapsed = now - masterT0;
      const m = Math.round(elapsed) % periodMs; // Millisecond counter 0..periodMs-1

      // Pulse marker true at the exact start (first 100ms) of every clock cycle
      const isPulseFrame = m < 100;

      const framePayload = {
        ...baseCompact,
        per: periodSec,
        m: m,
        pulse: isPulseFrame ? 1 : 0,
        seq: this.frameSeq
      };

      // Single ultra-compact droplet per frame for low-density instant scanning
      if (this.fountainEncoder) {
        framePayload.f = this.fountainEncoder.nextDroplet();
      }

      const jsonStr = JSON.stringify(framePayload);

      if (qrcodeInstance) {
        try {
          qrcodeInstance.clear();
          qrcodeInstance.makeCode(jsonStr);
        } catch (err) {
          console.warn("QR code render error:", err);
        }
      } else {
        container.innerHTML = '';
        const img = document.createElement('img');
        img.src = `https://api.qrserver.com/v1/create-qr-code/?size=230x230&data=${encodeURIComponent(jsonStr)}`;
        img.width = 230;
        img.height = 230;
        container.appendChild(img);
      }
    };

    drawFrame();
    // High FPS dynamic QR stream (~25ms per frame / ~40 FPS for instant optical recognition)
    this.dynamicTimer = setInterval(drawFrame, 25);
  }

  /**
   * Stop Dynamic QR Generator
   */
  stopDynamicQR() {
    if (this.dynamicTimer) {
      clearInterval(this.dynamicTimer);
      this.dynamicTimer = null;
    }
  }

  /**
   * Start Camera Scanner for Slave Device
   * @param {string} readerElementId
   * @param {Function} onScanSuccess Called when all data & Fountain Code file are reconstructed & min 3 clock cycles phase-locked
   * @param {Function} onScanProgress Called on every frame with reconstruction & clock phase progress %
   */
  async startScanner(readerElementId, onScanSuccess, onScanProgress) {
    this.fountainDecoder.reset();
    let hasCompleted = false;
    let decodedConfig = null;

    const observedCycles = new Set();
    let slaveT0 = null;
    let consecutiveLockCount = 0;

    if (window.Html5Qrcode) {
      this.html5QrCode = new window.Html5Qrcode(readerElementId);
      try {
        await this.html5QrCode.start(
          { facingMode: "environment" },
          { 
            fps: 30,
            aspectRatio: 1.0,
            qrbox: (viewfinderWidth, viewfinderHeight) => {
              const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
              const boxSize = Math.floor(minEdge * 0.85);
              return { width: boxSize, height: boxSize };
            }
          },
          (decodedText) => {
            if (hasCompleted) return;
            try {
              const scanTime = performance.now();
              const rawData = JSON.parse(decodedText);
              decodedConfig = this.decompressPayload(rawData);

              const periodMs = (decodedConfig.period || 0.5) * 1000;
              const masterM = rawData.m !== undefined ? rawData.m : 0;

              // Account for camera capture & JSON parsing latency (~10ms)
              const transitLatency = Math.round(performance.now() - scanTime);
              const targetM = (masterM + transitLatency) % periodMs;

              const now = performance.now();
              if (slaveT0 === null) {
                slaveT0 = now - targetM;
              }

              // Compute current Slave millisecond count
              const selfElapsed = Math.round(now - slaveT0);
              const selfM = ((selfElapsed % periodMs) + periodMs) % periodMs;

              // Calculate signed millisecond difference in range [-periodMs/2, +periodMs/2]
              let err = targetM - selfM;
              if (err > periodMs / 2) err -= periodMs;
              if (err < -periodMs / 2) err += periodMs;
              const absErr = Math.abs(err);

              let adjustMode = 'LOCKED';
              if (absErr > 300) {
                // Rule A: Large error > 300ms -> Coarse Hard Reset
                slaveT0 = now - targetM;
                consecutiveLockCount = 0;
                adjustMode = 'HARD_RESET';
              } else if (absErr > 50) {
                // Rule B: Medium error 50ms..300ms -> Soft Gradual Proportional Nudge (no scanner reset!)
                slaveT0 = slaveT0 - (err * 0.5);
                consecutiveLockCount = 0;
                adjustMode = 'SOFT_NUDGE';
              } else {
                // Rule C: Small error <= 50ms -> Phase Locked!
                consecutiveLockCount++;
                adjustMode = 'LOCKED';
              }

              // Track cycle index for multi-cycle verification
              const currentCycle = Math.floor(selfElapsed / periodMs);
              observedCycles.add(currentCycle);

              decodedConfig.scanTime = scanTime;
              decodedConfig.alignedT0 = slaveT0;
              decodedConfig.masterM = masterM;
              decodedConfig.selfM = selfM;
              decodedConfig.diffMs = Math.round(err);
              decodedConfig.absErr = Math.round(absErr);
              decodedConfig.mode = adjustMode;

              const cycleCount = observedCycles.size;
              const isPhaseLocked = consecutiveLockCount >= 3;
              const cycleProgress = Math.min(100, Math.floor((cycleCount / 3) * 100));

              // Process Fountain Code droplet if present
              if (rawData.f) {
                const status = this.fountainDecoder.addDroplet(rawData.f);
                const overallPercent = Math.min(status.percent, cycleProgress);

                if (onScanProgress) {
                  onScanProgress({
                    percent: overallPercent,
                    resolvedCount: status.resolvedCount,
                    totalBlocks: status.totalBlocks,
                    cycleCount: cycleCount,
                    masterM: masterM,
                    selfM: selfM,
                    diffMs: Math.round(err),
                    mode: adjustMode,
                    isLocked: isPhaseLocked
                  });
                }

                // Completion requires BOTH Fountain file reconstruction AND min 3 cycles phase alignment (50ms locked)
                if (status.isComplete && cycleCount >= 3 && isPhaseLocked) {
                  hasCompleted = true;
                  const reconstructedFile = this.fountainDecoder.getReconstructedFile();
                  this.stopScanner();
                  onScanSuccess(decodedConfig, reconstructedFile);
                }
              } else {
                // If no audio file attached, completion requires min 3 distinct clock cycles & 50ms phase lock
                if (onScanProgress) {
                  onScanProgress({
                    percent: cycleProgress,
                    resolvedCount: cycleCount,
                    totalBlocks: 3,
                    cycleCount: cycleCount,
                    masterM: masterM,
                    selfM: selfM,
                    diffMs: Math.round(err),
                    mode: adjustMode,
                    isLocked: isPhaseLocked
                  });
                }

                if (cycleCount >= 3 && isPhaseLocked) {
                  hasCompleted = true;
                  this.stopScanner();
                  onScanSuccess(decodedConfig, null);
                }
              }
            } catch (err) {
              console.warn("Invalid dynamic QR frame payload:", decodedText);
            }
          },
          (errorMessage) => {
            // parse error ignored
          }
        );
      } catch (err) {
        console.warn("Could not start camera scanner:", err);
      }
    }
  }

  /**
   * Stop Camera Scanner
   */
  async stopScanner() {
    if (this.html5QrCode && this.html5QrCode.isScanning) {
      try {
        await this.html5QrCode.stop();
        this.html5QrCode.clear();
      } catch (err) {
        console.warn("Error stopping scanner:", err);
      }
    }
  }
}
