import type { Line } from "@/components/diff-viewer";

/** Above this many LCS cells (old lines × new lines) the diff degrades to replace-all. */
export const MAX_DIFF_CELLS = 4_000_000;

export interface LineDiff {
  lines: Line[];
  added: number;
  removed: number;
}

const split = (text: string): string[] => (text === "" ? [] : text.replace(/\r\n/g, "\n").split("\n"));

/**
 * Line-by-line diff of `before` → `after` (longest common subsequence), as
 * `del` / `add` / `ctx` rows with old / new line numbers — the shape the PR
 * diff viewer's CodeLine renders. Removed lines come before added ones inside a
 * changed block. Pure and dependency-free.
 */
export function diffLines(before: string, after: string): LineDiff {
  const a = split(before);
  const b = split(after);
  const n = a.length;
  const m = b.length;

  if (n * m > MAX_DIFF_CELLS) {
    const lines: Line[] = [
      ...a.map((text, i) => ({ kind: "del" as const, text, oldNo: i + 1 })),
      ...b.map((text, j) => ({ kind: "add" as const, text, newNo: j + 1 })),
    ];
    return { lines, added: m, removed: n };
  }

  // lcs[i][j] = LCS length of a[i..] and b[j..] (suffix table, so the walk goes forward).
  const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }

  const lines: Line[] = [];
  let added = 0;
  let removed = 0;
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      lines.push({ kind: "ctx", text: a[i]!, oldNo: i + 1, newNo: j + 1 });
      i++;
      j++;
    } else if (i < n && (j >= m || lcs[i + 1]![j]! >= lcs[i]![j + 1]!)) {
      lines.push({ kind: "del", text: a[i]!, oldNo: i + 1 });
      removed++;
      i++;
    } else {
      lines.push({ kind: "add", text: b[j]!, newNo: j + 1 });
      added++;
      j++;
    }
  }
  return { lines, added, removed };
}
