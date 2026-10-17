import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Dependency direction (onion-architecture skill, applied to this small package):
 * only the composition root and the MCP layer touch the SDK / transport; tool
 * handlers and the pure helpers reach the API only through DevDigestApi; no
 * module imports outward and there are no import cycles.
 */
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sourceFiles(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : [],
  );
}

const files = sourceFiles(SRC);
const rel = (abs: string) => relative(SRC, abs).replace(/\\/g, '/');
const importsOf = (abs: string): string[] =>
  [...readFileSync(abs, 'utf8').matchAll(/^import\s[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]!);
/** Relative imports resolved to src-relative paths (".js" → ".ts"). */
const localImports = (abs: string): string[] =>
  importsOf(abs)
    .filter((s) => s.startsWith('.'))
    .map((s) => rel(resolve(dirname(abs), s.replace(/\.js$/, '.ts'))));

const graph = new Map(files.map((f) => [rel(f), localImports(f)]));

describe('dependency direction', () => {
  it('only index.ts and server.ts import the MCP SDK', () => {
    const users = files.filter((f) => importsOf(f).some((s) => s.startsWith('@modelcontextprotocol/'))).map(rel);
    expect(users.sort()).toEqual(['index.ts', 'server.ts']);
  });

  it('tool handlers and helpers never import the transport, the HTTP client or the entry points', () => {
    const inner = [...graph.keys()].filter((f) => f.startsWith('tools/') || ['findings.ts', 'tool-result.ts', 'errors.ts', 'api-schemas.ts'].includes(f));
    for (const f of inner) {
      expect(graph.get(f), f).not.toContain('api-client.ts');
      expect(graph.get(f), f).not.toContain('index.ts');
      expect(graph.get(f), f).not.toContain('server.ts');
    }
  });

  it('only devdigest-api.ts knows API paths (tools never build URLs)', () => {
    for (const f of files.filter((x) => rel(x).startsWith('tools/'))) {
      const code = readFileSync(f, 'utf8');
      expect(code, rel(f)).not.toMatch(/\.(get|post)\(\s*[`'"]\//);
      expect(code, rel(f)).not.toMatch(/\bfetch\(/);
    }
  });

  it('errors.ts and api-schemas.ts are leaves (no local imports)', () => {
    expect(graph.get('errors.ts')).toEqual([]);
    expect(graph.get('api-schemas.ts')).toEqual([]);
  });

  it('has no import cycles', () => {
    const state = new Map<string, 'visiting' | 'done'>();
    const cycles: string[] = [];
    const visit = (n: string, path: string[]) => {
      if (state.get(n) === 'done') return;
      if (state.get(n) === 'visiting') {
        cycles.push([...path.slice(path.indexOf(n)), n].join(' → '));
        return;
      }
      state.set(n, 'visiting');
      for (const m of graph.get(n) ?? []) visit(m, [...path, n]);
      state.set(n, 'done');
    };
    for (const n of graph.keys()) visit(n, []);
    expect(cycles).toEqual([]);
  });
});
