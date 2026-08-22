import { AudioManager } from './audio/audio-context.js';
import { ToneGenerator } from './audio/tone-generator.js';
import { DSPAnalyzer } from './audio/dsp-analyzer.js';
import { SyncEngine } from './audio/sync-engine.js';
import { YouTubePlayerManager } from './youtube-player.js';
import { QRManager } from './qr-manager.js';
import { VolumeChart } from './audio/volume-chart.js';

class AppController {
  constructor() {
    this.am = new AudioManager();
    this.toneGen = new ToneGenerator(this.am);
    this.dsp = new DSPAnalyzer(this.am);
    this.syncEngine = new SyncEngine(this.am, this.toneGen, this.dsp);
    this.ytPlayer = new YouTubePlayerManager();
    this.qrManager = new QRManager();
    this.volumeChart = null;

    // App state
    this.role = null; // 'master' or 'slave'
    this.config = {
      range: '50m',
      zone: 'A',
      partCount: 4,
      tones: [261, 293, 329, 392, 440], // Default pentatonic tones
      urls: []
    };

    this.tonePresets = {
      pentatonic: [261, 293, 329, 392, 440],
      healing: [432, 528, 639, 741, 852],
      rainbow: [261, 329, 392, 493, 587],
      chords: [220, 261, 329, 440, 659]
    };

    this.assignedPart = 1; // Selected part for this device (1 to N)
    this.isPlaying = false;
    this.isMuted = false;
    this.partStates = {}; // { 1: true, 2: true, ... } true=playing, false=muted
    this.pauseSyncTimer = null;
    this.seekWasAdjusted = false;
    this.audioFileBuffer = null;
    this.audioFileName = '';
    this.reconstructedAudioFile = null;

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
    this.volumeChart = new VolumeChart('canvas-528-volume');
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
      'view-slave-status',
      'view-white-screen'
    ];
    views.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        if (id === viewId) el.classList.remove('hidden');
        else el.classList.add('hidden');
      }
    });

    if (viewId === 'view-syncing' && this.volumeChart) {
      this.volumeChart.start();
    }
  }

  updateSyncProgressUI(data) {
    const bar = document.getElementById('sync-progress-bar');
    const label = document.getElementById('sync-progress-text');
    if (bar) bar.style.width = `${data.percent}%`;
    if (label) label.innerText = `${data.percent}% (${data.elapsedSec} / ${data.totalSec} 秒)`;
  }

  updateFountainProgressUI(progress) {
    const bar = document.getElementById('fountain-progress-bar');
    const text = document.getElementById('fountain-progress-text');
    if (bar) bar.style.width = `${progress.percent}%`;
    if (text) text.innerText = `${progress.percent}% (${progress.resolvedCount} / ${progress.totalBlocks} 封包)`;
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

      const progBox = document.getElementById('fountain-progress-container');
      if (progBox) progBox.classList.remove('hidden');

      this.qrManager.startScanner(
        'reader',
        (data, reconstructedFile) => this.onSlaveQRScanned(data, reconstructedFile),
        (progress) => this.updateFountainProgressUI(progress)
      );
    });

    // 2. Master Setup Controls
    const rangeSelect = document.getElementById('select-range');
    rangeSelect.addEventListener('change', (e) => {
      this.config.range = e.target.value;
      const zoneBadge = document.getElementById('range-zone-badge');
      if (['10m','20m','50m'].includes(this.config.range)) {
        this.config.zone = 'A';
        zoneBadge.innerText = '區間 A (2Hz / 周期 0.5s)';
      } else if (['70m','100m'].includes(this.config.range)) {
        this.config.zone = 'B';
        zoneBadge.innerText = '區間 B (1Hz / 周期 1.0s)';
      } else {
        this.config.zone = 'C';
        zoneBadge.innerText = '區間 C (0.5Hz / 周期 2.0s)';
      }
    });

    document.getElementById('select-parts').addEventListener('change', (e) => {
      this.config.partCount = parseInt(e.target.value);
    });

    const audioFileInput = document.getElementById('input-audio-file');
    if (audioFileInput) {
      audioFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        const badge = document.getElementById('audio-file-badge');
        if (file) {
          if (file.size > 800 * 1024) {
            alert('檔案大小超過 800 KB 限制，請重新選擇較小的音檔！');
            audioFileInput.value = '';
            this.audioFileBuffer = null;
            this.audioFileName = '';
            if (badge) badge.innerText = '檔案過大 (>800KB)';
            return;
          }
          const reader = new FileReader();
          reader.onload = (evt) => {
            this.audioFileBuffer = evt.target.result;
            this.audioFileName = file.name;
            const sizeKb = Math.round(file.size / 1024);
            if (badge) badge.innerText = `已載入: ${file.name} (${sizeKb} KB)`;
          };
          reader.readAsArrayBuffer(file);
        } else {
          this.audioFileBuffer = null;
          this.audioFileName = '';
          if (badge) badge.innerText = '未選擇檔案';
        }
      });
    }

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
      // Start Optical Dynamic Animated QR Code Generator with Fountain Code Stream
      this.qrManager.startDynamicQR(
        'qrcode-canvas-container',
        this.config,
        this.audioFileBuffer,
        this.audioFileName
      );
    });

    // 3. Master Sync Trigger Button (Direct View Transition)
    document.getElementById('btn-start-sync-master').addEventListener('click', async () => {
      // Stop optical dynamic QR code animation
      this.qrManager.stopDynamicQR();

      this.syncEngine.configureRange(this.config.range);
      this.syncEngine.isCalibrated = true;
      this.syncEngine.t0 = performance.now();

      this.onCalibrationCompleted();
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
        this.onSlaveQRScanned(data, null);
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

  onSlaveQRScanned(data, reconstructedFile) {
    this.config = data;
    this.reconstructedAudioFile = reconstructedFile;
    this.syncEngine.configureRange(this.config.range);

    // Perform Optical Clock Alignment from Dynamic QR Frame
    if (data.clk && data.scanTime) {
      const periodMs = this.syncEngine.period * 1000;
      const localTimeOffset = performance.now() - data.scanTime;
      const estimatedMasterNow = data.clk + localTimeOffset;
      this.syncEngine.t0 = performance.now() - (estimatedMasterNow % periodMs);
    } else {
      this.syncEngine.t0 = performance.now();
    }
    this.syncEngine.isCalibrated = true;

    // Hide scanner, show part selection grid
    document.getElementById('scanner-box').classList.add('hidden');
    document.getElementById('part-selection-box').classList.remove('hidden');

    const grid = document.getElementById('slave-parts-grid');
    grid.innerHTML = '';

    const totalParts = Math.max(1, this.config.partCount);
    for (let i = 1; i <= totalParts; i++) {
      const btn = document.createElement('button');
      btn.className = 'part-select-btn';
      btn.innerText = `第 ${i} 聲部`;
      btn.addEventListener('click', () => {
        grid.querySelectorAll('.part-select-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        this.assignedPart = i;

        // Transition directly to Full White Interface (View 8) for audio tap verification
        this.showView('view-white-screen');
        this.setupSlaveWhiteScreenTap();
      });
      grid.appendChild(btn);
    }
  }

  setupSlaveWhiteScreenTap() {
    const whiteView = document.getElementById('view-white-screen');
    if (!whiteView) return;

    const subtext = document.querySelector('.white-screen-subtext');
    if (subtext) {
      subtext.innerText = this.reconstructedAudioFile
        ? '✨ 光學噴泉碼重組成功！請點擊螢幕任意處播放傳輸音檔驗證'
        : '✨ 光學同步完成！請點擊螢幕任意處進入狀態介面';
    }

    let hasTapped = false;
    const onTap = async () => {
      if (hasTapped) return;
      hasTapped = true;
      whiteView.removeEventListener('click', onTap);
      whiteView.removeEventListener('touchstart', onTap);

      await this.am.init();

      if (this.reconstructedAudioFile && this.reconstructedAudioFile.buffer) {
        if (subtext) subtext.innerText = '🎵 正在播放主控者上傳之音檔中...';
        try {
          const ctx = this.am.ctx;
          const audioBuffer = await ctx.decodeAudioData(this.reconstructedAudioFile.buffer.slice(0));
          const source = ctx.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(ctx.destination);
          source.onended = () => {
            this.onCalibrationCompleted();
          };
          source.start(0);
        } catch (err) {
          console.warn("Could not decode reconstructed audio file, proceeding to status:", err);
          this.onCalibrationCompleted();
        }
      } else {
        this.onCalibrationCompleted();
      }
    };

    whiteView.addEventListener('click', onTap);
    whiteView.addEventListener('touchstart', onTap);
  }

  onCalibrationCompleted() {
    // Initialize voice part default states (all enabled = true)
    for (let i = 1; i <= Math.max(8, this.config.partCount); i++) {
      this.partStates[i] = true;
    }

    this.ytPlayer.setPlaylist(this.config.urls);

    // Pre-warm YouTube player buffer for zero-latency start on mobile browsers
    if (this.ytPlayer.isReady) {
      this.ytPlayer.mute();
      this.ytPlayer.play();
      setTimeout(() => {
        this.ytPlayer.pause();
        this.ytPlayer.unmute();
      }, 150);
    }

    // Start common clock visual pulse loop
    this.startClockPulseLoop();

    if (this.role === 'master') {
      this.showView('view-master-control');
      this.renderMasterPartButtons();
      this.startMasterProgressUpdater();
    } else {
      this.showView('view-slave-status');
      this.updateSlaveUIStatus();
    }
  }

  startClockPulseLoop() {
    if (this.clockPulseLoopTimer) {
      clearInterval(this.clockPulseLoopTimer);
      this.clockPulseLoopTimer = null;
    }

    this.clockPulseLoopTimer = setInterval(() => {
      if (!this.syncEngine.isCalibrated || !this.syncEngine.t0) return;

      const now = performance.now();
      const periodMs = this.syncEngine.period * 1000;
      const elapsed = now - this.syncEngine.t0;
      const offsetInCycle = ((elapsed % periodMs) + periodMs) % periodMs;

      // Pulse white ball for 0.5s (500ms) at start of each common clock cycle
      const pulseDurationMs = Math.min(500, periodMs);
      const isActive = offsetInCycle < pulseDurationMs;

      const masterBall = document.getElementById('master-clk-ball');
      const slaveBall = document.getElementById('slave-clk-ball');
      [masterBall, slaveBall].filter(Boolean).forEach(ball => {
        if (isActive) ball.classList.add('active');
        else ball.classList.remove('active');
      });
    }, 20);
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
    // Stop continuous pause sync loop
    this.stopPauseProgressLoop();

    // Transmit final 3.0s progress calibration signal
    const currentSec = this.ytPlayer.getCurrentTime();
    this.toneGen.playProgressSignal(currentSec);

    // Wait 3.0s for progress signal to complete, then trigger start signal on next common clk cycle
    setTimeout(() => {
      const delayToNextCycle = this.syncEngine.getTimeToNextCycleStart();
      const periodMs = this.syncEngine.period * 1000;

      // Schedule 4000Hz start tone at next cycle + 50ms
      setTimeout(() => {
        this.toneGen.playStartSignal();
      }, delayToNextCycle + 50);

      // Synchronously start playback on cycle boundary immediately following start tone
      setTimeout(() => {
        this.isPlaying = true;
        this.ytPlayer.play();
        document.getElementById('btn-play-pause').innerText = '⏸️';
      }, delayToNextCycle + periodMs);
    }, 3000);
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
      if (!this.isPlaying && this.role === 'master' && this.syncEngine.isCalibrated) {
        const currentTime = this.ytPlayer.getCurrentTime();
        this.toneGen.playProgressSignal(currentTime);
      }
    }, 5000); // Repeat every 5 seconds while paused
  }

  stopPauseProgressLoop() {
    if (this.pauseSyncTimer) {
      clearInterval(this.pauseSyncTimer);
      this.pauseSyncTimer = null;
    }
  }

  // --- ACOUSTIC COMMAND DETECTION LISTENERS (FOR SLAVES & MASTER) ---

  bindDSPCommandListeners() {
    // 0. Real-time 528Hz Volume Visualizer Update
    this.dsp.on('energy528Update', (data) => {
      if (this.volumeChart) {
        this.volumeChart.addSample(data.energy);
      }
      const tag = document.getElementById('volume-current-tag');
      if (tag) {
        tag.innerText = `目前音量: ${Math.round(data.energy)}`;
      }
    });

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

    // 3. Progress Sync Command (4500Hz + 10x0.2s FSK + 4500Hz)
    this.dsp.on('cmdProgressSync', (timeSec) => {
      if (!this.isPlaying) {
        const current = this.ytPlayer.getCurrentTime();
        if (Math.abs(current - timeSec) > 1.0) { // Only adjust if time diff > 1 second
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
