'use strict';
(() => {
  const canvas = document.getElementById('fire');
  const ctx = canvas.getContext('2d', { alpha: false });
  const TAU = Math.PI * 2;
  const MAX_PARTICLES = 2600, STEP = 1 / 60;
  const AMBIENT = 20, IGNITION = 290, BURN_TEMP = 820;
  let width = 1, height = 1, dpr = 1, logs = [], particles = [];
  let drag = null, activePointer = null, offsetX = 0, offsetY = 0;
  let last = 0, accumulator = 0;
  let delta = new Float64Array(0);
  const random = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const log of logs) constrain(log);
  }

  function constrain(log) {
    const ex = Math.abs(log.ux) * log.half + log.r;
    const ey = Math.abs(log.uy) * log.half + log.r;
    log.x = width < ex * 2 ? width / 2 : clamp(log.x, ex, width - ex);
    log.y = height < ey * 2 ? height / 2 : clamp(log.y, ey, height - ey);
  }

  function createLog(x, y, burning) {
    const angle = random(0, TAU);
    const log = {
      x, y,
      ux: Math.cos(angle), uy: Math.sin(angle), angle,
      half: random(52, 96), r: random(16, 24),
      temp: AMBIENT, fuel: 1, burning, emission: 0,
      grain: Array.from({ length: 7 }, () => [random(-0.85, 0.6), random(-0.7, 0.7), random(0.1, 0.7)])
    };
    if (burning) {
      log.burning = true;
      log.temp = BURN_TEMP;
    }
    constrain(log);
    logs.push(log);
    return log;
  }

  function reset() {
    drag = null;
    activePointer = null;
    canvas.classList.remove('dragging');
    particles.length = 0;
    logs = [];
    createLog(width / 2, height * 0.56, true);
    accumulator = 0;
  }

  function pointSegment(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1), 0, 1);
    return Math.hypot(px - ax - t * dx, py - ay - t * dy);
  }

  function gap(a, b) {
    const ax = a.x - a.ux * a.half, ay = a.y - a.uy * a.half;
    const bx = a.x + a.ux * a.half, by = a.y + a.uy * a.half;
    const cx = b.x - b.ux * b.half, cy = b.y - b.uy * b.half;
    const dx = b.x + b.ux * b.half, dy = b.y + b.uy * b.half;
    const rx = bx - ax, ry = by - ay, sx = dx - cx, sy = dy - cy;
    const cross = rx * sy - ry * sx;
    if (Math.abs(cross) > 1e-8) {
      const t = ((cx - ax) * sy - (cy - ay) * sx) / cross;
      const u = ((cx - ax) * ry - (cy - ay) * rx) / cross;
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return 0;
    }
    return Math.max(0, Math.min(
      pointSegment(ax, ay, cx, cy, dx, dy), pointSegment(bx, by, cx, cy, dx, dy),
      pointSegment(cx, cy, ax, ay, bx, by), pointSegment(dx, dy, ax, ay, bx, by)
    ) - a.r - b.r);
  }

  function update(dt) {
    if (delta.length !== logs.length) delta = new Float64Array(logs.length);
    delta.fill(0);
    for (let i = 0; i < logs.length; i++) {
      for (let j = i + 1; j < logs.length; j++) {
        const a = logs[i], b = logs[j];
        const separation = gap(a, b);
        if (separation > 140) continue;
        const coupling = 0.13 * Math.exp(-separation / 32) + (separation <= 1 ? 0.55 : 0);
        const heat = (a.temp - b.temp) * coupling;
        delta[i] -= heat;
        delta[j] += heat;
      }
    }
    for (let i = 0; i < logs.length; i++) {
      const log = logs[i];
      log.temp += (delta[i] - (log.temp - AMBIENT) * 0.075) * dt;
      if (!log.burning && log.fuel > 0 && log.temp >= IGNITION) log.burning = true;
      if (log.burning) {
        log.fuel = Math.max(0, log.fuel - dt / 100);
        if (log.fuel === 0 || log.temp < 190) log.burning = false;
        else log.temp += (BURN_TEMP - log.temp) * 1.5 * dt;
      }
      log.temp = Math.max(AMBIENT, log.temp);
      if (!log.burning) continue;
      log.emission += dt * 48;
      while (log.emission >= 1) {
        log.emission--;
        if (particles.length >= MAX_PARTICLES) continue;
        const along = random(-log.half, log.half);
        const life = random(0.4, 1.15);
        particles.push({
          x: log.x + log.ux * along + random(-log.r, log.r),
          y: log.y + log.uy * along + random(-log.r, log.r),
          vx: random(-18, 18), vy: random(-90, -35),
          age: 0, life, size: random(5, 15), phase: random(0, TAU)
        });
      }
    }
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.age += dt;
      if (p.age >= p.life) {
        particles[i] = particles[particles.length - 1];
        particles.pop();
        continue;
      }
      p.x += (p.vx + Math.sin(p.age * 9 + p.phase) * 14) * dt;
      p.y += p.vy * dt;
      p.vy -= 18 * dt;
    }
  }

  function render() {
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#090b10';
    ctx.fillRect(0, 0, width, height);
    for (const log of logs) {
      if (log.temp < 110) continue;
      const strength = clamp((log.temp - 110) / 710, 0, 1);
      const radius = log.half + 85;
      const glow = ctx.createRadialGradient(log.x, log.y, 0, log.x, log.y, radius);
      glow.addColorStop(0, `rgba(255,85,12,${strength * 0.2})`);
      glow.addColorStop(1, 'rgba(255,45,0,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(log.x - radius, log.y - radius, radius * 2, radius * 2);
    }
    for (const log of logs) {
      ctx.save();
      ctx.translate(log.x, log.y);
      ctx.rotate(log.angle);
      const char = 1 - log.fuel;
      const hot = clamp((log.temp - 170) / 650, 0, 1);
      ctx.lineCap = 'round';
      ctx.lineWidth = log.r * 2 + 3;
      ctx.strokeStyle = log === drag ? '#ffe3a1' : '#17100c';
      ctx.beginPath(); ctx.moveTo(-log.half, 0); ctx.lineTo(log.half, 0); ctx.stroke();
      ctx.lineWidth = log.r * 2;
      ctx.strokeStyle = `rgb(${Math.round(97 - char * 67 + hot * 65)},${Math.round(60 - char * 40)},${Math.round(34 - char * 23)})`;
      ctx.stroke();
      ctx.lineWidth = 1.3;
      ctx.strokeStyle = hot > 0.3 ? `rgba(255,116,28,${hot * 0.8})` : '#38251a';
      for (const g of log.grain) {
        ctx.beginPath();
        ctx.moveTo(g[0] * log.half, g[1] * log.r);
        ctx.lineTo(Math.min(0.95, g[0] + g[2]) * log.half, g[1] * log.r + 1);
        ctx.stroke();
      }
      ctx.fillStyle = `rgb(${Math.round(142 - char * 106)},${Math.round(98 - char * 73)},${Math.round(57 - char * 42)})`;
      ctx.beginPath(); ctx.ellipse(log.half, 0, log.r * 0.45, log.r * 0.83, 0, 0, TAU); ctx.fill();

      const ignition = log.burning ? 1 : clamp((log.temp - AMBIENT) / (IGNITION - AMBIENT), 0, 1);
      const visibility = 4 * ignition * (1 - ignition);
      if (visibility > 0.001) {
        const outline = log.r * 0.45 * ignition + 0.5;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.lineWidth = outline;
        ctx.strokeStyle = `rgba(255,${Math.round(190 - ignition * 115)},${Math.round(150 - ignition * 135)},${visibility * 0.9})`;
        ctx.beginPath();
        ctx.roundRect(-log.half - outline * 0.5, -log.r - outline * 0.5, log.half * 2 + outline, log.r * 2 + outline, log.r + outline * 0.5);
        ctx.stroke();
      }

      const label = log.burning ? 'BURN' : `${Math.round(ignition * 100)}% / F:${log.fuel}`;
      const fontSize = Math.max(7, log.r * 0.72);
      ctx.font = `600 ${fontSize}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = Math.max(2, fontSize * 0.22);
      ctx.strokeStyle = 'rgba(0,0,0,0.65)';
      ctx.strokeText(label, 0, 0);
      ctx.fillStyle = log.burning ? '#ffd27a' : `rgba(255,${Math.round(190 - ignition * 110)},${Math.round(170 - ignition * 150)},${0.35 + ignition * 0.55})`;
      ctx.fillText(label, 0, 0);
      ctx.restore();
    }
    ctx.globalCompositeOperation = 'lighter';
    for (const p of particles) {
      const t = p.age / p.life, radius = p.size * (1 - t) + 0.5;
      const flame = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius);
      flame.addColorStop(0, `rgba(255,${Math.round(220 - 110 * t)},65,${(1 - t) * 0.85})`);
      flame.addColorStop(0.4, `rgba(255,${Math.round(125 - 75 * t)},8,${(1 - t) * 0.55})`);
      flame.addColorStop(1, 'rgba(180,15,0,0)');
      ctx.fillStyle = flame;
      ctx.fillRect(p.x - radius, p.y - radius, radius * 2, radius * 2);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  canvas.addEventListener('pointerdown', e => {
    if (activePointer !== null || e.button !== 0) return;
    for (let i = logs.length - 1; i >= 0; i--) {
      const log = logs[i];
      if (pointSegment(e.clientX, e.clientY, log.x - log.ux * log.half, log.y - log.uy * log.half,
        log.x + log.ux * log.half, log.y + log.uy * log.half) > log.r + 5) continue;
      drag = log;
      activePointer = e.pointerId;
      offsetX = log.x - e.clientX; offsetY = log.y - e.clientY;
      logs.splice(i, 1); logs.push(log);
      canvas.setPointerCapture(e.pointerId);
      canvas.classList.add('dragging');
      return;
    }
    createLog(e.clientX, e.clientY, false);
  });
  canvas.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== activePointer) return;
    drag.x = e.clientX + offsetX; drag.y = e.clientY + offsetY;
    constrain(drag);
  });
  function release(e) {
    if (e.pointerId !== activePointer) return;
    drag = null; activePointer = null;
    canvas.classList.remove('dragging');
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  }
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('lostpointercapture', release);
  window.addEventListener('resize', resize);
  document.getElementById('reset').addEventListener('click', reset);
  document.addEventListener('visibilitychange', () => { last = 0; accumulator = 0; });
  function frame(time) {
    const elapsed = last ? Math.min((time - last) / 1000, 0.1) : 0;
    last = time;
    accumulator += elapsed;
    while (accumulator >= STEP) { update(STEP); accumulator -= STEP; }
    render();
    requestAnimationFrame(frame);
  }
  resize(); reset(); requestAnimationFrame(frame);
})();
