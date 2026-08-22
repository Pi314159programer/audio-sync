/**
 * Optical Dynamic QR Code Generator and Camera Scanner Manager
 */
export class QRManager {
  constructor() {
    this.html5QrCode = null;
    this.dynamicTimer = null;
    this.frameSeq = 0;
  }

  /**
   * Compress payload into minimal JSON structure for fast QR recognition
   */
  compressPayload(payload) {
    const extractId = (url) => {
      const match = url.match(/^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/);
      return (match && match[2] && match[2].length === 11) ? match[2] : url;
    };

    return {
      r: payload.range || '50m',
      p: payload.partCount || 4,
      t: payload.tones || [261, 293, 329, 392, 440],
      v: (payload.urls || []).map(extractId)
    };
  }

  /**
   * Decompress payload on scanning
   */
  decompressPayload(compact) {
    if (compact.r !== undefined) {
      return {
        range: compact.r,
        partCount: compact.p,
        tones: compact.t || [261, 293, 329, 392, 440],
        urls: (compact.v || []).map(id => id.length === 11 ? `https://www.youtube.com/watch?v=${id}` : id),
        clk: compact.clk || 0,
        seq: compact.seq || 0
      };
    }
    return compact;
  }

  /**
   * Render Optical Dynamic Animated QR Code for Master Configuration & Clock Sync
   * Cycles frames at 150ms (~6.6 FPS) embedding precision clock timestamp
   */
  startDynamicQR(containerId, payloadObject) {
    this.stopDynamicQR();
    const container = document.getElementById(containerId);
    if (!container) return;

    const baseCompact = this.compressPayload(payloadObject);

    const drawFrame = () => {
      container.innerHTML = '';
      this.frameSeq++;

      const now = performance.now();
      const framePayload = {
        ...baseCompact,
        clk: Math.round(now),
        seq: this.frameSeq
      };

      const jsonStr = JSON.stringify(framePayload);

      if (window.QRCode) {
        new window.QRCode(container, {
          text: jsonStr,
          width: 220,
          height: 220,
          colorDark: "#0f172a",
          colorLight: "#ffffff",
          correctLevel: window.QRCode.CorrectLevel.L
        });
      } else {
        const img = document.createElement('img');
        img.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(jsonStr)}`;
        img.width = 220;
        img.height = 220;
        container.appendChild(img);
      }
    };

    drawFrame();
    this.dynamicTimer = setInterval(drawFrame, 150); // 150ms per frame
  }

  /**
   * Stop Optical Dynamic QR Generator
   */
  stopDynamicQR() {
    if (this.dynamicTimer) {
      clearInterval(this.dynamicTimer);
      this.dynamicTimer = null;
    }
  }

  /**
   * Render static QR Code fallback
   */
  renderQRCode(containerId, payloadObject) {
    this.startDynamicQR(containerId, payloadObject);
  }

  /**
   * Start Camera Scanner for Slave Device
   */
  async startScanner(readerElementId, onScanSuccess) {
    if (window.Html5Qrcode) {
      this.html5QrCode = new window.Html5Qrcode(readerElementId);
      try {
        await this.html5QrCode.start(
          { facingMode: "environment" },
          { 
            fps: 20,
            aspectRatio: 1.0,
            qrbox: (viewfinderWidth, viewfinderHeight) => {
              const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
              const boxSize = Math.floor(minEdge * 0.8);
              return { width: boxSize, height: boxSize };
            }
          },
          (decodedText) => {
            try {
              const scanTime = performance.now();
              const rawData = JSON.parse(decodedText);
              const data = this.decompressPayload(rawData);
              data.scanTime = scanTime;
              this.stopScanner();
              onScanSuccess(data);
            } catch (err) {
              console.warn("Invalid QR data frame:", decodedText);
            }
          },
          (errorMessage) => {
            // ignore scan frame errors
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
