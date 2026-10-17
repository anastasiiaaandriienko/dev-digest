import { describe, it, expect } from 'vitest';
import {
  canonicalInput,
  computeFingerprint,
  extractHunkHeaders,
  knownFiles,
  type FingerprintInput,
  type IntentFileInput,
} from '../src/modules/reviews/intent/fingerprint.js';
import { evaluateFreshness, isCacheHit } from '../src/modules/reviews/intent/freshness.js';
import { INTENT_PROMPT_VERSION } from '../src/modules/reviews/intent/constants.js';
import type { IntentRow } from '../src/modules/reviews/repository/intent.repo.js';

const PATCH_A = [
  '@@ -10,6 +10,8 @@ export function login(user: User) {',
  ' context line',
  '+added body line',
  '-removed body line',
  '@@ -40 +42,2 @@ class Session {',
  '+x',
].join('\n');

const fileA: IntentFileInput = { path: 'src/a.ts', additions: 2, deletions: 1, patch: PATCH_A };
const fileB: IntentFileInput = { path: 'src/b.ts', additions: 1, deletions: 0, patch: '@@ -1 +1 @@\n+y' };

const base = (over: Partial<FingerprintInput> = {}): FingerprintInput => ({
  title: 'Add login',
  body: 'Body text',
  headSha: 'sha1',
  base: 'main',
  files: [fileA, fileB],
  ...over,
});

describe('extractHunkHeaders', () => {
  it('keeps the full header including the function context, and no body lines', () => {
    expect(extractHunkHeaders(PATCH_A)).toEqual([
      '@@ -10,6 +10,8 @@ export function login(user: User) {',
      '@@ -40 +42,2 @@ class Session {',
    ]);
  });

  it('handles CRLF patches, empty and null', () => {
    expect(extractHunkHeaders(PATCH_A.replaceAll('\n', '\r\n'))).toHaveLength(2);
    expect(extractHunkHeaders(null)).toEqual([]);
    expect(extractHunkHeaders('')).toEqual([]);
  });

  it('does not treat a diff body line that merely contains @@ as a header', () => {
    expect(extractHunkHeaders('+@@ -1 +1 @@ not a header\n some @@ -1 +1 @@ text')).toEqual([]);
  });
});

describe('computeFingerprint', () => {
  it('is a stable sha256 hex', () => {
    expect(computeFingerprint(base())).toMatch(/^[0-9a-f]{64}$/);
    expect(computeFingerprint(base())).toBe(computeFingerprint(base()));
  });

  it('includes function context: only the context changing changes the hash', () => {
    const changed = { ...fileA, patch: PATCH_A.replace('login(user: User)', 'logout(user: User)') };
    expect(computeFingerprint(base({ files: [changed, fileB] }))).not.toBe(computeFingerprint(base()));
  });

  it('ignores diff body lines (only headers are hashed)', () => {
    const changed = { ...fileA, patch: PATCH_A.replace('+added body line', '+other body line') };
    expect(computeFingerprint(base({ files: [changed, fileB] }))).toBe(computeFingerprint(base()));
  });

  it('changes with the PR body, title, head_sha and base', () => {
    const h = computeFingerprint(base());
    expect(computeFingerprint(base({ body: 'Edited body' }))).not.toBe(h);
    expect(computeFingerprint(base({ title: 'Add logout' }))).not.toBe(h);
    expect(computeFingerprint(base({ headSha: 'sha2' }))).not.toBe(h);
    expect(computeFingerprint(base({ base: 'develop' }))).not.toBe(h);
  });

  it('does not depend on file order', () => {
    expect(computeFingerprint(base({ files: [fileB, fileA] }))).toBe(computeFingerprint(base()));
  });

  it('normalises CRLF and surrounding whitespace in title/body', () => {
    expect(computeFingerprint(base({ body: '  Line1\r\nLine2  ' }))).toBe(
      computeFingerprint(base({ body: 'Line1\nLine2' })),
    );
    expect(computeFingerprint(base({ body: null }))).toBe(computeFingerprint(base({ body: '' })));
  });

  it('uses files: null (and a different hash) when file data is unknown', () => {
    expect(canonicalInput(base({ files: null })).files).toBeNull();
    expect(computeFingerprint(base({ files: null }))).not.toBe(computeFingerprint(base()));
  });

  it('canonical payload has version 1 and no model / prompt version', () => {
    const c = canonicalInput(base());
    expect(Object.keys(c)).toEqual(['v', 'title', 'body', 'head_sha', 'base', 'files']);
    expect(c.v).toBe(1);
  });
});

