/**
 * Smart Diff classification rules — the ONE definition of how a changed file is
 * assigned to a Smart Diff group. Pure: no runtime imports, no I/O.
 *
 * Used by the server (`GET /pulls/:id/smart-diff`) and the client ("Smart order"
 * in Files changed). The client copy (`client/src/vendor/shared/smart-diff-rules.ts`)
 * must stay byte-identical; `server/test/smart-diff-rules-sync.test.ts` enforces it.
 *
 * Priority (first matching category wins): boilerplate → tests → wiring → docs → core.
 */

/** Display order of the groups (all five are always shown, even when empty). */
export const SMART_GROUP_ORDER = ['core', 'tests', 'wiring', 'docs', 'boilerplate'] as const;
export type SmartGroupKey = (typeof SMART_GROUP_ORDER)[number];

/** Categories checked in this order; a file matching none of them is `core`. */
export const SMART_CLASSIFICATION_PRIORITY = ['boilerplate', 'tests', 'wiring', 'docs'] as const;
export type SmartRuleCategory = (typeof SMART_CLASSIFICATION_PRIORITY)[number];

export const SMART_LOCKFILES: ReadonlySet<string> = new Set([
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'npm-shrinkwrap.json',
  'bun.lockb',
  'bun.lock',
  'composer.lock',
  'gemfile.lock',
  'poetry.lock',
  'cargo.lock',
  'go.sum',
  'pipfile.lock',
]);

/** Generated/third-party output, matched only as the FIRST path segment. */
export const SMART_BOILERPLATE_DIRS: ReadonlySet<string> = new Set(['dist', 'build', 'vendor']);

export const SMART_ASSET_EXT: ReadonlySet<string> = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico', 'icns', 'svg',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'pdf', 'zip', 'gz', 'tar', 'tgz', 'mp3', 'mp4', 'mov', 'webm', 'wasm',
]);

export const SMART_TEST_DIRS: ReadonlySet<string> = new Set(['test', 'tests', '__tests__', 'e2e']);
export const SMART_DOC_EXT: ReadonlySet<string> = new Set(['md', 'mdx', 'rst', 'txt']);
export const SMART_DOC_STEMS: ReadonlySet<string> = new Set(['readme', 'changelog', 'license']);
export const SMART_WIRING_EXT: ReadonlySet<string> = new Set(['yml', 'yaml']);

/** A path split into the lower-cased, `/`-normalized parts the rules read. */
export interface SmartPathParts {
  base: string;
  dirs: string[];
  ext: string;
  stem: string;
}

export function smartPathParts(path: string): SmartPathParts {
  const segs = path.toLowerCase().replace(/\\/g, '/').split('/').filter(Boolean);
  const base = segs[segs.length - 1] ?? '';
  const dot = base.lastIndexOf('.');
  return {
    base,
    dirs: segs.slice(0, -1),
    ext: dot > 0 ? base.slice(dot + 1) : '',
    stem: base.split('.')[0] ?? '',
  };
}

function isBoilerplate({ base, dirs, ext }: SmartPathParts): boolean {
  if (SMART_LOCKFILES.has(base)) return true;
  for (let i = 0; i < dirs.length - 1; i++) {
    if (dirs[i] === 'migrations' && dirs[i + 1] === 'meta') return true;
  }
  if (ext === 'snap') return true;
  if (dirs.length > 0 && SMART_BOILERPLATE_DIRS.has(dirs[0]!)) return true;
  if (/\.min\.[^./]+$/.test(base)) return true;
  return SMART_ASSET_EXT.has(ext);
}

function isTests({ base, dirs }: SmartPathParts): boolean {
  if (dirs.some((d) => SMART_TEST_DIRS.has(d))) return true;
  if (/\.(test|spec)\./.test(base) || base.endsWith('.flow.json')) return true;
  return /^test_.*\.py$/.test(base) || base.endsWith('_test.go');
}

function isWiring({ base, dirs, ext }: SmartPathParts): boolean {
  if (/^requirements.*\.txt$/.test(base)) return true;
  if (base === 'package.json' || base.startsWith('tsconfig')) return true;
  if (/\.config\./.test(base) || SMART_WIRING_EXT.has(ext)) return true;
  if (base === 'dockerfile' || base.startsWith('dockerfile.')) return true;
  if (dirs.includes('.github') || base === '.env.example') return true;
  if (/^index\.(ts|tsx|js)$/.test(base)) return true;
  return ext === 'json' && dirs.includes('messages');
}

function isDocs({ dirs, ext, stem }: SmartPathParts): boolean {
  if (SMART_DOC_EXT.has(ext) || dirs.includes('docs')) return true;
  return SMART_DOC_STEMS.has(stem) && (ext === '' || SMART_DOC_EXT.has(ext));
}

const MATCHERS: Record<SmartRuleCategory, (p: SmartPathParts) => boolean> = {
  boilerplate: isBoilerplate,
  tests: isTests,
  wiring: isWiring,
  docs: isDocs,
};

/** Every category whose rules match `path`, in priority order (for tests and debugging). */
export function matchingSmartCategories(path: string): SmartRuleCategory[] {
  const parts = smartPathParts(path);
  return SMART_CLASSIFICATION_PRIORITY.filter((c) => MATCHERS[c](parts));
}

/** Classify a changed file path into one smart group (boilerplate > tests > wiring > docs > core). */
export function classifySmartFile(path: string): SmartGroupKey {
  const parts = smartPathParts(path);
  for (const category of SMART_CLASSIFICATION_PRIORITY) {
    if (MATCHERS[category](parts)) return category;
  }
  return 'core';
}
