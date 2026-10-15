/* ConfigTab — edit a skill's name, description, type, enabled flag and Markdown
   body (design: Skill Editor · Config), then Save (PUT /skills/:id with only
   the changed fields: a changed body becomes a new version, metadata edits keep
   the version). The body is edited in MarkdownEditor (line numbers, Markdown
   colouring, unsaved marker, token count). Cancel puts the saved values back.
   A failed save (validation or server) keeps every edit. The tab reports
   whether it has unsaved edits, and a way to save them, through `guardRef`
   so the page can ask before switching skills; the browser warns before a
   reload or close while edits are unsaved.
   The danger zone asks the parent to open the shared DeleteSkillModal. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, FormField, SelectInput, TextInput, Toggle } from "@devdigest/ui";
import type { Skill, SkillType } from "@devdigest/shared";
import { useUpdateSkill } from "@/lib/hooks/skills";
import { notify } from "@/lib/toast";
import { SKILL_TYPES } from "../../../../../constants";
import { validateSkillForm, type SkillFormField } from "../../../../../helpers";
import { MarkdownEditor } from "./_components/MarkdownEditor";
import { bodyStats, changedFields, formFrom, type ConfigForm, type ConfigGuard } from "./helpers";
import { useConfigGuard, useOutsideEnabled } from "./hooks";
import { s } from "./styles";

export function ConfigTab({
  skill,
  onDelete,
  guardRef,
  onDirtyChange,
}: {
  skill: Skill;
  onDelete: () => void;
  /** Filled with this tab's unsaved-edits guard while it is mounted (null after). */
  guardRef?: React.MutableRefObject<ConfigGuard | null>;
  /** Called when the form gains or loses unsaved edits (false again on unmount). */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const t = useTranslations("skills");
  const update = useUpdateSkill();
  const [form, setForm] = React.useState<ConfigForm>(() => formFrom(skill));
  const [errors, setErrors] = React.useState<Partial<Record<SkillFormField, true>>>({});

  const patch = changedFields(skill, form);
  const dirty = Object.keys(patch).length > 0;
  const stats = bodyStats(form.body);
  const set = <K extends keyof ConfigForm>(key: K, value: ConfigForm[K]) => setForm((f) => ({ ...f, [key]: value }));

  /** Validate and PUT the changed fields; true once saved. A failure keeps every edit. */
  const save = async (): Promise<boolean> => {
    const result = validateSkillForm({ name: form.name, description: form.description, type: form.type, body: form.body });
    if (!result.ok) {
      setErrors(result.errors);
      return false;
    }
    setErrors({});
    try {
      const saved = await update.mutateAsync({ id: skill.id, patch });
      notify.success(
        saved.version !== skill.version
          ? t("detail.config.savedVersion", { name: saved.name, version: saved.version })
          : t("detail.config.saved", { name: saved.name }),
      );
      return true;
    } catch {
      // The global MutationCache onError already shows the toast; keep the edits.
      return false;
    }
  };

  useOutsideEnabled(skill.enabled, setForm);
  useConfigGuard({ dirty, save, guardRef, onDirtyChange });

  const cancel = () => {
    setForm(formFrom(skill));
    setErrors({});
  };

  const bold = (chunks: React.ReactNode) => <b style={s.saveNoteVersion}>{chunks}</b>;

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

      <FormField label={t("detail.config.name")} required hint={error("name")}>
        <TextInput value={form.name} onChange={(v) => set("name", v)} mono />
      </FormField>
      <FormField label={t("detail.config.description")} hint={error("description")}>
        <TextInput value={form.description} onChange={(v) => set("description", v)} />
      </FormField>
      <FormField label={t("detail.config.type")}>
        <SelectInput
          value={form.type}
          onChange={(v) => set("type", v as SkillType)}
          options={SKILL_TYPES.map((k) => ({ value: k, label: t(`listItem.type.${k}`) }))}
        />
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
        <MarkdownEditor
          value={form.body}
          onChange={(v) => set("body", v)}
          filename={`${skill.name}.md`}
          dirty={form.body !== skill.body}
          invalid={!!errors.body}
          label={t("detail.config.body")}
        />
      </FormField>

      <div style={s.actions}>
        <Button kind="primary" icon="Check" onClick={save} disabled={!dirty || update.isPending}>
          {update.isPending ? t("detail.config.saving") : t("detail.config.save")}
        </Button>
        <Button kind="ghost" onClick={cancel} disabled={!dirty || update.isPending}>
          {t("detail.config.reset")}
        </Button>
        <span style={s.saveNote}>
          {!dirty
            ? t("detail.config.noChanges")
            : form.body !== skill.body
              ? t.rich("detail.config.saveNote", { version: skill.version + 1, b: bold })
              : t.rich("detail.config.saveNoteMeta", { version: skill.version, b: bold })}
        </span>
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
