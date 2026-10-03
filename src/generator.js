import { Game, supportsNoGuess } from "./engine.js";
import { verifyNoGuess } from "./solver.js";

export function generateNoGuess(config, first, {
  random = Math.random, now = () => performance.now(), timeoutMs = 6000,
  maxAttempts = 1500,
} = {}) {
  if (!supportsNoGuess(config)) throw new Error("无猜模式目前支持初级和中级");
  if (!Number.isInteger(first) || first < 0 || first >= config.rows * config.cols)
    throw new Error("起点无效");
  const deadline = now() + timeoutMs;
  for (let attempts = 1; attempts <= maxAttempts && now() < deadline; attempts++) {
    const candidate = new Game(config);
    candidate.reveal(first, random);
    const proof = verifyNoGuess(candidate, first, { deadline, now });
    if (!proof.solved) continue;
    candidate.mode = "logic";
    return { round: candidate.serialize(), attempts };
  }
  throw new Error("这次没生成成功，请再点第一格重试。");
}
