import { Game, PRESETS, validConfig, supportsNoGuess } from "./engine.js";
import { RestartGuard } from "./restart-guard.js";
import { startGeneration } from "./generation-client.js";
import { mountBoardView, fittedCellSize, boardDrag, CELL_GAP } from "./board-view.js";
import { icon } from "./icons.js";
import { restoreStatistics, recordStatistics, statisticsKey, statisticsConfig } from "./statistics.js";
import { findHint } from "./hints.js";

const $ = (id) => document.getElementById(id);
document.querySelectorAll("[data-icon]").forEach((element) => {
  element.innerHTML = icon(element.dataset.icon);
});
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
    return true;
  } catch {
    storageAvailable = false;
    return false;
  }
}
const preferences = read(PREFS) || {};
let autoFit = preferences.autoFit === true || !preferences.cellSize;
let statistics = restoreStatistics(read(STATS));
const savedRound = read(KEY);
const restoredRound = Game.restore(savedRound);
let game = restoredRound || new Game(PRESETS.easy,
  preferences.gameMode === "logic" ? "logic" : "classic");
const newRoundId = () => crypto.getRandomValues(new Uint32Array(4)).join("-");
let roundId = restoredRound && typeof savedRound?.id === "string" && savedRound.id.length > 0 && savedRound.id.length <= 100
  ? savedRound.id : newRoundId();
