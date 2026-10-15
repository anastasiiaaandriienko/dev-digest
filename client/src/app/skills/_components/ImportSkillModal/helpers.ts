// Runtime import from the contract file itself (a value import from the barrel breaks `next build`).
import { SKILL_IMPORT_LIMITS, skillImportIssues } from "@devdigest/shared/contracts/knowledge";
import type { SkillImportCandidate, SkillImportField, SkillImportIssue, SkillImportItem, SkillType } from "@devdigest/shared";
import { ApiError } from "@/lib/api";

/** Upload limit in MB, for messages. */
export const MAX_UPLOAD_MB = SKILL_IMPORT_LIMITS.maxUploadBytes / (1024 * 1024);

export type FileProblem = "type" | "size" | "empty";

/** Checks done before the file is even read (the server repeats all of them). */
export function fileProblem(file: { name: string; size: number }): FileProblem | null {
  if (!/\.(md|zip)$/i.test(file.name)) return "type";
  if (file.size === 0) return "empty";
  if (file.size > SKILL_IMPORT_LIMITS.maxUploadBytes) return "size";
  return null;
}

/** Bytes → base64 in chunks (spreading a large array into fromCharCode overflows the stack). */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** File → base64 via FileReader (works everywhere, incl. jsdom, unlike Blob.arrayBuffer). */
export function readAsBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(bytesToBase64(new Uint8Array(reader.result as ArrayBuffer)));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsArrayBuffer(file);
  });
}

/** One proposed skill as the user is reviewing / editing it. */
export interface ImportDraft {
  path: string;
  include: boolean;
  name: string;
  description: string;
  type: SkillType;
  body: string;
  /** Issues reported by the server; a field's issues are dropped once the user edits it. */
  serverIssues: SkillImportIssue[];
}

export type DraftPatch = Partial<Pick<ImportDraft, "include" | "name" | "description" | "type" | "body">>;

export function draftsFrom(items: readonly SkillImportCandidate[]): ImportDraft[] {
  return items.map((c) => ({
    path: c.path,
    include: true,
    name: c.name,
    description: c.description,
    type: c.type,
    body: c.body,
    serverIssues: c.issues,
  }));
}

export function editDraft(draft: ImportDraft, patch: DraftPatch): ImportDraft {
  const edited = Object.keys(patch) as (keyof DraftPatch)[];
  return {
    ...draft,
    ...patch,
    serverIssues: draft.serverIssues.filter((i) => !edited.includes(i.field as keyof DraftPatch)),
  };
}

/**
 * Everything wrong with draft `index` right now: the shared rules (same as the
 * server), the server's own findings for fields not edited since (e.g. a name
 * already taken), and a name used by another included draft. Excluded → none.
 */
export function draftIssues(
  drafts: readonly ImportDraft[],
  index: number,
  duplicateMessage: (name: string) => string,
): SkillImportIssue[] {
  const d = drafts[index]!;
  if (!d.include) return [];
  const issues = [...skillImportIssues(d), ...d.serverIssues];
  const key = d.name.trim().toLowerCase();
  if (key && drafts.some((o, i) => i !== index && o.include && o.name.trim().toLowerCase() === key)) {
    issues.push({ field: "name", message: duplicateMessage(d.name.trim()) });
  }
  return issues.filter((x, i) => issues.findIndex((y) => y.field === x.field && y.message === x.message) === i);
}

/** The request body for the included drafts. */
export function itemsToImport(drafts: readonly ImportDraft[]): SkillImportItem[] {
  return drafts
    .filter((d) => d.include)
    .map((d) => ({ name: d.name.trim(), description: d.description.trim(), type: d.type, body: d.body }));
}

const FIELDS: readonly SkillImportField[] = ["name", "description", "type", "body"];

/** One entry of a 422 `details` array as the API sends it (fastify-type-provider-zod). */
interface ValidationDetail {
  instancePath?: string;
  params?: { issue?: { path?: (string | number)[] } };
  message?: string;
}

/** `["items", 0, "body"]` from the zod issue, or parsed from `instancePath` ("/items/0/body"). */
function issuePath(d: ValidationDetail): (string | number)[] {
  if (Array.isArray(d.params?.issue?.path)) return d.params!.issue!.path!;
  return (d.instancePath ?? "")
    .split("/")
    .filter(Boolean)
    .map((p) => (/^\d+$/.test(p) ? Number(p) : p));
}

/**
 * Put a failed import's reasons back on the drafts: 409 → the taken names,
 * 422 → the field issues (paths `items.<i>.<field>` index the INCLUDED drafts).
 */
export function applyImportError(
  drafts: readonly ImportDraft[],
  err: unknown,
  takenMessage: (name: string) => string,
): ImportDraft[] {
  if (!(err instanceof ApiError)) return [...drafts];
  const included = drafts.flatMap((d, i) => (d.include ? [i] : []));
  const add = new Map<number, SkillImportIssue[]>();
  const push = (i: number, issue: SkillImportIssue) => add.set(i, [...(add.get(i) ?? []), issue]);

  if (err.status === 409) {
    const names = new Set(((err.details as { names?: string[] })?.names ?? []).map((n) => n.toLowerCase()));
    for (const i of included) {
      if (names.has(drafts[i]!.name.trim().toLowerCase())) push(i, { field: "name", message: takenMessage(drafts[i]!.name.trim()) });
    }
  } else if (err.status === 422 && Array.isArray(err.details)) {
    for (const issue of err.details as ValidationDetail[]) {
      const [root, idx, field] = issuePath(issue);
      const target = typeof idx === "number" ? included[idx] : undefined;
      if (root === "items" && target !== undefined && FIELDS.includes(field as SkillImportField)) {
        push(target, { field: field as SkillImportField, message: issue.message ?? "Invalid" });
      }
    }
  }
  return drafts.map((d, i) => (add.has(i) ? { ...d, serverIssues: [...d.serverIssues, ...add.get(i)!] } : d));
}

/** The archive entries a 422 `unsafe_archive` names, if any. */
export function rejectedEntries(err: unknown): { path: string; reason: string }[] {
  if (!(err instanceof ApiError)) return [];
  const entries = (err.details as { entries?: unknown })?.entries;
  return Array.isArray(entries) ? (entries as { path: string; reason: string }[]) : [];
}
