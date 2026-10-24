import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Db } from '../src/db/client.js';
import { Container } from '../src/platform/container.js';
import { loadConfig } from '../src/platform/config.js';
import { MockSecretsProvider } from '../src/adapters/mocks.js';
import { ReviewRepository } from '../src/modules/reviews/repository.js';
import { ReviewService } from '../src/modules/reviews/service.js';

/**
 * L07 B15 — POST /runs/:id/cancel is workspace-scoped. No DB: the repository
 * and the run bus are spied, so these tests prove that a run of another
 * workspace, a missing run and a CI run get `false` before ANY side effect
 * (event, bus flag, DB write), and that a local run of the caller's workspace
 * is cancelled exactly as before. The real rows are checked in
 * run-cancel-scope.it.test.ts.
 */

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
const RUN = '00000000-0000-4000-8000-0000000000c1';
const SIBLING = '00000000-0000-4000-8000-0000000000c2';

/** `source` as the DB would answer for (workspace, run); undefined = no such run here. */
function setup(sourceFor: (workspaceId: string, runId: string) => 'local' | 'ci' | undefined) {
  const container = new Container(config(), {} as Db, { secrets: new MockSecretsProvider({}) });
  const getRunSource = vi
    .spyOn(ReviewRepository.prototype, 'getRunSource')
    .mockImplementation(async (ws, id) => sourceFor(ws, id));
  const cancelRunIfRunning = vi.spyOn(ReviewRepository.prototype, 'cancelRunIfRunning').mockResolvedValue(true);
  const bus = {
    publish: vi.spyOn(container.runBus, 'publish'),
    cancel: vi.spyOn(container.runBus, 'cancel'),
    complete: vi.spyOn(container.runBus, 'complete'),
  };
  return { service: new ReviewService(container), container, getRunSource, cancelRunIfRunning, bus };
}

function expectUntouched(s: ReturnType<typeof setup>) {
  expect(s.cancelRunIfRunning).not.toHaveBeenCalled();
  expect(s.bus.publish).not.toHaveBeenCalled();
  expect(s.bus.cancel).not.toHaveBeenCalled();
  expect(s.bus.complete).not.toHaveBeenCalled();
}

describe('ReviewService.cancelRun — workspace scope', () => {
  afterEach(() => vi.restoreAllMocks());

  it('a local run of the caller\'s workspace is cancelled as before (→ true, i.e. { ok: true })', async () => {
    const s = setup((ws) => (ws === 'ws' ? 'local' : undefined));
    await expect(s.service.cancelRun('ws', RUN)).resolves.toBe(true);
    expect(s.getRunSource).toHaveBeenCalledWith('ws', RUN);
    expect(s.bus.publish).toHaveBeenCalledWith(RUN, 'info', 'Cancellation requested — stopping…', undefined);
    expect(s.bus.cancel).toHaveBeenCalledWith(RUN);
    expect(s.cancelRunIfRunning).toHaveBeenCalledWith(RUN);
    expect(s.bus.complete).toHaveBeenCalledWith(RUN);
    // The workspace check comes first, then the existing cancel sequence.
    expect(s.getRunSource.mock.invocationCallOrder[0]).toBeLessThan(s.bus.cancel.mock.invocationCallOrder[0]!);
  });

  it('a run of another workspace reads as missing: false ({ ok: false }) and nothing is touched', async () => {
    const s = setup((ws) => (ws === 'other' ? 'local' : undefined));
    await expect(s.service.cancelRun('ws', RUN)).resolves.toBe(false);
    expect(s.getRunSource).toHaveBeenCalledWith('ws', RUN);
    expectUntouched(s);
  });

  it('a non-existent run: false ({ ok: false }) and nothing is touched', async () => {
    const s = setup(() => undefined);
    await expect(s.service.cancelRun('ws', RUN)).resolves.toBe(false);
    expectUntouched(s);
  });

  it('a CI run of the caller\'s workspace is not cancelled like a local one: false, no event, flag or DB write', async () => {
    const s = setup(() => 'ci');
    await expect(s.service.cancelRun('ws', RUN)).resolves.toBe(false);
    expectUntouched(s);
  });

  it('cancelling one run of a multi-agent run leaves its sibling alone', async () => {
    const s = setup(() => 'local');
    await s.service.cancelRun('ws', RUN);
    expect(s.cancelRunIfRunning).toHaveBeenCalledTimes(1);
    expect(s.cancelRunIfRunning).toHaveBeenCalledWith(RUN);
    expect(s.bus.cancel).toHaveBeenCalledTimes(1);
    expect(s.bus.publish.mock.calls.every(([id]) => id === RUN)).toBe(true);
    expect(s.bus.complete.mock.calls.every(([id]) => id === RUN)).toBe(true);
    expect(s.container.runBus.isCancelled(SIBLING)).toBe(false);
  });
});
