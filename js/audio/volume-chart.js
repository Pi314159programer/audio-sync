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

    this.initCanvasSize();
    window.addEventListener('resize', () => this.initCanvasSize());
  }

  initCanvasSize() {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.width = rect.width || 520;
    this.height = rect.height || 180;

    this.canvas.width = this.width * dpr;
    this.canvas.height = this.height * dpr;
    this.ctx.scale(dpr, dpr);
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

    const w = this.width;
    const h = this.height;

    const paddingLeft = 45;
    const paddingRight = 15;
    const paddingTop = 25;
    const paddingBottom = 30;

    const plotWidth = w - paddingLeft - paddingRight;
    const plotHeight = h - paddingTop - paddingBottom;

    // Clear background
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(10, 14, 23, 0.85)';
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

    // Plot 528Hz Energy Waveform Curve
    if (this.dataHistory.length > 0) {
      const windowMs = 10000;
      const startTime = now - windowMs;

      ctx.save();
      ctx.beginPath();

      const points = [];
      for (let i = 0; i < this.dataHistory.length; i++) {
        const pt = this.dataHistory[i];
        const relTime = pt.time - startTime;
        const x = paddingLeft + (relTime / windowMs) * plotWidth;
        const y = paddingTop + (1 - Math.min(255, pt.energy) / 255) * plotHeight;
        points.push({ x, y, energy: pt.energy });
      }

      // If missing data at start/end, add boundary points for clean display
      if (points.length > 0) {
        const firstPt = points[0];
        if (firstPt.x > paddingLeft) {
          points.unshift({ x: paddingLeft, y: firstPt.y, energy: firstPt.energy });
        }
        const lastPt = points[points.length - 1];
        if (lastPt.x < paddingLeft + plotWidth) {
          points.push({ x: paddingLeft + plotWidth, y: lastPt.y, energy: lastPt.energy });
        }
      }

      // Draw Path
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
      }

      // Stroke Line with Glow Effect
      ctx.strokeStyle = '#06b6d4'; // Cyan
      ctx.lineWidth = 2.5;
      ctx.shadowColor = '#06b6d4';
      ctx.shadowBlur = 10;
      ctx.stroke();

      // Fill Gradient Area Under Curve
      const fillPath = new Path2D();
      fillPath.moveTo(paddingLeft, h - paddingBottom);
      points.forEach(p => fillPath.lineTo(p.x, p.y));
      fillPath.lineTo(paddingLeft + plotWidth, h - paddingBottom);
      fillPath.closePath();

      const grad = ctx.createLinearGradient(0, paddingTop, 0, h - paddingBottom);
      grad.addColorStop(0, 'rgba(6, 182, 212, 0.35)');
      grad.addColorStop(1, 'rgba(6, 182, 212, 0.0)');
      ctx.fillStyle = grad;
      ctx.shadowBlur = 0;
      ctx.fill(fillPath);

      // Draw current value indicator dot at the latest point
      const lastPoint = points[points.length - 1];
      ctx.fillStyle = this.currentEnergy > this.threshold ? '#10b981' : '#06b6d4';
      ctx.beginPath();
      ctx.arc(lastPoint.x, lastPoint.y, 5, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }
  }
}
