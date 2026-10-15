/* CreateConventionSkillModal — "Create skill" on the Conventions page (HW2 #41,
   #42, #51): explains that the skill is merged from the ACCEPTED conventions,
   loads the server-built draft (accepted conventions only) and lets the user
   edit name, description, type, enabled and the Markdown body — in the shared
   MarkdownEditor (file name, line numbers, token count, "unsaved"), with a
   Preview toggle for the rendered Markdown — and optionally attach it to an
   agent. A taken name (409) or a field the server refuses (422) is shown on
   that field; nothing the user typed is lost. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, FormField, Icon, Markdown, Modal, SelectInput, Skeleton, TextInput, Toggle } from "@devdigest/ui";
import type { ConventionSkillResult, SkillType } from "@devdigest/shared";
import { MarkdownEditor } from "@/components/markdown-editor";
import { useAgents } from "@/lib/hooks/agents";
import { useConventionSkillDraft, useCreateConventionSkill } from "@/lib/hooks/conventions";
import { notify } from "@/lib/toast";
import { SKILL_TYPES } from "@/lib/skill-meta";
import { BODY_EDITOR_HEIGHT, MODAL_WIDTH } from "./constants";
import { errorsFromApi, validateForm, type SkillForm, type SkillFormErrors } from "./helpers";
import { s } from "./styles";

export function CreateConventionSkillModal({
  repoId,
  repoName,
  onClose,
  onCreated,
}: {
  repoId: string;
  repoName: string;
  onClose: () => void;
  onCreated?: (result: ConventionSkillResult) => void;
}) {
  const t = useTranslations("conventions.createSkill");
  const tl = useTranslations("skills.listItem");
  const draft = useConventionSkillDraft(repoId, true);
  const agents = useAgents();
  const create = useCreateConventionSkill(repoId);
  const [form, setForm] = React.useState<SkillForm | null>(null);
  const [errors, setErrors] = React.useState<SkillFormErrors>({});
  const [previewing, setPreviewing] = React.useState(false);

  // Start from the server draft once; later refetches never overwrite the user's edits.
  React.useEffect(() => {
    if (draft.data && !form) {
      setForm({
        name: draft.data.name,
        description: draft.data.description,
        type: draft.data.type,
        enabled: true,
        body: draft.data.body,
        agentId: "",
      });
    }
  }, [draft.data, form]);

  const set = <K extends keyof SkillForm>(key: K, value: SkillForm[K]) => {
    setForm((f) => (f ? { ...f, [key]: value } : f));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const submit = async () => {
    if (!form) return;
    const checked = validateForm(form);
    if (!checked.ok) {
      setErrors(checked.errors);
      if (checked.errors.body) setPreviewing(false);
      return;
    }
    try {
      const result = await create.mutateAsync(checked.data);
      const agent = agents.data?.find((a) => a.id === result.attached_agent_id);
      notify.success(
        agent ? t("createdAttached", { name: result.skill.name, agent: agent.name }) : t("created", { name: result.skill.name }),
      );
      onClose();
      onCreated?.(result);
    } catch (e) {
      // Toasted globally; keep the form and point at the field.
      setErrors(errorsFromApi(e, (name) => t("nameTaken", { name })));
    }
  };

  const error = (key: keyof SkillFormErrors) =>
    errors[key] ? (
      <span role="alert" style={s.error}>
        {errors[key]}
      </span>
    ) : undefined;

  const count = draft.data?.convention_ids.length ?? 0;

  return (
    <Modal
      width={MODAL_WIDTH}
      title={t("title")}
      subtitle={form?.name ?? draft.data?.name}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <span style={s.savedAs}>
            <Icon.GitCommit size={13} />
            {t("savedAs")}
          </span>
          <Button kind="ghost" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button kind="primary" icon="Sparkles" onClick={submit} disabled={!form || create.isPending}>
            {create.isPending ? t("creating") : t("create")}
          </Button>
        </div>
      }
    >
      <div style={s.body}>
        {draft.isLoading && (
          <div aria-busy="true" style={s.loading}>
            <span style={s.muted}>{t("loading")}</span>
            <Skeleton height={220} />
          </div>
        )}
        {draft.isError && (
          <div role="alert" style={s.loadError}>
            {t("loadError")} {(draft.error as Error)?.message}
          </div>
        )}
        {form && (
          <>
            <div style={s.info}>
              <Icon.Wrench size={15} style={s.infoIcon} />
              <span>
                {t.rich("explanation", {
                  count,
                  repo: repoName,
                  b: (chunks) => <b style={s.infoStrong}>{chunks}</b>,
                  code: (chunks) => (
                    <span className="mono" style={s.infoRepo}>
                      {chunks}
                    </span>
                  ),
                })}
              </span>
            </div>
            <FormField label={t("name")} required hint={error("name") ?? t("nameHint")}>
              <TextInput value={form.name} onChange={(v) => set("name", v)} aria-label={t("name")} mono />
            </FormField>
            <FormField label={t("description")} hint={error("description")}>
              <TextInput value={form.description} onChange={(v) => set("description", v)} aria-label={t("description")} />
            </FormField>
            <div style={s.row}>
              <div style={s.grow}>
                <FormField label={t("type")} hint={error("type")}>
                  <SelectInput
                    value={form.type}
                    onChange={(v) => set("type", v as SkillType)}
                    aria-label={t("type")}
                    options={SKILL_TYPES.map((k) => ({ value: k, label: tl(`type.${k}`) }))}
                  />
                </FormField>
              </div>
              <div style={s.grow}>
                <FormField label={t("enabled")} hint={t("enabledHint")}>
                  <div style={s.toggle}>
                    <Toggle on={form.enabled} onChange={(v) => set("enabled", v)} size={17} label={t("enabled")} />
                  </div>
                </FormField>
              </div>
            </div>
            <FormField
              label={t("body")}
              required
              hint={error("body") ?? t("bodyHint")}
              right={
                <Button kind="ghost" size="sm" icon={previewing ? "Edit" : "Eye"} onClick={() => setPreviewing((p) => !p)}>
                  {previewing ? t("edit") : t("preview")}
                </Button>
              }
            >
              {previewing ? (
                <div style={s.preview} data-testid="convention-skill-preview">
                  {form.body.trim() ? <Markdown>{form.body}</Markdown> : <span style={s.muted}>{t("previewEmpty")}</span>}
                </div>
              ) : (
                <MarkdownEditor
                  value={form.body}
                  onChange={(v) => set("body", v)}
                  filename={`${form.name.trim() || draft.data?.name || "skill"}.md`}
                  dirty={form.body !== draft.data?.body}
                  invalid={!!errors.body}
                  label={t("body")}
                  height={BODY_EDITOR_HEIGHT}
                />
              )}
            </FormField>
            <FormField label={t("agent")} hint={error("agentId") ?? t("agentHint")}>
              <SelectInput
                value={form.agentId}
                onChange={(v) => set("agentId", v)}
                aria-label={t("agent")}
                mono={false}
                options={[{ value: "", label: t("noAgent") }, ...(agents.data ?? []).map((a) => ({ value: a.id, label: a.name }))]}
              />
            </FormField>
          </>
        )}
      </div>
    </Modal>
  );
}
