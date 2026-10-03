export function fittedCellSize(config, width, height = Infinity, minimum = 20) {
  const across = (width - 2 - (config.cols - 1) * 3) / config.cols;
  const down = (height - 2 - (config.rows - 1) * 3) / config.rows;
  return Math.max(minimum, Math.min(60, Math.floor(Math.min(across, down))));
}

// A clockwise CSS rotation maps a physical drag (dx, dy) to (dy, -dx).
export function boardDrag(dx, dy, rotated) {
  return rotated ? { x: dy, y: -dx } : { x: dx, y: dy };
}

export function mountBoardView({ onChange, onStatus }) {
  const root = document.documentElement;
  const expand = document.getElementById("expand-board");
  const landscape = document.getElementById("landscape-board");
  let active = false, wantsLandscape = false, rotated = false, wide = false;
  let nativeOwned = false, lockAttempted = false, revision = 0;
  let lastState = "";

  function sync() {
    rotated = active && wantsLandscape && window.innerHeight > window.innerWidth;
    wide = active && (rotated || window.innerWidth > window.innerHeight);
    root.classList.toggle("board-fullscreen", active);
    root.classList.toggle("board-wide", wide);
    root.classList.toggle("board-rotated", rotated);
    expand.setAttribute("aria-pressed", String(active));
    expand.setAttribute("aria-label", active ? "退出棋盘全屏" : "棋盘全屏");
    expand.title = active ? "退出全屏" : "棋盘全屏";
    expand.textContent = active ? "×" : "⛶";
    landscape.hidden = !active;
    landscape.setAttribute("aria-pressed", String(wantsLandscape));
    landscape.setAttribute("aria-label", wantsLandscape ? "跟随手机方向" : "横屏棋盘");
    landscape.textContent = wantsLandscape ? "随方向" : "横屏";
    const state = `${active}:${rotated}:${wide}`;
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
      onStatus("画面已横过来，请横握手机。再点“随方向”可恢复自动布局。");
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
  function enter() {
    const ticket = ++revision;
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
            onStatus("已铺满页面。可点“横屏”，或直接将手机横过来。");
        });
      } catch {
        onStatus("已铺满页面。可点“横屏”，或直接将手机横过来。");
      }
    } else {
      onStatus("已铺满页面。可点“横屏”，或直接将手机横过来。");
    }
  }
  expand.addEventListener("click", () => active ? exit() : enter());
  landscape.addEventListener("click", () => {
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
  return {
    get active() { return active; },
    get rotated() { return rotated; },
    exit,
  };
}
