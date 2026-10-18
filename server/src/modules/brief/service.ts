import type { BlastRadius, FeatureModelChoice, PrBriefState } from '@devdigest/shared';
import { PrBrief } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { ConfigError, NotFoundError } from '../../platform/errors.js';
import { TimeoutError, withTimeout } from '../../platform/resilience.js';
import { BlastService } from '../blast/service.js';
import { buildSmartDiff } from '../reviews/smart-diff.js';
import type { Logger } from '../reviews/run-executor.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import {
  BRIEF_FEATURE_ID,
  BRIEF_MODEL_UNAVAILABLE_MESSAGE,
  BRIEF_OUTPUT_MAX_TOKENS,
  BRIEF_PROMPT_VERSION,
  BRIEF_PROVIDER_TIMEOUT_MS,
  BRIEF_TIMEOUT_MS,
} from './constants.js';
import {
  BriefInputsIncompleteError,
  BriefInvalidOutputError,
  BriefModelUnavailableError,
  BriefSaveFailedError,
  BriefTimeoutError,
  mapBriefFailure,
} from './failures.js';
import { evaluateBriefFreshness, toStoredIntent, validateBriefOutput } from './helpers.js';
import { buildBriefMessages, BriefGeneration, SCHEMA_NAME } from './prompt.js';
import {
  BriefRepository,
  type BriefFile,
  type BriefPull,
  type BriefRow,
  type SaveBriefValues,
} from './repository.js';

/** The slice of `BriefRepository` the service needs (a fake in unit tests). */
export interface BriefStore {
  getPull(workspaceId: string, prId: string): Promise<BriefPull | undefined>;
  listFiles(prId: string): Promise<BriefFile[]>;
  getBriefRow(prId: string): Promise<BriefRow | undefined>;
  saveBrief(values: SaveBriefValues): Promise<boolean>;
}

export interface BriefServiceOptions {
  store?: BriefStore;
  /** Test seam: replaces the container-backed blast service. */
  blast?: { forPull(workspaceId: string, prId: string): Promise<BlastRadius> };
  /** How long one HTTP caller waits for the flight (default BRIEF_TIMEOUT_MS). The flight itself has no timeout. */
  timeoutMs?: number;
}

/**
 * In-flight computations (LLM call -> validate -> guarded save), keyed by the
 * exact work they do. A process singleton: two requests for the same PR head +
 * model + prompt share ONE model call, also with `force`. An entry is removed
 * ONLY by its own flight when that settles — never by a caller's timeout — so a
 * retry after a timeout joins the still-running (already paid) call.
 */
const inflight = new Map<string, Promise<void>>();
/** Count of settled flights; lets `run` detect a flight that finished (and saved) during its cache read. */
let settledFlights = 0;

export function briefFlightKey(prId: string, headSha: string, model: FeatureModelChoice): string {
  return [prId, headSha, model.provider, model.model, BRIEF_PROMPT_VERSION].join('|');
}

/**
 * PR Why + Risk Brief. `getState` is a pure local read (DB + settings + secrets
 * lookup): no LLM, no network. `run` is the only method that calls the model.
 * Never calls IntentService: the stored intent is only read.
 */
export class BriefService {
  private store: BriefStore;
  private blast: { forPull(workspaceId: string, prId: string): Promise<BlastRadius> };

  constructor(private container: Container, private opts: BriefServiceOptions = {}) {
    this.store = opts.store ?? new BriefRepository(container.db);
    this.blast = opts.blast ?? new BlastService(container);
  }

  // ---- state ---------------------------------------------------------------

  private async readPull(workspaceId: string, prId: string): Promise<BriefPull> {
    const pull = await this.store.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    return pull;
  }

  /** The stored brief, or null when there is no row or it no longer parses. */
  private async readBrief(prId: string): Promise<PrBrief | null> {
    const row = await this.store.getBriefRow(prId);
    if (!row) return null;
    const parsed = PrBrief.safeParse(row.json);
    return parsed.success ? parsed.data : null;
  }

  /** Local secrets lookup only: building the provider needs the key, not the network. */
  private async hasKey(model: FeatureModelChoice): Promise<boolean> {
    try {
      await this.container.llm(model.provider);
      return true;
    } catch (err) {
      if (err instanceof ConfigError) return false;
      throw err;
    }
  }

  private toState(prId: string, brief: PrBrief | null, headSha: string, model: FeatureModelChoice, modelError: string | null): PrBriefState {
    const { freshness, stale_reasons } = evaluateBriefFreshness(brief, { headSha, model });
    return { pr_id: prId, brief, freshness, stale_reasons, model_error: modelError };
  }

  /** GET /pulls/:id/brief — local reads only. 404 for an unknown / foreign PR. */
  async getState(workspaceId: string, prId: string): Promise<PrBriefState> {
    const pull = await this.readPull(workspaceId, prId);
    const [brief, model] = await Promise.all([
      this.readBrief(prId),
      resolveFeatureModel(this.container, workspaceId, BRIEF_FEATURE_ID),
    ]);
    const modelError = (await this.hasKey(model)) ? null : BRIEF_MODEL_UNAVAILABLE_MESSAGE;
    return this.toState(prId, brief, pull.headSha, model, modelError);
  }

  // ---- run -----------------------------------------------------------------

