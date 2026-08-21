/**
 * QR Code Generator and Camera Scanner Manager
 */
export class QRManager {
  constructor() {
    this.html5QrCode = null;
  }

  /**
   * Render QR Code for Master Configuration Payload
   * @param {string} containerId 
   * @param {object} payloadObject { urls, range, zone, parts }
   */
  renderQRCode(containerId, payloadObject) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';

    const jsonStr = JSON.stringify(payloadObject);

    // Use QRCode library if loaded globally via CDN, else use fallback API
    if (window.QRCode) {
      new window.QRCode(container, {
        text: jsonStr,
        width: 200,
        height: 200,
        colorDark : "#0f172a",
        colorLight : "#ffffff",
        correctLevel : window.QRCode.CorrectLevel.M
      });
    } else {
      // Fallback image generator via QR server API if CDN fails
      const img = document.createElement('img');
      img.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(jsonStr)}`;
      img.width = 200;
      img.height = 200;
      container.appendChild(img);
    }
  }

  /**
   * Start Camera Scanner for Slave Device
   * @param {string} readerElementId 
   * @param {function} onScanSuccess 
   */
  async startScanner(readerElementId, onScanSuccess) {
    if (window.Html5Qrcode) {
      this.html5QrCode = new window.Html5Qrcode(readerElementId);
      try {
        await this.html5QrCode.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 200, height: 200 } },
          (decodedText) => {
            try {
              const data = JSON.parse(decodedText);
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
