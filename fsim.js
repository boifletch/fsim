"use strict";
(() => {
  const canvas = document.getElementById("fire");
  const ctx = canvas.getContext("2d", { alpha: false });
  const scoreElement = document.getElementById("score");
  const incomeElement = document.getElementById("income");
  const fanMultiplierElement = document.getElementById("fan-multiplier");
  const inventoryElement = document.getElementById("inventory");
  const autosaveInElement = document.getElementById("autosave-in");
  const fpsElement = document.getElementById("fps");
  const showDebugInput = document.getElementById("show-debug");
  const showControlsInput = document.getElementById("show-controls");
  const settingsElement = document.getElementById("settings");
  const baseLogOutputInput = document.getElementById("base-log-output");
  const fanMaxMultiplierInput = document.getElementById("fan-max-multiplier");
  const fanIncreaseRateInput = document.getElementById("fan-increase-rate");
  const fanDecayInput = document.getElementById("fan-decay");
  const cellBurnDecayInput = document.getElementById("cell-burn-decay");
  const fuelConsumptionRateInput = document.getElementById("fuel-consumption-rate");
  const fanInfluenceAreaInput = document.getElementById("fan-influence-area");
  const crackleChanceInput = document.getElementById("crackle-chance");
  const TAU = Math.PI * 2;
  const FPS = 60;
  const STEP = 1 / FPS;
  const CELL_INFLUENCE_MULTIPLIER = 2.5;
  const BUCKET_MULTIPLIER = 2;
  const MAX_LOG_PARTICLES = 110;
  const MAX_PARTICLES = 2200;
  const MAX_HEARTH_LOGS = 8;
  const MAX_TEMP_LOGS = 5;
  const TEMP_LOG_RECHARGE_SECONDS = 20;
  const AUTOSAVE_SECONDS = 30;
  const AMBIENT = 20;
  const IGNITION = 290;
  const BURN_TEMP = 820;
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
  let activeTool = null;
  let offsetX = 0;
  let offsetY = 0;
  let last = 0;
  let accumulator = 0;
  let frameCount = 0;
  let fpsTime = 0;
  let autosaveRemaining = AUTOSAVE_SECONDS;
  let cellsByBucket = new Map();

  let baseLogOutput = 1.8;
  let fanMaxMultiplier = 3;
  let fanIncreaseRate = 8;
  let fanDecayPerSecond = 3;
  let cellBurnRateDecay = 1.5;
  let logFuelConsumptionRate = 0.01;
  let fanInfluenceArea = 6;
  let crackleChancePerSecond = 0.003;
  let showDebug = false;

  const FAN_FULL_SPEED = 1400;

  const toolkit = { x: 0, y: 0, width: 0, height: 0, padding: 10, labelHeight: 18 };
  const fan = {
    x: 0,
    y: 0,
    homeX: 0,
    homeY: 0,
    width: 0,
    height: 0,
    dragging: false,
    pointerOffsetX: 0,
    pointerOffsetY: 0,
    lagX: 0,
    lagY: 0,
    lastMoveX: 0,
    lastMoveY: 0,
    lastTickX: 0,
    lastTickY: 0,
    intensity: 0,
    strokeDir: 0,
    strokeTravel: 0,
    strokePeakSpeed: 0,
  };

  const lighter = {
    x: 0,
    y: 0,
    homeX: 0,
    homeY: 0,
    width: 0,
    height: 0,
    dragging: false,
    pointerOffsetX: 0,
    pointerOffsetY: 0,
    influenceArea: 4,
    emitAccumulator: 0,
    particleSource: { particleCount: 0 },
  };

  const pointA = { x: 0, y: 0 };

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  const CONTROL_SETTINGS_KEY = "fsim.settings";
  const controlInputs = [
    baseLogOutputInput,
    fanMaxMultiplierInput,
    fanIncreaseRateInput,
    fanDecayInput,
    cellBurnDecayInput,
    fuelConsumptionRateInput,
    fanInfluenceAreaInput,
    crackleChanceInput,
  ];

  function syncSettingsFromInputs() {
    baseLogOutput = Math.max(0, Number(baseLogOutputInput.value) || 0);
    fanMaxMultiplier = Math.max(1, Number(fanMaxMultiplierInput.value) || 1);
    fanIncreaseRate = Math.max(0, Number(fanIncreaseRateInput.value) || 0);
    fanDecayPerSecond = Math.max(0, Number(fanDecayInput.value) || 0);
    cellBurnRateDecay = Math.max(0, Number(cellBurnDecayInput.value) || 0);
    logFuelConsumptionRate = Math.max(0, Number(fuelConsumptionRateInput.value) || 0);
    fanInfluenceArea = Math.max(1, Number(fanInfluenceAreaInput.value) || 1);
    crackleChancePerSecond = Math.max(0, (Number(crackleChanceInput.value) || 0) / 100);
    showDebug = !!showDebugInput.checked;
    if (settingsElement && showControlsInput) {
      settingsElement.style.display = showControlsInput.checked ? "flex" : "none";
    }
  }

  function saveControlSettings() {
    try {
      const data = {};
      for (const input of controlInputs) data[input.id] = input.value;
      localStorage.setItem(CONTROL_SETTINGS_KEY, JSON.stringify(data));
    } catch {}
  }

  function loadControlSettings() {
    try {
      const raw = localStorage.getItem(CONTROL_SETTINGS_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (!data || typeof data !== "object") return;
      for (const input of controlInputs) {
        if (Object.prototype.hasOwnProperty.call(data, input.id)) {
          input.value = data[input.id];
        }
      }
    } catch {}
  }

  function getFanMultiplier() {
    return 1 + (fanMaxMultiplier - 1) * fan.intensity;
  }

  function layoutToolkit() {
    fan.width = 2 * CELL;
    fan.height = 5 * CELL;
    lighter.width = 1 * CELL;
    lighter.height = 6 * CELL;
    toolkit.padding = Math.max(8, Math.round(CELL * 0.7));
    toolkit.labelHeight = 18;
    const toolGap = Math.max(10, Math.round(CELL * 0.8));
    const toolsWidth = lighter.width + toolGap + fan.width;
    const toolsHeight = Math.max(fan.height, lighter.height);
    toolkit.width = Math.max(toolsWidth + toolkit.padding * 2, 120);
    toolkit.height = toolkit.labelHeight + toolsHeight + toolkit.padding * 3;
    toolkit.x = width - toolkit.width - 16;
    toolkit.y = 14;

    const toolsLeft = toolkit.x + (toolkit.width - toolsWidth) / 2;
    const toolsTop = toolkit.y + toolkit.labelHeight + toolkit.padding + 2;
    lighter.homeX = toolsLeft + lighter.width / 2;
    lighter.homeY = toolsTop + toolsHeight - lighter.height / 2;
    fan.homeX = toolsLeft + lighter.width + toolGap + fan.width / 2;
    fan.homeY = toolsTop + toolsHeight - fan.height / 2;

    if (!fan.dragging) {
      fan.x = fan.homeX;
      fan.y = fan.homeY;
      fan.lagX = 0;
      fan.lagY = 0;
    }
    if (!lighter.dragging) {
      lighter.x = lighter.homeX;
      lighter.y = lighter.homeY;
    }
  }

  function resetFanState() {
    fan.dragging = false;
    fan.pointerOffsetX = 0;
    fan.pointerOffsetY = 0;
    fan.lagX = 0;
    fan.lagY = 0;
    fan.intensity = 0;
    fan.strokeDir = 0;
    fan.strokeTravel = 0;
    fan.strokePeakSpeed = 0;
    fan.lastTickX = fan.homeX;
    fan.lastTickY = fan.homeY;
    fan.lastMoveX = fan.homeX;
    fan.lastMoveY = fan.homeY;
    fan.x = fan.homeX;
    fan.y = fan.homeY;
  }

  function resetLighterState() {
    lighter.dragging = false;
    lighter.pointerOffsetX = 0;
    lighter.pointerOffsetY = 0;
    lighter.emitAccumulator = 0;
    lighter.x = lighter.homeX;
    lighter.y = lighter.homeY;
  }

  function pointInLighter(x, y) {
    const halfW = lighter.width / 2;
    const halfH = lighter.height / 2;
    return (
      x >= lighter.x - halfW - 6 &&
      x <= lighter.x + halfW + 6 &&
      y >= lighter.y - halfH - 6 &&
      y <= lighter.y + halfH + 6
    );
  }

  function getLighterInfluenceRect() {
    const size = lighter.influenceArea * CELL;
    return {
      x: lighter.x - size / 2,
      y: lighter.y - lighter.height / 2 - size * 0.55,
      width: size,
      height: size,
    };
  }

  function lighterInfluenceContainsPoint(x, y) {
    const rect = getLighterInfluenceRect();
    return (
      x >= rect.x &&
      x <= rect.x + rect.width &&
      y >= rect.y &&
      y <= rect.y + rect.height
    );
  }

  function pointInFan(x, y) {
    const halfW = fan.width / 2;
    const halfH = fan.height / 2;
    return (
      x >= fan.x - halfW - 6 &&
      x <= fan.x + halfW + 6 &&
      y >= fan.y - halfH - 6 &&
      y <= fan.y + halfH + 6
    );
  }

  function fanIntersectsBounds(bounds) {
    const halfW = fan.width / 2;
    const halfH = fan.height / 2;
    return !(
      fan.x + halfW < bounds.x ||
      fan.x - halfW > bounds.x + bounds.width ||
      fan.y + halfH < bounds.y ||
      fan.y - halfH > bounds.y + bounds.height
    );
  }

  function applyLighter(dt) {
    if (!lighter.dragging) {
      lighter.emitAccumulator = 0;
      return;
    }

    const rect = getLighterInfluenceRect();
    if (rectIntersectsBounds(rect, hearth.bounds)) {
      const position = { x: 0, y: 0 };
      for (const log of hearth.logs) {
        for (let cell = 0; cell < log.count; cell++) {
          log.cellWorld(cell, position);
          if (lighterInfluenceContainsPoint(position.x, position.y)) {
            log.temp[cell] = Math.min(IGNITION, Math.max(log.temp[cell], IGNITION));
          }
        }
      }
    }

    lighter.emitAccumulator += dt * 28;
    while (lighter.emitAccumulator >= 1) {
      lighter.emitAccumulator--;
      if (particles.length >= MAX_PARTICLES) continue;
      const flameX = lighter.x + (Math.random() - 0.5) * lighter.width * 0.9;
      const flameY = lighter.y - lighter.height * 0.5 + lighter.height * (0.08 + Math.random() * 0.18);
      const heat = 0.75 + Math.random() * 0.2;
      particles.push({
        x: flameX,
        y: flameY,
        vx: (Math.random() - 0.5) * 18,
        vy: -(30 + Math.random() * 28),
        age: 0,
        life: 0.18 + Math.random() * 0.22,
        size: 2 + Math.random() * 3,
        heat,
        phase: Math.random() * TAU,
        wispPhase: Math.random() * TAU,
        wispAmp: 2 + Math.random() * 4,
        wispFreq: 6 + Math.random() * 4,
        log: lighter.particleSource,
      });
      lighter.particleSource.particleCount++;
    }
  }

  function getFanCenter() {
    return {
      x: fan.x + fan.width / 2,
      y: fan.y + fan.height / 2,
    };
  }

  function getFanInfluenceRect() {
    const center = getFanCenter();
    const size = fanInfluenceArea * CELL;
    return {
      x: center.x - size / 2,
      y: center.y - size / 2,
      width: size,
      height: size,
    };
  }

  function fanInfluenceContainsPoint(x, y) {
    const rect = getFanInfluenceRect();
    return (
      x >= rect.x &&
      x <= rect.x + rect.width &&
      y >= rect.y &&
      y <= rect.y + rect.height
    );
  }

  function rectIntersectsBounds(rect, bounds) {
    return !(
      rect.x + rect.width < bounds.x ||
      rect.x > bounds.x + bounds.width ||
      rect.y + rect.height < bounds.y ||
      rect.y > bounds.y + bounds.height
    );
  }

  function applyFanning(dt) {
    if (!fan.dragging) {
      fan.intensity = Math.max(0, fan.intensity - fanDecayPerSecond * dt);
      fan.lagX = 0;
      fan.lagY = 0;
      fan.lastTickX = fan.x;
      fan.lastTickY = fan.y;
      fan.strokeDir = 0;
      fan.strokeTravel = 0;
      fan.strokePeakSpeed = 0;
      return;
    }

    fan.lagX += (0 - fan.lagX) * Math.min(1, dt * 8);
    fan.lagY += (0 - fan.lagY) * Math.min(1, dt * 8);

    const dx = fan.x - fan.lastTickX;
    const dy = fan.y - fan.lastTickY;
    const speed = Math.hypot(dx, dy) / Math.max(dt, 1e-4);
    const targetIntensity = clamp(speed / FAN_FULL_SPEED, 0, 1);
    if (targetIntensity >= fan.intensity) {
      fan.intensity =
        fanIncreaseRate <= 0
          ? targetIntensity
          : Math.min(targetIntensity, fan.intensity + fanIncreaseRate * dt);
    } else {
      fan.intensity = Math.max(targetIntensity, fan.intensity - fanDecayPerSecond * dt);
    }

    fan.lastTickX = fan.x;
    fan.lastTickY = fan.y;

    const influenceRect = getFanInfluenceRect();
    const overHearth = rectIntersectsBounds(influenceRect, hearth.bounds);
    if (!overHearth || fan.intensity <= 0) return;

    const multiplier = getFanMultiplier();
    const position = { x: 0, y: 0 };
    for (const log of hearth.logs) {
      for (let cell = 0; cell < log.count; cell++) {
        log.cellWorld(cell, position);
        if (fanInfluenceContainsPoint(position.x, position.y)) {
          log.fanBoost[cell] = Math.max(log.fanBoost[cell], multiplier);
        }
      }
    }
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

  function getPlacementAngle(log, bounds) {
    if (log.type === "persistent") return log.angle;
    const relativeX = clamp((log.x - bounds.x) / bounds.width, 0, 1);
    if (relativeX < 0.45) return -Math.PI / 4;
    if (relativeX > 0.55) return Math.PI / 4;
    return 0;
  }

  function separateBodies(a, b, nx, ny, depth) {
    const aMovable = !a.isStatic && !a.isDragged;
    const bMovable = !b.isStatic && !b.isDragged;
    const aMass = aMovable ? 1 : 0;
    const bMass = bMovable ? 1 : 0;
    const invMassSum = aMass + bMass;
    if (invMassSum <= 0) return;

    const correction = Math.max(depth - POSITION_SLOP, 0) / invMassSum * POSITION_CORRECTION;
    if (correction <= 0) return;

    if (aMass) {
      a.x -= nx * correction;
      a.y -= ny * correction;
    }
    if (bMass) {
      b.x += nx * correction;
      b.y += ny * correction;
    }
  }

  function separateLogFromBounds(log, nx, ny, depth) {
    if (log.isStatic || log.isDragged) return;
    const correction = Math.max(depth - POSITION_SLOP, 0) * POSITION_CORRECTION;
    if (correction <= 0) return;
    log.x += nx * correction;
    log.y += ny * correction;
  }

  function resolveLogBounds(log, bounds) {
    if (log.isStatic || log.isDragged) return;
    const left = bounds.x;
    const right = bounds.x + bounds.width;
    const top = bounds.y;
    const bottom = bounds.y + bounds.height;

    getSupport(log, 0, 1, pointA);
    if (pointA.y > bottom) separateLogFromBounds(log, 0, -1, pointA.y - bottom);

    getSupport(log, 0, -1, pointA);
    if (pointA.y < top) separateLogFromBounds(log, 0, 1, top - pointA.y);

    getSupport(log, 1, 0, pointA);
    if (pointA.x > right) separateLogFromBounds(log, -1, 0, pointA.x - right);

    getSupport(log, -1, 0, pointA);
    if (pointA.x < left) separateLogFromBounds(log, 1, 0, left - pointA.x);
  }

  class Log {
    constructor(type, x, y, angle, burning = false, cols = null, rows = null) {
      this.type = type;
      this.x = x;
      this.y = y;
      this.angle = angle;
      this.cols = cols == null ? 12 + Math.floor(Math.random() * 5) : cols;
      this.rows = rows == null ? 2 + Math.floor(Math.random() * 2) : rows;
      this.count = this.cols * this.rows;
      this.halfW = (this.cols * CELL) / 2;
      this.halfH = (this.rows * CELL) / 2;
      this.temp = new Float64Array(this.count).fill(AMBIENT);
      this.delta = new Float64Array(this.count);
      this.fuel = new Float64Array(this.count).fill(1);
      this.burning = new Uint8Array(this.count);
      this.emission = new Float64Array(this.count);
      this.fanBoost = new Float64Array(this.count).fill(1);
      this.crackle = new Float64Array(this.count);
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
      let output = 0;
      for (let cell = 0; cell < this.count; cell++) {
        if (!this.burning[cell]) continue;
        const burnRate = this.fanBoost ? this.fanBoost[cell] : 1;
        output += (baseLogOutput / this.count) * burnRate;
      }
      return output;
    }

    get isDepleted() {
      for (let cell = 0; cell < this.count; cell++) {
        if (this.fuel[cell] > 0) return false;
      }
      return true;
    }

    get invMass() {
      return this.isStatic ? 0 : 1;
    }

    recharge() {
      this.temp.fill(AMBIENT);
      this.delta.fill(0);
      this.fuel.fill(1);
      this.burning.fill(0);
      this.emission.fill(0);
      this.fanBoost.fill(1);
      this.crackle.fill(0);
      this.particleCount = 0;
      this.vx = 0;
      this.vy = 0;
      this.omega = 0;
    }

    updateBasis() {
      this.ux = Math.cos(this.angle);
      this.uy = Math.sin(this.angle);
    }

    applyPlacementRotation(bounds) {
      this.angle = getPlacementAngle(this, bounds);
      this.updateBasis();
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
      const burnRate = Math.max(this.fanBoost[thisCell] || 1, other.fanBoost[otherCell] || 1);
      const heat =
        (this.temp[thisCell] - other.temp[otherCell]) * coupling * dt * burnRate;
      this.delta[thisCell] -= heat;
      other.delta[otherCell] += heat;
    }

    conduct(a, b, dt) {
      const burnRate = Math.max(this.fanBoost[a] || 1, this.fanBoost[b] || 1);
      const heat = (this.temp[a] - this.temp[b]) * 0.35 * dt * burnRate;
      this.delta[a] -= heat;
      this.delta[b] += heat;
    }

    update(dt) {
      const cracklePos = { x: 0, y: 0 };
      const crackleChance = 1 - Math.exp(-crackleChancePerSecond * dt);
      for (let cell = 0; cell < this.count; cell++) {
        let temperature = this.temp[cell] + this.delta[cell];
        temperature -= (temperature - AMBIENT) * 0.075 * dt;
        const boost = this.fanBoost ? this.fanBoost[cell] : 1;
        if (!this.burning[cell] && this.fuel[cell] > 0 && temperature >= IGNITION) {
          this.burning[cell] = 1;
        }
        if (this.burning[cell]) {
          if (this.type === "temporary") {
            this.fuel[cell] = Math.max(0, this.fuel[cell] - dt * logFuelConsumptionRate * boost);
          }
          if (this.fuel[cell] === 0 || temperature < 190) {
            this.burning[cell] = 0;
          } else {
            temperature += (BURN_TEMP - temperature) * 1.5 * dt * boost;
          }
        }
        this.temp[cell] = Math.max(AMBIENT, temperature);

        if (this.crackle) {
          this.crackle[cell] = Math.max(0, (this.crackle[cell] || 0) - dt);
        }
        if (this.burning[cell] && Math.random() < crackleChance) {
          this.crackle[cell] = 0.09;
          this.cellWorld(cell, cracklePos);
          const sparkCount = 2 + Math.floor(Math.random() * 3);
          for (let i = 0; i < sparkCount; i++) {
            if (this.particleCount >= MAX_LOG_PARTICLES || particles.length >= MAX_PARTICLES) break;
            const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.6;
            const speed = 35 + Math.random() * 85;
            particles.push({
              x: cracklePos.x + (Math.random() - 0.5) * CELL * 0.5,
              y: cracklePos.y + (Math.random() - 0.5) * CELL * 0.35,
              vx: Math.cos(angle) * speed + (Math.random() - 0.5) * 20,
              vy: Math.sin(angle) * speed - 20 - Math.random() * 30,
              age: 0,
              life: 0.05 + Math.random() * 0.09,
              size: 0.8 + Math.random() * 1.6,
              heat: 1,
              phase: Math.random() * TAU,
              wispPhase: 0,
              wispAmp: 0,
              wispFreq: 0,
              log: this,
              spark: true,
            });
            this.particleCount++;
          }
        }
      }
    }

    emit(dt) {
      const position = { x: 0, y: 0 };
      for (let cell = 0; cell < this.count; cell++) {
        if (!this.burning[cell]) continue;
        const temperature = this.temp[cell];
        const heat = clamp((temperature - 220) / (BURN_TEMP - 220), 0, 1);

        this.emission[cell] += dt * (1.3 + heat * 3.1);
        while (this.emission[cell] >= 1) {
          this.emission[cell]--;
          if (this.particleCount >= MAX_LOG_PARTICLES || particles.length >= MAX_PARTICLES) {
            continue;
          }

          this.cellWorld(cell, position);
          const wispCount = 1 + (heat > 0.45 ? 1 : 0) + (heat > 0.8 ? 1 : 0);
          const wispPhase = Math.random() * TAU;
          const wispAmp = 4 + heat * 18;
          const wispFreq = 3 + Math.random() * 5;

          for (let i = 0; i < wispCount; i++) {
            if (this.particleCount >= MAX_LOG_PARTICLES || particles.length >= MAX_PARTICLES) break;

            const spread = CELL * (0.22 + heat * 0.22);
            const riseJitter = (Math.random() - 0.5) * (3 + heat * 5);
            const size = (2.4 + Math.random() * 4.8) * (0.8 + heat * 1.15);
            const life = 0.26 + heat * 0.3 + Math.random() * 0.52;
            particles.push({
              x: position.x + (Math.random() - 0.5) * spread * 2 + Math.cos(wispPhase + i) * heat * 1.5,
              y: position.y + (Math.random() - 0.5) * spread,
              vx: (Math.random() - 0.5) * (14 + heat * 22) + riseJitter,
              vy: -(26 + heat * 62 + Math.random() * 34),
              age: 0,
              life,
              size,
              heat,
              phase: Math.random() * TAU,
              wispPhase,
              wispAmp,
              wispFreq,
              log: this,
            });
            this.particleCount++;
          }
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
        const x = (cell % this.cols) * CELL - this.halfW;
        const y = ((cell / this.cols) | 0) * CELL - this.halfH;
        if (this.type === "persistent") {
          const red = Math.round(205 + (162 - 205) * hot);
          const green = Math.round(205 + (60 - 205) * hot);
          const blue = Math.round(205 + (34 - 205) * hot);
          context.fillStyle = `rgb(${red},${green},${blue})`;
        } else {
          const char = 1 - this.fuel[cell];
          context.fillStyle = `rgb(${Math.round(97 - char * 67 + hot * 65)},${Math.round(60 - char * 40)},${Math.round(34 - char * 23)})`;
        }
        context.fillRect(x, y, CELL, CELL);

        if (this.crackle && this.crackle[cell] > 0) {
          const c = clamp(this.crackle[cell] / 0.09, 0, 1);
          if (showDebug) {
            context.fillStyle = `rgba(255, 60, 200, ${0.22 + c * 0.6})`;
            context.fillRect(x, y, CELL, CELL);
            context.fillStyle = `rgba(255, 20, 170, ${c * 0.35})`;
            context.fillRect(x + CELL * 0.15, y + CELL * 0.15, CELL * 0.7, CELL * 0.7);
          } else {
            context.fillStyle = `rgba(255, 245, 210, ${0.18 + c * 0.55})`;
            context.fillRect(x, y, CELL, CELL);
            context.fillStyle = `rgba(255, 180, 60, ${c * 0.28})`;
            context.fillRect(x + CELL * 0.15, y + CELL * 0.15, CELL * 0.7, CELL * 0.7);
          }
        }

        if (showDebug && this.type !== "persistent" && this.burning[cell]) {
          const fuel = clamp(this.fuel[cell], 0, 1);
          const fuelHeight = CELL * fuel;
          if (fuelHeight > 0) {
            context.fillStyle = "rgba(70, 210, 90, 0.95)";
            context.fillRect(x, y + CELL - fuelHeight, CELL, fuelHeight);
          }
        }
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

    clear() {
      this.logs.length = 0;
      this.unplacedLogs.length = 0;
      this.rechargingLogs.length = 0;
    }

    createTemporaryLog() {
      return new Log(
        "temporary",
        this.bounds.x + this.bounds.width / 2,
        this.bounds.y + this.bounds.height / 2,
        Math.PI / 2,
      );
    }

    resetToDefault() {
      this.clear();
      this.addPersistentLog(true);
      this.fillTemporaryInventory();
    }

    fillTemporaryInventory() {
      const placedTemp = this.logs.filter(log => log.type === "temporary").length;
      const needed = Math.max(0, MAX_TEMP_LOGS - placedTemp - this.unplacedLogs.length - this.rechargingLogs.length);
      for (let i = 0; i < needed; i++) {
        this.unplacedLogs.push(this.createTemporaryLog());
      }
    }

    restoreState(logs) {
      this.clear();
      for (const log of logs) {
        log.applyPlacementRotation(this.bounds);
        log.clampToBounds(this.bounds);
        this.logs.push(log);
      }
      if (!this.logs.some(log => log.type === "persistent")) {
        this.addPersistentLog(true);
      }
      this.fillTemporaryInventory();
    }

    extinguish() {
      for (const log of this.logs) {
        for (let cell = 0; cell < log.count; cell++) {
          log.burning[cell] = 0;
          log.emission[cell] = 0;
          if (log.temp[cell] >= IGNITION) {
            log.temp[cell] = IGNITION - 1;
          }
        }
      }
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
      log.vx = 0;
      log.vy = 0;
      log.omega = 0;
      log.applyPlacementRotation(this.bounds);
      log.clampToBounds(this.bounds);
      this.logs.push(log);
      this.resolvePlacement();
      return log;
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
          if (first.isStatic && second.isStatic) continue;

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
          separateBodies(first, second, normalX, normalY, smallestOverlap);
        }
      }
    }

    resolvePlacement() {
      for (let iteration = 0; iteration < SOLVER_ITERATIONS; iteration++) {
        this.resolveLogCollisions();
        for (const log of this.logs) {
          resolveLogBounds(log, this.bounds);
          log.clampToBounds(this.bounds);
        }
      }
    }

    update(dt) {
      for (const log of this.logs) {
        log.vx = 0;
        log.vy = 0;
        log.omega = 0;
        log.clearDelta();
        if (log.fanBoost) {
          for (let cell = 0; cell < log.count; cell++) {
            log.fanBoost[cell] = Math.max(1, log.fanBoost[cell] - cellBurnRateDecay * dt);
          }
        }
      }

      applyFanning(dt);
      applyLighter(dt);

      this.buildCellIndex();
      this.transferHeat(dt);
      for (const log of this.logs) log.update(dt);

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
    if (event.pointerId !== activePointer) return;
    if (activeTool === "fan" && fan.dragging) {
      const nextX = event.clientX + fan.pointerOffsetX;
      const nextY = event.clientY + fan.pointerOffsetY;
      const dx = nextX - fan.x;
      const dy = nextY - fan.y;
      fan.x = nextX;
      fan.y = nextY;
      fan.lagX = clamp(fan.lagX - dx * 0.45, -CELL * 4, CELL * 4);
      fan.lagY = clamp(fan.lagY - dy * 0.18, -CELL * 2.5, CELL * 2.5);
      return;
    }
    if (activeTool === "lighter" && lighter.dragging) {
      lighter.x = event.clientX + lighter.pointerOffsetX;
      lighter.y = event.clientY + lighter.pointerOffsetY;
      return;
    }
    if (!drag) return;
    drag.x = event.clientX + offsetX;
    drag.y = event.clientY + offsetY;
    drag.applyPlacementRotation(hearth.bounds);
    drag.clampToBounds(hearth.bounds);
  });
  canvas.addEventListener("pointerup", onRelease);
  canvas.addEventListener("pointercancel", onRelease);
  canvas.addEventListener("lostpointercapture", onRelease);
  window.addEventListener("resize", resize);
  document.getElementById("reset").addEventListener("click", reset);
  document.getElementById("add-log").addEventListener("click", () => {
    hearth.addTemporaryLog();
  });
  document.getElementById("save").addEventListener("click", () => {
    saveGame();
  });
  document.getElementById("extinguish").addEventListener("click", () => {
    hearth.extinguish();
    clearAllParticles();
  });
  for (const input of [
    showDebugInput,
    showControlsInput,
    baseLogOutputInput,
    fanMaxMultiplierInput,
    fanIncreaseRateInput,
    fanDecayInput,
    cellBurnDecayInput,
    fuelConsumptionRateInput,
    fanInfluenceAreaInput,
    crackleChanceInput,
  ]) {
    const handler = () => {
      syncSettingsFromInputs();
      if (input !== showDebugInput && input !== showControlsInput) {
        saveControlSettings();
      }
    };
    input.addEventListener("input", handler);
    input.addEventListener("change", handler);
  }
  loadControlSettings();
  syncSettingsFromInputs();
  saveControlSettings();
  document.addEventListener("visibilitychange", () => {
    last = 0;
    accumulator = 0;
  });

  resize();
  if (!loadGame()) {
    reset();
  }
  requestAnimationFrame(frame);

  function bucketKey(x, y) {
    return (Math.floor(x / BUCKET) + 4096) * 8192 + (Math.floor(y / BUCKET) + 4096);
  }

  function clearAllParticles() {
    particles.length = 0;
    lighter.particleSource.particleCount = 0;
    for (const log of hearth.logs) {
      log.particleCount = 0;
    }
  }

  function reset() {
    drag = null;
    activePointer = null;
    activeTool = null;
    canvas.classList.remove("dragging");
    clearAllParticles();
    score = 0;
    autosaveRemaining = AUTOSAVE_SECONDS;
    hearth.resetToDefault();
    accumulator = 0;
    layoutToolkit();
    resetFanState();
    resetLighterState();
  }

  function serializeLog(log) {
    return {
      type: log.type,
      x: log.x,
      y: log.y,
      angle: log.angle,
      cols: log.cols,
      rows: log.rows,
      temp: Array.from(log.temp),
      fuel: Array.from(log.fuel),
      burning: Array.from(log.burning),
      emission: Array.from(log.emission),
      fanBoost: Array.from(log.fanBoost),
    };
  }

  function restoreLog(data) {
    const type = data.type === "persistent" ? "persistent" : "temporary";
    const cols = Math.max(1, Number(data.cols) || 1);
    const rows = Math.max(1, Number(data.rows) || 1);
    const log = new Log(type, Number(data.x) || 0, Number(data.y) || 0, Number(data.angle) || 0, false, cols, rows);
    if (Array.isArray(data.temp)) {
      for (let i = 0; i < log.count && i < data.temp.length; i++) log.temp[i] = Number(data.temp[i]) || AMBIENT;
    }
    if (Array.isArray(data.fuel)) {
      for (let i = 0; i < log.count && i < data.fuel.length; i++) log.fuel[i] = clamp(Number(data.fuel[i]) || 0, 0, 1);
    }
    if (Array.isArray(data.burning)) {
      for (let i = 0; i < log.count && i < data.burning.length; i++) log.burning[i] = data.burning[i] ? 1 : 0;
    }
    if (Array.isArray(data.emission)) {
      for (let i = 0; i < log.count && i < data.emission.length; i++) log.emission[i] = Math.max(0, Number(data.emission[i]) || 0);
    }
    if (Array.isArray(data.fanBoost)) {
      for (let i = 0; i < log.count && i < data.fanBoost.length; i++) log.fanBoost[i] = Math.max(0, Number(data.fanBoost[i]) || 1);
    }
    log.vx = 0;
    log.vy = 0;
    log.omega = 0;
    log.isDragged = false;
    log.isStatic = type === "persistent";
    log.particleCount = 0;
    log.updateBasis();
    return log;
  }

  function serializeGameState() {
    return {
      score,
      logs: hearth.logs.map(log => JSON.stringify(serializeLog(log))),
    };
  }

  function saveGame() {
    try {
      localStorage.setItem("fsim", JSON.stringify(serializeGameState()));
      autosaveRemaining = AUTOSAVE_SECONDS;
    } catch {}
  }

  function loadGame() {
    try {
      const raw = localStorage.getItem("fsim");
      if (!raw) return false;
      const state = JSON.parse(raw);
      if (!state || !Array.isArray(state.logs) || state.logs.length === 0) return false;

      const logs = [];
      for (const entry of state.logs) {
        const data = typeof entry === "string" ? JSON.parse(entry) : entry;
        if (!data) continue;
        logs.push(restoreLog(data));
      }
      if (!logs.some(log => log.type === "persistent")) return false;

      hearth.restoreState(logs);
      score = Math.max(0, Number(state.score) || 0);
      clearAllParticles();
      drag = null;
      activePointer = null;
      activeTool = null;
      autosaveRemaining = AUTOSAVE_SECONDS;
      accumulator = 0;
      layoutToolkit();
      resetFanState();
      resetLighterState();
      return true;
    } catch {
      return false;
    }
  }

  function update(dt) {
    hearth.update(dt);
    hearth.emit(dt);
    updateParticles(dt);
    score += hearth.incomePerSecond * dt;
    autosaveRemaining -= dt;
    if (autosaveRemaining <= 0) {
      saveGame();
      autosaveRemaining = AUTOSAVE_SECONDS;
    }
  }

  function applyParticleHeat(particle, dt) {
    const fade = 1 - particle.age / particle.life;
    const heat = (particle.heat || 0) * fade;
    if (heat <= 0.05) return;

    const base = 26 * heat * dt;
    for (let logIndex = 0; logIndex < hearth.logs.length; logIndex++) {
      const log = hearth.logs[logIndex];
      const maxReach = Math.max(log.halfW, log.halfH) + CELL * 1.5;
      const dx = particle.x - log.x;
      const dy = particle.y - log.y;
      if (dx * dx + dy * dy > maxReach * maxReach) continue;

      const lx = dx * log.ux + dy * log.uy;
      const ly = -dx * log.uy + dy * log.ux;
      const col = Math.floor((lx + log.halfW) / CELL);
      const row = Math.floor((ly + log.halfH) / CELL);
      if (col < 0 || col >= log.cols || row < 0 || row >= log.rows) continue;

      const cell = row * log.cols + col;
      if (log.fuel[cell] <= 0) continue;

      const cellCenterX = col * CELL - log.halfW + CELL * 0.5;
      const cellCenterY = row * CELL - log.halfH + CELL * 0.5;
      const aboveBias = clamp((cellCenterY - ly) / CELL + 0.5, 0.4, 1.8);
      log.temp[cell] = Math.min(BURN_TEMP * 1.05, log.temp[cell] + base * aboveBias);

      if (row + 1 < log.rows) {
        const below = cell + log.cols;
        if (log.fuel[below] > 0) {
          log.temp[below] = Math.min(BURN_TEMP * 1.05, log.temp[below] + base * 0.45);
        }
      }

      if (Math.abs(lx - cellCenterX) > CELL * 0.18) {
        const sideCol = lx < cellCenterX ? col - 1 : col + 1;
        if (sideCol >= 0 && sideCol < log.cols) {
          const side = row * log.cols + sideCol;
          if (log.fuel[side] > 0) {
            log.temp[side] = Math.min(BURN_TEMP * 1.05, log.temp[side] + base * 0.2);
          }
        }
      }
    }
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

      const t = particle.age / particle.life;
      const heat = particle.heat || 0;
      const wobble =
        Math.sin(particle.age * (7 + heat * 4) + particle.phase) * (2.5 + heat * 4.5);
      const wispSway =
        Math.sin(particle.age * (particle.wispFreq || 4) + (particle.wispPhase || 0)) *
        (particle.wispAmp || 0) *
        (0.25 + (1 - t) * 0.75);

      particle.x += (particle.vx + wobble + wispSway) * dt;
      particle.y += particle.vy * dt;
      particle.vy -= (12 + heat * 12) * dt;
      particle.vx *= Math.max(0, 1 - (0.35 + heat * 0.15) * dt);

      applyParticleHeat(particle, dt);
    }
  }

  function updateHud() {
    scoreElement.textContent = Math.floor(score).toLocaleString();
    incomeElement.textContent = `${hearth.incomePerSecond.toFixed(2)} / sec`;
    fanMultiplierElement.textContent = `${getFanMultiplier().toFixed(2)}x`;
    inventoryElement.textContent = `${hearth.availableTemporaryLogs} / ${MAX_TEMP_LOGS}`;
    autosaveInElement.textContent = `${Math.max(0, Math.ceil(autosaveRemaining))}s`;
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

    if (pointInLighter(event.clientX, event.clientY)) {
      activeTool = "lighter";
      lighter.dragging = true;
      activePointer = event.pointerId;
      lighter.pointerOffsetX = lighter.x - event.clientX;
      lighter.pointerOffsetY = lighter.y - event.clientY;
      canvas.setPointerCapture(event.pointerId);
      canvas.classList.add("dragging");
      return;
    }

    if (pointInFan(event.clientX, event.clientY)) {
      activeTool = "fan";
      fan.dragging = true;
      activePointer = event.pointerId;
      fan.pointerOffsetX = fan.x - event.clientX;
      fan.pointerOffsetY = fan.y - event.clientY;
      fan.lastMoveX = fan.x;
      fan.lastMoveY = fan.y;
      fan.lastTickX = fan.x;
      fan.lastTickY = fan.y;
      fan.strokeDir = 0;
      fan.strokeTravel = 0;
      fan.strokePeakSpeed = 0;
      canvas.setPointerCapture(event.pointerId);
      canvas.classList.add("dragging");
      return;
    }

    for (let index = hearth.logs.length - 1; index >= 0; index--) {
      const log = hearth.logs[index];
      if (log.isStatic) continue;
      if (!log.contains(event.clientX, event.clientY, 6)) continue;
      drag = log;
      drag.isDragged = true;
      activePointer = event.pointerId;
      activeTool = null;
      offsetX = log.x - event.clientX;
      offsetY = log.y - event.clientY;
      drag.applyPlacementRotation(hearth.bounds);
      drag.clampToBounds(hearth.bounds);
      hearth.logs.splice(index, 1);
      hearth.logs.push(log);
      canvas.setPointerCapture(event.pointerId);
      canvas.classList.add("dragging");
      return;
    }
  }

  function onRelease(event) {
    if (event.pointerId !== activePointer) return;

    if (activeTool === "lighter" && lighter.dragging) {
      lighter.dragging = false;
      lighter.x = lighter.homeX;
      lighter.y = lighter.homeY;
      lighter.emitAccumulator = 0;
    } else if (activeTool === "fan" && fan.dragging) {
      fan.dragging = false;
      fan.x = fan.homeX;
      fan.y = fan.homeY;
      fan.lagX = 0;
      fan.lagY = 0;
      fan.strokeDir = 0;
      fan.strokeTravel = 0;
      fan.strokePeakSpeed = 0;
      fan.lastTickX = fan.x;
      fan.lastTickY = fan.y;
      fan.lastMoveX = fan.x;
      fan.lastMoveY = fan.y;
    } else if (drag) {
      drag.isDragged = false;
      drag.vx = 0;
      drag.vy = 0;
      drag.omega = 0;
      drag.applyPlacementRotation(hearth.bounds);
      drag.clampToBounds(hearth.bounds);
      hearth.resolvePlacement();
      drag = null;
    }

    activePointer = null;
    activeTool = null;
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

  function renderToolkit(context) {
    context.save();
    context.strokeStyle = "rgba(231,226,217,0.22)";
    context.lineWidth = 2;
    context.strokeRect(toolkit.x, toolkit.y, toolkit.width, toolkit.height);
    context.fillStyle = "rgba(231,226,217,0.8)";
    context.font = "12px system-ui, sans-serif";
    context.textAlign = "left";
    context.textBaseline = "top";
    context.fillText("toolkit", toolkit.x + 8, toolkit.y + 4);

    if (showDebug) {
      const fanInfluence = getFanInfluenceRect();
      context.fillStyle = "rgba(255, 60, 60, 0.18)";
      context.strokeStyle = "rgba(255, 60, 60, 0.55)";
      context.lineWidth = 1.5;
      context.fillRect(fanInfluence.x, fanInfluence.y, fanInfluence.width, fanInfluence.height);
      context.strokeRect(fanInfluence.x, fanInfluence.y, fanInfluence.width, fanInfluence.height);

      const lighterInfluence = getLighterInfluenceRect();
      context.fillStyle = "rgba(255, 140, 60, 0.16)";
      context.strokeStyle = "rgba(255, 140, 60, 0.5)";
      context.fillRect(lighterInfluence.x, lighterInfluence.y, lighterInfluence.width, lighterInfluence.height);
      context.strokeRect(lighterInfluence.x, lighterInfluence.y, lighterInfluence.width, lighterInfluence.height);
    }

    const lHalfW = lighter.width / 2;
    const lHalfH = lighter.height / 2;
    const topHeight = lighter.height * (2 / 6);
    const bottomHeight = lighter.height - topHeight;
    context.fillStyle = "#b8bec8";
    context.fillRect(lighter.x - lHalfW, lighter.y - lHalfH, lighter.width, topHeight);
    context.fillStyle = "#d64545";
    context.fillRect(lighter.x - lHalfW, lighter.y - lHalfH + topHeight, lighter.width, bottomHeight);
    context.strokeStyle = "rgba(20,20,20,0.35)";
    context.lineWidth = 1;
    context.strokeRect(lighter.x - lHalfW, lighter.y - lHalfH, lighter.width, lighter.height);

    const halfW = fan.width / 2;
    const halfH = fan.height / 2;
    const lagMag = Math.hypot(fan.lagX, fan.lagY);
    const elongation = Math.min(CELL * 1.4, lagMag * 0.28);
    const topShiftX = fan.lagX;
    const topShiftY = fan.lagY - elongation;

    context.fillStyle = "#1fb7b0";
    context.strokeStyle = "rgba(220,255,252,0.45)";
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(fan.x - halfW, fan.y + halfH);
    context.lineTo(fan.x + halfW, fan.y + halfH);
    context.lineTo(fan.x + halfW + topShiftX, fan.y - halfH + topShiftY);
    context.lineTo(fan.x - halfW + topShiftX, fan.y - halfH + topShiftY);
    context.closePath();
    context.fill();
    context.stroke();
    context.restore();
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
      const heat = particle.heat || 0;
      const fade = 1 - t;
      if (particle.spark) {
        const radius = particle.size * (0.7 + fade * 1.2);
        const alpha = fade * 0.95;
        ctx.save();
        ctx.translate(particle.x, particle.y);
        const spark = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
        if (showDebug) {
          spark.addColorStop(0, `rgba(255,245,255,${alpha})`);
          spark.addColorStop(0.35, `rgba(255,80,220,${alpha * 0.95})`);
          spark.addColorStop(1, "rgba(255,0,170,0)");
        } else {
          spark.addColorStop(0, `rgba(255,255,235,${alpha})`);
          spark.addColorStop(0.35, `rgba(255,230,120,${alpha * 0.9})`);
          spark.addColorStop(1, "rgba(255,120,20,0)");
        }
        ctx.fillStyle = spark;
        ctx.fillRect(-radius, -radius, radius * 2, radius * 2);
        ctx.restore();
        continue;
      }
      const radius = particle.size * (0.25 + fade * 0.95) * (0.85 + heat * 0.55);
      const stretch = 1 + heat * 0.5 + fade * 0.2;
      const coreGreen = Math.min(255, Math.round(210 - 95 * t + heat * 38));
      const midGreen = Math.max(0, Math.round(120 - 80 * t + heat * 28));
      const coreAlpha = fade * (0.7 + heat * 0.22);
      const midAlpha = fade * (0.42 + heat * 0.2);

      ctx.save();
      ctx.translate(particle.x, particle.y);
      ctx.scale(1, stretch);
      const flame = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
      flame.addColorStop(0, `rgba(255,${coreGreen},${Math.round(70 + heat * 45 - t * 20)},${coreAlpha})`);
      flame.addColorStop(0.38, `rgba(255,${midGreen},${Math.round(18 + heat * 14)},${midAlpha})`);
      flame.addColorStop(1, "rgba(160,20,0,0)");
      ctx.fillStyle = flame;
      ctx.fillRect(-radius, -radius, radius * 2, radius * 2);
      ctx.restore();
    }
    ctx.globalCompositeOperation = "source-over";
    hearth.renderDebug(ctx);
    renderToolkit(ctx);
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
    layoutToolkit();
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
