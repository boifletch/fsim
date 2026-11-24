"use strict";
(() => {
  const canvas = document.getElementById("fire");
  const ctx = canvas.getContext("2d", { alpha: false });
  const scoreElement = document.getElementById("score");
  const incomeElement = document.getElementById("income");
  const inventoryElement = document.getElementById("inventory");
  const fpsElement = document.getElementById("fps");
  const TAU = Math.PI * 2;
  const FPS = 60;
  const STEP = 1 / FPS;
  const CELL_INFLUENCE_MULTIPLIER = 2.5;
  const BUCKET_MULTIPLIER = 2;
  const MAX_LOG_PARTICLES = 72;
  const MAX_PARTICLES = 2200;
  const MAX_HEARTH_LOGS = 8;
  const MAX_TEMP_LOGS = 5;
  const BASE_LOG_OUTPUT = 1.8;
  const TEMP_LOG_RECHARGE_SECONDS = 20;
  const AMBIENT = 20;
  const IGNITION = 290;
  const BURN_TEMP = 820;
  const GRAVITY = 1200;
  const RESTITUTION = 0.08;
  const FRICTION = 0.6;
  const LINEAR_DAMPING = 0.12;
  const ANGULAR_DAMPING = 1.8;
  const MAX_ANGULAR_VELOCITY = 14;
  const ROTATION_SPEED = 3;
  const SOLVER_ITERATIONS = 6;
  const POSITION_SLOP = 0.2;
  const POSITION_CORRECTION = 0.8;
  let width = 1;
  let height = 1;
  let dpr = 1;
  let CELL = 14;
  let CELL_INFLUENCE = CELL * CELL_INFLUENCE_MULTIPLIER;
  let BUCKET = CELL * BUCKET_MULTIPLIER;
  let BUCKET_RADIUS = Math.ceil(CELL_INFLUENCE / BUCKET);
  let score = 0;
  let particles = [];
  let drag = null;
  let activePointer = null;
  let offsetX = 0;
  let offsetY = 0;
  let rotateDirection = 0;
  let last = 0;
  let accumulator = 0;
  let frameCount = 0;
  let fpsTime = 0;
  let cellsByBucket = new Map();

  const axis = { x: 0, y: 0 };
  const pointA = { x: 0, y: 0 };
  const pointB = { x: 0, y: 0 };
  const contactPoint = { x: 0, y: 0 };

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function getSupport(log, dirX, dirY, out) {
    const localXSign = log.ux * dirX + log.uy * dirY >= 0 ? 1 : -1;
    const localYSign = -log.uy * dirX + log.ux * dirY >= 0 ? 1 : -1;
    const localX = localXSign * log.halfW;
    const localY = localYSign * log.halfH;
    out.x = log.x + log.ux * localX - log.uy * localY;
    out.y = log.y + log.uy * localX + log.ux * localY;
    return out;
  }

  function crossScalar(rx, ry, vx, vy) {
    return rx * vy - ry * vx;
  }

  function applyImpulseAtPoint(body, impulseX, impulseY, px, py) {
    if (body.invMass === 0) return;
    body.vx += impulseX * body.invMass;
    body.vy += impulseY * body.invMass;
    const rx = px - body.x;
    const ry = py - body.y;
    body.omega += crossScalar(rx, ry, impulseX, impulseY) * body.invInertia;
  }

  function resolveContact(a, b, nx, ny, px, py, depth) {
    const invMassSum = a.invMass + b.invMass;
    if (invMassSum <= 0) return;

    const correction = Math.max(depth - POSITION_SLOP, 0) / invMassSum * POSITION_CORRECTION;
    if (correction > 0) {
      a.x -= nx * correction * a.invMass;
      a.y -= ny * correction * a.invMass;
      b.x += nx * correction * b.invMass;
      b.y += ny * correction * b.invMass;
    }

    const arx = px - a.x;
    const ary = py - a.y;
    const brx = px - b.x;
    const bry = py - b.y;
    const avx = a.vx - a.omega * ary;
    const avy = a.vy + a.omega * arx;
    const bvx = b.vx - b.omega * bry;
    const bvy = b.vy + b.omega * brx;
    const rvx = bvx - avx;
    const rvy = bvy - avy;
    const velAlongNormal = rvx * nx + rvy * ny;
    if (velAlongNormal > 0) return;

    const arCrossN = crossScalar(arx, ary, nx, ny);
    const brCrossN = crossScalar(brx, bry, nx, ny);
    const invMassN = invMassSum + arCrossN * arCrossN * a.invInertia + brCrossN * brCrossN * b.invInertia;
    if (invMassN <= 0) return;

    const restitution = Math.abs(velAlongNormal) < 40 ? 0 : RESTITUTION;
    const normalImpulse = -(1 + restitution) * velAlongNormal / invMassN;
    applyImpulseAtPoint(a, -normalImpulse * nx, -normalImpulse * ny, px, py);
    applyImpulseAtPoint(b, normalImpulse * nx, normalImpulse * ny, px, py);

    const avx2 = a.vx - a.omega * ary;
    const avy2 = a.vy + a.omega * arx;
    const bvx2 = b.vx - b.omega * bry;
    const bvy2 = b.vy + b.omega * brx;
    const rvx2 = bvx2 - avx2;
    const rvy2 = bvy2 - avy2;
    let tx = rvx2 - nx * (rvx2 * nx + rvy2 * ny);
    let ty = rvy2 - ny * (rvx2 * nx + rvy2 * ny);
    const tangentLength = Math.hypot(tx, ty);
    if (tangentLength < 1e-6) return;
    tx /= tangentLength;
    ty /= tangentLength;

    const arCrossT = crossScalar(arx, ary, tx, ty);
    const brCrossT = crossScalar(brx, bry, tx, ty);
    const invMassT = invMassSum + arCrossT * arCrossT * a.invInertia + brCrossT * brCrossT * b.invInertia;
    if (invMassT <= 0) return;

    let tangentImpulse = -(rvx2 * tx + rvy2 * ty) / invMassT;
    const maxFriction = Math.abs(normalImpulse) * FRICTION;
    tangentImpulse = clamp(tangentImpulse, -maxFriction, maxFriction);
    applyImpulseAtPoint(a, -tangentImpulse * tx, -tangentImpulse * ty, px, py);
    applyImpulseAtPoint(b, tangentImpulse * tx, tangentImpulse * ty, px, py);
  }

  function resolveBoundsContact(log, nx, ny, px, py, depth) {
    if (log.isStatic || log.isDragged) return;

    const correction = Math.max(depth - POSITION_SLOP, 0) * POSITION_CORRECTION;
    if (correction > 0) {
      log.x += nx * correction;
      log.y += ny * correction;
    }

    const rx = px - log.x;
    const ry = py - log.y;
    const vx = log.vx - log.omega * ry;
    const vy = log.vy + log.omega * rx;
    const velAlongNormal = vx * nx + vy * ny;
    if (velAlongNormal > 0) return;

    const rCrossN = crossScalar(rx, ry, nx, ny);
    const invMassN = log.invMass + rCrossN * rCrossN * log.invInertia;
    if (invMassN <= 0) return;

    const restitution = Math.abs(velAlongNormal) < 40 ? 0 : RESTITUTION;
    const normalImpulse = -(1 + restitution) * velAlongNormal / invMassN;
    applyImpulseAtPoint(log, normalImpulse * nx, normalImpulse * ny, px, py);

    const vx2 = log.vx - log.omega * ry;
    const vy2 = log.vy + log.omega * rx;
    let tx = vx2 - nx * (vx2 * nx + vy2 * ny);
    let ty = vy2 - ny * (vx2 * nx + vy2 * ny);
    const tangentLength = Math.hypot(tx, ty);
    if (tangentLength < 1e-6) return;
    tx /= tangentLength;
    ty /= tangentLength;

    const rCrossT = crossScalar(rx, ry, tx, ty);
    const invMassT = log.invMass + rCrossT * rCrossT * log.invInertia;
    if (invMassT <= 0) return;

    let tangentImpulse = -(vx2 * tx + vy2 * ty) / invMassT;
    const maxFriction = Math.abs(normalImpulse) * FRICTION;
    tangentImpulse = clamp(tangentImpulse, -maxFriction, maxFriction);
    applyImpulseAtPoint(log, tangentImpulse * tx, tangentImpulse * ty, px, py);
  }

  function resolveLogBounds(log, bounds) {
    if (log.isStatic || log.isDragged) return;
    const left = bounds.x;
    const right = bounds.x + bounds.width;
    const top = bounds.y;
    const bottom = bounds.y + bounds.height;

    getSupport(log, 0, 1, pointA);
    if (pointA.y > bottom) resolveBoundsContact(log, 0, -1, pointA.x, pointA.y, pointA.y - bottom);

    getSupport(log, 0, -1, pointA);
    if (pointA.y < top) resolveBoundsContact(log, 0, 1, pointA.x, pointA.y, top - pointA.y);

    getSupport(log, 1, 0, pointA);
    if (pointA.x > right) resolveBoundsContact(log, -1, 0, pointA.x, pointA.y, pointA.x - right);

    getSupport(log, -1, 0, pointA);
    if (pointA.x < left) resolveBoundsContact(log, 1, 0, pointA.x, pointA.y, left - pointA.x);
  }

  class Log {
    constructor(type, x, y, angle, burning = false) {
      this.type = type;
      this.x = x;
      this.y = y;
      this.angle = angle;
      this.cols = 12 + Math.floor(Math.random() * 5);
      this.rows = 2 + Math.floor(Math.random() * 2);
      this.count = this.cols * this.rows;
      this.halfW = (this.cols * CELL) / 2;
      this.halfH = (this.rows * CELL) / 2;
      this.temp = new Float64Array(this.count).fill(AMBIENT);
      this.delta = new Float64Array(this.count);
      this.fuel = new Float64Array(this.count).fill(1);
      this.burning = new Uint8Array(this.count);
      this.emission = new Float64Array(this.count);
      this.particleCount = 0;
      this.vx = 0;
      this.vy = 0;
      this.omega = 0;
      this.isDragged = false;
      this.isStatic = type === "persistent";
      this.updateBasis();
      if (burning) this.ignite(2);
    }

    get burningCellCount() {
      let count = 0;
      for (let cell = 0; cell < this.count; cell++) {
        if (this.burning[cell]) count++;
      }
      return count;
    }

    get outputPerSecond() {
      return BASE_LOG_OUTPUT * (this.burningCellCount / this.count);
    }

    get isDepleted() {
      for (let cell = 0; cell < this.count; cell++) {
        if (this.fuel[cell] > 0) return false;
      }
      return true;
    }

    get momentOfInertia() {
      return (this.halfW * this.halfW + this.halfH * this.halfH) * 0.08;
    }

    get invMass() {
      return this.isStatic || this.isDragged ? 0 : 1;
    }

    get invInertia() {
      return this.isStatic || this.isDragged ? 0 : 1 / this.momentOfInertia;
    }

    recharge() {
      this.temp.fill(AMBIENT);
      this.delta.fill(0);
      this.fuel.fill(1);
      this.burning.fill(0);
      this.emission.fill(0);
      this.particleCount = 0;
      this.vx = 0;
      this.vy = 0;
      this.omega = 0;
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

    projectRadius(axisX, axisY) {
      return (
        Math.abs(this.halfW * (this.ux * axisX + this.uy * axisY)) +
        Math.abs(this.halfH * (-this.uy * axisX + this.ux * axisY))
      );
    }

    getBoundsExtents() {
      return {
        x: Math.abs(this.ux) * this.halfW + Math.abs(this.uy) * this.halfH,
        y: Math.abs(this.ux) * this.halfH + Math.abs(this.uy) * this.halfW,
      };
    }

    clampToBounds(bounds) {
      const extentX = Math.abs(this.ux) * this.halfW + Math.abs(this.uy) * this.halfH;
      const extentY = Math.abs(this.ux) * this.halfH + Math.abs(this.uy) * this.halfW;
      this.x = clamp(this.x, bounds.x + extentX, bounds.x + bounds.width - extentX);
      this.y = clamp(this.y, bounds.y + extentY, bounds.y + bounds.height - extentY);
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
          if (this.type === "temporary") {
            this.fuel[cell] = Math.max(0, this.fuel[cell] - dt / 100);
          }
          if (this.fuel[cell] === 0 || temperature < 190) {
            this.burning[cell] = 0;
          } else {
            temperature += (BURN_TEMP - temperature) * 1.5 * dt;
          }
        }
        this.temp[cell] = Math.max(AMBIENT, temperature);
      }
    }

    integratePhysics(dt) {
      if (this.isStatic || this.isDragged) {
        this.vx = 0;
        this.vy = 0;
        this.omega = 0;
        return;
      }

      this.vy += GRAVITY * dt;
      const linearDamping = Math.max(0, 1 - LINEAR_DAMPING * dt);
      const angularDamping = Math.max(0, 1 - ANGULAR_DAMPING * dt);
      this.vx *= linearDamping;
      this.vy *= linearDamping;
      this.omega = clamp(this.omega * angularDamping, -MAX_ANGULAR_VELOCITY, MAX_ANGULAR_VELOCITY);

      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.angle += this.omega * dt;
      this.updateBasis();
    }

    emit(dt) {
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
          const life = 0.35 + Math.random() * 0.65;
          particles.push({
            x: position.x + (Math.random() - 0.5) * CELL * 0.8,
            y: position.y + (Math.random() - 0.5) * CELL * 0.8,
            vx: (Math.random() - 0.5) * 36,
            vy: -35 - Math.random() * 55,
            age: 0,
            life,
            size: 3 + Math.random() * 5,
            phase: Math.random() * TAU,
            log: this,
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
        const hot = Math.max(0, Math.min(1, (temperature - 170) / 650));
        if (this.burning[cell]) ignited++;
        if (this.type === "persistent") {
          const red = Math.round(205 + (162 - 205) * hot);
          const green = Math.round(205 + (60 - 205) * hot);
          const blue = Math.round(205 + (34 - 205) * hot);
          context.fillStyle = `rgb(${red},${green},${blue})`;
        } else {
          const char = 1 - this.fuel[cell];
          context.fillStyle = `rgb(${Math.round(97 - char * 67 + hot * 65)},${Math.round(60 - char * 40)},${Math.round(34 - char * 23)})`;
        }
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
        const outline = 2.5 * ignition + 0.5;
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

    renderDebug(context) {
      const burningPercent = Math.round(
        (this.burningCellCount / this.count) * 100,
      );
      const text = `${this.type} · ${burningPercent}% burning · ${this.outputPerSecond.toFixed(2)}/s`;
      const motion = `v ${this.vx.toFixed(0)}, ${this.vy.toFixed(0)} · ω ${this.omega.toFixed(2)}`;
      context.font = "10px system-ui, sans-serif";
      context.textAlign = "center";
      context.textBaseline = "bottom";
      context.fillStyle = "rgba(9,11,16,0.72)";
      const boxWidth = Math.max(context.measureText(text).width, 130) + 10;
      const boxHeight = 28;
      const boxX = this.x - boxWidth / 2;
      const boxY = this.y - this.halfH - boxHeight - 6;
      context.fillRect(boxX, boxY, boxWidth, boxHeight);
      context.fillStyle = "rgba(231,226,217,0.92)";
      context.fillText(text, this.x, boxY + 16);
      context.fillStyle = "rgba(170,170,170,0.85)";
      context.fillText(motion, this.x, boxY + 27);
    }
  }

  class Hearth {
    constructor() {
      this.logs = [];
      this.unplacedLogs = [];
      this.rechargingLogs = [];
      this.bounds = { x: 0, y: 0, width: 1, height: 1 };
    }

    get count() {
      return this.logs.length;
    }

    get canAcceptLog() {
      return this.logs.length < MAX_HEARTH_LOGS;
    }

    get availableTemporaryLogs() {
      return this.unplacedLogs.length;
    }

    get incomePerSecond() {
      let income = 0;
      for (const log of this.logs) income += log.outputPerSecond;
      return income;
    }

    resize(width, height) {
      const maxWidth = width * 0.92;
      const maxHeight = height * 0.68;
      let hearthWidth = Math.min(maxWidth, 900);
      let hearthHeight = hearthWidth * (4 / 6);
      if (hearthHeight > maxHeight) {
        hearthHeight = maxHeight;
        hearthWidth = hearthHeight * 1.5;
      }
      this.bounds = {
        x: (width - hearthWidth) / 2,
        y: (height - hearthHeight) / 2,
        width: hearthWidth,
        height: hearthHeight,
      };
      for (const log of this.logs) log.clampToBounds(this.bounds);
    }

    addPersistentLog(burning = false) {
      if (!this.canAcceptLog) return null;
      const log = new Log(
        "persistent",
        this.bounds.x + this.bounds.width / 2,
        this.bounds.y + this.bounds.height / 2,
        0,
        burning,
      );
      log.y = this.bounds.y + this.bounds.height - log.halfH;
      log.isStatic = true;
      this.logs.push(log);
      return log;
    }

    addTemporaryLog() {
      if (!this.canAcceptLog || this.unplacedLogs.length === 0) return null;
      const log = this.unplacedLogs.pop();
      log.x = this.bounds.x + this.bounds.width / 2;
      log.y = this.bounds.y + this.bounds.height / 2;
      log.angle = Math.PI / 2 - Math.random() * (Math.PI / 4);
      log.updateBasis();
      log.vx = 0;
      log.vy = 0;
      log.omega = 0;
      log.clampToBounds(this.bounds);
      this.logs.push(log);
      return log;
    }

    clear() {
      this.logs.length = 0;
      this.rechargingLogs.length = 0;
      this.unplacedLogs.length = 0;
      for (let index = 0; index < MAX_TEMP_LOGS; index++) {
        this.unplacedLogs.push(
          new Log(
            "temporary",
            this.bounds.x + this.bounds.width / 2,
            this.bounds.y + this.bounds.height / 2,
            Math.PI / 2,
          ),
        );
      }
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

    resolveLogCollisions() {
      for (let a = 0; a < this.logs.length; a++) {
        const first = this.logs[a];
        for (let b = a + 1; b < this.logs.length; b++) {
          const second = this.logs[b];
          if (first.invMass === 0 && second.invMass === 0) continue;

          const dx = second.x - first.x;
          const dy = second.y - first.y;
          const axes = [
            [first.ux, first.uy],
            [-first.uy, first.ux],
            [second.ux, second.uy],
            [-second.uy, second.ux],
          ];

          let separated = false;
          let smallestOverlap = Number.POSITIVE_INFINITY;
          let normalX = 0;
          let normalY = 0;

          for (let index = 0; index < axes.length; index++) {
            const axisX = axes[index][0];
            const axisY = axes[index][1];
            const projection = dx * axisX + dy * axisY;
            const overlap =
              first.projectRadius(axisX, axisY) +
              second.projectRadius(axisX, axisY) -
              Math.abs(projection);
            if (overlap <= 0) {
              separated = true;
              break;
            }
            if (overlap < smallestOverlap) {
              smallestOverlap = overlap;
              if (projection < 0) {
                normalX = -axisX;
                normalY = -axisY;
              } else {
                normalX = axisX;
                normalY = axisY;
              }
            }
          }

          if (separated) continue;

          getSupport(first, normalX, normalY, pointA);
          getSupport(second, -normalX, -normalY, pointB);
          contactPoint.x = (pointA.x + pointB.x) * 0.5;
          contactPoint.y = (pointA.y + pointB.y) * 0.5;
          resolveContact(
            first,
            second,
            normalX,
            normalY,
            contactPoint.x,
            contactPoint.y,
            smallestOverlap,
          );
        }
      }
    }

    resolvePhysics() {
      for (let iteration = 0; iteration < SOLVER_ITERATIONS; iteration++) {
        this.resolveLogCollisions();
        for (const log of this.logs) {
          resolveLogBounds(log, this.bounds);
        }
      }
    }

    update(dt) {
      if (drag && rotateDirection !== 0) {
        drag.angle += rotateDirection * ROTATION_SPEED * dt;
        drag.updateBasis();
      }

      for (const log of this.logs) log.clearDelta();
      this.buildCellIndex();
      this.transferHeat(dt);
      for (const log of this.logs) log.update(dt);
      for (const log of this.logs) log.integratePhysics(dt);
      this.resolvePhysics();
      for (const log of this.logs) log.clampToBounds(this.bounds);

      for (let index = this.logs.length - 1; index >= 0; index--) {
        const log = this.logs[index];
        if (log.type !== "temporary" || !log.isDepleted) continue;
        this.logs.splice(index, 1);
        this.rechargingLogs.push({ log, remaining: TEMP_LOG_RECHARGE_SECONDS });
      }

      for (let index = this.rechargingLogs.length - 1; index >= 0; index--) {
        const entry = this.rechargingLogs[index];
        entry.remaining -= dt;
        if (entry.remaining > 0) continue;
        this.rechargingLogs.splice(index, 1);
        entry.log.recharge();
        this.unplacedLogs.push(entry.log);
      }
    }

    emit(dt) {
      for (const log of this.logs) log.emit(dt);
    }

    renderGlow(context) {
      for (const log of this.logs) {
        let average = 0;
        for (let cell = 0; cell < log.count; cell++) average += log.temp[cell];
        average /= log.count;
        if (average < 110) continue;
        const strength = Math.max(0, Math.min(1, (average - 110) / 710));
        const radius = Math.max(log.halfW, log.halfH) + 70;
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

    renderDebug(context) {
      for (const log of this.logs) log.renderDebug(context);
    }
  }

  const hearth = new Hearth();

  canvas.addEventListener("pointerdown", onClicked);
  canvas.addEventListener("pointermove", event => {
    if (!drag || event.pointerId !== activePointer) return;
    drag.x = event.clientX + offsetX;
    drag.y = event.clientY + offsetY;
    drag.clampToBounds(hearth.bounds);
  });
  canvas.addEventListener("pointerup", onRelease);
  canvas.addEventListener("pointercancel", onRelease);
  canvas.addEventListener("lostpointercapture", onRelease);
  window.addEventListener("resize", resize);
  window.addEventListener("keydown", event => {
    if (event.key === "ArrowLeft") {
      rotateDirection = -1;
      event.preventDefault();
    } else if (event.key === "ArrowRight") {
      rotateDirection = 1;
      event.preventDefault();
    }
  });
  window.addEventListener("keyup", event => {
    if (event.key === "ArrowLeft" && rotateDirection === -1) {
      rotateDirection = 0;
    } else if (event.key === "ArrowRight" && rotateDirection === 1) {
      rotateDirection = 0;
    }
  });
  document.getElementById("reset").addEventListener("click", reset);
  document.getElementById("add-log").addEventListener("click", () => {
    hearth.addTemporaryLog();
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
    rotateDirection = 0;
    canvas.classList.remove("dragging");
    particles.length = 0;
    score = 0;
    hearth.clear();
    hearth.addPersistentLog(true);
    accumulator = 0;
  }

  function update(dt) {
    hearth.update(dt);
    hearth.emit(dt);
    updateParticles(dt);
    score += hearth.incomePerSecond * dt;
  }

  function updateParticles(dt) {
    for (let index = particles.length - 1; index >= 0; index--) {
      const particle = particles[index];
      particle.age += dt;
      if (particle.age >= particle.life) {
        particle.log.particleCount--;
        particles[index] = particles[particles.length - 1];
        particles.pop();
        continue;
      }
      particle.x += (particle.vx + Math.sin(particle.age * 9 + particle.phase) * 14) * dt;
      particle.y += particle.vy * dt;
      particle.vy -= 18 * dt;
    }
  }

  function updateHud() {
    scoreElement.textContent = Math.floor(score).toLocaleString();
    incomeElement.textContent = `${hearth.incomePerSecond.toFixed(2)} / sec`;
    inventoryElement.textContent = `${hearth.availableTemporaryLogs} / ${MAX_TEMP_LOGS}`;
  }

  function updateFps(time) {
    frameCount++;
    if (time - fpsTime < 500) return;
    const measuredFps = Math.round((frameCount * 1000) / (time - fpsTime));
    fpsElement.textContent = measuredFps.toLocaleString();
    frameCount = 0;
    fpsTime = time;
  }

  function onClicked(event) {
    if (activePointer !== null || event.button !== 0) return;
    for (let index = hearth.logs.length - 1; index >= 0; index--) {
      const log = hearth.logs[index];
      if (log.isStatic) continue;
      if (!log.contains(event.clientX, event.clientY, 6)) continue;
      drag = log;
      drag.isDragged = true;
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
    if (drag) {
      drag.isDragged = false;
      drag.vx = 0;
      drag.vy = 0;
      drag.omega = 0;
    }
    drag = null;
    activePointer = null;
    canvas.classList.remove("dragging");
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  }

  function renderHearth(context) {
    const bounds = hearth.bounds;
    context.strokeStyle = "rgba(231,226,217,0.16)";
    context.lineWidth = 3;
    context.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
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
    hearth.renderDebug(ctx);
    updateHud();
  }

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    CELL = Math.max(9, Math.min(16, Math.round(Math.min(width, height) / 44)));
    CELL_INFLUENCE = CELL * CELL_INFLUENCE_MULTIPLIER;
    BUCKET = CELL * BUCKET_MULTIPLIER;
    BUCKET_RADIUS = Math.ceil(CELL_INFLUENCE / BUCKET);
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
    updateFps(time);
    requestAnimationFrame(frame);
  }
})();
