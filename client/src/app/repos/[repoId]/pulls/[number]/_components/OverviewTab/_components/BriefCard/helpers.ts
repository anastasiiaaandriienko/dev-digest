import type { BriefReviewFocus } from "@devdigest/shared";

/** Files-changed deep link for a Review focus item: `<pathname>?tab=diff&file=…&line=…`. */
export function focusHref(pathname: string, item: Pick<BriefReviewFocus, "path" | "line">): string {
  const sp = new URLSearchParams({ tab: "diff", file: item.path, line: String(item.line) });
  return `${pathname}?${sp.toString()}`;
}
