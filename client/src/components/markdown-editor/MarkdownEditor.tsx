/* MarkdownEditor — shared Markdown body editor (design: CodeEditor, used by
   Skill Editor · Config and "Create skill from conventions"): a file header
   (name.md, "unsaved", ~token count) over a monospace editing area
   with line numbers and per-line Markdown colouring.
   How it works: a plain <textarea> with transparent text sits exactly on top of
   a highlighted copy of the same text. Both use the same font metrics and
   width, and only the outer box scrolls (the textarea grows with the copy), so
   wrapped lines, the caret and the selection stay aligned. Editing, undo,
   paste and IME are the browser's own textarea behaviour. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon } from "@devdigest/ui";
import { EDITOR_HEIGHT, KIND_COLOR } from "./constants";
import { approxTokens, classifyLines } from "./helpers";
import { s } from "./styles";

export function MarkdownEditor({
  value,
  onChange,
  filename,
  dirty,
  invalid,
  label,
  height = EDITOR_HEIGHT,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Shown in the header, e.g. `breaking-change.md`. */
  filename: string;
  /** The body differs from the saved one ("unsaved" badge). */
  dirty: boolean;
  /** Validation failed (red frame + aria-invalid). */
  invalid?: boolean;
  /** Accessible name of the textarea. */
  label: string;
  height?: number;
}) {
  const t = useTranslations("common");
  const [focused, setFocused] = React.useState(false);
  const kinds = React.useMemo(() => classifyLines(value), [value]);
  const lines = value.split("\n");

  return (
    <div style={s.frame(focused, !!invalid)} data-testid="skill-body-editor">
      <div style={s.header}>
        <Icon.FileText size={14} style={s.fileIcon} />
        <span className="mono" style={s.filename} title={filename}>
          {filename}
        </span>
        {dirty && (
          <span data-testid="body-unsaved">
            <Badge color="var(--text-muted)">{t("markdownEditor.unsaved")}</Badge>
          </span>
        )}
        <span className="mono tnum" style={s.tokens} data-testid="body-tokens">
          {t("markdownEditor.tokens", { tokens: approxTokens(value) })}
        </span>
      </div>
      <div style={s.scroll(height)}>
        <div style={s.stage}>
          <div aria-hidden="true">
            {lines.map((line, i) => (
              <div key={i} style={s.row}>
                <span className="mono tnum" style={s.lineNo}>
                  {i + 1}
                </span>
                <span className="mono" style={s.lineText(KIND_COLOR[kinds[i] ?? "text"])}>
                  {/* An empty line still takes one line of height. */}
                  {line || " "}
                </span>
              </div>
            ))}
          </div>
          <textarea
            className="mono"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            aria-label={label}
            aria-invalid={invalid || undefined}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            wrap="soft"
            style={s.textarea}
          />
        </div>
      </div>
    </div>
  );
}
