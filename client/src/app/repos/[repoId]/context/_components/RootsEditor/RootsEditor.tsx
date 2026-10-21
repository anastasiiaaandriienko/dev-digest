/* RootsEditor — the folders (relative to the repo root) that are scanned for
   Markdown docs. Saving only changes the roots; it never touches doc files. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Textarea } from "@devdigest/ui";
import { parseRoots, rootsToText } from "./helpers";
import { s } from "./styles";

export function RootsEditor({
  roots,
  saving,
  error,
  onSave,
}: {
  roots: string[];
  saving: boolean;
  /** Message of the last failed save (the previous roots stay in effect). */
  error?: string | null;
  onSave: (roots: string[]) => void;
}) {
  const t = useTranslations("context");
  const [text, setText] = React.useState(rootsToText(roots));
  // Follow the server's roots when they change (after a save or a refetch).
  const serverText = rootsToText(roots);
  React.useEffect(() => setText(serverText), [serverText]);
  const dirty = text !== serverText;

  return (
    <section style={s.box} aria-label={t("roots.title")}>
      <div style={s.head}>
        <span style={s.title}>{t("roots.title")}</span>
        <span style={s.hint}>{t("roots.hint")}</span>
      </div>
      <Textarea value={text} onChange={setText} rows={3} mono aria-label={t("roots.label")} />
      {error && (
        <div role="alert" style={s.error}>
          {error}
        </div>
      )}
      <div style={s.actions}>
        <Button
          kind="primary"
          size="sm"
          icon="Check"
          disabled={!dirty || saving}
          onClick={() => onSave(parseRoots(text))}
        >
          {saving ? t("roots.saving") : t("roots.save")}
        </Button>
        <Button kind="ghost" size="sm" disabled={!dirty || saving} onClick={() => setText(serverText)}>
          {t("roots.reset")}
        </Button>
      </div>
    </section>
  );
}
