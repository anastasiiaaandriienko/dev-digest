import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assemblePrompt, wrapUntrusted } from '@devdigest/reviewer-core';
import {
  CONTEXT_NOT_ISOLATED_LINE,
  buildProjectContext,
  contextLogLine,
  redactAssemblyForTrace,
} from '../src/modules/context/for-run.js';
import { USER_OMITTED_PLACEHOLDER, placeholderLine } from '../src/modules/context/constants.js';
import { readContextDoc } from '../src/modules/context/read.js';
import type { ContextAttachmentRow, ProjectContextInput } from '../src/modules/context/types.js';

const MARKER = 'UNIQUE-MARKER-7f3a';
const count = (t: string): number => Math.ceil(t.length / 4);

let root: string;
let canSymlink = true;

const rowOf = (path: string, order: number, ownerId = 'a1'): ContextAttachmentRow => ({
  id: `${ownerId}-${order}`,
  ownerId,
  repoId: 'r1',
  path,
  order,
});

const input = (over: Partial<ProjectContextInput> = {}): ProjectContextInput => ({
  roots: null,
  agent: [],
  skills: [],
  ...over,
});

const write = async (rel: string, content: string | Buffer): Promise<void> => {
  const full = join(root, ...rel.split('/'));
  await mkdir(join(full, '..'), { recursive: true });
  await writeFile(full, content);
};

