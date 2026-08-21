/**
 * QR Code Generator and Camera Scanner Manager
 */
export class QRManager {
  constructor() {
    this.html5QrCode = null;
  }

  /**
   * Compress payload into minimal JSON structure for faster QR recognition
   */
  compressPayload(payload) {
    const extractId = (url) => {
      const match = url.match(/^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/);
      return (match && match[2] && match[2].length === 11) ? match[2] : url;
    };

    return {
      r: payload.range,
      p: payload.partCount,
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
        urls: (compact.v || []).map(id => id.length === 11 ? `https://www.youtube.com/watch?v=${id}` : id)
      };
    }
    return compact; // fallback for uncompressed format
  }

  /**
   * Render QR Code for Master Configuration Payload
   */
  renderQRCode(containerId, payloadObject) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';

    const compactData = this.compressPayload(payloadObject);
    const jsonStr = JSON.stringify(compactData);

    if (window.QRCode) {
      new window.QRCode(container, {
        text: jsonStr,
        width: 220,
        height: 220,
        colorDark : "#0f172a",
        colorLight : "#ffffff",
        correctLevel : window.QRCode.CorrectLevel.M
      });
    } else {
      const img = document.createElement('img');
      img.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(jsonStr)}`;
      img.width = 220;
      img.height = 220;
      container.appendChild(img);
    }
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
            fps: 15,
            aspectRatio: 1.0,
            qrbox: (viewfinderWidth, viewfinderHeight) => {
              const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
              const boxSize = Math.floor(minEdge * 0.75);
              return { width: boxSize, height: boxSize };
            }
          },
          (decodedText) => {
            try {
              const rawData = JSON.parse(decodedText);
              const data = this.decompressPayload(rawData);
              this.stopScanner();
              onScanSuccess(data);
            } catch (err) {
              console.warn("Invalid QR data:", decodedText);
            }
          },
          (errorMessage) => {
            // parse error, ignore
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
