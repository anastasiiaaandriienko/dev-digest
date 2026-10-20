/* RootsPanel — collapsible wrapper around the unchanged RootsEditor (A2).
   Collapsed by default; the effective roots stay visible as a read-only
   summary next to the toggle. Collapsing unmounts the editor (unsaved edits are
   dropped, like Reset); a save — successful or failed — never closes the panel. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import { RootsEditor } from "../RootsEditor";
import { s } from "./styles";

export function RootsPanel({
  roots,
  saving,
  error,
  onSave,
}: {
  roots: string[];
  saving: boolean;
  error?: string | null;
  onSave: (roots: string[]) => void;
}) {
  const t = useTranslations("context");
  const [open, setOpen] = React.useState(false);
  const regionId = React.useId();

  return (
    <div style={s.box}>
      <div style={s.bar}>
        <button
          type="button"
          style={s.toggle}
          aria-expanded={open}
          aria-controls={regionId}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <Icon.ChevronDown size={13} /> : <Icon.ChevronRight size={13} />}
          {t("roots.toggle")}
        </button>
        {roots.length > 0 && (
          <div role="group" aria-label={t("roots.summary")} style={s.summary}>
            {roots.map((r) => (
              <span key={r} className="mono" style={s.root}>
                {r}
              </span>
            ))}
          </div>
        )}
      </div>
      <div id={regionId} style={open ? s.editor : undefined}>
        {open && <RootsEditor roots={roots} saving={saving} error={error} onSave={onSave} />}
      </div>
    </div>
  );
}
