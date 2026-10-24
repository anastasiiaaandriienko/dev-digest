import { AgentManifest, type CiFile } from '@devdigest/shared';
import { ValidationError } from '../../platform/errors.js';
import { MANIFEST_DIR, SKILLS_DIR } from './constants.js';

/**
 * Agent manifest + skill files for Export to CI (AC-CI-20..22). Pure: the
 * caller passes the agent and its enabled linked skills in link order.
 *
 * The manifest is JSON-compatible YAML (Q22): `JSON.stringify` output is valid
 * YAML 1.2, which the runner's YAML parser reads, and JSON string escaping means
 * no user value (name, system prompt, model) can inject YAML structure.
 */

export interface ManifestAgent {
  id: string;
  name: string;
  version: number;
  provider: 'openai' | 'anthropic' | 'openrouter';
  model: string;
  systemPrompt: string;
  strategy: 'single-pass' | 'map-reduce' | 'auto';
  ciFailOn: 'never' | 'critical' | 'warning' | 'any';
}

export interface ManifestSkill {
  name: string;
  body: string;
}

/** kebab-case of a name: ASCII letters/digits separated by single dashes. */
export function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** The runner always calls OpenRouter: other providers' models get a `<provider>/` prefix. */
export function manifestModel(provider: ManifestAgent['provider'], model: string): string {
  // An empty model stays empty so AgentManifest rejects it (no bare "openai/").
  if (provider === 'openrouter' || !model.trim()) return model;
  return `${provider}/${model}`;
}

/** Skill slugs in link order; an empty slug or two skills with one slug → 422 naming them. */
export function skillSlugs(skills: readonly ManifestSkill[]): string[] {
  const bySlug = new Map<string, string>();
  return skills.map((s) => {
    const slug = slugify(s.name);
    if (!slug) throw new ValidationError(`Skill "${s.name}" has no usable slug (letters or digits)`);
    const other = bySlug.get(slug);
    if (other !== undefined) {
      throw new ValidationError(`Skills "${other}" and "${s.name}" both map to the slug "${slug}"`);
    }
    bySlug.set(slug, s.name);
    return slug;
  });
}

export function manifestPathFor(agentSlug: string): string {
  return `${MANIFEST_DIR}/${agentSlug}.yaml`;
}

/** A manifest path kept from the repo (Q29) must be a direct `*.yaml|*.yml` child of `.devdigest/agents/`. */
export function assertManifestPath(path: string): void {
  const name = path.startsWith(`${MANIFEST_DIR}/`) ? path.slice(MANIFEST_DIR.length + 1) : '';
  if (!/^[A-Za-z0-9._-]+\.ya?ml$/.test(name) || name.startsWith('.')) {
    throw new ValidationError(`Invalid manifest path: ${JSON.stringify(path)}`);
  }
}

export interface BuiltManifest {
  agentSlug: string;
  manifest: AgentManifest;
  /** The manifest file followed by one skill file per slug, in link order. */
  files: CiFile[];
}

/**
 * Build the manifest (validated against `AgentManifest`) and the skill files.
 * `manifestPath` overrides the default `<slug>.yaml` path when the repo already
 * holds this agent's manifest (Q29, AC-CI-89).
 */
export function buildManifest(
  agent: ManifestAgent,
  skills: readonly ManifestSkill[],
  manifestPath?: string,
): BuiltManifest {
  const agentSlug = slugify(agent.name);
  if (!agentSlug) throw new ValidationError(`Agent "${agent.name}" has no usable slug (letters or digits)`);
  const slugs = skillSlugs(skills);
  const path = manifestPath ?? manifestPathFor(agentSlug);
  assertManifestPath(path);

  const candidate = {
    name: agent.name,
    agent_id: agent.id,
    version: agent.version,
    provider: 'openrouter' as const,
    model: manifestModel(agent.provider, agent.model),
    system_prompt: agent.systemPrompt,
    skills: slugs,
    strategy: agent.strategy,
    ci_fail_on: agent.ciFailOn,
  };
  const parsed = AgentManifest.safeParse(candidate);
  if (!parsed.success) {
    throw new ValidationError('The agent cannot be exported: invalid manifest', parsed.error.flatten());
  }

  return {
    agentSlug,
    manifest: parsed.data,
    files: [
      { path, contents: `${JSON.stringify(candidate, null, 2)}\n`, editable: false },
      ...skills.map((s, i) => ({ path: `${SKILLS_DIR}/${slugs[i]}.md`, contents: s.body, editable: false })),
    ],
  };
}