let statisticsMode = game.mode;
let statisticsPractice = game.practice;
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
let currentHint = null;
let boardView = null, regularSizing = null, viewFitMinimum = 28;
let viewAnchor = null;
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
function syncClock() {
  const now = performance.now();
  if (game.status === "playing" && !paused) game.elapsed += now - tickAt;
  tickAt = now;
  $("timer").textContent = formatTime(game.elapsed);
}
function save() {
  write(KEY, { ...game.serialize(), id: roundId });
}
function savePreferences() {
  const sizing = regularSizing || { cellSize, autoFit };
  write(PREFS, { theme: dark ? "dark" : "light", flagMode,
    cellSize: sizing.cellSize, autoFit: sizing.autoFit, gameMode: game.mode });
}
function theme() {
  document.documentElement.classList.toggle("dark", dark);
  $("theme").setAttribute("aria-pressed", String(dark));
  $("theme-icon").innerHTML = icon(dark ? "sun" : "moon");
  document.querySelector('meta[name="theme-color"]').content = dark
    ? "#202420"
    : "#f5f5f2";
}
function modes() {
  $("open-mode").classList.toggle("selected", !flagMode);
  $("flag-mode").classList.toggle("selected", flagMode);
  $("open-mode").setAttribute("aria-pressed", String(!flagMode));
  $("flag-mode").setAttribute("aria-pressed", String(flagMode));
}
function defaultStatus() {
  if (generation || paused || ["won", "lost"].includes(game.status)) return "";
  if (game.status === "ready") return "点一个格子开始";
  return flagMode ? "轻点插旗，再点取消" : game.practice ? "练习局 · 成绩单独记录" : "";
}
function setStatus(message = defaultStatus(), urgent = false) {
  $("status").textContent = message;
  $("status").classList.toggle("attention", urgent);
}
function best() {
  const entry = statistics[statisticsKey(game.config, game.mode, game.practice)];
  const label = game.practice ? "练习最佳用时" : "最佳用时";
  $("best").textContent = Number.isFinite(entry?.best)
    ? `${label} ${formatTime(entry.best)}`
    : `${label} —`;
}
function render() {
  const ended = ["won", "lost"].includes(game.status);
  const hint = currentHint?.kind === "none" ? null : currentHint;
  const hintClues = new Set(hint?.clues), hintRegion = new Set(hint?.region),
    hintMines = new Set(hint?.supportMines);
  board.dataset.state = game.status;
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
      hintClues.has(index) ? "hint-clue" : "",
      hintRegion.has(index) ? "hint-region" : "",
      hintMines.has(index) ? "hint-support" : "",
      hint?.index === index ? `hint-target hint-${hint.kind}` : "",
    ]
      .filter(Boolean)
      .join(" ");
    const symbol = wrong ? "close" : game.status === "won" && cell.mine
      ? "flag" : showMine ? "mine" : cell.flag ? "flag" : null;
    if (hint?.index === index && !cell.flag)
      button.innerHTML = icon(hint.kind === "safe" ? "check" : "mine");
    else if (symbol) button.innerHTML = icon(symbol);
    else button.textContent = cell.open && cell.count ? cell.count : "";
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
      `第 ${Math.floor(index / game.config.cols) + 1} 行，第 ${(index % game.config.cols) + 1} 列，${state}` +
        (hint?.index === index ? `，提示：${hint.kind === "safe" ? "安全格" : "必定有雷"}`
          : hintClues.has(index) || hintMines.has(index) ? "，推理依据" : ""),
    );
    if (hint?.index === index) button.setAttribute("aria-describedby", "hint-message");
    else button.removeAttribute("aria-describedby");
    button.setAttribute("aria-disabled", String(ended));
  });
  $("remaining").textContent = String(
    game.status === "won" ? 0 : game.config.mines - game.flags,
  ).padStart(3, "0");
  $("progress").textContent =
    `已打开 ${game.cleared} / ${game.cells.length - game.config.mines}`;
  $("pause").disabled = game.status !== "playing";
  $("open-mode").disabled = ended;
  $("flag-mode").disabled = ended;
  $("review-result").hidden = !ended || !$("result-panel").hidden;
  $("board-spec").textContent =
    `${game.config.cols} × ${game.config.rows} · ${game.config.mines} 颗雷`;
  $("difficulty-name").textContent = configName(game.config);
  $("game-mode").textContent = game.practice
    ? game.mode === "logic" ? "无猜练习" : "经典练习"
    : game.mode === "logic" ? "无猜" : "经典随机";
  $("game-mode").classList.toggle("practice", game.practice);
  $("mode-description").textContent = game.practice
    ? "练习局保留雷位和第一步，成绩单独记录。"
    : game.mode === "logic" ? "无猜：棋盘经过推理验证。"
    : "经典随机：部分局面需要猜测。";
  $("restart-label").textContent = game.practice ? "重试这盘练习" : "重新开始本局";
  setStatus();
  best();
  renderHint();
}
function renderHint() {
  $("hint-button").hidden = !game.practice || game.status !== "playing";
  $("hint-button").disabled = paused || !!generation;
  $("hint-panel").hidden = !currentHint || paused || !game.practice || game.status !== "playing";
  $("hint-button").setAttribute("aria-expanded", String(!$("hint-panel").hidden));
  if ($("hint-panel").hidden) return;
  $("hint-title").textContent = currentHint.kind === "none" ? "暂时没找到确定的一步"
    : `第 ${Math.floor(currentHint.index / game.config.cols) + 1} 行，第 ${currentHint.index % game.config.cols + 1} 列 · ${currentHint.kind === "safe" ? "安全格" : "是雷"}`;
  $("hint-message").textContent = currentHint.kind === "none"
    ? "根据当前线索，暂时没推导出确定的一步。" : currentHint.text;
}
function dismissHint() {
  currentHint = null;
  render();
}
function showHint() {
  if (!game.practice || game.status !== "playing" || paused || generation ||
      document.hidden || document.querySelector("dialog[open]")) return;
  if (currentHint) { dismissHint(); return; }
  clearGestures();
  currentHint = findHint({ config: game.config,
    clues: game.cells.map((cell) => cell.open ? cell.count : -1) },
  { flagged: game.cells.flatMap((cell, i) => cell.flag ? [i] : []) });
  render();
  const hint = currentHint;
  if (hint.kind === "none") return;
  requestAnimationFrame(() => {
    if (currentHint !== hint || paused) return;
    const indices = [hint.index, ...hint.clues, ...hint.supportMines];
    const cols = indices.map((i) => i % game.config.cols),
      rows = indices.map((i) => Math.floor(i / game.config.cols));
    const left = Math.min(...cols), right = Math.max(...cols),
      top = Math.min(...rows), bottom = Math.max(...rows);
    const fits = (right - left + 1) * (cellSize + CELL_GAP) + 6 <= viewport.clientWidth &&
      (bottom - top + 1) * (cellSize + CELL_GAP) + 6 <= viewport.clientHeight;
    restoreBoardPosition(fits ? { col: (left + right + 1) / 2, row: (top + bottom + 1) / 2 }
      : { col: hint.index % game.config.cols + 0.5, row: Math.floor(hint.index / game.config.cols) + 0.5 });
  });
}
function buildBoard() {
  board.replaceChildren();
  buttons = [];
  focusIndex = 0;
  board.style.gridTemplateColumns = `repeat(${game.config.cols}, var(--cell-size))`;
  board.style.setProperty("--cell-gap", `${CELL_GAP}px`);
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
function captureBoardPosition(point) {
  if (!buttons.length) return null;
  const area = viewport.getBoundingClientRect();
  point ||= { x: area.left + area.width / 2, y: area.top + area.height / 2 };
  const rect = board.getBoundingClientRect();
  const x = boardView?.rotated ? point.y - rect.top : point.x - rect.left;
  const y = boardView?.rotated ? rect.right - point.x : point.y - rect.top;
  return { col: x / (cellSize + CELL_GAP), row: y / (cellSize + CELL_GAP) };
}
function restoreBoardPosition(anchor, point) {
  if (!anchor) return;
  const current = captureBoardPosition(point);
  viewport.scrollLeft += (anchor.col - current.col) * (cellSize + CELL_GAP);
  viewport.scrollTop += (anchor.row - current.row) * (cellSize + CELL_GAP);
}
function resizeCells(size, persist = true, anchor = captureBoardPosition(), point) {
  cellSize = Math.max(20, Math.min(60, Math.round(size)));
  board.style.setProperty("--cell-size", `${cellSize}px`);
  $("zoom-out").disabled = cellSize <= 20;
  $("zoom-in").disabled = cellSize >= 60;
  restoreBoardPosition(anchor, point);
  if (persist) {
    autoFit = false;
    savePreferences();
  }
}
function fit() {
  if (boardView?.active) {
    viewFitMinimum = 20;
    autoFit = true;
    initialFit();
    return;
  }
  resizeCells(
    Math.floor(
      (viewport.clientWidth - 6 - (game.config.cols - 1) * CELL_GAP) / game.config.cols,
    ),
  );
}
function initialFit() {
  if (boardView?.active) {
    resizeCells(fittedCellSize(game.config, viewport.clientWidth,
      viewport.clientHeight, viewFitMinimum), false);
    return;
  }
  if (game.config.cols === 9)
    resizeCells(
      fittedCellSize(game.config, viewport.clientWidth, viewport.clientHeight, 28),
      false,
    );
}
function setPause(value) {
  syncClock();
  paused = value && game.status === "playing";
  $("pause-cover").hidden = !paused;
  board.inert = paused;
  $("pause").setAttribute("aria-label", paused ? "继续游戏" : "暂停游戏");
  $("pause").innerHTML = icon(paused ? "play" : "pause") +
    `<span>${paused ? "继续" : "暂停"}</span>`;
  currentHint = null;
  render();
  tickAt = performance.now();
  setStatus();
  save();
}
function recordResult() {
  if (!game.recorded) {
    statistics = recordStatistics(statistics, game, roundId);
    if (write(STATS, statistics)) {
      game.recorded = true;
      save();
    }
  }
  best();
  return statistics.recent.find((record) => record.id === roundId);
}
function showResult() {
  const record = recordResult();
  const won = game.status === "won";
  $("result-mark").innerHTML = icon(won ? "check" : "mine");
  const title = won ? "通关" : "踩雷了";
  $("result-title").textContent = (game.practice ? `练习${title}` : title) +
    (record?.newBest ? " · 新纪录" : "");
  $("result-description").textContent = game.practice ? "本次成绩已归入练习局" : won
    ? record?.newBest ? "刷新了这项棋盘的最佳用时" : "安全格已全部打开"
    : "可以查看棋盘复盘";
  $("result-time").textContent = formatTime(game.elapsed);
  $("result-cleared").textContent =
    `${game.cleared} / ${game.cells.length - game.config.mines}`;
  $("result-panel").hidden = false;
  $("result-panel").classList.toggle("lost", !won);
  $("review-result").hidden = true;
  $("replay-board").hidden = game.opening === null;
  if (roundAction) clearTimeout(roundAction.timer);
  roundAction = {
    panel: $("result-panel"), buttons: [$("play-again"), $("replay-board")], hint: $("result-restart-hint"),
    guard: new RestartGuard(activeInputs), timer: null,
  };
  updateRoundAction();
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
  currentHint = null;
  tickAt = performance.now();
  render();
  if (action === "flag") buttons[index]?.classList.add("flag-feedback");
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
}
function updateRoundAction() {
  if (!roundAction) return;
  clearTimeout(roundAction.timer);
  const ready = roundAction.guard.ready();
  roundAction.buttons.forEach((button) => button.setAttribute("aria-disabled", String(!ready)));
  roundAction.hint.textContent = ready
    ? "可以重试这盘或开始新一局"
    : "先松开手指，稍候再开始";
  if (!ready && roundAction.guard.active.size === 0)
    roundAction.timer = setTimeout(
      updateRoundAction,
      Math.max(0, roundAction.guard.until - performance.now()),
    );
}
function roundActionAllowed() {
  return (
    roundAction && !roundAction.panel.hidden &&
    roundAction.guard.ready()
  );
}
// Capture input before a result appears, including held keys.
function trackInput(input, pressed) {
  if (pressed) activeInputs.add(input);
  else activeInputs.delete(input);
  if (!roundAction || roundAction.panel.hidden) return;
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
    setStatus(error.message, true);
  }
}
$("cancel-generation").addEventListener("click", cancelGeneration);

