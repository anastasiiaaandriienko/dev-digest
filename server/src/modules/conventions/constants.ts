/** Top-ranked source files sampled per scan (HW2 #39), next to the config files. */
export const SAMPLE_TOP_FILES = 12;

/** Bytes read per file; longer files are cut at a line boundary (evidence must fall inside). */
export const MAX_FILE_BYTES = 16 * 1024;
/** Config files are short; a smaller share keeps room for source samples. */
export const MAX_CONFIG_BYTES = 8 * 1024;
/** Total sample text sent to the model in one scan. */
export const MAX_TOTAL_BYTES = 80 * 1024;

/** Candidates accepted from one model answer. */
export const MAX_CANDIDATES = 25;
/** Lines of context around the evidence line in the stored snippet. */
export const SNIPPET_CONTEXT_LINES = 2;
export const MAX_SNIPPET_CHARS = 600;
/** Rejected rules listed in the prompt as "do not propose again". */
export const MAX_REJECTED_IN_PROMPT = 40;

/** Upper bound for one extraction call (the model call is never retried). */
export const SCAN_TIMEOUT_MS = 180_000;

/** Default name of the skill built from accepted conventions (HW2 #42). */
export const SKILL_NAME = 'repo-conventions';

/** Root config files that describe the house style (allow-list, matched on the file name). */
export const CONFIG_FILE_RE =
  /^(tsconfig(\.[\w-]+)?\.json|jsconfig\.json|\.eslintrc(\.(json|js|cjs|yaml|yml))?|eslint\.config\.(js|mjs|cjs|ts)|\.prettierrc(\.(json|js|cjs|yaml|yml))?|prettier\.config\.(js|mjs|cjs)|\.editorconfig|biome\.jsonc?)$/;

/** Paths that never leave the clone (env files, keys, credential stores). */
export const SENSITIVE_PATH_RE =
  /(^|\/)(\.env(\.[\w.-]*)?|\.npmrc|\.netrc|\.pypirc|id_rsa|id_dsa|id_ecdsa|id_ed25519|credentials(\.\w+)?|secrets?\.(json|ya?ml|toml))$|\.(pem|key|p12|pfx|jks|keystore|crt|cer)$/i;

/**
 * Secret-looking values. A matching value is replaced by REDACTED_MARK (the
 * line is kept, so line numbers still match) before anything is sent or stored.
 */
export const SECRET_PATTERNS: readonly RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\b(gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  /\b(sk|rk)_(live|test)_[A-Za-z0-9]{16,}\b/g,
  /\bsk-(ant-|proj-)?[A-Za-z0-9_-]{20,}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@'"]+:[^\s@/'"]+@/gi,
];

/** `password = "..."`-style assignments: group 1 = key + operator, group 2 = the quote. */
export const SECRET_ASSIGNMENT_RE =
  /((?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret)["']?\s*[:=]\s*)(["'])[^"'\s]{8,}\2/gi;

export const REDACTED_MARK = '[REDACTED]';
