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
   * Request Microphone Stream for Acoustic Signal Analysis with iPadOS Unlocking
   */
  async startMicrophone() {
    await this.init();
    await this.resume();
    this.playSilentBuffer();

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

      // Auto-resume if Safari suspends context on iPad
      if (this.ctx) {
        this.ctx.onstatechange = () => {
          if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume();
          }
        };
      }

      this.bindGlobalUnlockListeners();
      return true;
    } catch (err) {
      console.warn("Microphone access permission denied or unavailable:", err);
      return false;
    }
  }

  /**
   * Resume AudioContext state if suspended on iOS / iPadOS Safari
   */
  async resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume();
      } catch (err) {
        console.warn("AudioContext resume failed:", err);
      }
    }
  }

  /**
   * Play 1-sample silent dummy buffer inside user gesture to unlock Safari hardware audio pipeline
   */
  playSilentBuffer() {
    if (!this.ctx) return;
    try {
      const buffer = this.ctx.createBuffer(1, 1, 22050);
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(this.ctx.destination);
      source.start(0);
    } catch (err) {
      // ignore
    }
  }

  /**
   * Bind global touch & click handlers to keep AudioContext active on iPadOS
   */
  bindGlobalUnlockListeners() {
    if (this.unlockBound) return;
    this.unlockBound = true;

    const unlock = () => {
      this.resume();
      this.playSilentBuffer();
    };

    ['touchstart', 'touchend', 'click', 'pointerdown'].forEach(evtType => {
      window.addEventListener(evtType, unlock, { passive: true });
    });
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
