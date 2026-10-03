import { Game, neighbors, validConfig } from "./engine.js";

// Covered cells have clue -1. The deduction boundary accepts visible clues and
// proven mines only, never the hidden layout or unverified player flags.
export function deduce({ config, clues, knownMines = [] }, {
  deadline = Infinity, now = () => performance.now(), maxConstraints = 400,
} = {}) {
  const empty = (reason) => ({ safe: [], mines: [], reason });
  if (!validConfig(config) || clues.length !== config.rows * config.cols ||
      clues.some((n) => !Number.isInteger(n) || n < -1 || n > 8))
    return empty("invalid");
  const proven = new Set(knownMines);
  if ([...proven].some((i) => !Number.isInteger(i) || !Object.hasOwn(clues, i) || clues[i] !== -1))
    return empty("invalid");
  const unknown = clues.flatMap((n, i) => n === -1 && !proven.has(i) ? [i] : []);
  const remaining = config.mines - proven.size;
  const safe = new Set(), mines = new Set(), constraints = [], seen = new Map();
  let invalid = false, bounded = false;
  function add(cells, count) {
    if (count < 0 || count > cells.length) { invalid = true; return; }
    if (!cells.length) return;
    if (count === 0 || count === cells.length) {
      const target = count === 0 ? safe : mines;
      cells.forEach((i) => target.add(i));
      return;
    }
    const key = cells.join(",");
    if (seen.has(key)) {
      if (seen.get(key) !== count) invalid = true;
      return;
    }
    if (constraints.length >= maxConstraints) { bounded = true; return; }
    seen.set(key, count);
    constraints.push({ cells, count });
  }
  add(unknown, remaining);
  for (let i = 0; i < clues.length; i++) {
    if (clues[i] < 0) continue;
    const adjacent = neighbors(config, i);
    add(adjacent.filter((n) => clues[n] === -1 && !proven.has(n)),
      clues[i] - adjacent.filter((n) => proven.has(n)).length);
  }
  function result() {
    if (invalid || [...safe].some((i) => mines.has(i))) return empty("invalid");
    if (safe.size || mines.size) return { safe: [...safe], mines: [...mines], reason: "deduced" };
    return empty(bounded ? "budget" : "stuck");
  }
  if (invalid || safe.size || mines.size) return result();
  // Derive B minus A when A is a subset of B. Keep small differences; use
  // large global remainders only when they directly prove safe cells or mines.
  let operations = 0;
  for (let cursor = 0; cursor < constraints.length; cursor++) {
    for (let j = 0; j < cursor; j++) {
      if (++operations % 128 === 0 && now() >= deadline) return empty("budget");
      let a = constraints[j], b = constraints[cursor];
      if (a.cells.length > b.cells.length) [a, b] = [b, a];
      if (a.cells.length === b.cells.length) continue;
      const set = new Set(b.cells);
      if (!a.cells.every((i) => set.has(i))) continue;
      const inside = new Set(a.cells);
      const difference = b.cells.filter((i) => !inside.has(i));
      const count = b.count - a.count;
      if (difference.length <= 8 || count <= 0 || count >= difference.length)
        add(difference, count);
      if (invalid || safe.size || mines.size) return result();
    }
  }
  return result();
}

// Counts are revealed by the oracle only AFTER a safe move is proved.
export function verifyNoGuess(layout, first, {
  deadline = Infinity, now = () => performance.now(), trace = false,
} = {}) {
  const source = Game.restore(layout instanceof Game ? layout.serialize() : layout);
  if (!source || source.status === "ready" || !Number.isInteger(first) || !source.cells[first] ||
      [first, ...source.neighbors(first)].some((i) => source.cells[i].mine))
    return { solved: false, reason: "invalid", steps: [] };
  const oracle = new Game(source.config);
  oracle.cells = source.cells.map((c) => ({ mine: c.mine, count: c.count, open: false, flag: false }));
  oracle.status = "playing";
  oracle.expand([first]);
  const knownMines = new Set(), steps = [];
  while (oracle.status !== "won") {
    if (now() >= deadline) return { solved: false, reason: "budget", steps };
    const clues = oracle.cells.map((c) => c.open ? c.count : -1);
    const move = deduce({ config: oracle.config, clues, knownMines: [...knownMines] }, { deadline, now });
    if (!move.safe.length && !move.mines.length)
      return { solved: false, reason: move.reason, steps };
    if (trace) steps.push({ clues, knownMines: [...knownMines], safe: move.safe, mines: move.mines });
    move.mines.forEach((i) => knownMines.add(i));
    oracle.expand(move.safe);
    if (oracle.status === "lost") return { solved: false, reason: "invalid", steps };
  }
  return { solved: true, reason: "solved", steps };
}
