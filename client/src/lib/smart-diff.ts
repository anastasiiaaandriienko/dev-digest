/* lib/smart-diff.ts — deterministic, client-side grouping of changed files by
   role for the "Smart order" view of Files changed. Pure: no React, no data
   fetching, no runtime imports. */

/** Display order of the groups (all five are always shown, even when empty). */
export const SMART_GROUP_ORDER = ["core", "tests", "wiring", "docs", "boilerplate"] as const;
export type SmartGroupKey = (typeof SMART_GROUP_ORDER)[number];

const LOCKFILES = new Set([
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  "npm-shrinkwrap.json",
  "bun.lockb",
  "bun.lock",
  "composer.lock",
  "gemfile.lock",
  "poetry.lock",
  "cargo.lock",
  "go.sum",
  "pipfile.lock",
]);

const BOILERPLATE_DIRS = new Set(["dist", "build", "vendor"]);

const ASSET_EXT = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico", "icns", "svg",
  "woff", "woff2", "ttf", "otf", "eot",
  "pdf", "zip", "gz", "tar", "tgz", "mp3", "mp4", "mov", "webm", "wasm",
]);

const TEST_DIRS = new Set(["test", "tests", "__tests__", "e2e"]);
const DOC_EXT = new Set(["md", "mdx", "rst", "txt"]);
const DOC_STEMS = new Set(["readme", "changelog", "license"]);
const WIRING_EXT = new Set(["yml", "yaml"]);

function extOf(base: string): string {
  const i = base.lastIndexOf(".");
  return i > 0 ? base.slice(i + 1) : "";
}

/** Classify a changed file path into one smart group (boilerplate > tests > docs > wiring > core). */
export function classifyFile(path: string): SmartGroupKey {
  const segs = path.toLowerCase().replace(/\\/g, "/").split("/").filter(Boolean);
  const base = segs[segs.length - 1] ?? "";
  const dirs = segs.slice(0, -1);
  const ext = extOf(base);
  const stem = base.split(".")[0] ?? "";

  // boilerplate
  if (LOCKFILES.has(base)) return "boilerplate";
  for (let i = 0; i < dirs.length - 1; i++) {
    if (dirs[i] === "migrations" && dirs[i + 1] === "meta") return "boilerplate";
  }
  if (ext === "snap") return "boilerplate";
  if (dirs.length > 0 && BOILERPLATE_DIRS.has(dirs[0]!)) return "boilerplate";
  if (/\.min\.[^./]+$/.test(base)) return "boilerplate";
  if (ASSET_EXT.has(ext)) return "boilerplate";

  // tests
  if (dirs.some((d) => TEST_DIRS.has(d))) return "tests";
  if (/\.(test|spec)\./.test(base) || base.endsWith(".flow.json")) return "tests";
  if (/^test_.*\.py$/.test(base) || base.endsWith("_test.go")) return "tests";

  // wiring that would otherwise look like docs (.txt)
  if (/^requirements.*\.txt$/.test(base)) return "wiring";

  // docs
  if (DOC_EXT.has(ext) || dirs.includes("docs") || (DOC_STEMS.has(stem) && (ext === "" || DOC_EXT.has(ext)))) {
    return "docs";
  }

  // wiring
  if (base === "package.json" || base.startsWith("tsconfig")) return "wiring";
  if (/\.config\./.test(base) || WIRING_EXT.has(ext)) return "wiring";
  if (base === "dockerfile" || base.startsWith("dockerfile.")) return "wiring";
  if (dirs.includes(".github") || base === ".env.example") return "wiring";
  if (/^index\.(ts|tsx|js)$/.test(base)) return "wiring";
  if (ext === "json" && dirs.includes("messages")) return "wiring";

  return "core";
}

export interface SmartGroup<F> {
  key: SmartGroupKey;
  files: F[];
  /** Number of FILES in the group with at least one finding. */
  filesWithFindings: number;
}

/** Always returns all five groups in SMART_GROUP_ORDER; original file order kept inside each. */
export function buildSmartGroups<F extends { path: string }>(
  files: readonly F[],
  findings: readonly { file: string }[],
): SmartGroup<F>[] {
  const withFindings = new Set(findings.map((f) => f.file));
  const groups: SmartGroup<F>[] = SMART_GROUP_ORDER.map((key) => ({
    key,
    files: [],
    filesWithFindings: 0,
  }));
  for (const file of files) {
    const g = groups[SMART_GROUP_ORDER.indexOf(classifyFile(file.path))]!;
    g.files.push(file);
    if (withFindings.has(file.path)) g.filesWithFindings += 1;
  }
  return groups;
}

/** core/tests/wiring open by default; docs/boilerplate only when they hold findings. */
export function defaultGroupOpen(key: SmartGroupKey, filesWithFindings: number): boolean {
  if (key === "docs" || key === "boilerplate") return filesWithFindings > 0;
  return true;
}
