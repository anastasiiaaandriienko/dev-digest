import type { CiExportInput, CiFile } from '@devdigest/shared';
import { ValidationError } from '../../platform/errors.js';
import { RUNNER_PACKAGE_JSON, RUNNER_PACKAGE_JSON_PATH, RUNNER_PATH, WORKFLOW_PATH } from './constants.js';
import { buildManifest, type ManifestAgent, type ManifestSkill } from './manifest.js';
import { assertEditedWorkflow, renderWorkflow, type WorkflowOptions } from './workflow.js';

/**
 * The exact Export-to-CI file set (FR-4, AC-CI-20): the manifest, one skill
 * file per enabled linked skill in link order, the runner bundle, the runner's
 * `package.json` (`{"type":"module"}`) and the workflow — nothing else (no memory.jsonl). Deterministic for the same agent
 * version and input: no timestamps, no randomness. Only the workflow is
 * editable (AC-CI-07); an edit from Preview replaces the generated text.
 */
export interface CiFileSetInput {
  agent: ManifestAgent;
  skills: readonly ManifestSkill[];
  input: Pick<CiExportInput, 'triggers' | 'post_as' | 'files'>;
  /** Contents of the built runner bundle (readRunnerBundle). */
  runnerBundle: string;
  /** Kept manifest path from the repo inspection (Q29); default `<slug>.yaml`. */
  manifestPath?: string;
  /** Test seam for the pinned actions. */
  actions?: WorkflowOptions['actions'];
}

export function buildCiFiles(args: CiFileSetInput): CiFile[] {
  const { agentSlug, files: manifestFiles } = buildManifest(args.agent, args.skills, args.manifestPath);
  const edited = workflowOverride(args.input.files);
  const workflow =
    edited ??
    renderWorkflow({
      triggers: args.input.triggers,
      postAs: args.input.post_as,
      agentSlug,
      agentVersion: args.agent.version,
      actions: args.actions,
    });
  return [
    ...manifestFiles,
    { path: RUNNER_PATH, contents: args.runnerBundle, editable: false },
    { path: RUNNER_PACKAGE_JSON_PATH, contents: RUNNER_PACKAGE_JSON, editable: false },
    { path: WORKFLOW_PATH, contents: workflow, editable: true },
  ];
}

/** The edited workflow, if Preview sent one; any other path is refused (only the workflow is editable). */
export function workflowOverride(files: readonly CiFile[] | undefined): string | null {
  if (!files || files.length === 0) return null;
  const others = files.filter((f) => f.path !== WORKFLOW_PATH);
  if (others.length > 0) {
    throw new ValidationError(`Only ${WORKFLOW_PATH} can be edited`, { paths: others.map((f) => f.path) });
  }
  if (files.length > 1) throw new ValidationError(`${WORKFLOW_PATH} was sent more than once`);
  const text = files[0]!.contents;
  assertEditedWorkflow(text);
  return text;
}
