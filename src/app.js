import { Game, PRESETS, validConfig, supportsNoGuess } from "./engine.js";
import { RestartGuard } from "./restart-guard.js";
import { startGeneration } from "./generation-client.js";

const $ = (id) => document.getElementById(id);
const KEY = "minesweeper:round:v1",
  PREFS = "minesweeper:prefs:v1",
  STATS = "minesweeper:stats:v1";
let storageAvailable = true;
function read(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}
function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    storageAvailable = false;
  }
}
const preferences = read(PREFS) || {};
let autoFit = preferences.autoFit === true || !preferences.cellSize;
let statistics = read(STATS) || {};
if (typeof statistics !== "object" || Array.isArray(statistics))
  statistics = {};
let game = Game.restore(read(KEY)) || new Game(PRESETS.easy,
  preferences.gameMode === "logic" ? "logic" : "classic");
let flagMode = preferences.flagMode === true;
let cellSize = Number.isFinite(preferences.cellSize)
  ? Math.max(20, Math.min(60, preferences.cellSize))
  : 38;
let paused = false,
  tickAt = performance.now(),
  buttons = [],
  focusIndex = 0;
let modalWasPlaying = false,
  pendingInstall = null,
  moving = false,
  pinch = null;
const pointers = new Map();
const activeInputs = new Set();
let roundAction = null;
let generation = null;
const board = $("board"),
  viewport = $("viewport");
let dark = preferences.theme
  ? preferences.theme === "dark"
  : matchMedia("(prefers-color-scheme: dark)").matches;