  /**
   * POST /pulls/:id/brief. Order: 404 → 409 (no stored files, no LLM) → 422 (no key
   * for the `risk_brief` provider, no fallback; BEFORE the cache check) → cache hit
   * (not `force`, fresh) → single-flight → caller waits ≤ BRIEF_TIMEOUT_MS, then 504
   * while the flight keeps running and saves. Always returns the stored state.
   */
  async run(workspaceId: string, prId: string, opts: { force?: boolean; logger?: Logger } = {}): Promise<PrBriefState> {
    const pull = await this.readPull(workspaceId, prId);

    const files = await this.store.listFiles(prId);
    if (files.length === 0) throw new BriefInputsIncompleteError();

    const model = await resolveFeatureModel(this.container, workspaceId, BRIEF_FEATURE_ID);
    if (!(await this.hasKey(model))) throw new BriefModelUnavailableError();

    const key = briefFlightKey(prId, pull.headSha, model);
    const cacheHit = (brief: PrBrief | null) => evaluateBriefFreshness(brief, { headSha: pull.headSha, model }).freshness === 'fresh';
    if (!opts.force) {
      // A running identical flight is joined (below) instead of reading the cache. If a flight
      // SETTLES while we read, its save may have missed our read, so the miss is not trusted: re-read.
      for (;;) {
        if (inflight.has(key)) break;
        const settledBefore = settledFlights;
        const brief = await this.readBrief(prId);
        if (cacheHit(brief)) return this.toState(prId, brief, pull.headSha, model, null);
        if (settledFlights === settledBefore) break;
      }
    }

    // No await between the last check above and `inflight.set`: check-and-set is atomic.
    let flight = inflight.get(key);
    if (!flight) {
      const own: Promise<void> = this.generate(workspaceId, prId, model, opts.logger).finally(() => {
        if (inflight.get(key) === own) inflight.delete(key);
        settledFlights += 1;
      });
      inflight.set(key, own);
      flight = own;
    } // else: join, the same work is already in flight

    await this.waitFor(flight);

    // Report the STORED state (a skipped write shows the row that won; a moved head is stale).
    return this.getState(workspaceId, prId);
  }

  /** One caller's bounded wait for a flight. Timing out abandons the wait, never the flight. */
  private async waitFor(flight: Promise<void>): Promise<void> {
    try {
      await withTimeout(flight, this.opts.timeoutMs ?? BRIEF_TIMEOUT_MS);
    } catch (err) {
      // Flight errors are already mapped AppErrors, so a TimeoutError can only be this wait.
      if (err instanceof TimeoutError) throw new BriefTimeoutError();
      throw err;
    }
  }

  /** The flight, with NO timeout of its own. Every failure is mapped to a safe AppError and logged once. */
  private async generate(workspaceId: string, prId: string, model: FeatureModelChoice, logger?: Logger): Promise<void> {
    try {
      await this.compute(workspaceId, prId, model);
    } catch (err) {
      const { error, fields } = mapBriefFailure(err);
      logger?.error(
        { prId, provider: model.provider, model: model.model, errorCode: error.code, ...fields },
        'brief: generation failed',
      );
      throw error;
    }
  }

  /** Inputs → one model call → validation → one guarded save. */
  private async compute(workspaceId: string, prId: string, model: FeatureModelChoice): Promise<void> {
    // Captured BEFORE any input is read: the same-head ordering of the save guard relies on it (A7).
    const generatedAt = new Date().toISOString();

    const pull = await this.readPull(workspaceId, prId);
    const files = await this.store.listFiles(prId);
    if (files.length === 0) throw new BriefInputsIncompleteError();
    const blast = await this.blast.forPull(workspaceId, prId);
    const storedIntent = toStoredIntent(await this.container.reviewRepo.getIntentRow(prId));

    // No patches: the smart diff is grouped from paths and counts only (A4).
    const smartDiff = buildSmartDiff(
      files.map((f) => ({ path: f.path, additions: f.additions, deletions: f.deletions, patch: null })),
      [],
    );
    const { messages, truncated } = buildBriefMessages(
      { title: pull.title, body: pull.body, files, smartDiff, blast, intent: storedIntent },
      this.container.tokenizer,
    );

    let llm;
    try {
      llm = await this.container.llm(model.provider);
    } catch (err) {
      if (err instanceof ConfigError) throw new BriefModelUnavailableError(); // fixed text, ConfigError message not forwarded
      throw err;
    }

    const result = await llm.completeStructured({
      model: model.model,
      schema: BriefGeneration,
      schemaName: SCHEMA_NAME,
      messages,
      temperature: 0,
      maxRetries: 1,
      maxTokens: BRIEF_OUTPUT_MAX_TOKENS,
      timeoutMs: BRIEF_PROVIDER_TIMEOUT_MS, // 0: no adapter-level race (the caller-side wait applies)
    });

    const parsed = BriefGeneration.safeParse(result.data);
    if (!parsed.success) throw new BriefInvalidOutputError();
    const valid = validateBriefOutput(parsed.data, files.map((f) => f.path));
    const costUsd = result.costUsd ?? this.container.priceBook.estimate(model.model, result.tokensIn, result.tokensOut);

    const brief: PrBrief = {
      intent: storedIntent ?? { intent: '', in_scope: [], out_of_scope: [] },
      blast,
      risks: { risks: valid.risks },
      summary: valid.summary,
      review_focus: valid.review_focus,
      meta: {
        head_sha: pull.headSha,
        provider: model.provider,
        model: model.model, // the requested id (not result.model): freshness compares it with the resolved choice
        prompt_version: BRIEF_PROMPT_VERSION,
        tokens_in: result.tokensIn, // cumulative over attempts, unchanged (D18)
        tokens_out: result.tokensOut,
        attempts: result.attempts,
        cost_usd: costUsd ?? null,
        generated_at: generatedAt,
        truncated,
        intent_available: storedIntent !== null,
      },
    };

    try {
      await this.store.saveBrief({ prId, brief }); // false = guard skipped the write; run() re-reads the stored state
    } catch {
      throw new BriefSaveFailedError(); // never forward the DB error text
    }
  }
}
