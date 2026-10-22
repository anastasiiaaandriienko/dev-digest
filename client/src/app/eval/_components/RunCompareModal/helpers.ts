/* Word-level diff of two system prompts (design screen_skills.jsx `diffTokens`).
   Tokens keep their whitespace, so the rendered diff keeps line breaks. The
   common prefix / suffix is matched first (prompt versions usually differ in a
   small part); only the differing middle runs through the LCS table, capped at
   PROMPT_DIFF_MAX_TOKENS per side so a huge prompt cannot freeze the page. */

export const PROMPT_DIFF_MAX_TOKENS = 3000;

export type DiffToken = { t: string; k: "same" | "add" | "del" };

const tokenize = (s: string): string[] => s.split(/(\s+)/).filter((x) => x.length > 0);

export function diffTokens(a: string, b: string, maxTokens = PROMPT_DIFF_MAX_TOKENS): { tokens: DiffToken[]; truncated: boolean } {
  const aw = tokenize(a);
  const bw = tokenize(b);
  let pre = 0;
  while (pre < aw.length && pre < bw.length && aw[pre] === bw[pre]) pre++;
  let suf = 0;
  while (suf < aw.length - pre && suf < bw.length - pre && aw[aw.length - 1 - suf] === bw[bw.length - 1 - suf]) suf++;

  let am = aw.slice(pre, aw.length - suf);
  let bm = bw.slice(pre, bw.length - suf);
  const truncated = am.length > maxTokens || bm.length > maxTokens;
  am = am.slice(0, maxTokens);
  bm = bm.slice(0, maxTokens);

  const n = am.length;
  const m = bm.length;
  // dp[i][j] = LCS length of am[i..] and bm[j..]; one flat Uint16Array (lengths ≤ maxTokens).
  const dp = new Uint16Array((n + 1) * (m + 1));
  const at = (i: number, j: number) => i * (m + 1) + j;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[at(i, j)] = am[i] === bm[j] ? dp[at(i + 1, j + 1)]! + 1 : Math.max(dp[at(i + 1, j)]!, dp[at(i, j + 1)]!);
    }
  }
  const middle: DiffToken[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (am[i] === bm[j]) {
      middle.push({ t: am[i]!, k: "same" });
      i++;
      j++;
    } else if (dp[at(i + 1, j)]! >= dp[at(i, j + 1)]!) {
      middle.push({ t: am[i++]!, k: "del" });
    } else {
      middle.push({ t: bm[j++]!, k: "add" });
    }
  }
  while (i < n) middle.push({ t: am[i++]!, k: "del" });
  while (j < m) middle.push({ t: bm[j++]!, k: "add" });

  const tokens: DiffToken[] = [
    ...aw.slice(0, pre).map((t) => ({ t, k: "same" as const })),
    ...middle,
    ...(truncated ? [] : aw.slice(aw.length - suf).map((t) => ({ t, k: "same" as const }))),
  ];
  return { tokens, truncated };
}
