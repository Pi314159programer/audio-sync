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
  decompressPayload(compact) {
    return {
      range: compact.r || '50m',
      partCount: compact.p || 4,
      urls: (compact.v || []).map(id => id.length === 11 ? `https://www.youtube.com/watch?v=${id}` : id),
      period: compact.per || 0.5,
      clk: compact.clk || 0,
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

    // Initialize Fountain Encoder with high-density 800-byte block size for 8x speedup
    if (audioFileBuffer && audioFileBuffer.byteLength > 0) {
      this.fountainEncoder = new FountainEncoder(audioFileBuffer, fileName, 'audio/mp3', 800);
    } else {
      this.fountainEncoder = null;
    }

    const masterT0 = performance.now();
    this.frameSeq = 0;

    const drawFrame = () => {
      this.frameSeq++;

      const now = performance.now();
      const elapsed = now - masterT0;
      const offsetInCycle = ((elapsed % periodMs) + periodMs) % periodMs;

      // Pulse marker true at the exact start (first 100ms) of every clock cycle
      const isPulseFrame = offsetInCycle < 100;

      const framePayload = {
        ...baseCompact,
        per: periodSec,
        clk: Math.round(now),
        pulse: isPulseFrame ? 1 : 0,
        seq: this.frameSeq
      };

      // Add batch of 2 Fountain Code Droplets per frame for 16x accelerated transmission
      if (this.fountainEncoder) {
        framePayload.f = [
          this.fountainEncoder.nextDroplet(),
          this.fountainEncoder.nextDroplet()
        ];
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
    // High FPS dynamic QR stream (~35ms per frame / ~28.5 FPS for 50x accelerated optical transfer)
    this.dynamicTimer = setInterval(drawFrame, 35);
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
   * @param {Function} onScanSuccess Called when all data & Fountain Code file are reconstructed
   * @param {Function} onScanProgress Called on every frame with reconstruction progress %
   */
  async startScanner(readerElementId, onScanSuccess, onScanProgress) {
    this.fountainDecoder.reset();
    let hasCompleted = false;
    let decodedConfig = null;

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
              decodedConfig.scanTime = scanTime;

              // Process Fountain Code droplet if present
              if (rawData.f) {
                const status = this.fountainDecoder.addDroplet(rawData.f);
                if (onScanProgress) {
                  onScanProgress({
                    percent: status.percent,
                    resolvedCount: status.resolvedCount,
                    totalBlocks: status.totalBlocks
                  });
                }

                if (status.isComplete) {
                  hasCompleted = true;
                  const reconstructedFile = this.fountainDecoder.getReconstructedFile();
                  this.stopScanner();
                  onScanSuccess(decodedConfig, reconstructedFile);
                }
              } else {
                // If no audio file attached, complete immediately on first frame
                hasCompleted = true;
                if (onScanProgress) onScanProgress({ percent: 100, resolvedCount: 1, totalBlocks: 1 });
                this.stopScanner();
                onScanSuccess(decodedConfig, null);
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
