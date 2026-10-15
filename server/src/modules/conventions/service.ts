import type {
  ConventionCandidate,
  ConventionScan,
  ConventionScanRequest,
  ConventionSkillCreate,
  ConventionSkillDraft,
  ConventionSkillResult,
  ConventionStatus,
  ConventionsState,
  ConventionUpdate,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { ConfigError, ConflictError, NotFoundError, ValidationError } from '../../platform/errors.js';
import { withTimeout } from '../../platform/resilience.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { toSkillDto } from '../skills/helpers.js';
import { MAX_REJECTED_IN_PROMPT, SAMPLE_TOP_FILES, SCAN_TIMEOUT_MS } from './constants.js';
import { buildSkillDraft, groundCandidates, toConventionDto, toScanDto } from './helpers.js';
import { buildExtractionMessages, ConventionExtraction, SCHEMA_NAME } from './prompt.js';
import { ConventionsRepository, type ScanRepo } from './repository.js';
import { selectConventionSamples } from './samples.js';

/** A started scan; `done` settles when the background work has finished (tests await it). */
export interface StartedScan {
  scan: ConventionScan;
  done: Promise<void>;
}

/**
 * Conventions Extractor (HW2 #38–#42): scan a repo → grounded candidate rules
 * → Accept / Reject / Edit → a `repo-conventions` skill (optionally attached
 * to an agent). Scans run in the background; their state lives in
 * `convention_scans`, so a reload, a failure or a restart never loses it.
 */
export class ConventionsService {
  private repo: ConventionsRepository;

  constructor(private container: Container) {
    this.repo = new ConventionsRepository(container.db);
  }

  private async scanRepo(workspaceId: string, repoId: string): Promise<ScanRepo> {
    const repo = await this.repo.getRepo(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repo not found');
    return repo;
  }

  /**
   * POST /repos/:id/conventions/extract. "Run Scan" (`rescan: false`) is for a
   * repo never scanned successfully; "ReScan" re-runs it. One scan per repo at
   * a time (409). The model call happens in the background.
   */
  async startScan(workspaceId: string, repoId: string, req: ConventionScanRequest): Promise<StartedScan> {
    const repo = await this.scanRepo(workspaceId, repoId);
    const latest = await this.repo.latestScan(workspaceId, repoId);
    if (latest?.status === 'running') throw new ConflictError('A conventions scan is already running for this repo');
    if (!req.rescan && latest?.status === 'done') {
      throw new ConflictError('This repo was already scanned; use ReScan to run it again');
    }
    const scan = await this.repo.startScan(workspaceId, repoId);
    if (!scan) throw new ConflictError('A conventions scan is already running for this repo');
    const done = this.runScan(workspaceId, repo, scan.id).catch(async (err) => {
      // Last resort: never leave a scan `running` because of an unexpected error.
      await this.repo.failScan(scan.id, (err as Error).message).catch(() => undefined);
    });
    return { scan: toScanDto(scan), done };
  }

  /** The extraction itself; every failure ends the scan as `failed` with a reason and changes no candidate. */
  private async runScan(workspaceId: string, repo: ScanRepo, scanId: string): Promise<void> {
    const fail = (message: string) => this.repo.failScan(scanId, message);

    // Settings > Models → "Conventions" (HW2 #53); the registry default otherwise.
    const { provider, model } = await resolveFeatureModel(this.container, workspaceId, 'conventions');
    await this.repo.updateScan(scanId, { provider, model });

    if (!repo.clonePath) return fail('The repository is not cloned yet');
    let ranked: string[] = [];
    try {
      ranked = await this.container.repoIntel.getConventionSamples(repo.id, SAMPLE_TOP_FILES);
    } catch {
      ranked = []; // repo-intel degrades: config files alone can still be sampled
    }
    const samples = await selectConventionSamples(repo.clonePath, ranked);
    const sampleFiles = samples.files.map((f) => f.path);
    await this.repo.updateScan(scanId, { sampleFiles });
    if (!samples.files.some((f) => f.kind === 'source')) {
      return fail('No source files to sample: index the repository first (repo-intel covers JS/TS files)');
    }

    let llm;
    try {
      llm = await this.container.llm(provider);
    } catch (err) {
      if (err instanceof ConfigError) return fail(`${err.message} (needed by Settings > Models > Conventions)`);
      throw err;
    }
    const rejected = await this.repo.rejectedRules(workspaceId, repo.id, MAX_REJECTED_IN_PROMPT);
    let result;
    try {
      result = await withTimeout(
        llm.completeStructured({
          model,
          schema: ConventionExtraction,
          schemaName: SCHEMA_NAME,
          messages: buildExtractionMessages(repo.fullName, samples.files, rejected),
          temperature: 0,
          maxRetries: 1,
          timeoutMs: SCAN_TIMEOUT_MS,
        }),
        SCAN_TIMEOUT_MS + 5_000,
      );
    } catch (err) {
      return fail(`The model call failed: ${(err as Error).message}`);
    }

    const grounded = groundCandidates(result.data.candidates, samples.files);
    const cost = result.costUsd ?? this.container.priceBook.estimate(model, result.tokensIn, result.tokensOut);
    await this.repo.completeScan(workspaceId, repo.id, scanId, grounded.candidates, {
      model: result.model || model,
      candidatesFound: result.data.candidates.length,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      costUsd: cost,
    });
  }

  /** GET /repos/:id/conventions — rejected candidates only when asked for. */
  async state(workspaceId: string, repoId: string, includeRejected: boolean): Promise<ConventionsState> {
    await this.scanRepo(workspaceId, repoId);
    const statuses: ConventionStatus[] = includeRejected ? ['pending', 'accepted', 'rejected'] : ['pending', 'accepted'];
    const [scan, rows, counts] = await Promise.all([
      this.repo.latestScan(workspaceId, repoId),
      this.repo.list(workspaceId, repoId, statuses),
      this.repo.counts(workspaceId, repoId),
    ]);
    return { scan: scan ? toScanDto(scan) : null, candidates: rows.map(toConventionDto), counts };
  }

  /** PATCH /conventions/:id — Accept / Reject / back to pending, inline edit of rule + category. */
  async update(workspaceId: string, id: string, patch: ConventionUpdate): Promise<ConventionCandidate> {
    const row = await this.repo.update(workspaceId, id, patch);
    if (!row) throw new NotFoundError('Convention not found');
    return toConventionDto(row);
  }

  /** GET /repos/:id/conventions/skill-draft — from ACCEPTED candidates only (422 when there are none). */
  async skillDraft(workspaceId: string, repoId: string): Promise<ConventionSkillDraft> {
    const repo = await this.scanRepo(workspaceId, repoId);
    const accepted = await this.repo.accepted(workspaceId, repoId);
    if (accepted.length === 0) throw new ValidationError('Accept at least one convention first');
    return buildSkillDraft(repo.fullName, accepted);
  }

  /**
   * POST /repos/:id/conventions/skill — the reviewed draft becomes a skill
   * (source `extracted`); the body was re-validated by the request schema.
   * Name taken → 409 (never overwritten); unknown / foreign agent → 404.
   */
  async createSkill(workspaceId: string, repoId: string, input: ConventionSkillCreate): Promise<ConventionSkillResult> {
    await this.scanRepo(workspaceId, repoId);
    const accepted = await this.repo.accepted(workspaceId, repoId);
    if (accepted.length === 0) throw new ValidationError('Accept at least one convention first');
    const evidence = [...new Set(accepted.flatMap((c) => (c.evidencePath ? [c.evidencePath] : [])))].slice(0, 100);
    const outcome = await this.repo.createSkill(workspaceId, input, evidence);
    if (outcome.kind === 'name_taken') {
      throw new ConflictError(`A skill named "${outcome.name}" already exists`, { names: [outcome.name] });
    }
    if (outcome.kind === 'agent_missing') throw new NotFoundError('Agent not found');
    return { skill: toSkillDto(outcome.skill, outcome.attachedAgentId ? 1 : 0), attached_agent_id: outcome.attachedAgentId };
  }

  /** On boot: scans left `running` by a dead process become `failed` (decisions are untouched). */
  async reapInterruptedScans(): Promise<number> {
    return this.repo.reapRunningScans();
  }
}
