/* TraceSection — collapsible titled section used throughout the trace tab.
   The header is a real button (aria-expanded) so it is keyboard- and
   role-reachable; `right` must stay non-interactive (badges only). */
"use client";

import React from "react";
import { Icon } from "@devdigest/ui";
import { s } from "../../styles";

export function TraceSection({
  icon,
  title,
  right,
  children,
  defaultOpen = true,
}: {
  icon: "Settings" | "Gauge" | "FileText" | "Wrench" | "Code" | "AlertOctagon";
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  const I = Icon[icon];
  return (
    <div style={s.section}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} style={s.sectionHead}>
        <I size={15} style={s.sectionIcon} />
        <span style={s.sectionTitle}>{title}</span>
        {right}
        <Icon.ChevronDown size={15} style={s.chevron(open)} />
      </button>
      {open && <div style={s.sectionBody}>{children}</div>}
    </div>
  );
}
