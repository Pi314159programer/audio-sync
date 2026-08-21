/**
 * AudioContext & Microphone Input Manager
 */
export class AudioManager {
  constructor() {
    this.ctx = null;
    this.micStream = null;
    this.micSource = null;
    this.analyser = null;
    this.isInitialized = false;
  }

  /**
   * Initialize AudioContext on user interaction
   */
  async init() {
    if (this.isInitialized && this.ctx && this.ctx.state !== 'closed') {
      if (this.ctx.state === 'suspended') {
        await this.ctx.resume();
      }
      return;
    }

    const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AudioCtxClass({ latencyHint: 'interactive' });
    
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }

    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.2;

    this.isInitialized = true;
  }

  /**
   * Request Microphone Stream for Acoustic Signal Analysis
   */
  async startMicrophone() {
    await this.init();
    if (this.micStream) return true;

    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          latency: 0
        },
        video: false
      });

      this.micSource = this.ctx.createMediaStreamSource(this.micStream);
      this.micSource.connect(this.analyser);
      return true;
    } catch (err) {
      console.warn("Microphone access permission denied or unavailable:", err);
      return false;
    }
  }

  /**
   * Stop Microphone Stream
   */
  stopMicrophone() {
    if (this.micStream) {
      this.micStream.getTracks().forEach(track => track.stop());
      this.micStream = null;
    }
    if (this.micSource) {
      this.micSource.disconnect();
      this.micSource = null;
    }
  }
}
