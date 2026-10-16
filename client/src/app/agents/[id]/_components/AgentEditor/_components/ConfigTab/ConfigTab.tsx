/* ConfigTab — edit an agent (design: Agent Editor · Config): Enabled, name,
   description, provider + the provider's models (live list, OpenRouter prices
   in the labels), system prompt with a token count, output schema, and the
   supported review settings (strategy, CI gate, repo intelligence). Save PUTs
   only the changed fields; Cancel puts the saved values back. Empty name /
   model / system prompt are refused inline (the server's rules). A failed
   save keeps every edit. Unsaved edits are reported to the page through
   `guardRef` (it asks before switching agents) and the browser asks before a
   reload or close. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, FormField, SearchableSelect, SelectInput, Textarea, TextInput, Toggle } from "@devdigest/ui";
import type { Agent, CiFailOn, Provider, ReviewStrategy } from "@devdigest/shared";
import { useProviderModels, useUpdateAgent } from "@/lib/hooks/agents";
import { toModelOptions } from "@/lib/model-label";
import { useToast } from "@/lib/toast";
import { useOutsideEnabled, useUnsavedGuard, type UnsavedGuard } from "@/lib/unsaved-guard";
import { CI_FAIL_ON_VALUES, OUTPUT_SCHEMA_VALUE, PROMPT_ROWS, PROVIDER_OPTIONS, STRATEGY_VALUES } from "./constants";
import { approxTokens, changedFields, formFrom, invalidFields, type AgentForm, type AgentFormField } from "./helpers";
import { s } from "./styles";

export function ConfigTab({
  agent,
  guardRef,
}: {
  agent: Agent;
  /** Filled with this tab's unsaved-edits guard while it is mounted (null after). */
  guardRef?: React.MutableRefObject<UnsavedGuard | null>;
}) {
  const t = useTranslations("agents");
  const toast = useToast();
  const update = useUpdateAgent();
  const [form, setForm] = React.useState<AgentForm>(() => formFrom(agent));
  const [errors, setErrors] = React.useState<Partial<Record<AgentFormField, true>>>({});
  const set = <K extends keyof AgentForm>(key: K, value: AgentForm[K]) => setForm((f) => ({ ...f, [key]: value }));

  const patch = changedFields(agent, form);
  const dirty = Object.keys(patch).length > 0;

  const { data: models } = useProviderModels(form.provider);
  // Show the price (USD per 1M in/out tokens) in the label when the provider
  // exposes it (OpenRouter) so a cheap model is easy to pick; value stays the id.
  const modelOptions = toModelOptions(models);
  const hasModel = modelOptions.some((o) => (typeof o === "string" ? o : o.value) === form.model);
  if (!hasModel && form.model) modelOptions.unshift(form.model);
  // Empty list after load = provider key missing/invalid (listModels failed) —
  // guide the user instead of showing a silent one-item dropdown.
  const noModels = models !== undefined && models.length === 0;

  const strategyOptions = STRATEGY_VALUES.map((v) => ({ value: v, label: t(`config.strategyOptions.${v}`) }));
  const ciFailOnOptions = CI_FAIL_ON_VALUES.map((v) => ({ value: v, label: t(`config.ciFailOnOptions.${v}`) }));

  /** Validate and PUT the changed fields; true once saved. A failure keeps every edit. */
  const save = async (): Promise<boolean> => {
    const invalid = invalidFields(form);
    setErrors(invalid);
    if (Object.keys(invalid).length > 0) return false;
    try {
      const saved = await update.mutateAsync({ id: agent.id, patch });
      toast.success(t("config.savedToast", { version: saved.version }));
      return true;
    } catch {
      // The global MutationCache onError already shows the toast; keep the edits.
      return false;
    }
  };
  const cancel = () => {
    setForm(formFrom(agent));
    setErrors({});
  };

  useOutsideEnabled(agent.enabled, setForm);
  useUnsavedGuard({ dirty, save, guardRef });

  const error = (field: AgentFormField) =>
    errors[field] ? (
      <span role="alert" style={s.error}>
        {t(`config.errors.${field}`)}
      </span>
    ) : undefined;

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("config.title")}</h2>
        <label style={s.enabledLabel}>
          {t("config.enabled")}
          <Toggle on={form.enabled} onChange={(v) => set("enabled", v)} size={16} label={t("card.toggleLabel", { name: agent.name })} />
        </label>
      </div>
      <FormField label={t("config.name")} required hint={error("name")}>
        <TextInput value={form.name} onChange={(v) => set("name", v)} />
      </FormField>
      <FormField label={t("config.description")}>
        <TextInput value={form.description} onChange={(v) => set("description", v)} />
      </FormField>
      <div className="dd-skills-lab-two-col" style={s.twoCol}>
        <FormField label={t("config.provider")}>
          <SelectInput value={form.provider} onChange={(v) => set("provider", v as Provider)} options={[...PROVIDER_OPTIONS]} />
        </FormField>
        <FormField
          label={t("config.model")}
          hint={error("model") ?? (noModels ? t("config.modelEmptyHint", { provider: form.provider }) : t("config.modelHint"))}
        >
          <SearchableSelect
            value={form.model}
            onChange={(v) => set("model", v)}
            options={modelOptions}
            placeholder={t("config.modelSearch")}
          />
        </FormField>
      </div>
      <FormField
        label={t("config.systemPrompt")}
        required
        hint={error("system_prompt") ?? t("config.systemPromptHint")}
        right={
          <span className="mono tnum" style={s.tokens} data-testid="prompt-tokens">
            {t("config.promptTokens", { tokens: approxTokens(form.system_prompt) })}
          </span>
        }
      >
        <Textarea value={form.system_prompt} onChange={(v) => set("system_prompt", v)} rows={PROMPT_ROWS} mono />
      </FormField>
      <FormField label={t("config.outputSchema")}>
        <SelectInput value={OUTPUT_SCHEMA_VALUE} options={[OUTPUT_SCHEMA_VALUE]} />
      </FormField>
      <FormField label={t("config.strategy")} hint={t("config.strategyHint")}>
        <SelectInput value={form.strategy} onChange={(v) => set("strategy", v as ReviewStrategy)} options={strategyOptions} />
      </FormField>
      <FormField label={t("config.ciFailOn")} hint={t("config.ciFailOnHint")}>
        <SelectInput value={form.ci_fail_on} onChange={(v) => set("ci_fail_on", v as CiFailOn)} options={ciFailOnOptions} />
      </FormField>
      <FormField label={t("config.repoIntel")} hint={t("config.repoIntelHint")}>
        <span style={s.inlineToggle}>
          <Toggle on={form.repo_intel} onChange={(v) => set("repo_intel", v)} size={16} label={t("config.repoIntel")} />
        </span>
      </FormField>
      <div style={s.actions}>
        <Button kind="primary" icon="Check" onClick={save} disabled={!dirty || update.isPending}>
          {update.isPending ? t("config.saving") : t("config.save")}
        </Button>
        <Button kind="ghost" onClick={cancel} disabled={!dirty || update.isPending}>
          {t("config.cancel")}
        </Button>
        {!dirty && <span style={s.muted}>{t("config.noChanges")}</span>}
      </div>
    </div>
  );
}
