import type { SkillVersion } from "@devdigest/shared";
import { diffLines } from "./_components/VersionDiff/helpers";

/**
 * For each version, the most recent OLDER version with the identical body (a
 * restore, or an edit that went back). There is no "restored from" column, so
 * this is derived from the bodies. Returns version → older version.
 */
export function sameBodyAs(versions: readonly SkillVersion[]): Map<number, number> {
  const out = new Map<number, number>();
  const ascending = [...versions].sort((a, b) => a.version - b.version);
  const lastWithBody = new Map<string, number>();
  for (const v of ascending) {
    const earlier = lastWithBody.get(v.body);
    if (earlier !== undefined) out.set(v.version, earlier);
    lastWithBody.set(v.body, v.version);
  }
  return out;
}

/** What a version changed, derived from the stored bodies (versions have no message). */
export type VersionSummary =
  | { kind: "initial" }
  | { kind: "same"; as: number }
  | { kind: "changed"; prev: number; added: number; removed: number };

/**
 * One summary per version: the oldest is the initial body; a body that repeats
 * an older one is a restore ("same as"); any other version is the line delta
 * against the version just before it. Returns version → summary.
 */
export function versionSummaries(versions: readonly SkillVersion[]): Map<number, VersionSummary> {
  const out = new Map<number, VersionSummary>();
  const same = sameBodyAs(versions);
  const ascending = [...versions].sort((a, b) => a.version - b.version);
  ascending.forEach((v, i) => {
    const sameAs = same.get(v.version);
    const prev = ascending[i - 1];
    if (sameAs !== undefined) out.set(v.version, { kind: "same", as: sameAs });
    else if (!prev) out.set(v.version, { kind: "initial" });
    else {
      const { added, removed } = diffLines(prev.body, v.body);
      out.set(v.version, { kind: "changed", prev: prev.version, added, removed });
    }
  });
  return out;
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Compact version timestamp as in the design (`2026-05-30`), plus the time —
 * several saves can share a day: `2026-05-30 14:07` (local time). An
 * unparseable value is returned as-is.
 */
export function versionWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
