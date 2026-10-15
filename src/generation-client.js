// A worker per request lets restart and cancellation stop computation. Late
// responses cannot resolve an already cancelled request.
export function startGeneration(config, first, {
  workerFactory = (url, options) => new Worker(url, options), timeoutMs = 8000,
} = {}) {
  let worker, timer, finished = false, rejectJob;
  function finish() {
    finished = true;
    clearTimeout(timer);
    worker?.terminate();
  }
  const promise = new Promise((resolve, reject) => {
    rejectJob = reject;
    try {
      worker = workerFactory(new URL("./generator-worker.js", import.meta.url), { type: "module" });
      worker.onmessage = ({ data }) => {
        if (finished) return;
        finish();
        if (data.ok) resolve(data.round);
        else reject(new Error(data.message || "生成失败，请重试。"));
      };
      worker.onerror = (event) => {
        event.preventDefault?.();
        if (finished) return;
        finish();
        reject(new Error("无猜棋盘生成失败，请重试或选经典随机。"));
      };
      worker.onmessageerror = () => {
        if (finished) return;
        finish();
        reject(new Error("生成结果无法读取，请重试。"));
      };
      timer = setTimeout(() => {
        if (finished) return;
        finish();
        reject(new Error("生成超时，请再点第一格重试。"));
      }, timeoutMs);
      worker.postMessage({ config, first });
    } catch {
      finish();
      reject(new Error("浏览器无法生成无猜棋盘，请选经典随机。"));
    }
  });
  return {
    promise,
    cancel() {
      if (finished) return;
      finish();
      const error = new Error("已取消生成");
      error.name = "AbortError";
      rejectJob(error);
    },
  };
}