describe('knownFiles', () => {
  it('is null when no pr_files are stored (absence of rows never means "no files")', () => {
    expect(knownFiles([])).toBeNull();
  });
  it('imported-but-never-opened PR (list sync stores files_count 0, no pr_files) is unknown, not an empty list', () => {
    // filesCount is 0 here and must not matter: knownFiles ignores it.
    expect(knownFiles([])).toBeNull();
    expect(computeFingerprint(base({ files: knownFiles([]) }))).toBe(computeFingerprint(base({ files: null })));
  });
  it('is the list when files are stored', () => {
    expect(knownFiles([fileA])).toEqual([fileA]);
  });
});

describe('evaluateFreshness / isCacheHit', () => {
  const model = { provider: 'openrouter', model: 'm1', source: 'fallback_onboarding' as const };
  const cur = {
    fingerprint: 'fp1',
    headSha: 'sha1',
    filesKnown: true,
    model,
  };
  const row = (over: Partial<IntentRow> = {}): IntentRow => ({
    prId: 'pr',
    intent: 'i',
    inScope: [],
    outOfScope: [],
    riskAreas: [],
    confidence: 'high',
    inputFingerprint: 'fp1',
    promptVersion: INTENT_PROMPT_VERSION,
    provider: 'openrouter',
    model: 'm1',
    headSha: 'sha1',
    inputSnapshotAt: new Date(),
    generatedAt: new Date(),
    tokensIn: 1,
    tokensOut: 1,
    costUsd: 0,
    ...over,
  });

  it('fresh when everything matches', () => {
    expect(evaluateFreshness(row(), cur)).toEqual({ freshness: 'fresh', stale_reasons: [] });
    expect(isCacheHit(row(), cur)).toBe(true);
  });

  it('pr_changed on a different fingerprint; legacy NULL fingerprint is stale', () => {
    expect(evaluateFreshness(row({ inputFingerprint: 'other' }), cur).stale_reasons).toEqual(['pr_changed']);
    const legacy = evaluateFreshness(row({ inputFingerprint: null, promptVersion: null, provider: null, model: null }), cur);
    expect(legacy.freshness).toBe('stale');
    expect(legacy.stale_reasons).toEqual(['pr_changed', 'prompt_changed', 'model_changed']);
  });

  it('prompt_changed and model_changed are reported separately', () => {
    expect(evaluateFreshness(row({ promptVersion: 'intent-v0' }), cur).stale_reasons).toEqual(['prompt_changed']);
    expect(evaluateFreshness(row({ model: 'm0' }), cur).stale_reasons).toEqual(['model_changed']);
    expect(evaluateFreshness(row({ provider: 'openai' }), cur).stale_reasons).toEqual(['model_changed']);
    expect(isCacheHit(row({ model: 'm0' }), cur)).toBe(false);
  });

  it('no model available: model_changed is not evaluated', () => {
    expect(evaluateFreshness(row(), { ...cur, model: null }).freshness).toBe('fresh');
  });

  it('files unknown: unknown unless head moved (pr_changed) or another definite reason', () => {
    const unknownCur = { ...cur, filesKnown: false, fingerprint: 'fp-null' };
    expect(evaluateFreshness(row(), unknownCur)).toEqual({ freshness: 'unknown', stale_reasons: [] });
    expect(evaluateFreshness(row(), { ...unknownCur, headSha: 'sha2' }).stale_reasons).toEqual(['pr_changed']);
    expect(evaluateFreshness(row({ model: 'm0' }), unknownCur).freshness).toBe('stale');
    // unknown inputs are never saved nor a cache hit (the service handles unknown files separately)
    expect(isCacheHit(row(), unknownCur)).toBe(false);
    expect(isCacheHit(row({ inputFingerprint: 'fp-null' }), unknownCur)).toBe(false);
  });

  it('no row: unknown, no reasons, no cache hit', () => {
    expect(evaluateFreshness(undefined, cur)).toEqual({ freshness: 'unknown', stale_reasons: [] });
    expect(isCacheHit(undefined, cur)).toBe(false);
  });
});
