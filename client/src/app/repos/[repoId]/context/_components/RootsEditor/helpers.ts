/** One root per line (commas also split); blanks and exact duplicates are dropped. */
export function parseRoots(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[\n,]/)) {
    const root = raw.trim();
    if (root && !out.includes(root)) out.push(root);
  }
  return out;
}

export const rootsToText = (roots: string[]) => roots.join("\n");
