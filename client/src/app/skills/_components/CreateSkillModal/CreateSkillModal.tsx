/* CreateSkillModal — "Add Skill → Create from scratch" (HW2 #11, #12): name,
   description, type and the Markdown body (Write / Preview). Validated with the
   shared SkillCreate contract; server errors are toasted by the global
   MutationCache handler. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, FormField, Markdown, Modal, SelectInput, Tabs, TextInput, Textarea } from "@devdigest/ui";
import type { Skill, SkillType } from "@devdigest/shared";
import { useCreateSkill } from "@/lib/hooks/skills";
import { notify } from "@/lib/toast";
import { SKILL_TYPES } from "../../constants";
import { BODY_ROWS, DEFAULT_TYPE, MODAL_WIDTH } from "./constants";
import { validateSkillForm, type SkillFormField } from "./helpers";
import { s } from "./styles";

export function CreateSkillModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  /** Called with the saved skill (the list opens its preview). */
  onCreated?: (skill: Skill) => void;
}) {
  const t = useTranslations("skills");
  const create = useCreateSkill();
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<SkillType>(DEFAULT_TYPE);
  const [body, setBody] = React.useState("");
  const [tab, setTab] = React.useState("write");
  const [errors, setErrors] = React.useState<Partial<Record<SkillFormField, true>>>({});

  const submit = async () => {
    const result = validateSkillForm({ name, description, type, body });
    if (!result.ok) {
      setErrors(result.errors);
      if (result.errors.body) setTab("write");
      return;
    }
    setErrors({});
    try {
      const skill = await create.mutateAsync(result.data);
      notify.success(t("create.created", { name: skill.name }));
      onClose();
      onCreated?.(skill);
    } catch {
      // The global MutationCache onError already shows the toast; keep the form.
    }
  };

  const error = (field: SkillFormField) =>
    errors[field] ? (
      <span role="alert" style={s.error}>
        {t(`create.errors.${field}`)}
      </span>
    ) : undefined;

  return (
    <Modal
      width={MODAL_WIDTH}
      title={t("create.title")}
      subtitle={t("create.subtitle")}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <Button kind="ghost" onClick={onClose}>
            {t("create.cancel")}
          </Button>
          <Button kind="primary" icon="Plus" onClick={submit} disabled={create.isPending}>
            {create.isPending ? t("create.creating") : t("create.submit")}
          </Button>
        </div>
      }
    >
      <div style={s.body}>
        <div style={s.row}>
          <div style={s.grow}>
            <FormField label={t("create.name")} required hint={error("name")}>
              <TextInput value={name} onChange={setName} placeholder={t("create.namePlaceholder")} mono />
            </FormField>
          </div>
          <div style={s.typeCol}>
            <FormField label={t("create.type")}>
              <SelectInput
                value={type}
                onChange={(v) => setType(v as SkillType)}
                options={SKILL_TYPES.map((k) => ({ value: k, label: t(`listItem.type.${k}`) }))}
              />
            </FormField>
          </div>
        </div>
        <FormField label={t("create.description")} hint={error("description")}>
          <TextInput
            value={description}
            onChange={setDescription}
            placeholder={t("create.descriptionPlaceholder")}
          />
        </FormField>
        <FormField label={t("create.body")} required hint={error("body")}>
          <Tabs
            tabs={[
              { key: "write", label: t("create.write") },
              { key: "preview", label: t("create.preview") },
            ]}
            value={tab}
            onChange={setTab}
            pad="0"
          />
          <div style={s.editor}>
            {tab === "write" ? (
              <Textarea
                value={body}
                onChange={setBody}
                placeholder={t("create.bodyPlaceholder")}
                rows={BODY_ROWS}
                mono
              />
            ) : (
              <div style={s.preview} data-testid="create-skill-preview">
                {body.trim() ? <Markdown>{body}</Markdown> : <span style={s.muted}>{t("create.previewEmpty")}</span>}
              </div>
            )}
          </div>
        </FormField>
      </div>
    </Modal>
  );
}
