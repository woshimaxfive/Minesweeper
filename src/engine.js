export const PRESETS = {
  easy: { rows: 9, cols: 9, mines: 10, name: "初级" },
  medium: { rows: 16, cols: 16, mines: 40, name: "中级" },
  hard: { rows: 16, cols: 30, mines: 99, name: "高级" },
};

export function validConfig(config) {
  return (
    config &&
    ["rows", "cols", "mines"].every((key) => Number.isInteger(config[key])) &&
    config.rows >= 6 &&
    config.rows <= 40 &&
    config.cols >= 6 &&
    config.cols <= 40 &&
    config.mines >= 1 &&
    config.mines <= Math.floor(config.rows * config.cols * 0.4)
  );
}

export function supportsNoGuess(config) {
  return [PRESETS.easy, PRESETS.medium].some((preset) =>
    ["rows", "cols", "mines"].every((key) => preset[key] === config?.[key]),
  );
}

export function neighbors(config, index) {
  const { rows, cols } = config;
  const row = Math.floor(index / cols), col = index % cols, result = [];
  for (let dr = -1; dr <= 1; dr++)
    for (let dc = -1; dc <= 1; dc++) {
      if ((!dr && !dc) || row + dr < 0 || row + dr >= rows ||
          col + dc < 0 || col + dc >= cols) continue;
      result.push((row + dr) * cols + col + dc);
    }
  return result;
}

