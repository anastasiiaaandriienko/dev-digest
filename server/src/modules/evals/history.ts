import { createHash } from 'node:crypto';
import { EvalConfigSnapshot } from '@devdigest/shared';
import type {
  AgentEvalRun,
  AgentEvalRunDetail,
  EvalCaseChange,
  EvalCaseOutcome,
  EvalCaseRunResult,
  EvalConfigSummary,
  EvalRunComparison,
  EvalSkillChange,
} from '@devdigest/shared';
import type { AgentEvalRunRow, EvalRunRow } from '../../db/rows.js';
import { toAgentEvalRun } from './helpers.js';
import { StoredCaseOutput } from './runner.js';

/**
 * Run history read side (specs/eval-pipeline.md §6, §12.4): pure mappers from
 * stored rows to the run detail and the two-run comparison. Read-only by
 * construction — nothing here writes, and nothing is recomputed: stored metrics
 * and stored case verdicts are shown as they were recorded.
 */

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

/** The run's frozen config, or null when the stored snapshot does not parse. */
export function parseRunConfig(row: AgentEvalRunRow): EvalConfigSnapshot | null {
  const parsed = EvalConfigSnapshot.safeParse(row.configSnapshot);
  return parsed.success ? parsed.data : null;
}

/** Stored per-case rows → case results (unreadable rows are skipped, never rewritten). */
export function toCaseRunResults(rows: readonly EvalRunRow[]): EvalCaseRunResult[] {
  return rows
    .flatMap((row) => {
      const stored = StoredCaseOutput.safeParse(row.actualOutput);
      return stored.success ? [{ ...stored.data.result, error: stored.data.engine.error }] : [];
    })
    .sort((a, b) => cmp(a.case_name, b.case_name) || cmp(a.case_id, b.case_id));
}

export function toAgentEvalRunDetail(row: AgentEvalRunRow, results: readonly EvalRunRow[]): AgentEvalRunDetail {
  return { ...toAgentEvalRun(row), config: parseRunConfig(row), results: toCaseRunResults(results) };
}

export function summarizeConfig(config: EvalConfigSnapshot | null, promptSha: string): EvalConfigSummary | null {
  if (!config) return null;
  return {
    provider: config.provider,
    model: config.model,
    strategy: config.strategy,
    agent_version: config.agent_version,
    prompt_sha: promptSha,
    skills: config.skills.map((s) => ({ id: s.id, name: s.name, version: s.version, body_sha: sha256(s.body) })),
  };
}

/** head − base; null when either side is null (an undefined metric has no delta). */
export function metricDelta(base: number | null, head: number | null): number | null {
  return base === null || head === null ? null : head - base;
}

/** Skill differences matched by id: added / removed / changed (version or body). */
export function diffSkills(base: EvalConfigSummary, head: EvalConfigSummary): EvalSkillChange[] {
  const b = new Map(base.skills.map((s) => [s.id, s]));
  const h = new Map(head.skills.map((s) => [s.id, s]));
  const out: EvalSkillChange[] = [];
  for (const [id, s] of h) {
    const old = b.get(id);
    if (!old) out.push({ id, name: s.name, change: 'added', base_version: null, head_version: s.version });
    else if (old.version !== s.version || old.body_sha !== s.body_sha) {
      out.push({ id, name: s.name, change: 'changed', base_version: old.version, head_version: s.version });
    }
  }
  for (const [id, s] of b) {
    if (!h.has(id)) out.push({ id, name: s.name, change: 'removed', base_version: s.version, head_version: null });
  }
  return out.sort((x, y) => cmp(x.name, y.name) || cmp(x.id, y.id));
}

const passed = (o: EvalCaseOutcome): boolean => o === 'tp' || o === 'pass';

function caseChange(base: EvalCaseOutcome | null, head: EvalCaseOutcome | null): EvalCaseChange {
  if (base === null) return 'only_head';
  if (head === null) return 'only_base';
  if (passed(base) === passed(head)) return 'unchanged';
  return passed(head) ? 'fixed' : 'regressed';
}

export interface ComparableRun {
  run: AgentEvalRun;
  config: EvalConfigSnapshot | null;
  results: readonly EvalCaseRunResult[];
}

/** Compare two runs of the same agent (the caller checks agent + status). */
export function compareRuns(base: ComparableRun, head: ComparableRun): EvalRunComparison {
  const baseSummary = summarizeConfig(base.config, base.run.prompt_sha);
  const headSummary = summarizeConfig(head.config, head.run.prompt_sha);
  const skillChanges = baseSummary && headSummary ? diffSkills(baseSummary, headSummary) : [];
  const configChanges: EvalRunComparison['config_changes'] = [];
  if (baseSummary && headSummary) {
    if (baseSummary.model !== headSummary.model) configChanges.push('model');
    if (baseSummary.provider !== headSummary.provider) configChanges.push('provider');
    if (baseSummary.strategy !== headSummary.strategy) configChanges.push('strategy');
    const order = (s: EvalConfigSummary) => s.skills.map((k) => `${k.id}@${k.version}:${k.body_sha}`).join('|');
    if (skillChanges.length > 0 || order(baseSummary) !== order(headSummary)) configChanges.push('skills');
  }

  const baseById = new Map(base.results.map((r) => [r.case_id, r]));
  const headById = new Map(head.results.map((r) => [r.case_id, r]));
  const ids = [...new Set([...baseById.keys(), ...headById.keys()])];
  const cases = ids
    .map((id) => {
      const b = baseById.get(id);
      const h = headById.get(id);
      const any = (h ?? b)!;
      return {
        case_id: id,
        case_name: any.case_name,
        kind: any.kind,
        base: b?.outcome ?? null,
        head: h?.outcome ?? null,
        change: caseChange(b?.outcome ?? null, h?.outcome ?? null),
      };
    })
    .sort((x, y) => cmp(x.case_name, y.case_name) || cmp(x.case_id, y.case_id));

  return {
    base: base.run,
    head: head.run,
    base_prompt: base.config?.system_prompt ?? '',
    head_prompt: head.config?.system_prompt ?? '',
    config: { base: baseSummary, head: headSummary },
    skill_changes: skillChanges,
    delta: {
      recall: metricDelta(base.run.recall, head.run.recall),
      precision: metricDelta(base.run.precision, head.run.precision),
      citation_accuracy: metricDelta(base.run.citation_accuracy, head.run.citation_accuracy),
      cost_usd: metricDelta(base.run.cost_usd, head.run.cost_usd),
    },
    prompt_changed: base.run.prompt_sha !== head.run.prompt_sha,
    config_changes: configChanges,
    same_case_set: baseById.size === headById.size && [...baseById.keys()].every((id) => headById.has(id)),
    cases,
  };
}
