import type { IntentModelInfo, PrIntentState } from '@devdigest/shared';
import type { Container } from '../../../platform/container.js';
import { ConfigError, NotFoundError } from '../../../platform/errors.js';
import { TimeoutError, withTimeout } from '../../../platform/resilience.js';
import { defaultFeatureModel, getFeatureModelOverride } from '../../settings/feature-models.js';
import type { Logger } from '../run-executor.js';
import type { IntentInputs, IntentRow, SaveIntentValues } from '../repository/intent.repo.js';
import {
  INTENT_FALLBACK_FEATURE_ID,
  INTENT_FEATURE_ID,
  INTENT_MODEL_SETTINGS_HINT,
  INTENT_PROMPT_VERSION,
  INTENT_PROVIDER_TIMEOUT_MS,
  INTENT_TIMEOUT_MS,
} from './constants.js';
import {
  IntentInputsIncompleteError,
  IntentInvalidOutputError,
  IntentSaveFailedError,
  IntentTimeoutError,
  mapIntentFailure,
} from './failures.js';
import { computeFingerprint, knownFiles, type IntentFileInput } from './fingerprint.js';
import { evaluateFreshness, isCacheHit, toIntent, toMeta, type CurrentIntentInput } from './freshness.js';
import { IntentModelUnavailableError, pickIntentModel } from './model.js';
import { buildIntentMessages, IntentGeneration, normalizeGeneration, SCHEMA_NAME } from './prompt.js';

/** The slice of `ReviewRepository` the intent service needs (a fake in unit tests). */
export interface IntentStore {
  getIntentRow(prId: string): Promise<IntentRow | undefined>;
  getIntentInputs(workspaceId: string, prId: string): Promise<IntentInputs | undefined>;
  saveIntent(values: SaveIntentValues): Promise<boolean>;
}

export interface IntentServiceOptions {
  store?: IntentStore;
  /** Test seam: replaces the container-backed model choice. */
  pickModel?: (workspaceId: string) => Promise<IntentModelInfo>;
  /** How long one HTTP caller waits for the flight (default INTENT_TIMEOUT_MS). The flight itself has no timeout. */
  timeoutMs?: number;
}

/**
 * In-flight computations (LLM call -> validate -> conditional save), keyed by the
 * exact work they do. A process singleton (like the RunBus): two requests for the
 * same PR input + model + prompt share ONE model call, also with `force`; a
 * different key computes separately. An entry is removed ONLY by its own flight
 * when that settles — never by a caller's timeout — so a retry after a timeout
 * joins the still-running (already paid) call instead of starting another.
 */
const inflight = new Map<string, Promise<void>>();
/** Count of settled flights; lets `run` detect a flight that finished (and saved) during its cache read. */
let settledFlights = 0;

export function intentFlightKey(prId: string, fingerprint: string, model: IntentModelInfo): string {
  return [prId, fingerprint, model.provider, model.model, INTENT_PROMPT_VERSION].join('|');
}

/**
 * L03 Intent block. `getState` is a pure local read (DB + settings + secrets
 * lookup): no LLM, no network, no GitHub. `run` is the only method that calls
 * the model, and it never holds a DB transaction across that call.
 */
export class IntentService {
  private store: IntentStore;

  constructor(private container: Container, private opts: IntentServiceOptions = {}) {
    this.store = opts.store ?? container.reviewRepo;
  }

  // ---- model ---------------------------------------------------------------

  private pickModel(workspaceId: string): Promise<IntentModelInfo> {
    if (this.opts.pickModel) return this.opts.pickModel(workspaceId);
    const { container } = this;
    return pickIntentModel({
      intentOverride: () => getFeatureModelOverride(container, workspaceId, INTENT_FEATURE_ID),
      fallbackModel: async () =>
        (await getFeatureModelOverride(container, workspaceId, INTENT_FALLBACK_FEATURE_ID)) ??
        defaultFeatureModel(INTENT_FALLBACK_FEATURE_ID),
      // Local secrets lookup only: building the provider needs the key, not the network.
      hasKey: async (provider) => {
        try {
          await container.llm(provider);
          return true;
        } catch (err) {
          if (err instanceof ConfigError) return false;
          throw err;
        }
      },
    });
  }

  private async tryPickModel(workspaceId: string): Promise<{ model: IntentModelInfo | null; error: string | null }> {
    try {
      return { model: await this.pickModel(workspaceId), error: null };
    } catch (err) {
      if (err instanceof IntentModelUnavailableError) return { model: null, error: err.message };
      throw err;
    }
  }

