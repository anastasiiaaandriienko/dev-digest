/* AgentPickCard — one agent on Configure run (AC-MAR-29): checkbox, icon,
   name, description and its "≈ time · cost" estimate (or "no estimate"). */
"use client";

import React from "react";
import { Checkbox, Icon } from "@devdigest/ui";
import { s } from "./styles";

export function AgentPickCard({
  agentId,
  name,
  description,
  estimate,
  color,
  checked,
  blocked,
  onToggle,
}: {
  agentId: string;
  name: string;
  description: string;
  /** Already formatted: "≈ 8.2s · $0.04", "no estimate", or "" while loading. */
  estimate: string;
  color: string;
  checked: boolean;
  /** Unchecked while the per-run limit is reached — cannot be checked. */
  blocked: boolean;
  onToggle: () => void;
}) {
  return (
    <div style={s.card(color, checked, blocked)} data-testid={`agent-card-${agentId}`}>
      <Checkbox checked={checked} onChange={blocked ? undefined : onToggle} />
      <span style={s.icon(color)}>
        <Icon.Cpu size={15} />
      </span>
      <div style={s.body}>
        <span style={s.name}>{name}</span>
        {description && <span style={s.description}>{description}</span>}
      </div>
      {estimate && <span style={s.estimate}>{estimate}</span>}
    </div>
  );
}