const build = (inp: ProjectContextInput, cloneRoot: string | null = root, readDoc?: typeof readContextDoc) =>
  buildProjectContext(inp, { cloneRoot, count, ...(readDoc ? { readDoc } : {}) });

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'ctx-for-run-')));
  await write('docs/a.md', `A line\n${MARKER}\n`);
  await write('docs/b.md', 'B body\n');
  await write('specs/s.md', 'Skill spec\n');
  await write('docs/bin.md', Buffer.from([0x23, 0x20, 0x00, 0x01, 0x0a]));
  await write('docs/big.md', `${'x'.repeat(100)}\n`.repeat(400)); // ~40 KB
  await write('docs/long.md', 'a'.repeat(33_000));
  await write('docs/tokens.md', `${'y'.repeat(99)}\n`.repeat(200)); // ~20 KB ≈ 5000 tokens
  for (let i = 0; i < 5; i++) await write(`docs/fat${i}.md`, `${'z'.repeat(14_999)}\n`);
  await write('docs/small.md', 'small\n');
  await write('docs/many.md', 'm\n');
  await write('outside/o.md', 'out\n');
  try {
    await mkdir(join(root, 'docs', 'real'), { recursive: true });
    await write('docs/real/t.md', 'target\n');
    await symlink(join(root, 'docs', 'real', 't.md'), join(root, 'docs', 'link.md'));
    await symlink(join(root, 'docs', 'real'), join(root, 'docs', 'linkdir'), 'dir');
  } catch {
    canSymlink = false;
  }
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('buildProjectContext', () => {
  it('AC-CTX-21 agent rows in order, entries become specs[] in injection order', async () => {
    const ctx = await build(input({ agent: [rowOf('docs/b.md', 1), rowOf('docs/a.md', 0)] }));
    expect(ctx.specsRead).toEqual(['docs/a.md', 'docs/b.md']);
    expect(ctx.specs).toHaveLength(2);
    expect(ctx.blocks.map((b) => b.status)).toEqual(['read', 'read']);
  });

  it('AC-CTX-16 skill docs come after the agent docs, skills in the given order', async () => {
    const ctx = await build(
      input({
        agent: [rowOf('docs/a.md', 0)],
        skills: [
          { skillId: 's1', rows: [rowOf('specs/s.md', 0, 's1')] },
          { skillId: 's2', rows: [rowOf('docs/b.md', 0, 's2')] },
        ],
      }),
    );
    expect(ctx.specsRead).toEqual(['docs/a.md', 'specs/s.md', 'docs/b.md']);
    expect(ctx.blocks.map((b) => [b.source, b.skill_id ?? null])).toEqual([
      ['agent', null],
      ['skill', 's1'],
      ['skill', 's2'],
    ]);
  });

  it('AC-CTX-56 a repeated path is injected once; later occurrences are skipped duplicate', async () => {
    const ctx = await build(
      input({
        agent: [rowOf('docs/a.md', 0)],
        skills: [{ skillId: 's1', rows: [rowOf('docs/a.md', 0, 's1'), rowOf('docs/b.md', 1, 's1')] }],
      }),
    );
    expect(ctx.specsRead).toEqual(['docs/a.md', 'docs/b.md']);
    expect(ctx.blocks[1]).toMatchObject({ path: 'docs/a.md', source: 'skill', status: 'skipped', reason: 'duplicate' });
  });

  it('AC-CTX-59 only the first 10 rows by order are used; the rest are skipped attachment limit', async () => {
    const rows = Array.from({ length: 12 }, (_, i) => rowOf(i === 11 ? 'docs/b.md' : 'docs/many.md', i));
    const ctx = await build(input({ agent: rows.reverse() }));
    expect(ctx.blocks).toHaveLength(12);
    expect(ctx.blocks.filter((b) => b.reason === 'attachment limit')).toHaveLength(2);
    // the last two by order are the skipped ones (order 10 and 11)
    expect(ctx.blocks.slice(10).every((b) => b.reason === 'attachment limit')).toBe(true);
    expect(ctx.summary.attached).toBe(12);
  });

  it('AC-CTX-25 each entry starts with the line "path: <normalized path>"', async () => {
    const ctx = await build(input({ agent: [rowOf('docs/a.md', 0)] }));
    expect(ctx.specs[0]!.startsWith('path: docs/a.md\n\n')).toBe(true);
    expect(ctx.specs[0]).toContain(MARKER);
  });

  it('AC-CTX-24 an entry over 4000 tokens drops whole trailing lines and ends with the marker', async () => {
    const ctx = await build(input({ agent: [rowOf('docs/tokens.md', 0)] }));
    const entry = ctx.reads[0]!;
    expect(entry.truncated).toBe(true);
    expect(entry.tokens).toBeLessThanOrEqual(4000);
    expect(entry.text.endsWith('[… truncated: project-context size limit]')).toBe(true);
    const body = entry.text.slice('path: docs/tokens.md\n\n'.length, -'\n[… truncated: project-context size limit]'.length);
    const lines = body.split('\n');
    expect(lines.length).toBeLessThan(200);
    expect(lines.every((l) => l === 'y'.repeat(99))).toBe(true);
    expect(ctx.blocks[0]).toMatchObject({ status: 'read', tokens: entry.tokens, truncated: true });
  });

  it('AC-CTX-41 the first entry that does not fit and all later ones are skipped budget exhausted', async () => {
    const ctx = await build(
      input({
        agent: ['fat0', 'fat1', 'fat2', 'fat3', 'small'].map((n, i) => rowOf(`docs/${n}.md`, i)),
      }),
    );
    expect(ctx.blocks.map((b) => b.status)).toEqual(['read', 'read', 'read', 'skipped', 'skipped']);
    expect(ctx.blocks[3]!.reason).toBe('budget exhausted');
    // the small doc would fit, but there is no skip-and-continue
    expect(ctx.blocks[4]).toMatchObject({ path: 'docs/small.md', reason: 'budget exhausted' });
    expect(ctx.summary.tokens).toBeLessThanOrEqual(12_000);
  });

  it('AC-CTX-66 a doc over 32 KB is cut at the last newline and marked truncated', async () => {
    const ctx = await build(input({ agent: [rowOf('docs/big.md', 0)] }));
    expect(ctx.blocks[0]).toMatchObject({ status: 'read', truncated: true });
    const body = ctx.reads[0]!.text.slice('path: docs/big.md\n\n'.length);
    expect(body.length).toBeLessThanOrEqual(32_768);
  });

  it('AC-CTX-74 no newline in the first 32 KB: skipped single line longer than the limit', async () => {
    const ctx = await build(input({ agent: [rowOf('docs/long.md', 0)] }));
    expect(ctx.blocks[0]).toMatchObject({ status: 'skipped', reason: 'single line longer than the limit' });
    expect(ctx.specs).toEqual([]);
  });

  it('AC-CTX-28 absolute and traversal paths are skipped without a read', async () => {
    const reads: string[] = [];
    const spy: typeof readContextDoc = async (...a) => {
      reads.push(a[1]);
      return readContextDoc(...a);
    };
    const ctx = await build(
      input({ agent: [rowOf('/etc/passwd', 0), rowOf('docs/../../x.md', 1), rowOf('C:/x.md', 2)] }),
      root,
      spy,
    );
    expect(ctx.blocks.map((b) => b.reason)).toEqual(['absolute path', 'path traversal', 'absolute path']);
    expect(reads).toEqual([]);
  });

  it('AC-CTX-29 symlinked file and symlinked folder are skipped', async (c) => {
    // Creating symlinks needs a privilege on Windows; skip when the fixture could not be made.
    if (!canSymlink) c.skip();
    const ctx = await build(input({ agent: [rowOf('docs/link.md', 0), rowOf('docs/linkdir/t.md', 1)] }));
    expect(ctx.blocks.map((b) => b.status)).toEqual(['skipped', 'skipped']);
    expect(ctx.specs).toEqual([]);
  });

  it('AC-CTX-38 a file deleted after attaching is recorded missing and the build finishes', async () => {
    const ctx = await build(input({ agent: [rowOf('docs/gone.md', 0), rowOf('docs/b.md', 1)] }));
    expect(ctx.blocks[0]).toMatchObject({ path: 'docs/gone.md', status: 'missing' });
    expect(ctx.blocks[0]!.reason).toBeUndefined();
    expect(ctx.specsRead).toEqual(['docs/b.md']);
    expect(ctx.summary.missing).toBe(1);
  });

  it('AC-CTX-40 a binary doc is skipped with that reason', async () => {
    const ctx = await build(input({ agent: [rowOf('docs/bin.md', 0)] }));
    expect(ctx.blocks[0]).toMatchObject({ status: 'skipped', reason: 'binary file' });
  });

  it('AC-CTX-54 no clone: every attachment skipped repo not cloned, nothing read', async () => {
    const ctx = await build(
      input({ agent: [rowOf('docs/a.md', 0)], skills: [{ skillId: 's1', rows: [rowOf('docs/b.md', 0, 's1')] }] }),
      null,
    );
    expect(ctx.blocks.map((b) => [b.status, b.reason])).toEqual([
      ['skipped', 'repo not cloned'],
      ['skipped', 'repo not cloned'],
    ]);
    expect(ctx.specs).toEqual([]);
  });

  it('AC-CTX-60 a path outside the current roots is skipped without a read', async () => {
    const reads: string[] = [];
    const spy: typeof readContextDoc = async (...a) => {
      reads.push(a[1]);
      return readContextDoc(...a);
    };
    const ctx = await build(
      input({ roots: ['specs'], agent: [rowOf('outside/o.md', 0), rowOf('docs/a.md', 1), rowOf('specs/s.md', 2)] }),
      root,
      spy,
    );
    expect(ctx.blocks.map((b) => b.reason ?? b.status)).toEqual(['outside roots', 'outside roots', 'read']);
    expect(reads).toEqual(['specs/s.md']);
  });

  it('AC-CTX-63 the worktree (default-branch) version is injected', async () => {
    await write('docs/changed.md', 'default branch version\n');
    const ctx = await build(input({ agent: [rowOf('docs/changed.md', 0)] }));
    expect(ctx.specs[0]).toContain('default branch version');
  });

  it('AC-CTX-64 a doc that exists only in the PR head is missing in the worktree', async () => {
    const ctx = await build(input({ agent: [rowOf('docs/pr-head-only.md', 0)] }));
    expect(ctx.blocks[0]).toMatchObject({ status: 'missing' });
  });

  it('AC-CTX-34 blocks hold path/source/skill_id/status/reason/tokens/truncated and no doc content', async () => {
    const ctx = await build(
      input({
        agent: [rowOf('docs/a.md', 0), rowOf('docs/gone.md', 1)],
        skills: [{ skillId: 's1', rows: [rowOf('docs/a.md', 0, 's1')] }],
      }),
    );
    expect(ctx.blocks[0]).toEqual({
      path: 'docs/a.md',
      source: 'agent',
      status: 'read',
      tokens: ctx.reads[0]!.tokens,
      truncated: false,
    });
    expect(ctx.blocks[1]).toEqual({ path: 'docs/gone.md', source: 'agent', status: 'missing' });
    expect(ctx.blocks[2]).toEqual({
      path: 'docs/a.md',
      source: 'skill',
      skill_id: 's1',
      status: 'skipped',
      reason: 'duplicate',
    });
    expect(JSON.stringify(ctx.blocks)).not.toContain(MARKER);
  });

  it('AC-CTX-65 summary has counts, total tokens and the L4-L7 limits', async () => {
    const ctx = await build(input({ agent: [rowOf('docs/a.md', 0), rowOf('docs/gone.md', 1), rowOf('docs/bin.md', 2)] }));
    expect(ctx.summary).toEqual({
      attached: 3,
      read: 1,
      missing: 1,
      skipped: 1,
      truncated: 0,
      tokens: ctx.reads[0]!.tokens,
      limits: { doc_bytes: 32_768, doc_tokens: 4000, prompt_tokens: 12_000, attachments: 10 },
    });
  });

  it('AC-CTX-36 log line has the agreed shape and no doc text', async () => {
    const ctx = await build(input({ agent: [rowOf('docs/a.md', 0), rowOf('docs/gone.md', 1), rowOf('docs/bin.md', 2)] }));
    const line = contextLogLine(ctx.summary);
    expect(line).toBe(`context: attached 1 doc(s) (${ctx.summary.tokens} tokens), skipped 1, truncated 0`);
    expect(line).not.toContain(MARKER);
  });
});

