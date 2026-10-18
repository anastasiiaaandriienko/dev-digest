/* AgentEditor — the agent's Config, Skills and Context tabs (HW2 #35 as amended
   by CTX A1: exactly these three; design: Agent Editor). Tab state lives in ?tab= (owned by the page).
   Config stays mounted (hidden) while Skills or Context is shown, so switching tabs keeps
   its unsaved edits; it reports them to the page through `guardRef`. Keyed by
   agent id + version: after a save the form starts from the saved agent. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Tabs } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import type { UnsavedGuard } from "@/lib/unsaved-guard";
import { ConfigTab } from "./_components/ConfigTab";
import { ContextTab } from "./_components/ContextTab";
import { SkillsTab } from "./_components/SkillsTab";
import { TABS } from "./constants";
import { s } from "./styles";

export function AgentEditor({
  agent,
  tab,
  onTab,
  guardRef,
}: {
  agent: Agent;
  tab: string;
  onTab: (t: string) => void;
  /** Filled by the Config tab with its unsaved-edits guard. */
  guardRef?: React.MutableRefObject<UnsavedGuard | null>;
}) {
  const t = useTranslations("agents");
  const tabs = TABS.map((tb) => ({ key: tb.key, label: t(tb.labelKey) }));
  return (
    <div style={s.wrap}>
      <div style={s.tabsBar}>
        <Tabs tabs={tabs} value={tab} onChange={onTab} pad="0 24px" />
      </div>
      <div className="dd-skills-lab-editor-scroll" style={s.body}>
        <div hidden={tab !== "config"}>
          <ConfigTab key={`${agent.id}:${agent.version}`} agent={agent} guardRef={guardRef} />
        </div>
        {tab === "skills" && <SkillsTab agent={agent} />}
        {tab === "context" && <ContextTab agent={agent} />}
      </div>
    </div>
  );
}
