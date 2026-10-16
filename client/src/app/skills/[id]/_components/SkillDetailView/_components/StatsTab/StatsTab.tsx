/* StatsTab — usage of a skill (design: Skill Editor · Stats). Only real data:
   "Used by" is the skill's agent count and the list shows the agents it is
   attached to (Open → that agent's Skills tab, through the page's
   unsaved-edits check). Findings are not linked to the
   skill that produced them, so pull frequency, accept rate, 30-day findings and
   findings by category show as "not tracked" — never sample numbers. */
"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Badge, ErrorState, Icon, SectionLabel, Skeleton } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useAgentsUsingSkill } from "@/lib/hooks/agents";
import { StatCard } from "./_components/StatCard";
import { s } from "./styles";

export function StatsTab({
  skill,
  onNavigate,
}: {
  skill: Skill;
  /** Open an in-app link through the page (so unsaved Config edits are asked about first). */
  onNavigate?: (href: string) => void;
}) {
  const t = useTranslations("skills");
  const { data: using, isLoading, isError } = useAgentsUsingSkill(skill.id);
  const notTracked = t("detail.stats.notTracked");

  return (
    <div style={s.wrap}>
      <div style={s.cards}>
        <StatCard
          label={t("detail.stats.usedBy")}
          value={skill.agent_count}
          suffix={t("detail.stats.agentsSuffix", { count: skill.agent_count })}
        />
        <StatCard label={t("detail.stats.pullFrequency")} note={notTracked} />
        <StatCard label={t("detail.stats.acceptRate")} note={notTracked} />
        <StatCard label={t("detail.stats.findings30d")} note={notTracked} />
      </div>

      <div className="dd-skills-lab-two-col" style={s.grid}>
        <section style={s.card} aria-label={t("detail.stats.agentsTitle")}>
          <SectionLabel icon="Cpu">{t("detail.stats.agentsTitle")}</SectionLabel>
          {isLoading && <Skeleton height={36} />}
          {isError && !isLoading && <ErrorState body={t("detail.stats.agentsError")} />}
          {!isLoading && !isError && using.length === 0 && <p style={s.muted}>{t("detail.stats.noAgents")}</p>}
          {!isLoading && !isError && using.length > 0 && (
            <ul style={s.agentList}>
              {using.map(({ agent, enabled }) => (
                <li key={agent.id} style={s.agentRow}>
                  <span style={s.agentIcon}>
                    <Icon.Cpu size={12} />
                  </span>
                  <span style={s.agentName} title={agent.name}>
                    {agent.name}
                  </span>
                  {!enabled && <Badge color="var(--text-muted)">{t("detail.stats.offForAgent")}</Badge>}
                  <Link
                    href={`/agents/${agent.id}?tab=skills`}
                    onClick={(e) => {
                      // A plain click goes through the page; ctrl/cmd/middle-click keep the browser's new-tab behaviour.
                      if (!onNavigate || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                      e.preventDefault();
                      onNavigate(`/agents/${agent.id}?tab=skills`);
                    }}
                    style={s.open}
                    aria-label={t("detail.stats.openAgent", { name: agent.name })}
                  >
                    {t("detail.stats.open")}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section style={s.card} aria-label={t("detail.stats.categoriesTitle")}>
          <SectionLabel icon="Tag">{t("detail.stats.categoriesTitle")}</SectionLabel>
          <div style={s.unavailable} data-testid="findings-by-category-unavailable">
            <Icon.BarChart size={18} style={s.unavailableIcon} />
            <span>{t("detail.stats.categoriesUnavailable")}</span>
          </div>
        </section>
      </div>
    </div>
  );
}