describe('redactAssemblyForTrace', () => {
  const assembled = async (paths: string[]) => {
    const ctx = await build(input({ agent: paths.map((p, i) => rowOf(p, i)) }));
    const a = assemblePrompt({
      system: 'sys',
      specs: ctx.specs,
      task: 'Review PR #1',
      diff: 'diff --git a/x b/x\n+added line',
    });
    return { ctx, a };
  };

  it('AC-CTX-72 persisted specs are the placeholders wrapped per doc; user holds the same block', async () => {
    const { ctx, a } = await assembled(['docs/a.md', 'docs/b.md']);
    const out = redactAssemblyForTrace(a.assembly, ctx, count);
    const expected = ctx.reads
      .map((r, i) => wrapUntrusted(`spec-${i}`, placeholderLine(r.path, r.tokens, r.truncated)))
      .join('\n\n');
    expect(out.isolated).toBe(true);
    expect(out.assembly.specs).toBe(expected);
    expect(out.assembly.specs).toContain(
      `[project-context omitted from trace] path=docs/a.md tokens=${ctx.reads[0]!.tokens} truncated=false`,
    );
    expect(out.assembly.user).toContain(`## Project context\n${expected}`);
    expect(JSON.stringify(out.assembly)).not.toContain(MARKER);
    // the rest of user is byte-identical
    expect(out.assembly.user).toBe(
      a.assembly.user.replace(`## Project context\n${a.assembly.specs}`, `## Project context\n${expected}`),
    );
    expect(out.assembly.system).toBe(a.assembly.system);
  });

  it('AC-CTX-35 specs_tokens counts the section as sent (full text); null when absent', async () => {
    const { ctx, a } = await assembled(['docs/a.md']);
    const out = redactAssemblyForTrace(a.assembly, ctx, count);
    expect(out.assembly.specs_tokens).toBe(count(`## Project context\n${a.assembly.specs}`));
    const none = await build(input({ agent: [rowOf('docs/gone.md', 0)] }));
    const base = assemblePrompt({ system: 'sys', diff: 'd' });
    expect(redactAssemblyForTrace(base.assembly, none, count).assembly.specs_tokens).toBeNull();
  });

  it('AC-CTX-23 no doc read: specs and user stay as the baseline (no Project context)', async () => {
    const none = await build(input({ agent: [rowOf('docs/gone.md', 0)] }));
    expect(none.specs).toEqual([]);
    const base = assemblePrompt({ system: 'sys', task: 't', diff: 'd' });
    const out = redactAssemblyForTrace(base.assembly, none, count);
    expect(out.assembly.specs).toBeNull();
    expect(out.assembly.user).toBe(base.assembly.user);
    expect(out.assembly.user).not.toContain('## Project context');
    expect(out.assembly.spec_blocks).toHaveLength(1);
  });

  it('AC-CTX-73 section not found: user is the fail-closed placeholder, specs still placeholders', async () => {
    const { ctx, a } = await assembled(['docs/a.md']);
    const broken = { ...a.assembly, user: 'no section here' };
    const out = redactAssemblyForTrace(broken, ctx, count);
    expect(out.isolated).toBe(false);
    expect(out.assembly.user).toBe(USER_OMITTED_PLACEHOLDER);
    expect(JSON.stringify(out.assembly)).not.toContain(MARKER);
    expect(CONTEXT_NOT_ISOLATED_LINE).not.toContain(MARKER);
  });

  it('AC-CTX-73 residual doc text outside the section: fail closed', async () => {
    const { ctx, a } = await assembled(['docs/a.md']);
    const entry = ctx.reads[0]!.text;
    // a forged earlier copy of the whole entry in the user prompt
    const forged = { ...a.assembly, user: `${entry}\n\n${a.assembly.user}` };
    const out = redactAssemblyForTrace(forged, ctx, count);
    expect(out.isolated).toBe(false);
    expect(out.assembly.user).toBe(USER_OMITTED_PLACEHOLDER);
    expect(JSON.stringify(out.assembly)).not.toContain(MARKER);
  });
});