function startRound(next) {
  cancelGeneration();
  clearGestures();
  if (roundAction) clearTimeout(roundAction.timer);
  roundAction = null;
  $("result-panel").hidden = true;
  viewAnchor = null;
  game = next;
  currentHint = null;
  roundId = newRoundId();
  paused = false;
  tickAt = performance.now();
  $("timer").textContent = "00:00";
  $("pause-cover").hidden = true;
  board.inert = false;
  $("pause").innerHTML = icon("pause") + "<span>暂停</span>";
  $("pause").setAttribute("aria-label", "暂停游戏");
  modalWasPlaying = false;
  autoFit = game.config.cols === 9;
  if (boardView?.active) {
    regularSizing = { cellSize: 38, autoFit,
    };
    autoFit = true;
    viewFitMinimum = 28;
  }
  buildBoard();
  initialFit();
  savePreferences();
  save();
  if (["won", "lost"].includes(game.status)) showResult();
}
function newGame(config, mode = game.mode) {
  startRound(new Game(config, mode));
}
function replayBoard() {
  const next = game.replay();
  if (!next) return;
  startRound(next);
  restoreBoardPosition({ col: game.opening % game.config.cols + 0.5,
    row: Math.floor(game.opening / game.config.cols) + 0.5 });
  buttons[game.opening]?.focus({ preventScroll: true });
}
document
  .querySelectorAll("[data-close]")
  .forEach((button) =>
    button.addEventListener("click", () => button.closest("dialog").close()),
  );
