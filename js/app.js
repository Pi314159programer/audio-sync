import { AudioManager } from './audio/audio-context.js';
import { ToneGenerator } from './audio/tone-generator.js';
import { DSPAnalyzer } from './audio/dsp-analyzer.js';
import { SyncEngine } from './audio/sync-engine.js';
import { YouTubePlayerManager } from './youtube-player.js';
import { QRManager } from './qr-manager.js';
import { OpticalFlashDetector } from './optical-detector.js';

class AppController {
  constructor() {
    this.am = new AudioManager();
    this.toneGen = new ToneGenerator(this.am);
    this.dsp = new DSPAnalyzer(this.am);
    this.syncEngine = new SyncEngine(this.am, this.toneGen, this.dsp);
    this.ytPlayer = new YouTubePlayerManager();
    this.qrManager = new QRManager();

    // App state
    this.role = null; // 'master' or 'slave'
    this.config = {
      range: '50m',
      zone: 'A',
      partCount: 4,
      urls: []
    };

    this.assignedPart = 1; // Selected part for this device (1 to N)
    this.isPlaying = false;
    this.isMuted = false;
    this.partStates = {}; // { 1: true, 2: true, ... } true=playing, false=muted
    this.seekWasAdjusted = false;

    // Master & Slave Clock / Calibration Timers
    this.masterClockTimer = null;
    this.masterT0 = null;

    this.slaveClockTimer = null;
    this.slaveT0 = null;
    this.slaveActiveCycleLimit = 2000;
    this.slaveFlashHistory = [];
    this.slaveSyncState = 'IDLE'; // 'IDLE', 'DETECTING_INTERVALS', 'NUDGE_AND_VERIFY', 'COMPLETE'
    this.slaveConsecutiveLocks = 0;
    this.detector = null;

    // Voice Part Color Mapping
    this.partColors = {
      1: '#ff4d4d',
      2: '#ff944d',
      3: '#ffd11a',
      4: '#2ecc71',
      5: '#3498db',
      6: '#9b59b6',
      7: '#ff69b4',
      8: '#a0522d'
    };
  }

  async init() {
    this.bindDOMEvents();
    await this.ytPlayer.init('yt-player');
  }

