import { AudioManager } from './audio/audio-context.js';
import { ToneGenerator } from './audio/tone-generator.js';
import { DSPAnalyzer } from './audio/dsp-analyzer.js';
import { SyncEngine } from './audio/sync-engine.js';
import { YouTubePlayerManager } from './youtube-player.js';
import { QRManager } from './qr-manager.js';

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

    this.assignedPart = 0; // Selected part for this device (0 to N)
    this.isPlaying = false;
    this.isMuted = false;
    this.partStates = {}; // { 1: true, 2: true, ... } true=playing, false=muted
    this.pauseSyncTimer = null;
    this.seekWasAdjusted = false;

    // Voice Part Color Mapping
    this.partColors = {
      0: '#64748b',
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
      'view-slave-setup',
      'view-syncing',
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
      this.qrManager.startScanner('reader', (data) => this.onSlaveQRScanned(data));
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
      this.qrManager.renderQRCode('qrcode-canvas-container', this.config);
    });

    // 3. Master Sync Trigger Button
    document.getElementById('btn-start-sync-master').addEventListener('click', async () => {
      this.showView('view-syncing');
      this.syncEngine.configureRange(this.config.range);
      
      this.syncEngine.on('syncComplete', () => {
        this.onCalibrationCompleted();
      });

      await this.syncEngine.startCalibration(true);
    });

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

  onSlaveQRScanned(data) {
    this.config = data;
    this.syncEngine.configureRange(this.config.range);

    // Hide scanner, show part selection grid
    document.getElementById('scanner-box').classList.add('hidden');
    document.getElementById('part-selection-box').classList.remove('hidden');

    const grid = document.getElementById('slave-parts-grid');
    grid.innerHTML = '';

    for (let i = 0; i <= this.config.partCount; i++) {
      const btn = document.createElement('button');
      btn.className = 'part-select-btn';
      btn.innerText = i === 0 ? '0 聲部 (預設)' : `第 ${i} 聲部`;
      btn.addEventListener('click', () => {
        grid.querySelectorAll('.part-select-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        this.assignedPart = i;

        // Hide part select, show waiting box
        document.getElementById('part-selection-box').classList.add('hidden');
        document.getElementById('slave-waiting-box').classList.remove('hidden');

        // Start listening for master 528Hz calibration signal
        this.listenForSlaveCalibration();
      });
      grid.appendChild(btn);
    }
  }

  async listenForSlaveCalibration() {
    await this.am.startMicrophone();
    this.dsp.start();

    this.dsp.on('pulse528', () => {
      this.showView('view-syncing');
      this.syncEngine.on('syncComplete', () => {
        this.onCalibrationCompleted();
      });
      this.syncEngine.startCalibration(false);
    });
  }

  onCalibrationCompleted() {
    // Initialize voice part default states (all enabled = true)
    for (let i = 1; i <= Math.max(8, this.config.partCount); i++) {
      this.partStates[i] = true;
    }

    this.ytPlayer.setPlaylist(this.config.urls);

    if (this.role === 'master') {
      this.showView('view-master-control');
      this.renderMasterPartButtons();
      this.startMasterProgressUpdater();
    } else {
      this.showView('view-slave-status');
      this.updateSlaveUIStatus();
    }
  }

  renderMasterPartButtons() {
    const container = document.getElementById('master-part-buttons');
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
    const delayToNextCycle = this.syncEngine.getTimeToNextCycleStart();
    const periodMs = this.syncEngine.period * 1000;

    let preCycles = 0;
    if (this.seekWasAdjusted) {
      preCycles = 2; // Wait 2 extra clock cycles for progress sync
      this.seekWasAdjusted = false;
    }

    // Schedule 0.5s 4000Hz start tone at next cycle + 0.05s
    setTimeout(() => {
      if (preCycles > 0) {
        // Transmit progress seek calibration tone during preCycles
        this.toneGen.playProgressSignal(this.ytPlayer.getCurrentTime());
      }
      this.toneGen.playStartSignal();
    }, delayToNextCycle + (preCycles * periodMs) + 50);

    // Synchronously start playback on the cycle IMMEDIATELY following the start signal
    setTimeout(() => {
      this.isPlaying = true;
      this.ytPlayer.play();
      document.getElementById('btn-play-pause').innerText = '⏸️';
      this.stopPauseProgressLoop();
    }, delayToNextCycle + ((preCycles + 1) * periodMs));
  }

  triggerMasterPause() {
    const delayToNextCycle = this.syncEngine.getTimeToNextCycleStart();
    const periodMs = this.syncEngine.period * 1000;

    // Schedule 0.5s 5000Hz pause tone at next cycle + 0.05s
    setTimeout(() => {
      this.toneGen.playPauseSignal();
    }, delayToNextCycle + 50);

    // Synchronously pause playback on the cycle IMMEDIATELY following the pause signal
    setTimeout(() => {
      this.isPlaying = false;
      this.ytPlayer.pause();
      document.getElementById('btn-play-pause').innerText = '▶️';
      this.startPauseProgressLoop();
    }, delayToNextCycle + periodMs);
  }

  triggerMasterNextTrack() {
    this.toneGen.playNextTrackSignal();
    this.ytPlayer.nextTrack();
    this.isPlaying = false;
    document.getElementById('btn-play-pause').innerText = '▶️';
    document.getElementById('master-track-title').innerText = `曲目 #${this.ytPlayer.currentIndex + 1}`;
    document.getElementById('master-track-index').innerText = `第 ${this.ytPlayer.currentIndex + 1} / ${this.config.urls.length} 首`;
  }

  startPauseProgressLoop() {
    this.stopPauseProgressLoop();
    this.pauseSyncTimer = setInterval(() => {
      if (!this.isPlaying && this.role === 'master') {
        const currentTime = this.ytPlayer.getCurrentTime();
        this.toneGen.playProgressSignal(currentTime);
      }
    }, 3000);
  }

  stopPauseProgressLoop() {
    if (this.pauseSyncTimer) {
      clearInterval(this.pauseSyncTimer);
      this.pauseSyncTimer = null;
    }
  }

  // --- ACOUSTIC COMMAND DETECTION LISTENERS (FOR SLAVES & MASTER) ---

  bindDSPCommandListeners() {
    // 1. Start Play Command (4000 Hz)
    this.dsp.on('cmdStart', () => {
      const delayToNextCycle = this.syncEngine.getTimeToNextCycleStart();
      setTimeout(() => {
        this.isPlaying = true;
        this.ytPlayer.play();
        this.updateSlaveUIStatus();
      }, delayToNextCycle);
    });

    // 2. Pause Command (5000 Hz)
    this.dsp.on('cmdPause', () => {
      const delayToNextCycle = this.syncEngine.getTimeToNextCycleStart();
      setTimeout(() => {
        this.isPlaying = false;
        this.ytPlayer.pause();
        this.updateSlaveUIStatus();
      }, delayToNextCycle);
    });

    // 3. Progress Sync Command (4500Hz + FSK)
    this.dsp.on('cmdProgressSync', (timeSec) => {
      if (!this.isPlaying) {
        this.ytPlayer.seekTo(timeSec);
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