document.querySelectorAll("dialog").forEach((dialog) => {
  dialog.addEventListener("close", () => {
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
$("restart").addEventListener("click", () => {
  $("preferences-dialog").close();
  if (game.practice) replayBoard();
  else newGame(game.config);
});
$("replay-board").addEventListener("click", () => {
  if (roundActionAllowed()) replayBoard();
});
$("play-again").addEventListener("click", () => {
  if (!roundActionAllowed()) return;
  newGame(game.config);
});
$("review-board").addEventListener("click", () => {
  $("result-panel").hidden = true;
  $("review-result").hidden = false;
  clearTimeout(roundAction?.timer);
  roundAction = null;
});
$("review-result").addEventListener("click", showResult);
$("hint-button").addEventListener("click", showHint);
$("dismiss-hint").addEventListener("click", dismissHint);
$("pause").addEventListener("click", () => setPause(!paused));
$("resume").addEventListener("click", () => {
  setPause(false);
  buttons[focusIndex]?.focus({ preventScroll: true });
});
$("preferences").addEventListener("click", () => showDialog("preferences-dialog"));
function renderStatistics() {
  const key = $("statistics-config").value;
  const entry = statistics[key] || { played: 0, wins: 0, best: null };
  $("statistics-played").textContent = entry.played;
  $("statistics-wins").textContent = entry.wins;
  $("statistics-rate").textContent = entry.played
    ? `${Number((entry.wins / entry.played * 100).toFixed(1))}%` : "—";
  $("statistics-best").textContent = entry.best === null ? "—" : formatTime(entry.best);
  $("statistics-scope").value = statisticsPractice ? "practice" : "formal";
  document.querySelectorAll("[data-statistics-mode]").forEach((button) => {
    const selected = button.dataset.statisticsMode === statisticsMode;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  const records = statistics.recent.filter((record) => record.key === key);
  const fragment = document.createDocumentFragment();
  const dateFormat = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
  for (const record of records) {
    const row = document.createElement("li");
    const result = document.createElement("span");
    result.className = `history-result ${record.status}`;
    result.innerHTML = icon(record.status === "won" ? "check" : "mine");
    result.append(record.status === "won" ? "通关" : "踩雷");
    if (record.newBest) {
      const label = document.createElement("span");
      label.className = "history-record";
      label.textContent = "新纪录";
      result.append(label);
    }
    const detail = document.createElement("span");
    detail.className = "history-detail";
    const duration = document.createElement("strong");
    duration.textContent = formatTime(record.elapsed);
    const date = document.createElement("time");
    date.dateTime = new Date(record.finishedAt).toISOString();
    date.textContent = dateFormat.format(record.finishedAt);
    detail.append(duration, date);
    row.append(result, detail);
    fragment.append(row);
  }
  $("statistics-history").replaceChildren(fragment);
  $("statistics-empty").hidden = records.length > 0;
  $("statistics-empty").textContent = entry.played
    ? "还没有逐局记录。" : statisticsPractice
    ? "在结算中选择“再试这盘”，完成练习后留下记录。" : "完成一局后，这里会留下记录。";
  $("statistics-history-note").hidden = entry.played <= records.length;
  $("statistics-storage-note").textContent = storageAvailable
    ? `${statisticsPractice ? "练习成绩单独计算，不影响正式战绩。" : "正式战绩不包含同盘练习。"}只统计通关和踩雷，中途重开不计入。成绩保存在当前浏览器。`
    : "当前浏览器无法保存成绩，关闭页面后本次成绩可能丢失。";
}
function statisticsChoices(config = game.config) {
  const choices = new Map();
  const add = (config) => {
    if (statisticsMode === "logic" && !supportsNoGuess(config)) return;
    choices.set(statisticsKey(config, statisticsMode, statisticsPractice), config);
  };
  Object.values(PRESETS).forEach(add);
  Object.keys(statistics).forEach((key) => {
    const entry = statisticsConfig(key);
    if (entry?.mode === statisticsMode && entry.practice === statisticsPractice) add(entry.config);
  });
  add(config);
  const options = Array.from(choices, ([key, config]) => {
    const label = `${configName(config)} · ${config.cols} × ${config.rows} · ${config.mines} 颗雷`;
    return new Option(label, key);
  });
  $("statistics-config").replaceChildren(...options);
  const preferred = statisticsKey(config, statisticsMode, statisticsPractice);
  if (choices.has(preferred)) $("statistics-config").value = preferred;
  renderStatistics();
}
function showStatistics() {
  statisticsMode = game.mode;
  statisticsPractice = game.practice;
  statisticsChoices();
  if ($("preferences-dialog").open) $("preferences-dialog").close();
  showDialog("statistics-dialog");
  $("statistics-dialog").scrollTop = 0;
}
$("statistics").addEventListener("click", showStatistics);
$("result-statistics").addEventListener("click", showStatistics);
$("statistics-config").addEventListener("change", renderStatistics);
$("statistics-scope").addEventListener("change", () => {
  const config = statisticsConfig($("statistics-config").value)?.config || game.config;
  statisticsPractice = $("statistics-scope").value === "practice";
  statisticsChoices(config);
});
document.querySelectorAll("[data-statistics-mode]").forEach((button) => {
  button.addEventListener("click", () => {
    const config = statisticsConfig($("statistics-config").value)?.config || game.config;
    statisticsMode = button.dataset.statisticsMode;
    statisticsChoices(config);
  });
});
$("help").addEventListener("click", () => {
  $("preferences-dialog").close();
  showDialog("help-dialog");
});
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
  $("custom-fields").hidden = $("custom-fields").disabled;
  $("settings-note").textContent = $("custom-fields").disabled
    ? "首次点击及相邻格安全。"
    : "边长 6–40 格，雷数最多占 40%。";
  $("settings-mode-note").textContent = logic
    ? "初级、中级支持无猜，棋盘经过推理验证。"
    : "支持所有难度，部分局面需要猜测。";
}
$("difficulty").addEventListener("click", () => {
  const level =
    Object.keys(PRESETS).find(
      (key) => PRESETS[key].name === configName(game.config),
    ) || "custom";
  $("settings-form").elements.level.value = level;
  $("settings-form").elements.gameMode.value = game.mode;
  updateSettingsMode();
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
  board.querySelectorAll(".pressing").forEach((cell) => cell.classList.remove("pressing"));
  pointers.clear();
  pinch = null;
  moving = false;
}
viewport.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || paused || generation) return;
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
    if (!["won", "lost"].includes(game.status)) {
      cell?.classList.add("pressing");
      pointer.hold = setTimeout(() => {
        if (pointer.moved || pointers.size !== 1 || pointer.index === null)
          return;
        pointer.held = true;
        act(pointer.index, "flag");
      }, 420);
    }
  } else {
    board.querySelectorAll(".pressing").forEach((button) => button.classList.remove("pressing"));
    pointers.forEach((p) => {
      clearTimeout(p.hold);
      p.moved = true;
    });
    moving = true;
    autoFit = false;
    const [a, b] = [...pointers.values()];
    const point = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    pinch = { distance: distance(a, b), size: cellSize, anchor: captureBoardPosition(point) };
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
      resizeCells((pinch.size * distance(a, b)) / pinch.distance, false, pinch.anchor,
        { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    return;
  }
  const dx = event.clientX - pointer.startX,
    dy = event.clientY - pointer.startY;
  if (Math.hypot(dx, dy) > 8) {
    pointer.moved = true;
    moving = true;
    clearTimeout(pointer.hold);
    buttons[pointer.index]?.classList.remove("pressing");
  }
  if (pointer.moved && !pointer.held) {
    const delta = boardDrag(dx, dy, boardView?.rotated);
    viewport.scrollLeft = pointer.scrollX - delta.x;
    viewport.scrollTop = pointer.scrollY - delta.y;
  }
});
viewport.addEventListener("pointerup", (event) => {
  const pointer = pointers.get(event.pointerId);
  if (!pointer) return;
  clearTimeout(pointer.hold);
  buttons[pointer.index]?.classList.remove("pressing");
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
boardView = mountBoardView({
  onBeforeChange() { viewAnchor = captureBoardPosition(); },
  onChange({ active }) {
    clearGestures();
    if (active && !regularSizing) {
      regularSizing = { cellSize, autoFit };
      viewFitMinimum = 28;
    } else if (!active && regularSizing) {
      const sizing = regularSizing;
      regularSizing = null;
      autoFit = sizing.autoFit;
      resizeCells(sizing.cellSize, false);
      savePreferences();
    }
    const anchor = viewAnchor;
    requestAnimationFrame(() => {
      if (autoFit) initialFit();
      restoreBoardPosition(anchor);
    });
    setStatus();
  },
  onStatus(message) {
    if (!paused && !generation && !["won", "lost"].includes(game.status)) setStatus(message);
  },
});
theme();
modes();
buildBoard();
syncClock();
if (autoFit) initialFit();
new ResizeObserver(() => {
  if (autoFit) initialFit();
}).observe(viewport);
if (game.status === "playing") setPause(true);
else if (["won", "lost"].includes(game.status)) showResult();
save();
if (!storageAvailable) setStatus("无法保存进度，当前仍可游玩", true);
