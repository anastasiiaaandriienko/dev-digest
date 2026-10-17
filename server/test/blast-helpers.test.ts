import { describe, it, expect } from 'vitest';
import { BlastRadius } from '@devdigest/shared';
import {
  blastSummary,
  changedLinesByFile,
  emptyBlastRadius,
  githubBlobUrl,
  toBlastRadius,
} from '../src/modules/blast/helpers.js';
import type { BlastResult } from '../src/modules/repo-intel/types.js';

/** HW-04 Blast Radius — pure mapping from the repo-intel result to the shared contract. */

const RESULT: BlastResult = {
  changedSymbols: [{ file: 'server/src/modules/agents/helpers.ts', name: 'toAgentDto', kind: 'function', line: 10 }],
  downstream: [
    {
      name: 'toAgentDto',
      file: 'server/src/modules/agents/helpers.ts',
      callers: [
        { file: 'server/src/modules/agents/service.ts', symbol: 'list', viaSymbol: 'toAgentDto', line: 62, rank: 0.4 },
        { file: 'client/src/app/agents/[id]/page.tsx', symbol: 'Page', viaSymbol: 'toAgentDto', line: 7, rank: 0.1 },
      ],
      callerCount: 23,
      endpoints: ['GET /agents', 'POST /agents'],
      crons: ['job:sync'],
    },
  ],
  callers: [],
  impactedEndpoints: ['GET /agents', 'POST /agents'],
  ref: '45ce6b9adc1dbc433275cb6d79b8bc6000f127dd',
  degraded: false,
};

describe('changedLinesByFile', () => {
  it('maps each stored patch to its changed base lines; a file without a patch gets no entry', () => {
    expect(
      changedLinesByFile([
        { path: 'a.ts', patch: '@@ -10,3 +10,3 @@\n x\n-y\n+z\n w' },
        { path: 'big.ts', patch: null },
      ]),
    ).toEqual({ 'a.ts': [11] });
  });
});

describe('githubBlobUrl', () => {
  it('pins the link to the given commit and encodes each path segment', () => {
    expect(githubBlobUrl('acme/api', 'abc123', 'client/src/app/agents/[id]/page tsx.tsx', 7)).toBe(
      'https://github.com/acme/api/blob/abc123/client/src/app/agents/%5Bid%5D/page%20tsx.tsx#L7',
    );
    expect(githubBlobUrl('acme/api', 'abc123', 'a.ts')).toBe('https://github.com/acme/api/blob/abc123/a.ts');
  });

  it('returns null when the commit is unknown', () => {
    expect(githubBlobUrl('acme/api', '', 'a.ts', 3)).toBeNull();
  });
});

describe('toBlastRadius', () => {
  it('maps callers with file:line links to the INDEXED commit, totals and truncation', () => {
    const blast = toBlastRadius(RESULT, 'acme/dev-digest');

    expect(() => BlastRadius.parse(blast)).not.toThrow();
    expect(blast.source).toEqual({ repo_full_name: 'acme/dev-digest', ref: RESULT.ref });
    expect(blast.changed_symbols[0]).toMatchObject({
      name: 'toAgentDto',
      line: 10,
      url: `https://github.com/acme/dev-digest/blob/${RESULT.ref}/server/src/modules/agents/helpers.ts#L10`,
    });
    const impact = blast.downstream[0]!;
    expect(impact.callers[0]).toEqual({
      name: 'list',
      file: 'server/src/modules/agents/service.ts',
      line: 62,
      url: `https://github.com/acme/dev-digest/blob/${RESULT.ref}/server/src/modules/agents/service.ts#L62`,
    });
    expect(impact).toMatchObject({ caller_count: 23, truncated: true, endpoints_affected: ['GET /agents', 'POST /agents'] });
    expect(blast.totals).toEqual({ symbols: 1, callers: 23, endpoints: 2, crons: 1 });
    expect(blast).toMatchObject({ degraded: false, reason: null });
    expect(blast.summary).toBe('1 changed symbol, 23 callers; potentially affected: 2 endpoints, 1 cron/job.');
  });

  it('keeps a degraded result honest: reason + note in the summary, no links without a commit', () => {
    const blast = toBlastRadius({ ...RESULT, ref: '', degraded: true, reason: 'no_data' }, 'acme/dev-digest');

    expect(blast).toMatchObject({ degraded: true, reason: 'no_data' });
    expect(blast.summary).toContain('not indexed yet');
    expect(blast.downstream[0]!.callers.every((c) => c.url === null)).toBe(true);
  });

  it('marks a degraded result without a reason as no_data', () => {
    expect(toBlastRadius({ ...RESULT, degraded: true }, 'a/b').reason).toBe('no_data');
  });
});

describe('emptyBlastRadius / blastSummary', () => {
  it('describes a PR without stored files as degraded no_files', () => {
    const blast = emptyBlastRadius('acme/api', 'no_files');
    expect(() => BlastRadius.parse(blast)).not.toThrow();
    expect(blast).toMatchObject({ changed_symbols: [], downstream: [], degraded: true, reason: 'no_files' });
    expect(blast.summary).toContain('No changed symbols');
  });

  it('distinguishes "no symbols" from "symbols without callers"', () => {
    expect(blastSummary({ symbols: 2, callers: 0, endpoints: 0, crons: 0 }, null)).toBe(
      '2 changed symbols, no downstream callers found.',
    );
  });

  it('rejects an unknown degraded reason at the contract', () => {
    expect(() => BlastRadius.parse({ ...emptyBlastRadius('a/b', 'no_files'), reason: 'oops' })).toThrow();
  });
});
