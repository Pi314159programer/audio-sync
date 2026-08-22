/**
 * Real-time Canvas Chart for 10-Second 528Hz Received Volume Monitoring
 */
export class VolumeChart {
  /**
   * @param {HTMLCanvasElement|string} canvasElementOrId 
   */
  constructor(canvasElementOrId) {
    this.canvas = typeof canvasElementOrId === 'string'
      ? document.getElementById(canvasElementOrId)
      : canvasElementOrId;

    if (!this.canvas) {
      console.warn("VolumeChart: Canvas element not found!");
      return;
    }

    this.ctx = this.canvas.getContext('2d');
    this.isRendering = false;
    this.animFrameId = null;
    this.dataHistory = []; // [{ time: number, energy: number }]
    this.currentEnergy = 0;
    this.threshold = 140;

    window.addEventListener('resize', () => {
      this.lastRectWidth = 0; // Force resize check on window resize
    });
  }

  /**
   * Add a new energy data point
   * @param {number} energy Energy value 0-255
   */
  addSample(energy) {
    const now = performance.now();
    this.currentEnergy = energy;
    this.dataHistory.push({ time: now, energy });
    this.pruneOldData(now);
  }

  pruneOldData(now = performance.now()) {
    const windowMs = 10000; // 10 seconds window
    this.dataHistory = this.dataHistory.filter(d => (now - d.time) <= windowMs);
  }

  start() {
    if (this.isRendering) return;
    this.isRendering = true;

    const renderLoop = () => {
      if (!this.isRendering) return;
      this.draw();
      this.animFrameId = requestAnimationFrame(renderLoop);
    };
    renderLoop();
  }

  stop() {
    this.isRendering = false;
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  draw() {
    if (!this.ctx || !this.canvas) return;
    const ctx = this.ctx;
    const now = performance.now();
    this.pruneOldData(now);

    // Measure actual rendered canvas size from DOM
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return; // Skip if element is hidden (display: none)

    const dpr = window.devicePixelRatio || 1;
    const targetPixelWidth = Math.floor(rect.width * dpr);
    const targetPixelHeight = Math.floor(rect.height * dpr);

    if (this.canvas.width !== targetPixelWidth || this.canvas.height !== targetPixelHeight) {
      this.canvas.width = targetPixelWidth;
      this.canvas.height = targetPixelHeight;
    }

    this.width = rect.width;
    this.height = rect.height;

    // Reset matrix & scale for crisp high-DPI rendering
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const w = this.width;
    const h = this.height;

    const paddingLeft = 45;
    const paddingRight = 15;
    const paddingTop = 22;
    const paddingBottom = 30;

    const plotWidth = Math.max(10, w - paddingLeft - paddingRight);
    const plotHeight = Math.max(10, h - paddingTop - paddingBottom);

    // Clear background
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0a0e17';
    ctx.fillRect(0, 0, w, h);

    // Draw Grid & Axes Lines
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';

    // Y Grid Lines & Ticks (0, 64, 128, 192, 255)
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    const yLevels = [0, 64, 128, 192, 255];
    yLevels.forEach(val => {
      const y = paddingTop + (1 - val / 255) * plotHeight;
      ctx.beginPath();
      ctx.moveTo(paddingLeft, y);
      ctx.lineTo(w - paddingRight, y);
      ctx.stroke();

      ctx.fillText(val.toString(), paddingLeft - 6, y);
    });

    // Y Axis Title
    ctx.textAlign = 'left';
    ctx.fillText('音量', 8, 12);

    // X Grid Lines & Ticks (-10s, -7.5s, -5s, -2.5s, 0s)
    const xTimeSteps = [
      { offsetSec: -10, label: '-10s' },
      { offsetSec: -7.5, label: '-7.5s' },
      { offsetSec: -5, label: '-5s' },
      { offsetSec: -2.5, label: '-2.5s' },
      { offsetSec: 0, label: '0s (現在)' }
    ];

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    xTimeSteps.forEach(step => {
      const ratio = (step.offsetSec + 10) / 10;
      const x = paddingLeft + ratio * plotWidth;

      ctx.beginPath();
      ctx.moveTo(x, paddingTop);
      ctx.lineTo(x, h - paddingBottom);
      ctx.stroke();

      ctx.fillText(step.label, x, h - paddingBottom + 6);
    });

    // X Axis Title
    ctx.fillText('時間 (最近 10 秒內部動態視窗)', paddingLeft + plotWidth / 2, h - 12);

    // Draw Threshold Line (140)
    const thresholdY = paddingTop + (1 - this.threshold / 255) * plotHeight;
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.7)'; // Amber
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(paddingLeft, thresholdY);
    ctx.lineTo(w - paddingRight, thresholdY);
    ctx.stroke();

    ctx.fillStyle = '#f59e0b';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText('門檻 140', w - paddingRight - 4, thresholdY - 2);
    ctx.restore();

    // Plot 528Hz Energy Waveform Curve (10s Window)
    const windowMs = 10000;
    const startTime = now - windowMs;

    const validSamples = this.dataHistory.filter(d => d.time >= startTime);
    const points = [];

    // Always start curve at x = paddingLeft (t = -10s)
    const startEnergy = validSamples.length > 0 ? validSamples[0].energy : 0;
    points.push({
      x: paddingLeft,
      y: paddingTop + (1 - Math.min(255, startEnergy) / 255) * plotHeight,
      energy: startEnergy
    });

    // Add all samples recorded in the 10s window
    for (let i = 0; i < validSamples.length; i++) {
      const pt = validSamples[i];
      const relTime = pt.time - startTime;
      const x = paddingLeft + (relTime / windowMs) * plotWidth;
      const y = paddingTop + (1 - Math.min(255, pt.energy) / 255) * plotHeight;
      points.push({ x, y, energy: pt.energy });
    }

    // Always end curve at x = paddingLeft + plotWidth (t = 0s / now)
    const endEnergy = validSamples.length > 0 ? validSamples[validSamples.length - 1].energy : this.currentEnergy;
    points.push({
      x: paddingLeft + plotWidth,
      y: paddingTop + (1 - Math.min(255, endEnergy) / 255) * plotHeight,
      energy: endEnergy
    });

    // Draw Continuous Waveform Line
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }

    ctx.strokeStyle = '#06b6d4'; // Cyan
    ctx.lineWidth = 2.5;
    ctx.shadowColor = '#06b6d4';
    ctx.shadowBlur = 8;
    ctx.stroke();

    // Fill Area Under Waveform
    const fillPath = new Path2D();
    fillPath.moveTo(paddingLeft, paddingTop + plotHeight);
    points.forEach(p => fillPath.lineTo(p.x, p.y));
    fillPath.lineTo(paddingLeft + plotWidth, paddingTop + plotHeight);
    fillPath.closePath();

    const grad = ctx.createLinearGradient(0, paddingTop, 0, paddingTop + plotHeight);
    grad.addColorStop(0, 'rgba(6, 182, 212, 0.35)');
    grad.addColorStop(1, 'rgba(6, 182, 212, 0.0)');
    ctx.fillStyle = grad;
    ctx.shadowBlur = 0;
    ctx.fill(fillPath);

    // Draw current volume dot on the right edge
    const lastPoint = points[points.length - 1];
    ctx.fillStyle = endEnergy > this.threshold ? '#10b981' : '#06b6d4';
    ctx.beginPath();
    ctx.arc(lastPoint.x, lastPoint.y, 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}
