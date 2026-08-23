/**
 * Optical Flash Detector via Camera Stream & Canvas Luminance Processing
 */
export class OpticalFlashDetector {
  /**
   * @param {HTMLVideoElement} videoElement Video element rendering camera stream
   * @param {Function} onFlashCallback Callback fired when bright white flash is detected
   */
  constructor(videoElement = null, onFlashCallback = null) {
    this.video = videoElement;
    this.onFlash = onFlashCallback;

    this.canvas = document.createElement('canvas');
    this.canvas.width = 160;
    this.canvas.height = 120;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });

    this.isAnalyzing = false;
    this.animFrameId = null;
    this.baselineLuma = null;
    this.lastFlashTime = 0;
    this.stream = null;
  }

  /**
   * Start Camera Stream & Frame Analysis
   * @param {string} containerId ID of container to attach video preview element to
   */
  async start(containerId) {
    if (this.isAnalyzing) return;

    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '';

    this.video = document.createElement('video');
    this.video.setAttribute('playsinline', 'true');
    this.video.setAttribute('autoplay', 'true');
    this.video.muted = true;
    this.video.style.width = '100%';
    this.video.style.height = '100%';
    this.video.style.objectFit = 'cover';
    this.video.style.borderRadius = '16px';
    container.appendChild(this.video);

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 60, max: 60 }
        },
        audio: false
      });
      this.video.srcObject = this.stream;
      await this.video.play();
    } catch (err) {
      console.warn("OpticalFlashDetector: Could not open camera:", err);
      return;
    }

    this.isAnalyzing = true;
    this.baselineLuma = null;
    this.lastFlashTime = 0;

    const loop = () => {
      if (!this.isAnalyzing) return;
      this.processFrame();
      this.animFrameId = requestAnimationFrame(loop);
    };
    loop();
  }

  /**
   * Process a single video frame to detect brightness spike
   */
  processFrame() {
    if (!this.video || this.video.readyState < 2) return;

    try {
      this.ctx.drawImage(this.video, 0, 0, 160, 120);

      // Sample center 100x80 box
      const imgData = this.ctx.getImageData(30, 20, 100, 80);
      const pixels = imgData.data;

      let totalLuma = 0;
      const count = pixels.length / 4;
      for (let i = 0; i < pixels.length; i += 4) {
        // Luminance Y = 0.299R + 0.587G + 0.114B
        totalLuma += (0.299 * pixels[i] + 0.587 * pixels[i+1] + 0.114 * pixels[i+2]);
      }
      const avgLuma = totalLuma / count;

      const now = performance.now();

      if (this.baselineLuma === null) {
        this.baselineLuma = avgLuma;
        return;
      }

      const diff = avgLuma - this.baselineLuma;

      // Detection threshold: brightness jump > 18 units & cooldown > 150ms
      if (diff > 18 && (now - this.lastFlashTime) > 150) {
        this.lastFlashTime = now;
        if (this.onFlash) {
          this.onFlash(now);
        }
      } else {
        // Slowly update baseline when not flashing
        this.baselineLuma = 0.90 * this.baselineLuma + 0.10 * avgLuma;
      }
    } catch (err) {
      // Ignore frame draw errors
    }
  }

  /**
   * Stop Camera Analysis & Stream
   */
  stop() {
    this.isAnalyzing = false;
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    if (this.video) {
      this.video.pause();
      this.video.srcObject = null;
      this.video = null;
    }
  }
}
