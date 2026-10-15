import { deduce } from "./solver.js";

function describe(proof, config, clues) {
  const count = proof.cells.length;
  const safe = proof.count === 0;
  if (proof.rule === "total") return safe
    ? `已从数字确定全部 ${config.mines} 颗雷，其余未开格都安全。`
    : `扣除已确定的雷，剩余 ${proof.count} 颗雷恰好占满 ${count} 个未确定格。`;
  if (proof.rule === "subset")
    return `扣除高亮数字的共同范围，剩余 ${count} 格${safe ? "无雷。" : "全是雷。"}`;
  const clue = clues[proof.clues[0]];
  if (safe) return `数字 ${clue} 周围的雷已确定，其余邻格安全。`;
  return proof.knownMines.length
    ? `数字 ${clue} 扣除已确定的雷后，剩余 ${count} 格全是雷。`
    : `数字 ${clue} 周围只剩 ${count} 个未开格，${count === 1 ? "这格是雷。" : "这些格全是雷。"}`;
}

// The input contains visible clues only. Flags select useful targets; they are
// never supplied to the solver as facts. Every supporting mine is re-proved.
export function findHint({ config, clues }, {
  flagged = [], now = () => performance.now(), deadline = now() + 60,
} = {}) {
  const proven = new Map(), flags = new Set(flagged);
  while (now() < deadline) {
    const move = deduce({ config, clues, knownMines: [...proven.keys()] },
      { now, deadline, explain: true });
    const index = move.safe.find((i) => flags.has(i)) ?? move.safe[0] ??
      move.mines.find((i) => !flags.has(i));
    if (index !== undefined) {
      const proof = move.proofs[index], sources = new Set(proof.clues), support = new Set();
      function include(evidence) {
        evidence.clues.forEach((i) => sources.add(i));
        for (const mine of evidence.knownMines) {
          if (support.has(mine)) continue;
          support.add(mine);
          include(proven.get(mine));
        }
      }
      include(proof);
      const kind = proof.count === 0 ? "safe" : "mine";
      return { kind, index, clues: [...sources], supportMines: [...support],
        region: proof.cells, rule: proof.rule,
        text: describe(proof, config, clues) +
          (kind === "safe" && flags.has(index) ? "先取消这格的旗帜。" : "") };
    }
    if (move.reason !== "deduced") return { kind: "none", reason: move.reason };
    move.mines.forEach((i) => proven.set(i, move.proofs[i]));
  }
  return { kind: "none", reason: "budget" };
}
