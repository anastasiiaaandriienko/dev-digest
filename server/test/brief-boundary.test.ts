import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SRC = resolve(__dirname, '../src');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe('brief module boundary', () => {
  it('AC-BRIEF-28 no brief file imports context/constants', () => {
    const files = walk(join(SRC, 'modules/brief')).filter((f) => f.endsWith('.ts'));
    const seed = join(SRC, 'db/seed-brief.ts');
    if (existsSync(seed)) files.push(seed);
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const imports = readFileSync(f, 'utf8')
        .split('\n')
        .filter((l) => /^\s*(import|export)\b.*\bfrom\b|^\s*import\s*\(/.test(l) || /import\(/.test(l));
      for (const line of imports) expect(line, f).not.toMatch(/context\/constants/);
    }
  });
});
