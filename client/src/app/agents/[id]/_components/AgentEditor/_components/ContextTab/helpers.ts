import type { ContextAttachment, ContextAttachmentStatus, ContextListItem } from "@devdigest/shared";

/** One line of the tab: an attachment (checked) or an unattached discovered doc. */
export interface DocRow {
  path: string;
  attached: boolean;
  /** Attachment id, set when attached (needed to detach). */
  attachmentId?: string;
  status?: ContextAttachmentStatus;
  /** Bytes; unknown for attachments that are not in the discovered list. */
  size?: number;
}

/** Attachments first in server order, then unattached discovered docs in discovery order. */
export function buildRows(attachments: readonly ContextAttachment[], files: readonly ContextListItem[]): DocRow[] {
  const sizes = new Map(files.map((f) => [f.path, f.size]));
  const taken = new Set(attachments.map((a) => a.path));
  const attached: DocRow[] = attachments.map((a) => ({
    path: a.path,
    attached: true,
    attachmentId: a.id,
    status: a.status,
    size: sizes.get(a.path),
  }));
  const rest: DocRow[] = files
    .filter((f) => !taken.has(f.path))
    .map((f) => ({ path: f.path, attached: false, size: f.size }));
  return [...attached, ...rest];
}

const trimSlashes = (p: string) => p.replace(/^\.?\/+|\/+$/g, "");

/** The longest root that prefixes the path (whole segments), or null. */
export function rootOf(path: string, roots: readonly string[]): string | null {
  let best: string | null = null;
  for (const raw of roots) {
    const root = trimSlashes(raw);
    if (!root) continue;
    if ((path === root || path.startsWith(`${root}/`)) && (best === null || root.length > trimSlashes(best).length)) {
      best = raw;
    }
  }
  return best;
}

/** Last segment of a root, lower-cased (".devdigest/specs" -> "specs"). */
export function rootKind(root: string): string {
  const parts = trimSlashes(root).split("/");
  return (parts[parts.length - 1] ?? "").toLowerCase();
}

/** Filename and folder of a repo-relative path. */
export function splitPath(path: string): { name: string; folder: string } {
  const i = path.lastIndexOf("/");
  return i < 0 ? { name: path, folder: "" } : { name: path.slice(i + 1), folder: path.slice(0, i) };
}

/** Case-insensitive "path contains text"; blank text keeps every row. */
export function filterRows(rows: readonly DocRow[], text: string): DocRow[] {
  const needle = text.trim().toLowerCase();
  return needle ? rows.filter((r) => r.path.toLowerCase().includes(needle)) : [...rows];
}

/** Move one attachment id by `delta` positions (↑ / ↓); clamped, always the full id list. */
export function moveBy(ids: readonly string[], id: string, delta: number): string[] {
  const from = ids.indexOf(id);
  if (from < 0) return [...ids];
  return moveTo(ids, from, Math.max(0, Math.min(ids.length - 1, from + delta)));
}

/** Drag & drop: put the dragged id where the target is. */
export function dropOn(ids: readonly string[], draggedId: string, targetId: string): string[] {
  const from = ids.indexOf(draggedId);
  const to = ids.indexOf(targetId);
  if (from < 0 || to < 0 || from === to) return [...ids];
  return moveTo(ids, from, to);
}

function moveTo(ids: readonly string[], from: number, to: number): string[] {
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

/** Same order? (skip a PUT that would change nothing) */
export function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** Size in kB with one decimal below 10 kB (e.g. 0.4, 12). */
export function formatKb(bytes: number): string {
  const kb = bytes / 1024;
  return kb < 10 ? (Math.round(kb * 10) / 10).toString() : Math.round(kb).toString();
}