function configName(config) {
  return (
    Object.values(PRESETS).find((preset) =>
      ["rows", "cols", "mines"].every((key) => preset[key] === config[key]),
    )?.name || "自定义"
  );
}
function formatTime(ms) {
  const seconds = Math.floor(ms / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
function statsKey() {
  const key = `${game.config.rows}x${game.config.cols}:${game.config.mines}`;
  return game.mode === "logic" ? `${key}:logic` : key;
}
function syncClock() {
  const now = performance.now();
  if (game.status === "playing" && !paused) game.elapsed += now - tickAt;
  tickAt = now;
  $("timer").textContent = formatTime(game.elapsed);
}
function save() {
  write(KEY, game.serialize());
}
function savePreferences() {
  write(PREFS, { theme: dark ? "dark" : "light", flagMode, cellSize, autoFit, gameMode: game.mode });
}
function theme() {
  document.documentElement.classList.toggle("dark", dark);
  $("theme").setAttribute("aria-label", dark ? "切换浅色主题" : "切换深色主题");
  document.querySelector('meta[name="theme-color"]').content = dark
    ? "#182538"
    : "#edf2f8";
}
function modes() {
  $("open-mode").classList.toggle("selected", !flagMode);
  $("flag-mode").classList.toggle("selected", flagMode);
  $("open-mode").setAttribute("aria-pressed", String(!flagMode));
  $("flag-mode").setAttribute("aria-pressed", String(flagMode));
}
function defaultStatus() {
  if (generation) return "正在生成可推理通关的棋盘…";
  if (game.status === "won") return "所有安全格子都找到了。做得好！";
  if (game.status === "lost") return "这一格有雷。可以查看棋盘，或再来一局。";
  if (paused) return "本局已暂停。";
  if (game.status === "ready") return "选一个格子，开始这一局。";
  return flagMode
    ? "插旗模式：轻点标记，再点取消。"
    : "轻点开格 · 长按插旗 · 拖动查看棋盘";
}
function setStatus(message = defaultStatus()) {
  $("status").textContent = message;
}
function best() {
  const entry = statistics[statsKey()];
  $("best").textContent = Number.isFinite(entry?.best)
    ? `最佳用时 ${formatTime(entry.best)}`
    : "最佳用时 —";
}
function render() {
  const ended = ["won", "lost"].includes(game.status);
  game.cells.forEach((cell, index) => {
    const button = buttons[index];
    const showMine = ended && cell.mine;
    const wrong = game.status === "lost" && cell.flag && !cell.mine;
    button.className = [
      "cell",
      cell.open ? "open" : "",
      cell.flag || (game.status === "won" && cell.mine) ? "flagged" : "",
      showMine ? "mine" : "",
      wrong ? "wrong" : "",
      index === game.exploded ? "exploded" : "",
    ]
      .filter(Boolean)
      .join(" ");
    button.textContent = wrong
      ? "×"
      : game.status === "won" && cell.mine
        ? "⚑"
        : showMine
          ? "✳"
          : cell.flag
            ? "⚑"
            : cell.open && cell.count
              ? cell.count
              : "";
    button.dataset.count = cell.open && !cell.mine ? cell.count : "";
    const state = wrong
      ? "错误旗帜"
      : showMine
        ? "雷"
        : cell.flag
          ? "已插旗"
          : cell.open
            ? cell.count
              ? `周围 ${cell.count} 颗雷`
              : "空白"
            : "未打开";
    button.setAttribute(
      "aria-label",
      `第 ${Math.floor(index / game.config.cols) + 1} 行，第 ${(index % game.config.cols) + 1} 列，${state}`,
    );
    button.setAttribute("aria-disabled", String(ended));
  });
  $("remaining").textContent = String(
    game.status === "won" ? 0 : game.config.mines - game.flags,
  ).padStart(3, "0");
  $("progress").textContent =
    `已打开 ${game.cleared} / ${game.cells.length - game.config.mines}`;
  $("pause").disabled = game.status !== "playing";
  $("board-spec").textContent =
    `${game.config.cols} × ${game.config.rows} · ${game.config.mines} 颗雷`;
  $("difficulty-name").textContent = configName(game.config);
  $("game-mode").textContent = game.mode === "logic" ? "无猜" : "经典随机";
  $("mode-description").textContent = game.mode === "logic"
    ? "无猜棋盘，每一步都有可推理的线索。"
    : "经典随机棋盘，部分局面需要猜测。";
  setStatus();
  best();
}
function buildBoard() {
  board.replaceChildren();
  buttons = [];
  focusIndex = 0;
  board.style.gridTemplateColumns = `repeat(${game.config.cols}, var(--cell-size))`;
  board.setAttribute("aria-rowcount", game.config.rows);
  board.setAttribute("aria-colcount", game.config.cols);
  const fragment = document.createDocumentFragment();
  game.cells.forEach((_, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.index = index;
    button.className = "cell";
    button.tabIndex = index ? -1 : 0;
    button.setAttribute("role", "gridcell");
    button.setAttribute(
      "aria-rowindex",
      Math.floor(index / game.config.cols) + 1,
    );
    button.setAttribute("aria-colindex", (index % game.config.cols) + 1);
    buttons.push(button);
    fragment.append(button);
  });
  board.append(fragment);
  viewport.scrollTo(0, 0);
  resizeCells(cellSize, false);
  render();
}
function resizeCells(size, persist = true) {
  cellSize = Math.max(20, Math.min(60, Math.round(size)));
  board.style.setProperty("--cell-size", `${cellSize}px`);
  $("zoom-out").disabled = cellSize <= 20;
  $("zoom-in").disabled = cellSize >= 60;
  if (persist) {
    autoFit = false;
    savePreferences();
  }
}
function fit() {
  resizeCells(
    Math.floor(
      (viewport.clientWidth - (game.config.cols - 1) * 3) / game.config.cols,
    ),
  );
}
function initialFit() {
  if (game.config.cols === 9)
    resizeCells(
      Math.min(44, Math.floor((viewport.clientWidth - 24) / 9)),
      false,
    );
}
function setPause(value) {
  syncClock();
  paused = value && game.status === "playing";
  $("pause-cover").hidden = !paused;
  board.inert = paused;
  $("pause").setAttribute("aria-label", paused ? "继续游戏" : "暂停游戏");
  $("pause").innerHTML = paused ? "▶ <span>继续</span>" : "Ⅱ <span>暂停</span>";
  tickAt = performance.now();
  setStatus();
  save();
}
function recordResult() {
  if (game.recorded) return;
  const entry = statistics[statsKey()] || {};
  statistics[statsKey()] = {
    played: (Number.isFinite(entry.played) ? entry.played : 0) + 1,
    wins:
      (Number.isFinite(entry.wins) ? entry.wins : 0) +
      (game.status === "won" ? 1 : 0),
    best:
      game.status === "won"
        ? Math.min(
            Number.isFinite(entry.best) ? entry.best : Infinity,
            game.elapsed,
          )
        : (entry.best ?? null),
  };
  game.recorded = true;
  write(STATS, statistics);
  save();
  best();
}
function showResult() {
  recordResult();
  const won = game.status === "won";
  $("result-mark").textContent = won ? "⚑" : "✳";
  $("result-title").textContent = won ? "安全着陆。" : "差一点，再来。";
  $("result-caption").textContent = won ? "这一局，你赢了" : "这一局结束了";
  $("result-description").textContent = won
    ? "所有安全格子都已打开。下一块棋盘等着你。"
    : "踩到了一颗雷。留在棋盘上看看线索，或开始新的一局。";
  $("result-time").textContent = formatTime(game.elapsed);
  $("result-cleared").textContent =
    `${game.cleared} / ${game.cells.length - game.config.mines}`;
  showDialog("result-dialog");
}
function act(index, action) {
  if (
    generation ||
    paused ||
    document.hidden ||
    document.querySelector("dialog[open]") ||
    !Number.isInteger(index)
  )
    return;
  syncClock();
  const before = game.status;
  let changed = false;
  if (action === "flag") {
    if (game.mode === "logic" && game.status === "ready") {
      setStatus("先打开第一格，再标记雷。");
      return;
    }
    const limited = !game.cells[index]?.flag && game.flags >= game.config.mines;
    changed = game.flag(index);
    if (limited && !changed && !["won", "lost"].includes(game.status))
      setStatus("旗帜已用完；先取消一面旗，再标记新的位置。");
  } else if (game.mode === "logic" && game.status === "ready" && game.cells[index]) {
    beginGeneration(index);
    return;
  } else if (game.cells[index]?.open) changed = game.chord(index);
  else changed = game.reveal(index);
  if (!changed) return;
  tickAt = performance.now();
  render();
  save();
  if (["won", "lost"].includes(game.status) && before !== game.status)
    showResult();
}
function showDialog(id) {
  if (generation) cancelGeneration();
  syncClock();
  if (game.status === "playing" && !paused) {
    modalWasPlaying = true;
    setPause(true);
  }
  $(id).showModal();
  const actions = {
    "result-dialog": ["play-again", "result-restart-hint"],
  };
  if (actions[id]) {
    if (roundAction) clearTimeout(roundAction.timer);
    const [button, hint] = actions[id];
    roundAction = {
      dialog: $(id),
      button: $(button),
      hint: $(hint),
      guard: new RestartGuard(activeInputs),
      timer: null,
    };
    updateRoundAction();
  }
}
function updateRoundAction() {
  if (!roundAction) return;
  clearTimeout(roundAction.timer);
  const ready = roundAction.guard.ready();
  roundAction.button.setAttribute("aria-disabled", String(!ready));
  roundAction.hint.textContent = ready
    ? "点击再来一局，开始一张新棋盘。"
    : "先松开手指，稍等一下再开始。";
  if (!ready && roundAction.guard.active.size === 0)
    roundAction.timer = setTimeout(
      updateRoundAction,
      Math.max(0, roundAction.guard.until - performance.now()),
    );
}
function roundActionAllowed(id) {
  return (
    roundAction?.dialog.id === id &&
    roundAction.dialog.open &&
    roundAction.guard.ready()
  );
}
// Capture input before board actions can open a dialog, including held keys.
function trackInput(input, pressed) {
  if (pressed) activeInputs.add(input);
  else activeInputs.delete(input);
  if (!roundAction?.dialog.open) return;
  if (pressed) roundAction.guard.press(input);
  else roundAction.guard.release(input);
  updateRoundAction();
}
document.addEventListener(
  "pointerdown",
  (event) => trackInput(`pointer:${event.pointerId}`, true),
  true,
);
document.addEventListener(
  "pointerup",
  (event) => trackInput(`pointer:${event.pointerId}`, false),
  true,
);
document.addEventListener(
  "pointercancel",
  (event) => trackInput(`pointer:${event.pointerId}`, false),
  true,
);
document.addEventListener(
  "keydown",
  (event) => trackInput(`key:${event.code}`, true),
  true,
);
document.addEventListener(
  "keyup",
  (event) => trackInput(`key:${event.code}`, false),
  true,
);
window.addEventListener("blur", () => {
  for (const input of activeInputs) trackInput(input, false);
});
function generationView(busy) {
  $("generation-cover").hidden = !busy;
  board.inert = busy || paused;
  board.setAttribute("aria-busy", String(busy));
  $("pause").disabled = busy || game.status !== "playing";
}
function cancelGeneration() {
  if (!generation) return;
  const job = generation;
  generation = null;
  job.cancel();
  generationView(false);
  setStatus();
}
async function beginGeneration(first) {
  const original = game;
  const job = startGeneration(game.config, first);
  generation = job;
  generationView(true);
  setStatus();
  try {
    const round = await job.promise;
    if (generation !== job || game !== original) return;
    const next = Game.restore(round);
    if (!next || next.mode !== "logic" || next.opening !== first ||
        !["playing", "won"].includes(next.status) ||
        !["rows", "cols", "mines"].every((key) => next.config[key] === original.config[key]))
      throw new Error("生成结果无效，请重新打开第一格。");
    game = next;
    generation = null;
    tickAt = performance.now();
    generationView(false);
    render();
    save();
    if (document.hidden) setPause(true);
    else if (game.status === "won") showResult();
  } catch (error) {
    if (generation !== job) return;
    generation = null;
    generationView(false);
    setStatus(error.message);
  }
}
$("cancel-generation").addEventListener("click", cancelGeneration);

function newGame(config, mode = game.mode) {
  cancelGeneration();
  clearGestures();
  game = new Game(config, mode);
  paused = false;
  tickAt = performance.now();
  $("timer").textContent = "00:00";
  $("pause-cover").hidden = true;
  board.inert = false;
  $("pause").innerHTML = "Ⅱ <span>暂停</span>";
  $("pause").setAttribute("aria-label", "暂停游戏");
  modalWasPlaying = false;
  autoFit = game.config.cols === 9;
  buildBoard();
  initialFit();
  savePreferences();
  save();
}
document
  .querySelectorAll("[data-close]")
  .forEach((button) =>
    button.addEventListener("click", () => button.closest("dialog").close()),
  );
document.querySelectorAll("dialog").forEach((dialog) => {
  dialog.addEventListener("close", () => {
    if (roundAction?.dialog === dialog) {
      clearTimeout(roundAction.timer);
      roundAction = null;
    }
    if (document.querySelector("dialog[open]")) return;
    if (modalWasPlaying) {
      modalWasPlaying = false;
      if (!document.hidden) setPause(false);
    }
    tickAt = performance.now();
  });
});
$("theme").addEventListener("click", () => {
  dark = !dark;
  theme();
  savePreferences();
});
$("open-mode").addEventListener("click", () => {
  flagMode = false;
  modes();
  savePreferences();
  setStatus();
});
$("flag-mode").addEventListener("click", () => {
  flagMode = true;
  modes();
  savePreferences();
  setStatus();
});
$("restart").addEventListener("click", () => newGame(game.config));
$("play-again").addEventListener("click", () => {
  if (!roundActionAllowed("result-dialog")) return;
  $("result-dialog").close();
  newGame(game.config);
});
$("pause").addEventListener("click", () => setPause(!paused));
$("resume").addEventListener("click", () => {
  setPause(false);
  buttons[focusIndex]?.focus({ preventScroll: true });
});
$("help").addEventListener("click", () => showDialog("help-dialog"));
$("zoom-in").addEventListener("click", () => resizeCells(cellSize + 4));
$("zoom-out").addEventListener("click", () => resizeCells(cellSize - 4));
$("fit").addEventListener("click", fit);

function customLimit() {
  const rows = Number($("rows").value),
    cols = Number($("cols").value);
  $("mines").max = Math.floor(rows * cols * 0.4);
  $("mines").setCustomValidity("");
}
["rows", "cols", "mines"].forEach((id) =>
  $(id).addEventListener("input", customLimit),
);
$("settings-form").addEventListener("change", () => {
  updateSettingsMode();
  $("custom-fields").disabled =
    $("settings-form").elements.level.value !== "custom";
});
function updateSettingsMode() {
  const form = $("settings-form");
  const logic = form.elements.gameMode.value === "logic";
  ["hard", "custom"].forEach((level) => {
    form.querySelector(`[name="level"][value="${level}"]`).disabled = logic;
  });
  if (logic && !["easy", "medium"].includes(form.elements.level.value))
    form.elements.level.value = "medium";
  $("custom-fields").disabled = form.elements.level.value !== "custom";
  $("settings-mode-note").textContent = logic
    ? "无猜模式目前支持初级和中级，棋盘可全程推理通关。"
    : "经典随机支持所有难度，部分局面需要猜测。";
}
$("difficulty").addEventListener("click", () => {
  const level =
    Object.keys(PRESETS).find(
      (key) => PRESETS[key].name === configName(game.config),
    ) || "custom";
  $("settings-form").elements.level.value = level;
  $("settings-form").elements.gameMode.value = game.mode;
  updateSettingsMode();
  $("custom-fields").disabled = level !== "custom";
  $("rows").value = game.config.rows;
  $("cols").value = game.config.cols;
  $("mines").value = game.config.mines;
  customLimit();
  showDialog("settings-dialog");
});
$("settings-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const level = event.currentTarget.elements.level.value;
  const mode = event.currentTarget.elements.gameMode.value;
  const config =
    level === "custom"
      ? {
          rows: Number($("rows").value),
          cols: Number($("cols").value),
          mines: Number($("mines").value),
        }
      : PRESETS[level];
  if (!validConfig(config) || (mode === "logic" && !supportsNoGuess(config))) {
    $("settings-note").textContent =
      "请检查参数：边长 6–40 格，雷数 1 至格子总数的 40%。";
    return;
  }
  $("settings-dialog").close();
  newGame(config, mode);
});

// All gestures end on release. Moving or adding another finger cancels a tap.
function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
function clearGestures() {
  pointers.forEach((pointer) => clearTimeout(pointer.hold));
  pointers.clear();
  pinch = null;
  moving = false;
}
viewport.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || paused) return;
  const cell = event.target.closest(".cell");
  const pointer = {
    x: event.clientX,
    y: event.clientY,
    startX: event.clientX,
    startY: event.clientY,
    scrollX: viewport.scrollLeft,
    scrollY: viewport.scrollTop,
    index: cell ? Number(cell.dataset.index) : null,
    held: false,
    moved: false,
  };
  pointers.set(event.pointerId, pointer);
  viewport.setPointerCapture(event.pointerId);
  if (pointers.size === 1) {
    moving = false;
    pointer.hold = setTimeout(() => {
      if (pointer.moved || pointers.size !== 1 || pointer.index === null)
        return;
      pointer.held = true;
      act(pointer.index, "flag");
    }, 420);
  } else {
    pointers.forEach((p) => {
      clearTimeout(p.hold);
      p.moved = true;
    });
    moving = true;
    const [a, b] = [...pointers.values()];
    pinch = { distance: distance(a, b), size: cellSize };
  }
});
viewport.addEventListener("pointermove", (event) => {
  const pointer = pointers.get(event.pointerId);
  if (!pointer) return;
  pointer.x = event.clientX;
  pointer.y = event.clientY;
  if (pointers.size > 1) {
    const [a, b] = [...pointers.values()];
    if (pinch?.distance > 0)
      resizeCells((pinch.size * distance(a, b)) / pinch.distance, false);
    return;
  }
  const dx = event.clientX - pointer.startX,
    dy = event.clientY - pointer.startY;
  if (Math.hypot(dx, dy) > 8) {
    pointer.moved = true;
    moving = true;
    clearTimeout(pointer.hold);
  }
  if (pointer.moved && !pointer.held) {
    viewport.scrollLeft = pointer.scrollX - dx;
    viewport.scrollTop = pointer.scrollY - dy;
  }
});
viewport.addEventListener("pointerup", (event) => {
  const pointer = pointers.get(event.pointerId);
  if (!pointer) return;
  clearTimeout(pointer.hold);
  const wasPinch = !!pinch;
  if (wasPinch) savePreferences();
  pointers.delete(event.pointerId);
  if (
    !pointer.moved &&
    !pointer.held &&
    !moving &&
    !wasPinch &&
    pointer.index !== null
  )
    act(pointer.index, flagMode ? "flag" : "open");
  if (pointers.size)
    pointers.forEach((p) => {
      p.startX = p.x;
      p.startY = p.y;
      p.scrollX = viewport.scrollLeft;
      p.scrollY = viewport.scrollTop;
      p.moved = true;
    });
  else {
    pinch = null;
    moving = false;
  }
});
viewport.addEventListener("pointercancel", clearGestures);
viewport.addEventListener("lostpointercapture", (event) => {
  if (pointers.has(event.pointerId)) clearGestures();
});
viewport.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  // Mobile browsers may emit contextmenu as part of a long press; that press is already handled.
  if (event.pointerType === "touch" || pointers.size) return;
  const cell = event.target.closest(".cell");
  if (cell) act(Number(cell.dataset.index), "flag");
});
board.addEventListener("click", (event) => {
  // Keyboard and assistive-technology activation does not create pointer events.
  if (event.detail !== 0) return;
  const cell = event.target.closest(".cell");
  if (cell) act(Number(cell.dataset.index), flagMode ? "flag" : "open");
});
board.addEventListener("focusin", (event) => {
  const cell = event.target.closest(".cell");
  if (!cell) return;
  buttons[focusIndex].tabIndex = -1;
  focusIndex = Number(cell.dataset.index);
  buttons[focusIndex].tabIndex = 0;
});
board.addEventListener("keydown", (event) => {
  const cell = event.target.closest(".cell");
  if (!cell) return;
  const index = Number(cell.dataset.index),
    { cols } = game.config;
  let next = index;
  if (event.key === "ArrowLeft") next = index % cols ? index - 1 : index;
  else if (event.key === "ArrowRight")
    next = index % cols < cols - 1 ? index + 1 : index;
  else if (event.key === "ArrowUp") next = Math.max(0, index - cols);
  else if (event.key === "ArrowDown")
    next = Math.min(buttons.length - 1, index + cols);
  else if (event.key.toLowerCase() === "f") {
    event.preventDefault();
    act(index, "flag");
    return;
  } else return;
  event.preventDefault();
  buttons[next].focus();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    cancelGeneration();
    clearGestures();
    if (game.status === "playing") setPause(true);
    else save();
  }
  tickAt = performance.now();
});
window.addEventListener("pagehide", () => {
  cancelGeneration();
  syncClock();
  save();
});
window.addEventListener("blur", clearGestures);
let ticks = 0;
setInterval(() => {
  syncClock();
  if (++ticks % 5 === 0 && game.status === "playing" && !paused) save();
}, 1000);

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  pendingInstall = event;
  $("install").hidden = false;
});
$("install").addEventListener("click", async () => {
  if (!pendingInstall) return;
  await pendingInstall.prompt();
  pendingInstall = null;
  $("install").hidden = true;
});
window.addEventListener("appinstalled", () => {
  pendingInstall = null;
  $("install").hidden = true;
});
if ("serviceWorker" in navigator && window.isSecureContext) {
  navigator.serviceWorker
    .register("./sw.js", { updateViaCache: "none" })
    .then(() => navigator.serviceWorker.ready)
    .then(async () => {
      if (await caches.match(new URL("./index.html", location.href)))
        $("offline-state").textContent = storageAvailable
          ? "已准备好离线游玩"
          : "可离线游玩，存档不可用";
    })
    .catch(() => {
      $("offline-state").textContent = "离线缓存未完成，请联网游玩";
    });
}
theme();
modes();
buildBoard();
syncClock();
if (autoFit) initialFit();
new ResizeObserver(() => {
  if (autoFit) initialFit();
}).observe(viewport);
if (game.status === "playing") setPause(true);
else if (["won", "lost"].includes(game.status) && !game.recorded)
  recordResult();
save();
if (!storageAvailable) setStatus("浏览器无法保存进度；当前仍可游玩。");