  // ---- state ---------------------------------------------------------------

  private async readInputs(workspaceId: string, prId: string): Promise<IntentInputs> {
    const inputs = await this.store.getIntentInputs(workspaceId, prId);
    if (!inputs) throw new NotFoundError('Pull request not found');
    return inputs;
  }

  private current(inputs: IntentInputs, model: IntentModelInfo | null): CurrentIntentInput & { files: IntentFileInput[] | null } {
    const all: IntentFileInput[] = inputs.files.map((f) => ({
      path: f.path,
      additions: f.additions,
      deletions: f.deletions,
      patch: f.patch,
    }));
    const files = knownFiles(all);
    const fingerprint = computeFingerprint({
      title: inputs.pull.title,
      body: inputs.pull.body,
      headSha: inputs.pull.headSha,
      base: inputs.pull.base,
      files,
    });
    return { fingerprint, headSha: inputs.pull.headSha, filesKnown: files !== null, model, files };
  }

  private toState(
    prId: string,
    row: IntentRow | undefined,
    cur: CurrentIntentInput,
    modelError: string | null,
  ): PrIntentState {
    const { freshness, stale_reasons } = evaluateFreshness(row, cur);
    return {
      pr_id: prId,
      intent: row ? toIntent(row) : null,
      meta: row ? toMeta(row) : null,
      freshness,
      stale_reasons,
      current_model: cur.model,
      model_error: modelError,
    };
  }

  /** GET /pulls/:id/intent — local reads only. 404 for an unknown / foreign PR. */
  async getState(workspaceId: string, prId: string): Promise<PrIntentState> {
    const inputs = await this.readInputs(workspaceId, prId);
    const [row, picked] = await Promise.all([this.store.getIntentRow(prId), this.tryPickModel(workspaceId)]);
    return this.toState(prId, row, this.current(inputs, picked.model), picked.error);
  }

  // ---- run -----------------------------------------------------------------

  /**
   * POST /pulls/:id/intent. Cache hit (not `force`, stored row fresh for PR input,
   * prompt version and model) → no model call, `computed: false`. Otherwise one
   * model call (shared with any identical in-flight call) and the new state.
   *
   * The model is NEVER called while the PR's file list is unknown (no `pr_files`
   * stored): a stored intent for the same head is returned as-is (`unknown`,
   * `computed: false`); anything else → 409 `intent_inputs_incomplete`.
   *
   * Errors are safe and fixed: model unavailable → 422; provider failure / invalid
   * output → 502; caller wait elapsed → 504 `intent_timeout` (the flight keeps
   * running and may still save). The stored row is untouched on failure.
   */
  async run(
    workspaceId: string,
    prId: string,
    opts: { force?: boolean; logger?: Logger } = {},
  ): Promise<PrIntentState> {
    const inputs = await this.readInputs(workspaceId, prId);
    const model = await this.pickModel(workspaceId); // throws 422 intent_model_unavailable
    const cur = this.current(inputs, model);

    if (!cur.filesKnown) {
      // `force` means "ignore the cache", not "accept incomplete input": it does not bypass this guard.
      if (opts.force) throw new IntentInputsIncompleteError();
      const row = await this.store.getIntentRow(prId);
      if (row && row.headSha === cur.headSha) return { ...this.toState(prId, row, cur, null), computed: false };
      throw new IntentInputsIncompleteError();
    }

    const key = intentFlightKey(prId, cur.fingerprint, model);
    if (!opts.force) {
      // A running identical flight is joined (below) instead of reading the cache. If a flight
      // SETTLES while we read, its save may have missed our read, so the miss is not trusted:
      // re-read. Once no flight settled during a read, nothing awaits before `inflight.set`.
      for (;;) {
        if (inflight.has(key)) break;
        const settledBefore = settledFlights;
        const row = await this.store.getIntentRow(prId);
        if (isCacheHit(row, cur)) return { ...this.toState(prId, row, cur, null), computed: false };
        if (settledFlights === settledBefore) break;
      }
    }

    // No await between the last check above and `inflight.set`: check-and-set is atomic.
    let flight = inflight.get(key);
    let computed = false;
    if (!flight) {
      const own: Promise<void> = this.generate(inputs, cur, model, opts.logger).finally(() => {
        if (inflight.get(key) === own) inflight.delete(key);
        settledFlights += 1;
      });
      inflight.set(key, own);
      flight = own;
      computed = true;
    } // else: join, the same work is already in flight

    await this.waitFor(flight);

    // Report against the CURRENT state: a PR edited during the call is stale (pr_changed).
    const fresh = await this.getState(workspaceId, prId);
    return { ...fresh, computed };
  }

