/* ConventionCard — one candidate rule (HW2 #46, #47, #49): the rule, its
   category, the evidence (file:line + snippet read from that file) and the
   confidence, with Accept / Reject / Edit. Edit works inline (rule + category,
   Save / Cancel); the shared ConventionUpdate rules are checked before saving. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, IconBtn, MonoLink, ProgressBar, SelectInput, Textarea } from "@devdigest/ui";
import type { ConventionCandidate, ConventionCategory, ConventionUpdate as Patch } from "@devdigest/shared";
// Runtime import from the contract file itself (a value import from the barrel breaks `next build`).
import { ConventionCategory as Categories, ConventionUpdate } from "@devdigest/shared/contracts/knowledge";
import { notify } from "@/lib/toast";
import { CONFIDENT_AT, RULE_ROWS } from "./constants";
import { evidenceLocation, percent } from "./helpers";
import { s } from "./styles";

export function ConventionCard({
  candidate,
  evidenceHref,
  onUpdate,
}: {
  candidate: ConventionCandidate;
  /** Opens the evidence on GitHub in a new tab; without it file:line is plain text. */
  evidenceHref?: string | null;
  /** Persist a decision or an edit; rejects when the server refused it. */
  onUpdate: (patch: Patch) => Promise<unknown>;
}) {
  const t = useTranslations("conventions");
  const c = candidate;
  const accepted = c.status === "accepted";
  const [editing, setEditing] = React.useState(false);
  const [rule, setRule] = React.useState(c.rule);
  const [category, setCategory] = React.useState<ConventionCategory>(c.category);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const location = evidenceLocation(c);
  const short = c.rule.length > 60 ? `${c.rule.slice(0, 57)}…` : c.rule;

  const startEdit = () => {
    setRule(c.rule);
    setCategory(c.category);
    setError(null);
    setEditing(true);
  };

  const save = async () => {
    const parsed = ConventionUpdate.safeParse({ rule, category });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t("card.invalidRule"));
      return;
    }
    setSaving(true);
    try {
      await onUpdate(parsed.data);
      setEditing(false);
    } catch {
      // Toasted globally; keep the editor open with the user's text.
    } finally {
      setSaving(false);
    }
  };

  const copy = async () => {
    if (!location) return;
    try {
      await navigator.clipboard?.writeText(location);
      notify.success(t("card.copied", { location }));
    } catch {
      /* clipboard unavailable: nothing to do */
    }
  };

  return (
    <li data-convention-id={c.id} data-status={c.status} style={s.card(accepted)}>
      <div style={s.main}>
        {editing ? (
          <div style={s.editor}>
            <label style={s.fieldLabel}>
              {t("card.ruleLabel")}
              <Textarea value={rule} onChange={setRule} rows={RULE_ROWS} aria-label={t("card.ruleLabel")} />
            </label>
            <label style={s.fieldLabel}>
              {t("card.categoryLabel")}
              <SelectInput
                value={category}
                onChange={(v) => setCategory(v as ConventionCategory)}
                aria-label={t("card.categoryLabel")}
                mono={false}
                options={Categories.options.map((k) => ({ value: k, label: t(`category.${k}`) }))}
              />
            </label>
            {error && (
              <span role="alert" style={s.error}>
                {error}
              </span>
            )}
            <div style={s.editActions}>
              <Button kind="ghost" size="sm" onClick={() => setEditing(false)} disabled={saving}>
                {t("card.cancel")}
              </Button>
              <Button kind="primary" size="sm" icon="Check" onClick={save} loading={saving}>
                {t("card.save")}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div style={s.ruleRow}>
              <span style={s.category} data-testid="convention-category">
                {t(`category.${c.category}`)}
              </span>
              <div style={s.rule}>{c.rule}</div>
            </div>
            <div style={s.evidence}>
              <div style={s.evidenceHead}>
                {location ? <MonoLink href={evidenceHref ?? undefined}>{location}</MonoLink> : <span style={s.muted}>{t("card.noEvidence")}</span>}
                {location && <IconBtn icon="Copy" size={22} label={t("card.copyEvidence", { location })} onClick={copy} />}
              </div>
              {c.evidence_snippet && (
                <pre className="mono" style={s.snippet} data-testid="convention-snippet">
                  {c.evidence_snippet}
                </pre>
              )}
            </div>
            <div style={s.confidenceRow}>
              <span style={s.muted}>{t("card.confidence")}</span>
              {c.confidence != null && (
                <div style={s.bar}>
                  <ProgressBar value={c.confidence * 100} height={5} color={c.confidence >= CONFIDENT_AT ? "var(--ok)" : "var(--warn)"} />
                </div>
              )}
              <span className="mono tnum" style={s.percent} data-testid="convention-confidence">
                {percent(c.confidence)}
              </span>
            </div>
          </>
        )}
      </div>
      {!editing && (
        <div style={s.actions}>
          <Button
            kind={accepted ? "primary" : "secondary"}
            size="sm"
            icon={accepted ? "Check" : "Plus"}
            full
            aria-pressed={accepted}
            aria-label={accepted ? t("card.unacceptLabel", { rule: short }) : t("card.acceptLabel", { rule: short })}
            onClick={() => onUpdate({ status: accepted ? "pending" : "accepted" }).catch(() => undefined)}
          >
            {accepted ? t("card.accepted") : t("card.accept")}
          </Button>
          <Button
            kind="ghost"
            size="sm"
            icon="X"
            full
            aria-label={t("card.rejectLabel", { rule: short })}
            onClick={() => onUpdate({ status: "rejected" }).catch(() => undefined)}
          >
            {t("card.reject")}
          </Button>
          <Button kind="ghost" size="sm" icon="Edit" full aria-label={t("card.editLabel", { rule: short })} onClick={startEdit}>
            {t("card.edit")}
          </Button>
        </div>
      )}
    </li>
  );
}
