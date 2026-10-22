import type { ContextAttachment, ContextListItem } from "@devdigest/shared";
// Runtime import from the file, not the barrel (see client/INSIGHTS.md, 2026-10-15).
import { groupContextDocs } from "@devdigest/shared/context-doc-groups";
import { approxInjectedTokens } from "@/lib/context-tokens";

export interface SerializedDoc {
  path: string;
  /** Approximate prompt tokens; null when the size is unknown. */
  tokens: number | null;
}

export interface SerializedGroup {
  title: string;
  docs: SerializedDoc[];
}

/**
 * The skill's docs as a review prompt holds them: `ok` attachments in their
 * order, under the same headings the server uses (`groupContextDocs`).
 * Missing / outside-roots attachments are skipped at review time and counted.
 */
export function serializedGroups(
  attachments: readonly ContextAttachment[],
  files: readonly ContextListItem[],
  roots: readonly string[],
): { groups: SerializedGroup[]; skipped: number } {
  const sizes = new Map(files.map((f) => [f.path, f.size]));
  const ordered = [...attachments].sort((a, b) => a.order - b.order);
  const ok = ordered.filter((a) => a.status === "ok");
  const groups = groupContextDocs(ok, (a) => a.path, roots).map((g) => ({
    title: g.title,
    docs: g.items.map((a) => {
      const size = sizes.get(a.path);
      return { path: a.path, tokens: size === undefined ? null : approxInjectedTokens(size) };
    }),
  }));
  return { groups, skipped: ordered.length - ok.length };
}
