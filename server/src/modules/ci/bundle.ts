import { readFile as fsReadFile } from 'node:fs/promises';
import { AppError } from '../../platform/errors.js';

/**
 * The built runner bundle (`agent-runner/dist/index.js`, located by
 * `AppConfig.ciRunnerBundlePath`, TA1) — copied byte-for-byte into the export
 * as `.devdigest/runner/index.js` (AC-CI-26). The only file-system read of the
 * ci module. No size gate (Q26: the size is measured, AC-CI-85).
 */

export type ReadText = (path: string, encoding: 'utf8') => Promise<string>;

export async function readRunnerBundle(path: string, readFile: ReadText = fsReadFile): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new AppError(
        'ci_runner_bundle_missing',
        'The CI runner bundle is not built. Run `cd agent-runner && pnpm build`, then try again.',
        500,
        { path },
      );
    }
    throw err;
  }
}