  /**
   * Helper to switch active view container
   */
  showView(viewId) {
    const views = [
      'view-role-selection',
      'view-master-setup',
      'view-master-qr',
      'view-master-calibration',
      'view-slave-setup',
      'view-slave-calibration',
      'view-slave-part-select',
      'view-master-control',
      'view-slave-status'
    ];
    views.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        if (id === viewId) el.classList.remove('hidden');
        else el.classList.add('hidden');
      }
    });
  }

  bindDOMEvents() {
    // 1. Role Selection
    document.getElementById('btn-select-master').addEventListener('click', async () => {
      this.role = 'master';
      await this.am.init();
      this.showView('view-master-setup');
    });

    document.getElementById('btn-select-slave').addEventListener('click', async () => {
      this.role = 'slave';
      await this.am.init();
      this.showView('view-slave-setup');

      this.qrManager.startScanner(
        'reader',
        (data) => this.onSlaveQRScanned(data)
      );
    });

    // 2. Master Setup Controls
    const rangeSelect = document.getElementById('select-range');
    rangeSelect.addEventListener('change', (e) => {
      this.config.range = e.target.value;
      const zoneBadge = document.getElementById('range-zone-badge');
      if (['10m','20m','50m'].includes(this.config.range)) {
        this.config.zone = 'A';
        zoneBadge.innerText = '區間 A (周期 0.5s)';
      } else if (['70m','100m'].includes(this.config.range)) {
        this.config.zone = 'B';
        zoneBadge.innerText = '區間 B (周期 1.0s)';
      } else {
        this.config.zone = 'C';
        zoneBadge.innerText = '區間 C (周期 2.0s)';
      }
    });

    document.getElementById('select-parts').addEventListener('change', (e) => {
      this.config.partCount = parseInt(e.target.value);
    });

    const ytInput = document.getElementById('input-yt-url');
    document.getElementById('btn-add-yt').addEventListener('click', () => {
      const url = ytInput.value.trim();
      if (url && this.config.urls.length < 50) {
        this.config.urls.push(url);
        ytInput.value = '';
        this.renderYTList();
      }
    });

    document.getElementById('btn-confirm-master-setup').addEventListener('click', () => {
      if (this.config.urls.length === 0) {
        // Fallback demo URL if empty
        this.config.urls.push('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
        this.renderYTList();
      }
      this.showView('view-master-qr');

      this.syncEngine.configureRange(this.config.range);

      // Generate Standard Static QR Code
      this.qrManager.generateStaticQR(
        'qrcode-canvas-container',
        this.config
      );
    });

    // 3. Master Start Calibration Button (轉至主控校正畫面)
    const startMasterCalibBtn = document.getElementById('btn-start-master-calibration');
    if (startMasterCalibBtn) {
      startMasterCalibBtn.addEventListener('click', () => {
        this.showView('view-master-calibration');
        this.startMasterClockLoop();
      });
    }

    // Master Enter Control Console Button
    const enterMasterBtn = document.getElementById('btn-enter-master-control');
    if (enterMasterBtn) {
      enterMasterBtn.addEventListener('click', () => {
        this.stopMasterClockLoop();
        this.enterMasterControlConsole();
      });
    }

    // 4. Slave Manual Input Fallback
    document.getElementById('btn-toggle-manual-input').addEventListener('click', () => {
      const box = document.getElementById('manual-input-box');
      box.classList.toggle('hidden');
    });

    document.getElementById('btn-submit-manual-json').addEventListener('click', () => {
      const jsonStr = document.getElementById('input-manual-json').value.trim();
      try {
        const rawData = JSON.parse(jsonStr);
        const data = this.qrManager.decompressPayload(rawData);
        this.onSlaveQRScanned(data);
      } catch (err) {
        alert("格式錯誤，請確定輸入的是正確的 JSON 設定數據");
      }
    });

    // 5. Master Playback & Controls
    document.getElementById('btn-play-pause').addEventListener('click', () => {
      if (!this.isPlaying) {
        this.triggerMasterPlay();
      } else {
        this.triggerMasterPause();
      }
    });

    document.getElementById('btn-next-track').addEventListener('click', () => {
      this.triggerMasterNextTrack();
    });

    const seekSlider = document.getElementById('seek-slider');
    seekSlider.addEventListener('input', () => {
      this.seekWasAdjusted = true;
      const targetSec = parseFloat(seekSlider.value);
      this.ytPlayer.seekTo(targetSec);
      document.getElementById('time-current').innerText = this.formatTime(targetSec);

      if (this.isPlaying) {
        this.triggerMasterPause();
      }
    });

    // 6. Bind DSP Analyzer Events for Slave acoustic commands
    this.bindDSPCommandListeners();
  }

  renderYTList() {
    const listEl = document.getElementById('yt-link-list');
    const labelEl = document.getElementById('yt-count-label');
    listEl.innerHTML = '';
    labelEl.innerText = `${this.config.urls.length} / 50`;

    this.config.urls.forEach((url, index) => {
      const item = document.createElement('div');
      item.className = 'yt-item';
      item.innerHTML = `
        <span class="yt-item-url">${index + 1}. ${url}</span>
        <span class="yt-item-del" data-index="${index}">✕</span>
      `;
      listEl.appendChild(item);
    });

    listEl.querySelectorAll('.yt-item-del').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.target.getAttribute('data-index'));
        this.config.urls.splice(idx, 1);
        this.renderYTList();
      });
    });
  }

  // --- MASTER OPTICAL PULSE BALL CLOCK LOOP ---

  startMasterClockLoop() {
    this.stopMasterClockLoop();

    const periodMs = (this.syncEngine.period || 0.5) * 1000;
    this.masterT0 = performance.now();

    const loop = () => {
      if (!this.masterT0) return;
      const elapsed = performance.now() - this.masterT0;
      const cnt = Math.floor(elapsed % periodMs);

      const ball = document.getElementById('master-pulse-ball');
      if (ball) {
        if (cnt >= 0 && cnt <= 30) {
          ball.classList.add('active');
        } else {
          ball.classList.remove('active');
        }
      }
      this.masterAnimFrameId = requestAnimationFrame(loop);
    };
    loop();
  }

  stopMasterClockLoop() {
    if (this.masterAnimFrameId) {
      cancelAnimationFrame(this.masterAnimFrameId);
      this.masterAnimFrameId = null;
    }
    this.masterT0 = null;
  }

  // --- SLAVE OPTICAL SCANNING & CLK ALIGNMENT ---

  onSlaveQRScanned(data) {
    this.config = data;

    if (data.range) this.config.range = data.range;
    if (data.zone) this.config.zone = data.zone;
    this.syncEngine.configureRange(this.config.range);

    // Transition to Slave Optical Calibration View
    this.showView('view-slave-calibration');
    this.startSlaveOpticalCalibration();
  }

  startSlaveOpticalCalibration() {
    const periodMs = (this.syncEngine.period || 0.5) * 1000;

    this.slaveFlashHistory = [];
    this.slaveSyncState = 'DETECTING_INTERVALS';
    this.slaveConsecutiveLocks = 0;
    this.slaveT0 = null;
    this.slaveActiveCycleLimit = periodMs;

    // Slave Pulse Ball requestAnimationFrame Loop
    if (this.slaveAnimFrameId) cancelAnimationFrame(this.slaveAnimFrameId);

    const slaveLoop = () => {
      if (this.slaveT0) {
        const now = performance.now();
        let elapsed = now - this.slaveT0;
        const activeLimit = this.slaveActiveCycleLimit;

        if (elapsed >= activeLimit) {
          this.slaveT0 += activeLimit;
          this.slaveActiveCycleLimit = periodMs; // Reset back to standard periodMs for subsequent cycles
          elapsed = now - this.slaveT0;
        }

        const cnt = Math.floor(elapsed % periodMs);
        const ball = document.getElementById('slave-pulse-ball');
        if (ball) {
          if (cnt >= 0 && cnt <= 30) {
            ball.classList.add('active');
          } else {
            ball.classList.remove('active');
          }
        }
      }
      if (this.slaveSyncState !== 'COMPLETE') {
        this.slaveAnimFrameId = requestAnimationFrame(slaveLoop);
      }
    };
    slaveLoop();

    // Start Camera Optical Flash Detector
    this.detector = new OpticalFlashDetector(null, (flashTime) => {
      this.handleSlaveFlashDetected(flashTime, periodMs);
    });
    this.detector.start('slave-camera-box');
  }

  handleSlaveFlashDetected(flashTime, periodMs) {
    const statusText = document.getElementById('slave-sync-status-text');

    if (this.slaveSyncState === 'DETECTING_INTERVALS') {
      this.slaveFlashHistory.push(flashTime);

      if (this.slaveFlashHistory.length >= 4) {
        const n = this.slaveFlashHistory.length;
        const i1 = this.slaveFlashHistory[n-3] - this.slaveFlashHistory[n-4];
        const i2 = this.slaveFlashHistory[n-2] - this.slaveFlashHistory[n-3];
        const i3 = this.slaveFlashHistory[n-1] - this.slaveFlashHistory[n-2];

        const diff1 = Math.abs(i1 - periodMs);
        const diff2 = Math.abs(i2 - periodMs);
        const diff3 = Math.abs(i3 - periodMs);

        // Check if 3 consecutive intervals match equal distance (within 20ms)
        if (diff1 <= 20 && diff2 <= 20 && diff3 <= 20) {
          // 4th Flash detected -> Start Slave clk!
          this.slaveT0 = flashTime;
          // 1st cycle limit reduced by 15ms (to compensate for camera latency)
          this.slaveActiveCycleLimit = periodMs - 15;
          this.slaveSyncState = 'NUDGE_AND_VERIFY';
          this.slaveConsecutiveLocks = 0;

          if (statusText) statusText.innerText = `已對齊時距！開啟相機校正 (0/5)...`;
        } else {
          this.slaveFlashHistory.shift(); // Slide window
          if (statusText) statusText.innerText = `正在分析脈衝時距 (${this.slaveFlashHistory.length}/4)...`;
        }
      } else {
        if (statusText) statusText.innerText = `正在捕捉主控脈衝 (${this.slaveFlashHistory.length}/4)...`;
      }
      return;
    }

    if (this.slaveSyncState === 'NUDGE_AND_VERIFY') {
      const cnt = Math.floor((flashTime - this.slaveT0) % periodMs);

      if (cnt >= 5 && cnt <= 15) {
        // Ideal window (5 <= cnt <= 15)
        this.slaveConsecutiveLocks++;
        if (statusText) statusText.innerText = `脈衝同步對齊中 (${this.slaveConsecutiveLocks}/5) [cnt: ${cnt}]`;

        if (this.slaveConsecutiveLocks >= 5) {
          // Calibration Complete!
          this.slaveSyncState = 'COMPLETE';
          if (statusText) statusText.innerText = `✨ 光學校正完成！進入聲部選擇`;

          setTimeout(() => {
            if (this.detector) this.detector.stop();
            if (this.slaveAnimFrameId) cancelAnimationFrame(this.slaveAnimFrameId);
            this.showView('view-slave-part-select');
            this.renderSlavePartSelectionGrid();
          }, 600);
        }
      } else {
        // Outside 5~15 -> Adjust current cycle limit by offset
        // User example: period = 2000, cnt = 70 -> offset = 70 - 5 = 65 -> cycle limit = 2000 + 65 = 2065
        const offset = cnt - 5;
        this.slaveActiveCycleLimit = periodMs + offset;
        this.slaveConsecutiveLocks = 0;

        if (statusText) statusText.innerText = `微調相位 [cnt: ${cnt} -> 週期上限 ${Math.round(this.slaveActiveCycleLimit)}ms]`;
      }
    }
  }

  renderSlavePartSelectionGrid() {
    const grid = document.getElementById('slave-parts-grid');
    if (!grid) return;

    grid.innerHTML = '';
    const totalParts = Math.max(1, this.config.partCount);

    for (let i = 1; i <= totalParts; i++) {
      const btn = document.createElement('button');
      btn.className = 'part-select-btn';
      btn.innerText = `第 ${i} 聲部`;
      btn.addEventListener('click', async () => {
        grid.querySelectorAll('.part-select-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        this.assignedPart = i;

        // Initialize audio & start listening on slave device
        await this.am.init();
        try {
          await this.am.startMicrophone();
          this.dsp.start();
        } catch (err) {
          console.warn("Could not start microphone on slave device:", err);
        }

        // Set playlist on slave YT player
        this.ytPlayer.setPlaylist(this.config.urls);

        // Pre-warm YouTube player
        if (this.ytPlayer.isReady) {
          this.ytPlayer.mute();
          this.ytPlayer.play();
          setTimeout(() => {
            this.ytPlayer.pause();
            this.ytPlayer.unmute();
          }, 150);
        }

        // Transition directly to Slave Status View
        this.showView('view-slave-status');
        this.updateSlaveUIStatus();
      });
      grid.appendChild(btn);
    }
  }

  enterMasterControlConsole() {
    for (let i = 1; i <= Math.max(8, this.config.partCount); i++) {
      this.partStates[i] = true;
    }

    this.ytPlayer.setPlaylist(this.config.urls);

    if (this.ytPlayer.isReady) {
      this.ytPlayer.mute();
      this.ytPlayer.play();
      setTimeout(() => {
        this.ytPlayer.pause();
        this.ytPlayer.unmute();
      }, 150);
    }

    this.showView('view-master-control');
    this.renderMasterPartButtons();
    this.startMasterProgressUpdater();
  }

  renderMasterPartButtons() {
    const container = document.getElementById('master-part-buttons');
    if (!container) return;

    container.innerHTML = '';
    const total = this.config.partCount;
    if (total === 0) {
      container.innerHTML = '<div style="grid-column:1/-1; text-align:center; color:var(--text-muted); font-size:0.8rem;">未啟用分部</div>';
      return;
    }

    for (let k = 1; k <= total; k++) {
      const btn = document.createElement('button');
      const isPartActive = this.partStates[k] !== false;
      btn.className = `part-toggle-btn ${isPartActive ? 'active' : 'muted'}`;
      btn.innerHTML = `
        <div class="part-indicator-dot" style="background:${this.partColors[k]}"></div>
        <span>第 ${k} 聲部</span>
      `;
      btn.addEventListener('click', () => {
        const newState = !this.partStates[k];
        this.partStates[k] = newState;
        this.toneGen.playPartToggleSignal(k, newState);
        this.renderMasterPartButtons();
      });
      container.appendChild(btn);
    }
  }

  startMasterProgressUpdater() {
    setInterval(() => {
      if (this.role === 'master' && this.ytPlayer.isReady) {
        const current = this.ytPlayer.getCurrentTime();
        const duration = this.ytPlayer.getDuration();
        const slider = document.getElementById('seek-slider');
        
        if (!this.seekWasAdjusted) {
          slider.max = duration || 100;
          slider.value = current;
          document.getElementById('time-current').innerText = this.formatTime(current);
          document.getElementById('time-duration').innerText = this.formatTime(duration);
        }
      }
    }, 500);
  }

  formatTime(sec) {
    if (!sec || isNaN(sec)) return '00:00';
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  // --- MASTER CONTROL SIGNAL TRANSMISSION ---

  triggerMasterPlay() {
    if (this.isPlayTransitioning) return;
    this.isPlayTransitioning = true;

    const playBtn = document.getElementById('btn-play-pause');
    if (playBtn) playBtn.disabled = true;

    const currentSec = this.ytPlayer.getCurrentTime();
    this.toneGen.playProgressSignal(currentSec);

    setTimeout(() => {
      this.toneGen.playStartSignal();
      setTimeout(() => {
        this.isPlaying = true;
        this.ytPlayer.play();
        if (playBtn) {
          playBtn.innerText = '⏸️';
          playBtn.disabled = false;
        }
        this.isPlayTransitioning = false;
      }, 500);
    }, 3000);
  }

  triggerMasterPause() {
    this.toneGen.playPauseSignal();
    setTimeout(() => {
      this.isPlaying = false;
      this.ytPlayer.pause();
      document.getElementById('btn-play-pause').innerText = '▶️';
    }, 500);
  }

  triggerMasterNextTrack() {
    this.toneGen.playNextTrackSignal();
    this.ytPlayer.nextTrack();
    this.isPlaying = false;
    document.getElementById('btn-play-pause').innerText = '▶️';
    document.getElementById('master-track-title').innerText = `曲目 #${this.ytPlayer.currentIndex + 1}`;
    document.getElementById('master-track-index').innerText = `第 ${this.ytPlayer.currentIndex + 1} / ${this.config.urls.length} 首`;
  }

  // --- ACOUSTIC COMMAND DETECTION LISTENERS (FOR SLAVES) ---

  bindDSPCommandListeners() {
    // 1. Start Play Command (4000 Hz)
    this.dsp.on('cmdStart', () => {
      this.isPlaying = true;
      const currentSec = this.ytPlayer.getCurrentTime();
      if (currentSec > 0.5) {
        this.ytPlayer.seekTo(currentSec);
      }
      this.ytPlayer.play();
      this.updateSlaveUIStatus();
    });

    // 2. Pause Command (5000 Hz)
    this.dsp.on('cmdPause', () => {
      this.isPlaying = false;
      this.ytPlayer.pause();
      this.updateSlaveUIStatus();
    });

    // 3. Progress Sync Command (4500Hz + 10x0.2s FSK + 4500Hz)
    this.dsp.on('cmdProgressSync', (timeSec) => {
      if (!this.isPlaying) {
        const current = this.ytPlayer.getCurrentTime();
        if (Math.abs(current - timeSec) > 1.0) {
          this.ytPlayer.seekTo(timeSec);
        }
      }
    });

    // 4. Next Track Command (4900 Hz)
    this.dsp.on('cmdNextTrack', () => {
      this.ytPlayer.nextTrack();
      this.isPlaying = false;
      this.updateSlaveUIStatus();
    });

    // 5. Voice Part Toggle Command (4030/4060Hz...)
    this.dsp.on('partToggle', (data) => {
      this.partStates[data.part] = data.enable;
      if (this.assignedPart === data.part) {
        if (data.enable) {
          this.ytPlayer.unmute();
          this.isMuted = false;
        } else {
          this.ytPlayer.mute();
          this.isMuted = true;
        }
      }
      this.updateSlaveUIStatus();
    });
  }

  /**
   * Update Slave Visual Status Screen
   * Grey = Paused
   * Part Color Vibrant = Playing & Audio Active
   * Part Color Dim = Playing & Audio Muted
   */
  updateSlaveUIStatus() {
    if (this.role !== 'slave') return;

    const bgEl = document.getElementById('view-slave-status');
    const noteEl = document.getElementById('slave-music-note');
    const badgeEl = document.getElementById('slave-part-badge');

    const part = this.assignedPart;
    const baseColor = this.partColors[part] || '#64748b';
    const isPartAudioActive = this.partStates[part] !== false;

    if (!this.isPlaying) {
      // Paused State
      bgEl.style.backgroundColor = '#0a0e17';
      noteEl.style.color = '#64748b';
      noteEl.classList.remove('playing');
      badgeEl.innerText = `第 ${part} 聲部 (已暫停)`;
      badgeEl.style.borderColor = 'rgba(255,255,255,0.2)';
    } else {
      // Playing State
      noteEl.classList.add('playing');
      if (isPartAudioActive) {
        // Light Color (Playing & Audio Active)
        bgEl.style.backgroundColor = baseColor;
        noteEl.style.color = '#ffffff';
        badgeEl.innerText = `第 ${part} 聲部 (發聲中)`;
        badgeEl.style.borderColor = '#ffffff';
      } else {
        // Dark Color (Playing & Muted)
        bgEl.style.backgroundColor = '#0a0e17';
        noteEl.style.color = baseColor;
        badgeEl.innerText = `第 ${part} 聲部 (靜音中)`;
        badgeEl.style.borderColor = baseColor;
      }
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const app = new AppController();
  app.init();
});