  /** One caller's bounded wait for a flight. Timing out abandons the wait, never the flight. */
  private async waitFor(flight: Promise<void>): Promise<void> {
    try {
      await withTimeout(flight, this.opts.timeoutMs ?? INTENT_TIMEOUT_MS);
    } catch (err) {
      // Flight errors are already mapped AppErrors, so a TimeoutError can only be this wait.
      if (err instanceof TimeoutError) throw new IntentTimeoutError();
      throw err;
    }
  }

  /**
   * The flight: LLM call -> validate -> conditional save, with NO timeout of its
   * own (see INTENT_TIMEOUT_MS). Every failure is mapped to a safe AppError and
   * logged once with safe fields only.
   */
  private async generate(
    inputs: IntentInputs,
    cur: CurrentIntentInput & { files: IntentFileInput[] | null },
    model: IntentModelInfo,
    logger?: Logger,
  ): Promise<void> {
    try {
      await this.compute(inputs, cur, model);
    } catch (err) {
      const { error, fields } = mapIntentFailure(err);
      logger?.error(
        { prId: inputs.pull.id, provider: model.provider, model: model.model, errorCode: error.code, ...fields },
        'intent: generation failed',
      );
      throw error;
    }
  }

  /** One model call + one conditional save. The input snapshot is what was SENT. */
  private async compute(
    inputs: IntentInputs,
    cur: CurrentIntentInput & { files: IntentFileInput[] | null },
    model: IntentModelInfo,
  ): Promise<void> {
    const { pull } = inputs;
    // Defensive: run() already refuses unknown files; the model must never see an incomplete list.
    if (!cur.files) throw new IntentInputsIncompleteError();
    let llm;
    try {
      llm = await this.container.llm(model.provider as 'openai' | 'anthropic' | 'openrouter');
    } catch (err) {
      if (err instanceof ConfigError) {
        // Fixed text: ConfigError messages are not forwarded.
        throw new IntentModelUnavailableError(
          `No API key is configured for the ${model.provider} provider. ` +
            `Add it or pick another model in ${INTENT_MODEL_SETTINGS_HINT}.`,
        );
      }
      throw err;
    }

    const result = await llm.completeStructured({
      model: model.model,
      schema: IntentGeneration,
      schemaName: SCHEMA_NAME,
      messages: buildIntentMessages({ title: pull.title, body: pull.body, files: cur.files }),
      temperature: 0,
      maxRetries: 1,
      timeoutMs: INTENT_PROVIDER_TIMEOUT_MS, // 0: no adapter-level race (see constants.ts)
    });

    const parsed = IntentGeneration.safeParse(result.data);
    if (!parsed.success) throw new IntentInvalidOutputError();
    const data = normalizeGeneration(parsed.data);
    const costUsd = result.costUsd ?? this.container.priceBook.estimate(model.model, result.tokensIn, result.tokensOut);

    try {
      await this.store.saveIntent({
        prId: pull.id,
        intent: data.intent,
        inScope: data.in_scope,
        outOfScope: data.out_of_scope,
        riskAreas: data.risk_areas,
        confidence: data.confidence,
        inputFingerprint: cur.fingerprint,
        promptVersion: INTENT_PROMPT_VERSION,
        provider: model.provider,
        model: model.model, // the requested id (not result.model): freshness compares it with the resolved choice
        headSha: pull.headSha,
        inputSnapshotAt: inputs.snapshotAt,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        costUsd: costUsd ?? null,
      });
    } catch {
      throw new IntentSaveFailedError(); // never forward the DB error text
    }
  }

  /**
   * For the review executor (P3): the intent to put in the prompt, or null.
   * Returns the stored intent when fresh, or unknown (files not synced, same head);
   * computes it when missing/stale ONLY if the file list is known — with unknown
   * files it never computes (run() throws 409 → null). NEVER throws: any failure
   * (no model, model error, timeout, PR gone) yields null so a review is never
   * blocked by the intent step. A stale intent is not returned.
   */
  async resolveForRun(workspaceId: string, prId: string, logger?: Logger): Promise<PrIntentState | null> {
    try {
      const state = await this.getState(workspaceId, prId);
      if (state.intent && state.freshness !== 'stale') return state;
      const next = await this.run(workspaceId, prId, { force: false, logger });
      return next.intent && next.freshness !== 'stale' ? next : null;
    } catch {
      return null;
    }
  }
}
