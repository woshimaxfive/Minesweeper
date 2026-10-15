import { deduce } from "./solver.js";

function describe(proof, config, clues) {
  const count = proof.cells.length;
  const safe = proof.count === 0;
  if (proof.rule === "total") return safe
    ? `总共 ${config.mines} 颗雷都已由数字确定，其余未开格都是安全格。`
    : `扣除已证明的雷后，还剩 ${proof.count} 颗雷和 ${count} 个未确定格，因此这些格都是雷。`;
  if (proof.rule === "subset")
    return `对比高亮数字并排除共同范围后，剩余 ${count} 格${safe ? "都没有雷。" : "都必须是雷。"}`;
  const clue = clues[proof.clues[0]];
  if (safe) return `这个 ${clue} 周围的雷位已由线索确定，剩余相邻格可以安全打开。`;
  return proof.knownMines.length
    ? `这个 ${clue} 周围扣除已证明的雷后，剩下 ${count} 格都必须是雷。`
    : `这个 ${clue} 周围只剩 ${count} 个未开格，${count === 1 ? "雷只能在这里。" : `这 ${count} 格都必须是雷。`}`;
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
