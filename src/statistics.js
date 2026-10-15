import { validConfig, supportsNoGuess } from "./engine.js";

export const HISTORY_LIMIT = 50;
const validTime = (value) => Number.isFinite(value) && value >= 0 && value <= 31536000000;
const validCount = (value) => Number.isSafeInteger(value) && value >= 0;

export function statisticsKey(config, mode = "classic", practice = false) {
  const key = `${config.rows}x${config.cols}:${config.mines}`;
  return key + (mode === "logic" ? ":logic" : "") + (practice ? ":practice" : "");
}

export function statisticsConfig(key) {
  const match = /^(\d+)x(\d+):(\d+)(:logic)?(:practice)?$/.exec(key);
  if (!match) return null;
  const config = { rows: Number(match[1]), cols: Number(match[2]), mines: Number(match[3]) };
  const mode = match[4] ? "logic" : "classic";
  const practice = Boolean(match[5]);
  return validConfig(config) && (mode !== "logic" || supportsNoGuess(config)) &&
    statisticsKey(config, mode, practice) === key ? { config, mode, practice } : null;
}

export function restoreStatistics(value) {
  const result = { recent: [] };
  if (!value || typeof value !== "object" || Array.isArray(value)) return result;
  for (const [key, entry] of Object.entries(value)) {
    if (!statisticsConfig(key) || !entry || !validCount(entry.played) ||
        !validCount(entry.wins) || entry.wins > entry.played) continue;
    result[key] = { played: entry.played, wins: entry.wins,
      best: entry.wins > 0 && validTime(entry.best) ? entry.best : null };
  }
  const ids = new Set();
  const counts = { formal: 0, practice: 0 };
  for (const record of Array.isArray(value.recent) ? value.recent : []) {
    if (!record || typeof record.id !== "string" || !record.id || record.id.length > 100 ||
        ids.has(record.id) || !result[record.key] || !statisticsConfig(record.key) ||
        !["won", "lost"].includes(record.status) || !validTime(record.elapsed) ||
        !Number.isSafeInteger(record.finishedAt) || record.finishedAt < 0 ||
        record.finishedAt > 8640000000000000) continue;
    const scope = statisticsConfig(record.key).practice ? "practice" : "formal";
    if (counts[scope] >= HISTORY_LIMIT) continue;
    counts[scope]++;
    ids.add(record.id);
    result.recent.push({ id: record.id, key: record.key, status: record.status,
      elapsed: record.elapsed, finishedAt: record.finishedAt,
      newBest: record.status === "won" && record.newBest === true });
  }
  return result;
}

export function recordStatistics(statistics, game, id, finishedAt = Date.now()) {
  if (game.recorded || !["won", "lost"].includes(game.status) ||
      statistics.recent.some((record) => record.id === id)) return statistics;
  const key = statisticsKey(game.config, game.mode, game.practice);
  const previous = statistics[key] || { played: 0, wins: 0, best: null };
  const won = game.status === "won";
  const elapsed = Math.floor(game.elapsed);
  const best = won ? Math.min(previous.best ?? Infinity, elapsed) : previous.best;
  const record = { id, key, status: game.status, elapsed, finishedAt,
    newBest: won && previous.best !== null &&
      Math.floor(elapsed / 1000) < Math.floor(previous.best / 1000) };
  const counts = { formal: 0, practice: 0 };
  const recent = [record, ...statistics.recent].filter((item) => {
    const scope = statisticsConfig(item.key).practice ? "practice" : "formal";
    return ++counts[scope] <= HISTORY_LIMIT;
  });
  return { ...statistics,
    [key]: { played: previous.played + 1, wins: previous.wins + Number(won), best },
    recent };
}
