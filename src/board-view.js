import { icon } from "./icons.js";

export const CELL_GAP = 2;

export function fittedCellSize(config, width, height = Infinity, minimum = 20) {
  const across = (width - 6 - (config.cols - 1) * CELL_GAP) / config.cols;
  const down = (height - 6 - (config.rows - 1) * CELL_GAP) / config.rows;
  return Math.max(minimum, Math.min(60, Math.floor(Math.min(across, down))));
}

// A clockwise CSS rotation maps a physical drag (dx, dy) to (dy, -dx).
export function boardDrag(dx, dy, rotated) {
  return rotated ? { x: dy, y: -dx } : { x: dx, y: dy };
}

export function mountBoardView({ onBeforeChange, onChange, onStatus }) {
  const root = document.documentElement;
  const expand = document.getElementById("expand-board");
  const landscape = document.getElementById("landscape-board");
  let active = false, wantsLandscape = false, rotated = false, wide = false;
  let nativeOwned = false, lockAttempted = false, revision = 0;
  let lastState = "";

  function sync() {
    const nextRotated = active && wantsLandscape && window.innerHeight > window.innerWidth;
    const nextWide = nextRotated || (window.innerWidth > window.innerHeight && (active || window.innerHeight <= 560));
    const state = `${active}:${nextRotated}:${nextWide}`;
    if (state !== lastState) onBeforeChange?.();
    rotated = nextRotated;
    wide = nextWide;
    root.classList.toggle("board-fullscreen", active);
    root.classList.toggle("board-wide", wide);
    root.classList.toggle("board-rotated", rotated);
    expand.setAttribute("aria-pressed", String(active));
    expand.setAttribute("aria-label", active ? "退出棋盘全屏" : "棋盘全屏");
    expand.title = active ? "退出全屏" : "棋盘全屏";
    expand.innerHTML = icon(active ? "collapse" : "expand");
    landscape.setAttribute("aria-pressed", String(wantsLandscape));
    landscape.setAttribute("aria-label", wantsLandscape ? "跟随手机方向" : "横屏棋盘");
    landscape.title = wantsLandscape ? "跟随手机方向" : "横屏棋盘";
    landscape.innerHTML = icon(wantsLandscape ? "follow" : "landscape") +
      `<span class="button-label">${wantsLandscape ? "跟随" : "横屏"}</span>`;
    if (state !== lastState) {
      lastState = state;
      onChange({ active, rotated, wide });
    }
  }
  function unlock() {
    if (lockAttempted) {
      try { screen.orientation?.unlock?.(); } catch { /* Already released by browser. */ }
      lockAttempted = false;
    }
  }
  async function lockLandscape() {
    if (!active || !wantsLandscape) return;
    if (document.fullscreenElement === root && screen.orientation?.lock) {
      lockAttempted = true;
      try {
        await screen.orientation.lock("landscape");
        if (!active || !wantsLandscape) {
          // A pending lock can finish after exit() already released the earlier lock.
          try { screen.orientation.unlock(); } catch { /* Browser has released it. */ }
          lockAttempted = false;
        }
      } catch { /* The rotated layout works without a device orientation lock. */ }
    }
    sync();
    if (active && wantsLandscape && rotated)
      onStatus("横屏已开启，可横握手机");
  }
  async function exitNative() {
    if (document.fullscreenElement !== root) return;
    try { await document.exitFullscreen(); } catch { /* Layout exit still works. */ }
  }
  function exit() {
    revision++;
    active = false;
    wantsLandscape = false;
    unlock();
    sync();
    exitNative();
  }
  function enter(landscapeRequested = false) {
    const ticket = ++revision;
    wantsLandscape = landscapeRequested;
    active = true;
    sync();
    // Request directly in the click handler to retain transient user activation.
    if (root.requestFullscreen && document.fullscreenEnabled) {
      try {
        const request = root.requestFullscreen({ navigationUI: "hide" });
        Promise.resolve(request).then(() => {
          if (!active || ticket !== revision) {
            if (!active) exitNative();
            return;
          }
          nativeOwned = document.fullscreenElement === root;
          sync();
          if (wantsLandscape) lockLandscape();
        }).catch(() => {
          if (active && ticket === revision)
            onStatus(wantsLandscape ? "横屏已开启，可横握手机" : "已铺满页面");
        });
      } catch {
        onStatus(wantsLandscape ? "横屏已开启，可横握手机" : "已铺满页面");
      }
    } else {
      onStatus(wantsLandscape ? "横屏已开启，可横握手机" : "已铺满页面");
    }
  }
  expand.addEventListener("click", () => active ? exit() : enter());
  landscape.addEventListener("click", () => {
    if (!active) { enter(true); return; }
    wantsLandscape = !wantsLandscape;
    if (!wantsLandscape) unlock();
    sync();
    if (wantsLandscape) lockLandscape();
  });
  document.addEventListener("fullscreenchange", () => {
    if (document.fullscreenElement === root) {
      nativeOwned = true;
      if (!active) exitNative();
    } else if (nativeOwned) {
      nativeOwned = false;
      exit();
    }
    sync();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && active &&
        !document.querySelector("dialog[open]")) {
      event.preventDefault();
      exit();
    }
  });
  window.addEventListener("resize", sync);
  screen.orientation?.addEventListener?.("change", sync);
  queueMicrotask(sync);
  return {
    get active() { return active; },
    get rotated() { return rotated; },
    exit,
  };
}
