"use strict";
(() => {
  const canvas = document.getElementById("fire");
  const ctx = canvas.getContext("2d", { alpha: false });
  const TAU = Math.PI * 2;
  const STEP = 1 / 60;
  const CELL = 40;
  const CELL_INFLUENCE = CELL * 2.5;
  const BUCKET = CELL * 2;
  const BUCKET_RADIUS = Math.ceil(CELL_INFLUENCE / BUCKET);
  const MAX_LOG_PARTICLES = 96;
  const MAX_PARTICLES = 2600;
  const MAX_HEARTH_LOGS = 8;
  const AMBIENT = 20;
  const IGNITION = 290;
  const BURN_TEMP = 820;
  let width = 1;
  let height = 1;
  let dpr = 1;
  let particles = [];
  let drag = null;
  let activePointer = null;
  let offsetX = 0;
  let offsetY = 0;
  let last = 0;
  let accumulator = 0;
  let cellsByBucket = new Map();

  class Log {
    constructor(x, y, angle, burning = false) {
      this.x = x;
      this.y = y;
      this.angle = angle;
      this.cols = 7 + Math.floor(Math.random() * 5);
      this.rows = 4 + Math.floor(Math.random() * 3);
      this.count = this.cols * this.rows;
      this.halfW = (this.cols * CELL) / 2;
      this.halfH = (this.rows * CELL) / 2;
      this.temp = new Float64Array(this.count).fill(AMBIENT);
      this.delta = new Float64Array(this.count);
      this.fuel = new Float64Array(this.count).fill(1);
      this.burning = new Uint8Array(this.count);
      this.emission = new Float64Array(this.count);
      this.particleCount = 0;
      this.updateBasis();
      if (burning) this.ignite(2);
    }

    updateBasis() {
      this.ux = Math.cos(this.angle);
      this.uy = Math.sin(this.angle);
    }

    ignite(count = 1) {
      for (let i = 0; i < count; i++) {
        const cell = Math.floor(Math.random() * this.count);
        this.burning[cell] = 1;
        this.temp[cell] = BURN_TEMP;
      }
    }

    cellWorld(index, out) {
      const column = index % this.cols;
      const row = (index / this.cols) | 0;
      const localX = (column + 0.5) * CELL - this.halfW;
      const localY = (row + 0.5) * CELL - this.halfH;
      out.x = this.x + localX * this.ux - localY * this.uy;
      out.y = this.y + localX * this.uy + localY * this.ux;
    }

    contains(x, y, margin = 0) {
      const dx = x - this.x;
      const dy = y - this.y;
      const localX = dx * this.ux + dy * this.uy;
      const localY = -dx * this.uy + dy * this.ux;
      return (
        Math.abs(localX) <= this.halfW + margin &&
        Math.abs(localY) <= this.halfH + margin
      );
    }

    constrain() {
      const extentX =
        Math.abs(this.ux) * this.halfW + Math.abs(this.uy) * this.halfH;
      const extentY =
        Math.abs(this.ux) * this.halfH + Math.abs(this.uy) * this.halfW;
      this.x =
        width < extentX * 2
          ? width / 2
          : Math.max(extentX, Math.min(width - extentX, this.x));
      this.y =
        height < extentY * 2
          ? height / 2
          : Math.max(extentY, Math.min(height - extentY, this.y));
    }

    clearDelta() {
      this.delta.fill(0);
    }

    transferTo(other, thisCell, otherCell, distance, dt) {
      const separation = Math.max(0, distance - CELL);
      const coupling =
        separation <= CELL * 0.05
          ? 1
          : 0.8 * Math.exp(-separation / (CELL * 1.5));
      const heat =
        (this.temp[thisCell] - other.temp[otherCell]) * coupling * dt;
      this.delta[thisCell] -= heat;
      other.delta[otherCell] += heat;
    }

    conduct(a, b, dt) {
      const heat = (this.temp[a] - this.temp[b]) * 0.35 * dt;
      this.delta[a] -= heat;
      this.delta[b] += heat;
    }

    update(dt) {
      for (let cell = 0; cell < this.count; cell++) {
        let temperature = this.temp[cell] + this.delta[cell];
        temperature -= (temperature - AMBIENT) * 0.075 * dt;
        if (!this.burning[cell] && this.fuel[cell] > 0 && temperature >= IGNITION) {
          this.burning[cell] = 1;
        }
        if (this.burning[cell]) {
          this.fuel[cell] = Math.max(0, this.fuel[cell] - dt / 100);
          if (this.fuel[cell] === 0 || temperature < 190) {
            this.burning[cell] = 0;
          } else {
            temperature += (BURN_TEMP - temperature) * 1.5 * dt;
          }
        }
        this.temp[cell] = Math.max(AMBIENT, temperature);
      }
    }

    emit(dt, logIndex) {
      const position = { x: 0, y: 0 };
      for (let cell = 0; cell < this.count; cell++) {
        if (!this.burning[cell]) continue;
        this.emission[cell] += dt * 2.2;
        while (this.emission[cell] >= 1) {
          this.emission[cell]--;
          if (this.particleCount >= MAX_LOG_PARTICLES || particles.length >= MAX_PARTICLES) {
            continue;
          }
          this.cellWorld(cell, position);
          const life = 0.4 + Math.random() * 0.75;
          particles.push({
            x: position.x + (Math.random() - 0.5) * CELL * 0.8,
            y: position.y + (Math.random() - 0.5) * CELL * 0.8,
            vx: (Math.random() - 0.5) * 36,
            vy: -35 - Math.random() * 55,
            age: 0,
            life,
            size: 4 + Math.random() * 6,
            phase: Math.random() * TAU,
            logIndex,
          });
          this.particleCount++;
        }
      }
    }

    render(context) {
      context.save();
      context.translate(this.x, this.y);
      context.rotate(this.angle);
      let ignited = 0;
      for (let cell = 0; cell < this.count; cell++) {
        const temperature = this.temp[cell];
        const char = 1 - this.fuel[cell];
        const hot = Math.max(0, Math.min(1, (temperature - 170) / 650));
        if (this.burning[cell]) ignited++;
        context.fillStyle = `rgb(${Math.round(97 - char * 67 + hot * 65)},${Math.round(60 - char * 40)},${Math.round(34 - char * 23)})`;
        context.fillRect(
          (cell % this.cols) * CELL - this.halfW,
          ((cell / this.cols) | 0) * CELL - this.halfH,
          CELL,
          CELL,
        );
      }
      const ignition = ignited / this.count;
      const visibility = 4 * ignition * (1 - ignition);
      if (visibility > 0.001) {
        const outline = 3 * ignition + 0.5;
        context.lineJoin = "round";
        context.lineCap = "round";
        context.lineWidth = outline;
        context.strokeStyle = `rgba(255,${Math.round(190 - ignition * 115)},${Math.round(150 - ignition * 135)},${visibility * 0.9})`;
        context.beginPath();
        context.roundRect(
          -this.halfW - outline * 0.5,
          -this.halfH - outline * 0.5,
          this.halfW * 2 + outline,
          this.halfH * 2 + outline,
          4,
        );
        context.stroke();
      }
      context.restore();
    }
  }

  class Hearth {
    constructor() {
      this.logs = [];
      this.width = 0;
      this.height = 0;
    }

    get count() {
      return this.logs.length;
    }

    get canAcceptLog() {
      return this.logs.length < MAX_HEARTH_LOGS;
    }

    resize(width, height) {
      this.width = width;
      this.height = height;
      for (const log of this.logs) log.constrain();
    }

    addLog(burning = false) {
      if (!this.canAcceptLog) return null;
      const angle = Math.PI / 2 - Math.random() * (Math.PI / 4);
      const log = new Log(this.width / 2, this.height / 2, angle, burning);
      this.logs.push(log);
      return log;
    }

    clear() {
      this.logs.length = 0;
    }

    buildCellIndex() {
      cellsByBucket.clear();
      const position = { x: 0, y: 0 };
      this.logs.forEach((log, logIndex) => {
        for (let cell = 0; cell < log.count; cell++) {
          log.cellWorld(cell, position);
          const key = bucketKey(position.x, position.y);
          let bucket = cellsByBucket.get(key);
          if (!bucket) {
            bucket = [];
            cellsByBucket.set(key, bucket);
          }
          bucket.push(logIndex, cell, position.x, position.y);
        }
      });
    }

    transferHeat(dt) {
      const position = { x: 0, y: 0 };
      this.logs.forEach((log, logIndex) => {
        for (let cell = 0; cell < log.count; cell++) {
          log.cellWorld(cell, position);
          const baseX = Math.floor(position.x / BUCKET);
          const baseY = Math.floor(position.y / BUCKET);
          for (let bucketY = baseY - BUCKET_RADIUS; bucketY <= baseY + BUCKET_RADIUS; bucketY++) {
            for (let bucketX = baseX - BUCKET_RADIUS; bucketX <= baseX + BUCKET_RADIUS; bucketX++) {
              const bucket = cellsByBucket.get(bucketKey(bucketX * BUCKET, bucketY * BUCKET));
              if (!bucket) continue;
              for (let entry = 0; entry < bucket.length; entry += 4) {
                const otherLogIndex = bucket[entry];
                if (otherLogIndex <= logIndex) continue;
                const otherLog = this.logs[otherLogIndex];
                const otherCell = bucket[entry + 1];
                const dx = bucket[entry + 2] - position.x;
                const dy = bucket[entry + 3] - position.y;
                const distance = Math.hypot(dx, dy);
                if (distance > CELL_INFLUENCE) continue;
                log.transferTo(otherLog, cell, otherCell, distance, dt);
              }
            }
          }
        }
        for (let cell = 0; cell < log.count; cell++) {
          const row = (cell / log.cols) | 0;
          const column = cell % log.cols;
          if (column + 1 < log.cols) log.conduct(cell, cell + 1, dt);
          if (row + 1 < log.rows) log.conduct(cell, cell + log.cols, dt);
        }
      });
    }

    update(dt) {
      for (const log of this.logs) log.clearDelta();
      this.buildCellIndex();
      this.transferHeat(dt);
      for (const log of this.logs) log.update(dt);
    }

    emit(dt) {
      this.logs.forEach((log, index) => log.emit(dt, index));
    }

    renderGlow(context) {
      for (const log of this.logs) {
        let average = 0;
        for (let cell = 0; cell < log.count; cell++) average += log.temp[cell];
        average /= log.count;
        if (average < 110) continue;
        const strength = Math.max(0, Math.min(1, (average - 110) / 710));
        const radius = Math.max(log.halfW, log.halfH) + 85;
        const glow = context.createRadialGradient(log.x, log.y, 0, log.x, log.y, radius);
        glow.addColorStop(0, `rgba(255,85,12,${strength * 0.2})`);
        glow.addColorStop(1, "rgba(255,45,0,0)");
        context.fillStyle = glow;
        context.fillRect(log.x - radius, log.y - radius, radius * 2, radius * 2);
      }
    }

    renderLogs(context) {
      for (const log of this.logs) log.render(context);
    }
  }

  const hearth = new Hearth();

  canvas.addEventListener("pointerdown", onClicked);
  canvas.addEventListener("pointermove", event => {
    if (!drag || event.pointerId !== activePointer) return;
    drag.x = event.clientX + offsetX;
    drag.y = event.clientY + offsetY;
    drag.constrain();
  });
  canvas.addEventListener("pointerup", onRelease);
  canvas.addEventListener("pointercancel", onRelease);
  canvas.addEventListener("lostpointercapture", onRelease);
  window.addEventListener("resize", resize);
  document.getElementById("reset").addEventListener("click", reset);
  document.getElementById("add-log").addEventListener("click", () => {
    hearth.addLog(false);
  });
  document.addEventListener("visibilitychange", () => {
    last = 0;
    accumulator = 0;
  });

  resize();
  reset();
  requestAnimationFrame(frame);

  function bucketKey(x, y) {
    return (Math.floor(x / BUCKET) + 4096) * 8192 + (Math.floor(y / BUCKET) + 4096);
  }

  function reset() {
    drag = null;
    activePointer = null;
    canvas.classList.remove("dragging");
    particles.length = 0;
    hearth.clear();
    hearth.addLog(true);
    accumulator = 0;
  }

  function update(dt) {
    hearth.update(dt);
    hearth.emit(dt);
    updateParticles(dt);
  }

  function updateParticles(dt) {
    for (let index = particles.length - 1; index >= 0; index--) {
      const particle = particles[index];
      particle.age += dt;
      if (particle.age >= particle.life) {
        hearth.logs[particle.logIndex].particleCount--;
        particles[index] = particles[particles.length - 1];
        particles.pop();
        continue;
      }
      particle.x += (particle.vx + Math.sin(particle.age * 9 + particle.phase) * 14) * dt;
      particle.y += particle.vy * dt;
      particle.vy -= 18 * dt;
    }
  }

  function onClicked(event) {
    if (activePointer !== null || event.button !== 0) return;
    for (let index = hearth.logs.length - 1; index >= 0; index--) {
      const log = hearth.logs[index];
      if (!log.contains(event.clientX, event.clientY, 5)) continue;
      drag = log;
      activePointer = event.pointerId;
      offsetX = log.x - event.clientX;
      offsetY = log.y - event.clientY;
      hearth.logs.splice(index, 1);
      hearth.logs.push(log);
      canvas.setPointerCapture(event.pointerId);
      canvas.classList.add("dragging");
      return;
    }
  }

  function onRelease(event) {
    if (event.pointerId !== activePointer) return;
    drag = null;
    activePointer = null;
    canvas.classList.remove("dragging");
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  }

  function renderHearth(context) {
    const hearthWidth = Math.min(width * 0.72, 900);
    const hearthHeight = hearthWidth * (4 / 6);
    const x = width / 2 - hearthWidth / 2;
    const y = height / 2 - hearthHeight / 2;
    context.strokeStyle = "rgba(231,226,217,0.16)";
    context.lineWidth = 3;
    context.strokeRect(x, y, hearthWidth, hearthHeight);
  }

  function render() {
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#090b10";
    ctx.fillRect(0, 0, width, height);
    renderHearth(ctx);
    hearth.renderGlow(ctx);
    hearth.renderLogs(ctx);
    ctx.globalCompositeOperation = "lighter";
    for (const particle of particles) {
      const t = particle.age / particle.life;
      const radius = particle.size * (1 - t) + 0.5;
      const flame = ctx.createRadialGradient(particle.x, particle.y, 0, particle.x, particle.y, radius);
      flame.addColorStop(0, `rgba(255,${Math.round(220 - 110 * t)},65,${(1 - t) * 0.85})`);
      flame.addColorStop(0.4, `rgba(255,${Math.round(125 - 75 * t)},8,${(1 - t) * 0.55})`);
      flame.addColorStop(1, "rgba(180,15,0,0)");
      ctx.fillStyle = flame;
      ctx.fillRect(particle.x - radius, particle.y - radius, radius * 2, radius * 2);
    }
    ctx.globalCompositeOperation = "source-over";
  }

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    hearth.resize(width, height);
  }

  function frame(time) {
    const elapsed = last ? Math.min((time - last) / 1000, 0.1) : 0;
    last = time;
    accumulator += elapsed;
    while (accumulator >= STEP) {
      update(STEP);
      accumulator -= STEP;
    }
    render();
    requestAnimationFrame(frame);
  }
})();
