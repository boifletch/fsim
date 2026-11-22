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
  const MAX_PARTICLES = 5200;
  const AMBIENT = 20,
    IGNITION = 290,
    BURN_TEMP = 820;
  let width = 1,
    height = 1,
    dpr = 1,
    logs = [],
    particles = [];
  let drag = null,
    activePointer = null,
    offsetX = 0,
    offsetY = 0;
  let last = 0,
    accumulator = 0;
  let cellsByBucket = new Map();

  canvas.addEventListener("pointerdown", clicked);
  canvas.addEventListener("pointermove", e => {
    if (!drag || e.pointerId !== activePointer) return;
    drag.x = e.clientX + offsetX;
    drag.y = e.clientY + offsetY;
    constrain(drag);
  });
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);
  canvas.addEventListener("lostpointercapture", release);
  window.addEventListener("resize", resize);
  document.getElementById("reset").addEventListener("click", reset);
  document.addEventListener("visibilitychange", () => {
    last = 0;
    accumulator = 0;
  });

  resize();
  reset();
  requestAnimationFrame(frame);

  // Utilities

  function bucketKey(x, y) {
    return (
      (Math.floor(x / BUCKET) + 4096) * 8192 + (Math.floor(y / BUCKET) + 4096)
    );
  }

  function cellWorld(log, index, out) {
    const column = index % log.cols;
    const row = (index / log.cols) | 0;
    const localX = (column + 0.5) * CELL - log.halfW;
    const localY = (row + 0.5) * CELL - log.halfH;
    out.x = log.x + localX * log.ux - localY * log.uy;
    out.y = log.y + localX * log.uy + localY * log.ux;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function random(min, max) {
    return min + Math.random() * (max - min);
  }

  function randomInt(min, max) {
    return Math.floor(random(min, max + 1));
  }

  // Simulation / business logic

  function createLog(x, y, burning) {
    const angle = random(0, TAU);
    const cols = randomInt(7, 11);
    const rows = randomInt(4, 6);
    const count = cols * rows;
    const log = {
      x,
      y,
      ux: Math.cos(angle),
      uy: Math.sin(angle),
      angle,
      cols,
      rows,
      count,
      halfW: (cols * CELL) / 2,
      halfH: (rows * CELL) / 2,
      temp: new Float64Array(count).fill(AMBIENT),
      delta: new Float64Array(count),
      fuel: new Float64Array(count).fill(1),
      burning: new Uint8Array(count),
      emission: new Float64Array(count),
      particleCount: 0,
    };
    if (burning) {
      for (let i = 0; i < 2; i++) {
        const starter = randomInt(0, count - 1);
        log.burning[starter] = 1;
        log.temp[starter] = BURN_TEMP;
      }
    }
    constrain(log);
    logs.push(log);
    return log;
  }

  function reset() {
    drag = null;
    activePointer = null;
    canvas.classList.remove("dragging");
    particles.length = 0;
    logs = [];
    createLog(width / 2, height * 0.56, true);
    accumulator = 0;
  }

  function update(dt) {
    for (const log of logs) log.delta.fill(0);
    buildCellIndex();
    transferHeat(dt);
    updateCells(dt);
    updateParticles(dt);
  }

  function buildCellIndex() {
    cellsByBucket.clear();
    const position = { x: 0, y: 0 };
    for (let logIndex = 0; logIndex < logs.length; logIndex++) {
      const log = logs[logIndex];
      for (let cellIndex = 0; cellIndex < log.count; cellIndex++) {
        cellWorld(log, cellIndex, position);
        const key = bucketKey(position.x, position.y);
        let bucket = cellsByBucket.get(key);
        if (!bucket) {
          bucket = [];
          cellsByBucket.set(key, bucket);
        }
        bucket.push(logIndex, cellIndex, position.x, position.y);
      }
    }
  }

  function transferHeat(dt) {
    const position = { x: 0, y: 0 };
    for (let logIndex = 0; logIndex < logs.length; logIndex++) {
      const log = logs[logIndex];
      for (let cellIndex = 0; cellIndex < log.count; cellIndex++) {
        const temperature = log.temp[cellIndex];
        cellWorld(log, cellIndex, position);
        const baseX = Math.floor(position.x / BUCKET);
        const baseY = Math.floor(position.y / BUCKET);
        for (let bucketY = baseY - BUCKET_RADIUS; bucketY <= baseY + BUCKET_RADIUS; bucketY++) {
          for (let bucketX = baseX - BUCKET_RADIUS; bucketX <= baseX + BUCKET_RADIUS; bucketX++) {
            const bucket = cellsByBucket.get(
              bucketKey(bucketX * BUCKET, bucketY * BUCKET),
            );
            if (!bucket) continue;
            for (let entry = 0; entry < bucket.length; entry += 4) {
              const otherLogIndex = bucket[entry];
              if (otherLogIndex <= logIndex) continue;
              const otherLog = logs[otherLogIndex];
              const otherCell = bucket[entry + 1];
              const dx = bucket[entry + 2] - position.x;
              const dy = bucket[entry + 3] - position.y;
              const distance = Math.hypot(dx, dy);
              if (distance > CELL_INFLUENCE) continue;
              const separation = Math.max(0, distance - CELL);
              const coupling =
                separation <= CELL * 0.05
                  ? 1
                  : 0.8 * Math.exp(-separation / (CELL * 1.5));
              const heat =
                (temperature - otherLog.temp[otherCell]) * coupling * dt;
              log.delta[cellIndex] -= heat;
              otherLog.delta[otherCell] += heat;
            }
          }
        }
      }
      for (let cellIndex = 0; cellIndex < log.count; cellIndex++) {
        const row = (cellIndex / log.cols) | 0;
        const column = cellIndex % log.cols;
        if (column + 1 < log.cols) conduct(log, cellIndex, cellIndex + 1, dt);
        if (row + 1 < log.rows)
          conduct(log, cellIndex, cellIndex + log.cols, dt);
      }
    }
  }

  function conduct(log, a, b, dt) {
    const heat = (log.temp[a] - log.temp[b]) * 0.35 * dt;
    log.delta[a] -= heat;
    log.delta[b] += heat;
  }

  function updateCells(dt) {
    for (let logIndex = 0; logIndex < logs.length; logIndex++) {
      const log = logs[logIndex];
      for (let cellIndex = 0; cellIndex < log.count; cellIndex++) {
        let temperature = log.temp[cellIndex] + log.delta[cellIndex];
        temperature -= (temperature - AMBIENT) * 0.075 * dt;
        if (
          !log.burning[cellIndex] &&
          log.fuel[cellIndex] > 0 &&
          temperature >= IGNITION
        )
          log.burning[cellIndex] = 1;
        if (log.burning[cellIndex]) {
          log.fuel[cellIndex] = Math.max(0, log.fuel[cellIndex] - dt / 100);
          if (log.fuel[cellIndex] === 0 || temperature < 190) {
            log.burning[cellIndex] = 0;
          } else {
            temperature += (BURN_TEMP - temperature) * 1.5 * dt;
          }
        }
        log.temp[cellIndex] = Math.max(AMBIENT, temperature);
      }
    }
  }

  function updateParticles(dt) {
    const position = { x: 0, y: 0 };
    for (let logIndex = 0; logIndex < logs.length; logIndex++) {
      const log = logs[logIndex];
      for (let cellIndex = 0; cellIndex < log.count; cellIndex++) {
        if (!log.burning[cellIndex]) continue;
        log.emission[cellIndex] += dt * 2.2;
        while (log.emission[cellIndex] >= 1) {
          log.emission[cellIndex]--;
          if (
            log.particleCount >= MAX_LOG_PARTICLES ||
            particles.length >= MAX_PARTICLES
          )
            continue;
          cellWorld(log, cellIndex, position);
          const life = random(0.4, 1.15);
          particles.push({
            x: position.x + random(-CELL * 0.4, CELL * 0.4),
            y: position.y + random(-CELL * 0.4, CELL * 0.4),
            vx: random(-18, 18),
            vy: random(-90, -35),
            age: 0,
            life,
            size: random(4, 10),
            phase: random(0, TAU),
            logIndex,
          });
          log.particleCount++;
        }
      }
    }
    for (let i = particles.length - 1; i >= 0; i--) {
      const particle = particles[i];
      particle.age += dt;
      if (particle.age >= particle.life) {
        logs[particle.logIndex].particleCount--;
        particles[i] = particles[particles.length - 1];
        particles.pop();
        continue;
      }
      particle.x +=
        (particle.vx + Math.sin(particle.age * 9 + particle.phase) * 14) * dt;
      particle.y += particle.vy * dt;
      particle.vy -= 18 * dt;
    }
  }

  // Input

  function clicked(e) {
    if (activePointer !== null || e.button !== 0) return;
    for (let logIndex = logs.length - 1; logIndex >= 0; logIndex--) {
      const log = logs[logIndex];
      if (!contains(log, e.clientX, e.clientY, 5)) continue;
      drag = log;
      activePointer = e.pointerId;
      offsetX = log.x - e.clientX;
      offsetY = log.y - e.clientY;
      logs.splice(logIndex, 1);
      logs.push(log);
      canvas.setPointerCapture(e.pointerId);
      canvas.classList.add("dragging");
      return;
    }
    createLog(e.clientX, e.clientY, false);
  }

  function release(e) {
    if (e.pointerId !== activePointer) return;
    drag = null;
    activePointer = null;
    canvas.classList.remove("dragging");
    if (canvas.hasPointerCapture(e.pointerId))
      canvas.releasePointerCapture(e.pointerId);
  }

  // Visual

  function contains(log, x, y, margin) {
    const dx = x - log.x;
    const dy = y - log.y;
    const localX = dx * log.ux + dy * log.uy;
    const localY = -dx * log.uy + dy * log.ux;
    return (
      Math.abs(localX) <= log.halfW + margin &&
      Math.abs(localY) <= log.halfH + margin
    );
  }

  function constrain(log) {
    const extentX = Math.abs(log.ux) * log.halfW + Math.abs(log.uy) * log.halfH;
    const extentY = Math.abs(log.ux) * log.halfH + Math.abs(log.uy) * log.halfW;
    log.x =
      width < extentX * 2 ? width / 2 : clamp(log.x, extentX, width - extentX);
    log.y =
      height < extentY * 2
        ? height / 2
        : clamp(log.y, extentY, height - extentY);
  }

  function render() {
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#090b10";
    ctx.fillRect(0, 0, width, height);

    for (const log of logs) {
      let average = 0;
      for (let i = 0; i < log.count; i++) average += log.temp[i];
      average /= log.count;
      if (average < 110) continue;
      const strength = clamp((average - 110) / 710, 0, 1);
      const radius = Math.max(log.halfW, log.halfH) + 85;
      const glow = ctx.createRadialGradient(
        log.x,
        log.y,
        0,
        log.x,
        log.y,
        radius,
      );
      glow.addColorStop(0, `rgba(255,85,12,${strength * 0.2})`);
      glow.addColorStop(1, "rgba(255,45,0,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(log.x - radius, log.y - radius, radius * 2, radius * 2);
    }

    for (const log of logs) {
      ctx.save();
      ctx.translate(log.x, log.y);
      ctx.rotate(log.angle);
      let ignited = 0;
      let fuel = 0;
      let burning = false;
      for (let cellIndex = 0; cellIndex < log.count; cellIndex++) {
        const temperature = log.temp[cellIndex];
        const char = 1 - log.fuel[cellIndex];
        const hot = clamp((temperature - 170) / 650, 0, 1);
        if (log.burning[cellIndex]) {
          ignited++;
          burning = true;
        }
        fuel += log.fuel[cellIndex];
        ctx.fillStyle = `rgb(${Math.round(97 - char * 67 + hot * 65)},${Math.round(60 - char * 40)},${Math.round(34 - char * 23)})`;
        ctx.fillRect(
          (cellIndex % log.cols) * CELL - log.halfW,
          ((cellIndex / log.cols) | 0) * CELL - log.halfH,
          CELL,
          CELL,
        );
      }
      fuel /= log.count;
      const ignition = ignited / log.count;
      const visibility = 4 * ignition * (1 - ignition);
      if (visibility > 0.001) {
        const outline = 3 * ignition + 0.5;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.lineWidth = outline;
        ctx.strokeStyle = `rgba(255,${Math.round(190 - ignition * 115)},${Math.round(150 - ignition * 135)},${visibility * 0.9})`;
        ctx.beginPath();
        ctx.roundRect(
          -log.halfW - outline * 0.5,
          -log.halfH - outline * 0.5,
          log.halfW * 2 + outline,
          log.halfH * 2 + outline,
          4,
        );
        ctx.stroke();
      }

      ctx.restore();
    }

    ctx.globalCompositeOperation = "lighter";
    for (const particle of particles) {
      const t = particle.age / particle.life,
        radius = particle.size * (1 - t) + 0.5;
      const flame = ctx.createRadialGradient(
        particle.x,
        particle.y,
        0,
        particle.x,
        particle.y,
        radius,
      );
      flame.addColorStop(
        0,
        `rgba(255,${Math.round(220 - 110 * t)},65,${(1 - t) * 0.85})`,
      );
      flame.addColorStop(
        0.4,
        `rgba(255,${Math.round(125 - 75 * t)},8,${(1 - t) * 0.55})`,
      );
      flame.addColorStop(1, "rgba(180,15,0,0)");
      ctx.fillStyle = flame;
      ctx.fillRect(
        particle.x - radius,
        particle.y - radius,
        radius * 2,
        radius * 2,
      );
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
    for (const log of logs) constrain(log);
  }

  // Main loop

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
