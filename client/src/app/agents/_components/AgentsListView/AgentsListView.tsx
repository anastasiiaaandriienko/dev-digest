/* /agents — Agents (A2, L03; design: Agents list + editor). The list column
   (AgentsSidebar: search, Add Agent, cards with toggles, skill counts and
   delete) sits next to the editor area; picking an agent opens it at
   /agents/:id. With no agents the main area shows the design's empty state
   ("No agents yet" + Create your first agent); otherwise it asks to pick an
   agent. No template action: templates do not exist yet. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, EmptyState, Icon } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useAgents } from "@/lib/hooks/agents";
import { AgentsSidebar } from "../AgentsSidebar";
import { s } from "./styles";

export function AgentsListView() {
  const t = useTranslations("agents");
  const router = useRouter();
  const { data: agents } = useAgents();
  const [creating, setCreating] = React.useState(false);
  const none = !!agents && agents.length === 0;

  return (
    <AppShell crumb={[{ label: t("list.breadcrumbLab") }, { label: t("list.breadcrumb") }]}>
      <div className="dd-skills-lab" style={s.lab}>
        <AgentsSidebar
          onSelect={(id) => router.push(`/agents/${id}?tab=config`)}
          creating={creating}
          onCreatingChange={setCreating}
        />
        <section style={s.main}>
          {none && (
            <div style={s.empty} data-testid="agents-empty">
              <div style={s.emptyIcon}>
                <Icon.Cpu size={30} />
              </div>
              <h1 style={s.emptyTitle}>{t("list.emptyTitle")}</h1>
              <p style={s.emptyBody}>{t("list.emptyBody")}</p>
              <div style={s.emptyActions}>
                <Button kind="primary" icon="Plus" onClick={() => setCreating(true)}>
                  {t("list.emptyCta")}
                </Button>
              </div>
            </div>
          )}
          {agents && agents.length > 0 && (
            <EmptyState icon="Cpu" title={t("list.selectTitle")} body={t("list.selectBody")} />
          )}
        </section>
      </div>
    </AppShell>
  );
}
