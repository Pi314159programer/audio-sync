/**
 * Static QR Code Generator and Camera Scanner Manager
 */
export class QRManager {
  constructor() {
    this.html5QrCode = null;
  }

  /**
   * Determine clock period (in seconds) based on range zone
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

    const periodSec = this.getPeriodFromRange(payload.range);

    return {
      r: payload.range || '50m',
      z: payload.zone || 'A',
      p: payload.partCount || 4,
      clk: periodSec,
      v: (payload.urls || []).map(extractId)
    };
  }

  /**
   * Decompress payload on scanning
   */
  decompressPayload(compact) {
    return {
      range: compact.r || '50m',
      zone: compact.z || 'A',
      partCount: compact.p || 4,
      period: compact.clk || 0.5,
      urls: (compact.v || []).map(id => id.length === 11 ? `https://www.youtube.com/watch?v=${id}` : id)
    };
  }

  /**
   * Generate Standard Static QR Code
   * @param {string} containerId Canvas element ID
   * @param {Object} payloadObject Master configuration
   */
  generateStaticQR(containerId, payloadObject) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '';

    const compact = this.compressPayload(payloadObject);
    const jsonStr = JSON.stringify(compact);

    if (window.QRCode) {
      new window.QRCode(container, {
        text: jsonStr,
        width: 230,
        height: 230,
        colorDark: "#0f172a",
        colorLight: "#ffffff",
        correctLevel: window.QRCode.CorrectLevel.L
      });
    } else {
      const img = document.createElement('img');
      img.src = `https://api.qrserver.com/v1/create-qr-code/?size=230x230&data=${encodeURIComponent(jsonStr)}`;
      img.width = 230;
      img.height = 230;
      container.appendChild(img);
    }
  }

  /**
   * Start Camera Scanner for Slave Device
   * @param {string} readerElementId
   * @param {Function} onScanSuccess Called when QR code is scanned and payload decompressed
   */
  async startScanner(readerElementId, onScanSuccess) {
    let hasCompleted = false;

    if (window.Html5Qrcode) {
      this.html5QrCode = new window.Html5Qrcode(readerElementId);
      try {
        await this.html5QrCode.start(
          { facingMode: "environment" },
          { 
            fps: 10,
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
              const rawData = JSON.parse(decodedText);
              const decodedConfig = this.decompressPayload(rawData);
              hasCompleted = true;
              this.stopScanner();
              if (onScanSuccess) {
                onScanSuccess(decodedConfig);
              }
            } catch (err) {
              console.warn("Invalid QR code format:", decodedText);
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
