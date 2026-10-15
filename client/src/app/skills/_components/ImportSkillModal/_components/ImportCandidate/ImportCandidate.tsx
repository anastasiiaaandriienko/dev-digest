/* ImportCandidate — one skill found in the imported file, editable before the
   import: include switch, name, type, description and the Markdown body
   (rendered by default so it is read before it is imported). Issues are shown
   under the field they belong to. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { FormField, Markdown, SelectInput, Tabs, TextInput, Textarea } from "@devdigest/ui";
import type { SkillImportField, SkillImportIssue, SkillType } from "@devdigest/shared";
import { SKILL_TYPES } from "@/lib/skill-meta";
import { BODY_ROWS } from "../../constants";
import type { DraftPatch, ImportDraft } from "../../helpers";
import { s } from "./styles";

export function ImportCandidate({
  draft,
  issues,
  onChange,
}: {
  draft: ImportDraft;
  /** Current problems of this draft (empty when excluded or valid). */
  issues: readonly SkillImportIssue[];
  onChange: (patch: DraftPatch) => void;
}) {
  const t = useTranslations("skills.importFile");
  const tl = useTranslations("skills.listItem");
  const [tab, setTab] = React.useState("rendered");
  const label = draft.name.trim() || draft.path;

  const errors = (field: SkillImportField) => {
    const list = issues.filter((i) => i.field === field);
    if (list.length === 0) return undefined;
    return (
      <span role="alert" style={s.error}>
        {list.map((i) => i.message).join(" · ")}
      </span>
    );
  };

  return (
    <li data-import-path={draft.path} style={s.card(draft.include, issues.length > 0)}>
      <div style={s.head}>
        <input
          type="checkbox"
          checked={draft.include}
          onChange={(e) => onChange({ include: e.target.checked })}
          aria-label={t("include", { name: label })}
        />
        <span className="mono" style={s.path} title={draft.path}>
          {t("from", { path: draft.path })}
        </span>
        <span style={s.status(draft.include, issues.length > 0)} data-testid="import-status">
          {!draft.include ? t("excluded") : issues.length > 0 ? t("problems", { count: issues.length }) : t("ready")}
        </span>
      </div>

      {draft.include && (
        <div style={s.fields}>
          <div style={s.row}>
            <div style={s.grow}>
              <FormField label={t("name")} required hint={errors("name")}>
                <TextInput value={draft.name} onChange={(name) => onChange({ name })} aria-label={t("name")} mono />
              </FormField>
            </div>
            <div style={s.typeCol}>
              <FormField label={t("type")} hint={errors("type")}>
                <SelectInput
                  value={draft.type}
                  onChange={(v) => onChange({ type: v as SkillType })}
                  aria-label={t("type")}
                  options={SKILL_TYPES.map((k) => ({ value: k, label: tl(`type.${k}`) }))}
                />
              </FormField>
            </div>
          </div>
          <FormField label={t("description")} hint={errors("description")}>
            <TextInput value={draft.description} onChange={(description) => onChange({ description })} aria-label={t("description")} />
          </FormField>
          <FormField label={t("body")} required hint={errors("body")}>
            <Tabs
              tabs={[
                { key: "rendered", label: t("rendered") },
                { key: "edit", label: t("edit") },
              ]}
              value={tab}
              onChange={setTab}
              pad="0"
            />
            <div style={s.editor}>
              {tab === "edit" ? (
                <Textarea value={draft.body} onChange={(body) => onChange({ body })} rows={BODY_ROWS} aria-label={t("body")} mono />
              ) : (
                <div style={s.rendered} data-testid="import-body-rendered">
                  {draft.body.trim() ? <Markdown>{draft.body}</Markdown> : <span style={s.muted}>{t("bodyEmpty")}</span>}
                </div>
              )}
            </div>
          </FormField>
        </div>
      )}
    </li>
  );
}
