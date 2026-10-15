import type { SkillVersion } from "@devdigest/shared";

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
