/* ConfigTab — edit a skill's name, description, type, enabled flag and Markdown
   body, then Save (PUT /skills/:id with only the changed fields: a changed body
   becomes a new version, metadata edits keep the version). The danger zone asks
   the parent to open the shared DeleteSkillModal. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, FormField, SelectInput, Textarea, TextInput, Toggle } from "@devdigest/ui";
import type { Skill, SkillType } from "@devdigest/shared";
import { useUpdateSkill } from "@/lib/hooks/skills";
import { notify } from "@/lib/toast";
import { SKILL_TYPES } from "../../../../../constants";
import { validateSkillForm, type SkillFormField } from "../../../../../helpers";
import { BODY_ROWS } from "./constants";
import { bodyStats, changedFields, formFrom, type ConfigForm } from "./helpers";
import { s } from "./styles";

export function ConfigTab({ skill, onDelete }: { skill: Skill; onDelete: () => void }) {
  const t = useTranslations("skills");
  const update = useUpdateSkill();
  const [form, setForm] = React.useState<ConfigForm>(() => formFrom(skill));
  const [errors, setErrors] = React.useState<Partial<Record<SkillFormField, true>>>({});

  const patch = changedFields(skill, form);
  const dirty = Object.keys(patch).length > 0;
  const stats = bodyStats(form.body);
  const set = <K extends keyof ConfigForm>(key: K, value: ConfigForm[K]) => setForm((f) => ({ ...f, [key]: value }));

  const save = async () => {
    const result = validateSkillForm({ name: form.name, description: form.description, type: form.type, body: form.body });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    try {
      const saved = await update.mutateAsync({ id: skill.id, patch });
      notify.success(
        saved.version !== skill.version
          ? t("detail.config.savedVersion", { name: saved.name, version: saved.version })
          : t("detail.config.saved", { name: saved.name }),
      );
    } catch {
      // The global MutationCache onError already shows the toast; keep the edits.
    }
  };

  const error = (field: SkillFormField) =>
    errors[field] ? (
      <span role="alert" style={s.error}>
        {t(`create.errors.${field}`)}
      </span>
    ) : undefined;

  return (
    <div style={s.wrap}>
      <div style={s.titleRow}>
        <h2 style={s.h2}>{t("detail.config.title")}</h2>
        <Badge color="var(--text-secondary)" icon="GitCommit">
          {t("preview.version", { version: skill.version })}
        </Badge>
        <span style={s.enabled}>
          {t("detail.config.enabled")}
          <Toggle
            on={form.enabled}
            onChange={(v) => set("enabled", v)}
            size={16}
            label={t("card.toggleLabel", { name: skill.name })}
          />
        </span>
      </div>

      <div style={s.row}>
        <div style={s.grow}>
          <FormField label={t("detail.config.name")} required hint={error("name")}>
            <TextInput value={form.name} onChange={(v) => set("name", v)} mono />
          </FormField>
        </div>
        <div style={s.typeCol}>
          <FormField label={t("detail.config.type")}>
            <SelectInput
              value={form.type}
              onChange={(v) => set("type", v as SkillType)}
              options={SKILL_TYPES.map((k) => ({ value: k, label: t(`listItem.type.${k}`) }))}
            />
          </FormField>
        </div>
      </div>
      <FormField label={t("detail.config.description")} hint={error("description")}>
        <TextInput value={form.description} onChange={(v) => set("description", v)} />
      </FormField>
      <FormField
        label={t("detail.config.body")}
        required
        hint={error("body") ?? t("detail.config.bodyHint", { next: skill.version + 1, current: skill.version })}
        right={
          <span className="mono tnum" style={s.stats} data-testid="body-stats">
            {t("detail.config.bodyStats", stats)}
          </span>
        }
      >
        <Textarea value={form.body} onChange={(v) => set("body", v)} rows={BODY_ROWS} mono />
      </FormField>

      <div style={s.actions}>
        <Button kind="primary" icon="Check" onClick={save} disabled={!dirty || update.isPending}>
          {update.isPending ? t("detail.config.saving") : t("detail.config.save")}
        </Button>
        <Button kind="ghost" onClick={() => setForm(formFrom(skill))} disabled={!dirty || update.isPending}>
          {t("detail.config.reset")}
        </Button>
        {!dirty && <span style={s.muted}>{t("detail.config.noChanges")}</span>}
      </div>

      <div style={s.danger}>
        <div style={s.grow}>
          <div style={s.dangerTitle}>{t("detail.config.dangerTitle")}</div>
          <div style={s.muted}>{t("detail.config.dangerBody")}</div>
        </div>
        <Button kind="danger" size="sm" icon="Trash" onClick={onDelete}>
          {t("detail.config.delete")}
        </Button>
      </div>
    </div>
  );
}
