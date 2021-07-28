// import { log } from './Utils.mjs';

export default class Graph {
  constructor(title, canvas) {
    this.ctx = canvas.getContext('2d');
    this.title = title;
    this.samples = null;
    this.note = null;
    this.drawingRequested = false;
    this.redrawHandler = () => {
      this.draw();
    }
  }

  redraw() {
    if (!this.drawingRequested) {
      this.drawingRequested = true;
      window.requestAnimationFrame(this.redrawHandler);
    }
  }

  setNote(note) {
    if (this.note !== note) {
      this.note = note;
      this.redraw();
    }
  }

  setSamples(samples) {
    this.samples = samples;
    this.redraw();
  }

  draw() {
    this.drawingRequested = false;
    if (this.samples === null) { return; }
    if (this.samples.length <= 0) { return; }

    const maskedOffset = 1000 * 25 / 50;   // 500msec lag to remove choppy incoming data
    const timeOffset = 0; // maskedOffset

    const now = Date.now();

    let drawingActive = 0;

    {
      const ctx = this.ctx;

      // Actual pixel size (accounting for pixel density)
      const scale = 1; // window.devicePixelRatio;
      // Display size (in css pixels)
      const cssWidth = ctx.canvas.clientWidth;
      const cssHeight = ctx.canvas.clientHeight;

      if (ctx.canvas.width != cssWidth * scale) 
        ctx.canvas.width = cssWidth * scale;
      if (ctx.canvas.height != cssHeight * scale) 
        ctx.canvas.height = cssHeight * scale;

      const timeWindow = 10 * 1000 * cssWidth / 640;
      const maskedWidth = 1.20 * cssWidth * maskedOffset / (timeWindow > 0 ? timeWindow : 1);  // add 20% for gradient

      ctx.save();

      ctx.scale(scale, scale);

      ctx.clearRect(0, 0, cssWidth, cssHeight);

      // Shadow
      if (false) {
        ctx.save();
          ctx.globalCompositeOperation = 'xor';
          ctx.shadowOffsetX = 5;
          ctx.shadowOffsetY = 5;
          ctx.shadowColor = 'rgba(99,99,99,1.0)';
          ctx.shadowBlur = 15;
          ctx.fillStyle = 'rgba(0,0,0,1.0)';
          ctx.fillRect(0, 0, cssWidth, cssHeight);
        ctx.restore();
      }

      const verticalScale = 2;  // +/- 2g
      // Draw axis
      ctx.strokeStyle = 'rgba(100,100,100,0.8)';
      ctx.setLineDash([2, 2]);
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, cssHeight / 2); ctx.lineTo(cssWidth, cssHeight / 2); ctx.stroke();
      // Draw 1g lines
      ctx.strokeStyle = 'rgba(100,100,100,0.3)';
      ctx.setLineDash([5, 15]);
      ctx.lineWidth = 1;
      let ly;
      ly = cssHeight / 2 - 1 * cssHeight / 2 / verticalScale; ctx.beginPath(); ctx.moveTo(0, ly); ctx.lineTo(cssWidth, ly); ctx.stroke();
      ly = cssHeight / 2 + 1 * cssHeight / 2 / verticalScale; ctx.beginPath(); ctx.moveTo(0, ly); ctx.lineTo(cssWidth, ly); ctx.stroke();

      ctx.globalCompositeOperation = 'xor';
      
      let endSample = null;
      for (let chan = 0; chan < 3; chan++) {
        ctx.strokeStyle = ['rgba(255,100,100,0.5)', 'rgba(100,255,100,0.5)', 'rgba(100,100,255,0.5)'][chan];
        let lastX = null, lastY = null, lastSampleNumber = null;
        ctx.setLineDash([]);
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = this.samples.length - 1; i >= 0; i--) {
          let timeAgo = now - this.samples[i].estimatedTime - timeOffset;
          if (timeAgo < 0) { drawingActive++; continue; }  // skip future samples outside window

          let x = cssWidth - cssWidth * timeAgo / timeWindow;
          let y = (cssHeight / 2) - (cssHeight / 2 / verticalScale) * this.samples[i].accel[chan];

          if (lastSampleNumber !== null && this.samples[i].sampleNumber + 1 !== lastSampleNumber) {
            ctx.stroke();

            ctx.setLineDash([3, 3]);
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.lineTo(lastX, lastY);
            ctx.lineTo(x, y);
            ctx.stroke();

            ctx.setLineDash([]);
            ctx.lineWidth = 2;
            ctx.beginPath();
          }

          ctx.lineTo(x, y);
          lastX = x;
          lastY = y;
          lastSampleNumber = this.samples[i].sampleNumber;

          if (chan == 0) {
            if (endSample === null) { endSample = i; }
            drawingActive++;
          }

          if (timeAgo > timeWindow) {
            break;
          }
        }
        ctx.stroke();
      }

      // Angles
if (0)
      if (endSample !== null) {
        const [ax, ay, az] = this.samples[endSample].accel;
        const displays = [
          { offset: 0, label: 'XY', angle: Math.atan2(ay, ax), length: Math.sqrt(ax**2 + ay**2) },
          { offset: 1, label: 'XZ', angle: Math.atan2(az, ax), length: Math.sqrt(ax**2 + az**2) },
          { offset: 2, label: 'YZ', angle: Math.atan2(az, ay), length: Math.sqrt(ay**2 + az**2) },
        ];

        for (let display of displays) {
          let r = cssHeight / 8;
          let rr = display.length * r;
          let x = (display.offset + 1) * cssWidth / (displays.length + 1);
          let y = cssHeight - r;

          ctx.strokeStyle = 'rgba(100,100,100,0.8)';
          ctx.setLineDash([]);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, 2 * Math.PI);
          ctx.stroke();

          ctx.strokeStyle = 'rgba(100,100,100,0.8)';
          ctx.setLineDash([]);
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + rr * Math.cos(display.angle), y + rr * Math.sin(display.angle));
          ctx.stroke();
        }
      }

      ctx.save();
      const maskX1 = cssWidth;
      const maskX0 = maskX1 - maskedWidth;

      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = 'rgba(255,255,255,0.90)';
      if (true) {
        const gradient = ctx.createLinearGradient(maskX0, 0, maskX1, 0);
        gradient.addColorStop(0.0, 'rgba(255,255,255,0.00)');
        gradient.addColorStop(0.3, 'rgba(255,255,255,0.9)');
        ctx.fillStyle = gradient;
      }
      ctx.fillRect(maskX0, 0, maskX1 - maskX0, cssHeight);
      ctx.restore();

      ctx.font = '14px monospace';
      ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillText(this.title !== '' ? this.title : '-', 10, 10); 

      if (this.note !== null) {
        ctx.fillText(this.note, cssWidth - 10 - ctx.measureText(this.note).width, 10); 
      }

      ctx.restore();
    }

    if (drawingActive > 1) {
      this.drawingRequested = true;
      window.requestAnimationFrame(this.redrawHandler);
    }
  }

}
