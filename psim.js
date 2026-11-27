class Cell {
  constructor(temperature = 0) {
    this.temperature = Math.max(0, Math.min(1, temperature));
  }

  get color() {
    const red = Math.round(this.temperature * 255);
    return `rgb(${red}, 0, 0)`;
  }

  draw(context, x, y, size) {
    context.fillStyle = this.color;
    context.fillRect(x, y, size, size);
  }
}

class Environment {
  constructor(canvas, { envSize = 512, cellSize = 16, fps = 60 } = {}) {
    if (!Number.isInteger(envSize) || envSize <= 0) {
      throw new RangeError("envSize must be a positive integer.");
    }
    if (!Number.isFinite(cellSize) || cellSize <= 0) {
      throw new RangeError("cellSize must be a positive number.");
    }
    if (!Number.isFinite(fps) || fps <= 0) {
      throw new RangeError("fps must be a positive number.");
    }

    this.canvas = canvas;
    this.context = canvas.getContext("2d");
    if (!this.context) {
      throw new Error("A 2D canvas context is required.");
    }

    this.envSize = envSize;
    this.cellSize = this.findNearestDivisor(cellSize);
    this.fps = fps;
    this.frameDuration = 1000 / fps;
    this.cellsPerSide = envSize / this.cellSize;
    this.cells = Array.from({ length: this.cellsPerSide }, () =>
      Array.from({ length: this.cellsPerSide }, () => new Cell()),
    );
    this.animationFrame = null;
    this.lastFrameTime = null;
    this.elapsed = 0;
    this.activePointerId = null;

    const F = this.cellSize / this.envSize;
    this.ambientTemperature = 0;
    this.ambientDecay = (1 - F) * 0.008;
    this.sidewaysConductivity = (1 - F) * 0.14;
    this.upwardConductivity = (1 - F) * 0.64;
    this.downwardConductivity = (1 - F) * 0.05;

    canvas.width = envSize;
    canvas.height = envSize;
    canvas.addEventListener("pointerdown", event =>
      this.handlePointerDown(event),
    );
    canvas.addEventListener("pointermove", event =>
      this.handlePointerMove(event),
    );
    canvas.addEventListener("pointerup", event => this.handlePointerEnd(event));
    canvas.addEventListener("pointercancel", event =>
      this.handlePointerEnd(event),
    );
    canvas.addEventListener("lostpointercapture", event =>
      this.handlePointerEnd(event),
    );

    this.start();
  }

  findNearestDivisor(requestedSize) {
    let nearest = 1;
    let nearestDistance = Math.abs(requestedSize - nearest);

    for (let size = 2; size <= this.envSize; size += 1) {
      if (this.envSize % size !== 0) {
        continue;
      }

      const distance = Math.abs(requestedSize - size);
      if (distance < nearestDistance) {
        nearest = size;
        nearestDistance = distance;
      }
    }

    return nearest;
  }

  handlePointerDown(event) {
    if (this.activePointerId !== null || event.isPrimary === false) {
      return;
    }

    this.activePointerId = event.pointerId;
    this.canvas.setPointerCapture(event.pointerId);
    this.heatCellAt(event);
  }

  handlePointerMove(event) {
    if (event.pointerId === this.activePointerId) {
      this.heatCellAt(event);
    }
  }

  handlePointerEnd(event) {
    if (event.pointerId === this.activePointerId) {
      this.activePointerId = null;
    }
  }

  heatCellAt(event) {
    const bounds = this.canvas.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) {
      return;
    }

    const x = Math.floor(
      ((event.clientX - bounds.left) / bounds.width) * this.envSize,
    );
    const y = Math.floor(
      ((event.clientY - bounds.top) / bounds.height) * this.envSize,
    );
    const column = Math.floor(x / this.cellSize);
    const row = Math.floor(y / this.cellSize);

    if (this.cells[row]?.[column]) {
      this.cells[row][column].temperature = 1;
      this.draw();
    }
  }

  update() {
    const changes = Array.from(
      { length: this.cellsPerSide },
      () => new Float64Array(this.cellsPerSide),
    );

    for (let row = 0; row < this.cellsPerSide; row += 1) {
      for (let column = 0; column < this.cellsPerSide; column += 1) {
        changes[row][column] =
          (this.ambientTemperature - this.cells[row][column].temperature) *
          this.ambientDecay;
      }
    }

    for (let row = 0; row < this.cellsPerSide; row += 1) {
      for (let column = 0; column < this.cellsPerSide; column += 1) {
        const cell = this.cells[row][column];

        if (column + 1 < this.cellsPerSide) {
          const right = this.cells[row][column + 1];
          const sidewaysHeat =
            (right.temperature - cell.temperature) * this.sidewaysConductivity;
          changes[row][column] += sidewaysHeat;
          changes[row][column + 1] -= sidewaysHeat;
        }
        if (row + 1 < this.cellsPerSide) {
          const below = this.cells[row + 1][column];
          const conductivity =
            below.temperature > cell.temperature
              ? this.upwardConductivity
              : this.downwardConductivity;
          const verticalHeat =
            (below.temperature - cell.temperature) * conductivity;
          changes[row][column] += verticalHeat;
          changes[row + 1][column] -= verticalHeat;
        }
      }
    }

    for (let row = 0; row < this.cellsPerSide; row += 1) {
      for (let column = 0; column < this.cellsPerSide; column += 1) {
        const cell = this.cells[row][column];
        cell.temperature = Math.max(
          0,
          Math.min(1, cell.temperature + changes[row][column]),
        );
      }
    }
  }

  draw() {
    this.context.fillStyle = "white";
    this.context.fillRect(0, 0, this.envSize, this.envSize);

    for (let row = 0; row < this.cellsPerSide; row += 1) {
      for (let column = 0; column < this.cellsPerSide; column += 1) {
        this.cells[row][column].draw(
          this.context,
          column * this.cellSize,
          row * this.cellSize,
          this.cellSize,
        );
      }
    }
  }

  start() {
    if (this.animationFrame !== null) {
      return;
    }

    const frame = timestamp => {
      if (this.lastFrameTime !== null) {
        this.elapsed += Math.min(timestamp - this.lastFrameTime, 1000);
        while (this.elapsed >= this.frameDuration) {
          this.update();
          this.elapsed -= this.frameDuration;
        }
      }

      this.lastFrameTime = timestamp;
      this.draw();
      this.animationFrame = requestAnimationFrame(frame);
    };

    this.animationFrame = requestAnimationFrame(frame);
  }

  stop() {
    if (this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
      this.lastFrameTime = null;
    }
  }
}

const canvas = document.getElementById("environment");
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('Expected a canvas element with id "environment".');
}

const environment = new Environment(canvas);
