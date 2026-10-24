import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { PromptSkill } from '@devdigest/reviewer-core';
import { RunnerError } from './errors.js';

/**
 * Placeholder `PromptSkill.version` for skills loaded from the checked-in
 * `.devdigest/skills/<slug>.md` files. `AgentManifest.skills` carries slugs
 * only — no versions — and `PromptSkill.version` is a required number with no
 * default, so the runner cannot know the studio version a body came from.
 * `0` means "unversioned": studio skill versions start at 1, so it never
 * passes for a real version. Rendered into the prompt as `version="0"`.
 */
export const UNVERSIONED_SKILL = 0;

/**
 * Loads the checked-in `.devdigest/skills/<slug>.md` bodies referenced by the
 * manifest's `skills` slugs, in order, as RESOLVED `PromptSkill`s (the slug
 * is the name) — `reviewPullRequest` (reviewer-core) takes `{ name, version,
 * body }`, exactly like the studio resolves slugs to DB rows before calling
 * the same engine (AC-36 parity: both callers hand the engine already-resolved
 * skills).
 */
export function loadSkillBodies(
  devdigestDir: string,
  slugs: readonly string[],
  readFile: typeof readFileSync = readFileSync,
): PromptSkill[] {
  return slugs.map((slug) => {
    const skillPath = path.join(devdigestDir, 'skills', `${slug}.md`);
    try {
      return { name: slug, version: UNVERSIONED_SKILL, body: readFile(skillPath, 'utf8') };
    } catch (err) {
      throw new RunnerError(
        `Skill file for slug '${slug}' not found at ${skillPath}: ${(err as Error).message}`,
      );
    }
  });
}