export class Game {
  constructor(config = PRESETS.easy, mode = "classic") {
    if (!validConfig(config)) throw new Error("棋盘参数无效");
    if (!["classic", "logic"].includes(mode) ||
        (mode === "logic" && !supportsNoGuess(config)))
      throw new Error("无猜模式目前支持初级和中级");
    this.config = { rows: config.rows, cols: config.cols, mines: config.mines };
    this.mode = mode;
    this.opening = null;
    this.cells = Array.from({ length: config.rows * config.cols }, () => ({
      mine: false,
      count: 0,
      open: false,
      flag: false,
    }));
    this.status = "ready";
    this.exploded = -1;
    this.elapsed = 0;
    this.recorded = false;
  }
  neighbors(index) {
    return neighbors(this.config, index);
  }
  place(first, random = Math.random) {
    if (!Number.isInteger(first) || !this.cells[first])
      throw new Error("起点无效");
    this.opening = first;
    const safe = new Set([first, ...this.neighbors(first)]);
    const candidates = this.cells.map((_, i) => i).filter((i) => !safe.has(i));
    for (let i = 0; i < this.config.mines; i++) {
      const j = i + Math.floor(random() * (candidates.length - i));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
      this.cells[candidates[i]].mine = true;
    }
    this.cells.forEach((cell, i) => {
      cell.count = this.neighbors(i).filter((n) => this.cells[n].mine).length;
    });
    this.status = "playing";
  }
  reveal(index, random) {
    const cell = this.cells[index];
    if (
      !cell ||
      cell.flag ||
      cell.open ||
      ["won", "lost"].includes(this.status)
    )
      return false;
    if (this.status === "ready") {
      // Logic rounds are supplied by the verified generator, never random fallback.
      if (this.mode === "logic") return false;
      this.place(index, random);
    }
    this.expand([index]);
    return true;
  }
  expand(indices) {
    const queue = [...indices];
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const index = queue[cursor],
        cell = this.cells[index];
      if (cell.open || cell.flag) continue;
      cell.open = true;
      if (cell.mine) {
        this.status = "lost";
        this.exploded = index;
        return;
      }
      if (!cell.count)
        queue.push(
          ...this.neighbors(index).filter(
            (i) => !this.cells[i].open && !this.cells[i].flag,
          ),
        );
    }
    if (this.cells.every((cell) => cell.mine || cell.open)) this.status = "won";
  }
  flag(index) {
    if (this.mode === "logic" && this.status === "ready") return false;
    const cell = this.cells[index];
    if (!cell || cell.open || ["won", "lost"].includes(this.status))
      return false;
    // The mine counter stays meaningful; removing a flag is always allowed.
    if (!cell.flag && this.flags >= this.config.mines) return false;
    cell.flag = !cell.flag;
    return true;
  }
  chord(index) {
    const cell = this.cells[index];
    if (!cell?.open || !cell.count || this.status !== "playing") return false;
    const adjacent = this.neighbors(index);
    if (adjacent.filter((i) => this.cells[i].flag).length !== cell.count)
      return false;
    const targets = adjacent.filter(
      (i) => !this.cells[i].flag && !this.cells[i].open,
    );
    if (!targets.length) return false;
    this.expand(targets);
    return true;
  }
  get flags() {
    return this.cells.filter((cell) => cell.flag).length;
  }
  get cleared() {
    return this.cells.filter((cell) => cell.open && !cell.mine).length;
  }
  serialize() {
    return {
      version: 1,
      mode: this.mode,
      opening: this.opening,
      config: this.config,
      cells: this.cells,
      status: this.status,
      exploded: this.exploded,
      elapsed: this.elapsed,
      recorded: this.recorded,
    };
  }
  static restore(data) {
    if (data?.version !== 1 || !validConfig(data.config)) return null;
    const mode = data.mode ?? "classic";
    if (!["classic", "logic"].includes(mode) ||
        (mode === "logic" && !supportsNoGuess(data.config))) return null;
    const opening = data.opening ?? null;
    if (opening !== null && (!Number.isInteger(opening) || opening < 0 ||
        opening >= data.config.rows * data.config.cols)) return null;
    const game = new Game(data.config, mode);
    game.opening = opening;
    if (
      !Array.isArray(data.cells) ||
      data.cells.length !== game.cells.length ||
      !["ready", "playing", "won", "lost"].includes(data.status) ||
      !Number.isFinite(data.elapsed) ||
      data.elapsed < 0 ||
      data.elapsed > 31536000000 ||
      !Number.isInteger(data.exploded) ||
      data.exploded < -1 ||
      data.exploded >= game.cells.length ||
      typeof data.recorded !== "boolean"
    )
      return null;
    if (
      data.cells.some(
        (cell) =>
          !cell ||
          ["mine", "open", "flag"].some(
            (key) => typeof cell[key] !== "boolean",
          ) ||
          !Number.isInteger(cell.count) ||
          cell.count < 0 ||
          cell.count > 8 ||
          (cell.open && cell.flag),
      )
    )
      return null;
    game.cells = data.cells.map((cell) => ({
      mine: cell.mine,
      open: cell.open,
      flag: cell.flag,
      count: cell.count,
    }));
    game.status = data.status;
    game.elapsed = data.elapsed;
    game.exploded = data.exploded;
    game.recorded = data.recorded;
    if (game.flags > game.config.mines) return null;
    if (mode === "logic") {
      if (game.status === "ready") {
        if (opening !== null || game.flags) return null;
      } else if (opening === null || !game.cells[opening].open ||
          [opening, ...game.neighbors(opening)].some((i) => game.cells[i].mine))
        return null;
    }
    if (game.status === "ready") {
      if (
        game.cells.some((cell) => cell.mine || cell.open || cell.count) ||
        game.exploded !== -1 ||
        game.elapsed !== 0
      )
        return null;
    } else {
      if (game.cells.filter((cell) => cell.mine).length !== game.config.mines)
        return null;
      if (
        game.cells.some(
          (cell, i) =>
            cell.count !==
            game.neighbors(i).filter((n) => game.cells[n].mine).length,
        )
      )
        return null;
      if (game.status === "lost") {
        if (!game.cells[game.exploded]?.mine || !game.cells[game.exploded].open)
          return null;
      } else if (
        game.exploded !== -1 ||
        game.cells.some((cell) => cell.mine && cell.open)
      )
        return null;
      const complete = game.cells.every((cell) => cell.mine || cell.open);
      if ((game.status === "won") !== complete) return null;
    }
    return game;
  }
}
