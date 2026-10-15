/* SkillsTab — the agent's skills (HW2 #13, #30, #31, #37): every skill in the
   workspace, attached ones first in their PROMPT order, then the rest. The
   switch attaches/enables a skill for this agent; × detaches it; enabled,
   attached skills reorder by drag & drop or ↑ / ↓. Every change PUTs the whole
   ordered list (optimistic, rolled back on error). Skills disabled globally
   stay listed but are marked as not applied. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import { useAgentSkills, useSetAgentSkills, type AgentSkillItem } from "@/lib/hooks/agents";
import { useSkills } from "@/lib/hooks/skills";
import { AgentSkillRow } from "./_components/AgentSkillRow";
import {
  appliedCount,
  attach,
  buildRows,
  detach,
  dropOn,
  filterRows,
  itemsFrom,
  moveBy,
  sameItems,
  setEnabled,
  type SkillRow,
} from "./helpers";
import { s } from "./styles";

export function SkillsTab({ agent }: { agent: Agent }) {
  const t = useTranslations("agents");
  const skillsQ = useSkills();
  const linksQ = useAgentSkills(agent.id);
  const save = useSetAgentSkills(agent.id);
  const [query, setQuery] = React.useState("");
  const [dragId, setDragId] = React.useState<string | null>(null);
  const [overId, setOverId] = React.useState<string | null>(null);

  if (skillsQ.isLoading || linksQ.isLoading) {
    return (
      <div style={s.wrap} aria-busy="true">
        <Skeleton height={22} width={220} />
        <Skeleton height={44} />
        <Skeleton height={44} />
      </div>
    );
  }
  if (skillsQ.isError || linksQ.isError || !skillsQ.data || !linksQ.data) {
    return (
      <ErrorState
        body={t("skills.loadError")}
        onRetry={() => {
          void skillsQ.refetch();
          void linksQ.refetch();
        }}
      />
    );
  }

  const { attached, available } = buildRows(skillsQ.data, linksQ.data);
  const items = itemsFrom(linksQ.data);
  const filtering = query.trim() !== "";
  const shownAttached = filterRows(attached, query);
  const shownAvailable = filterRows(available, query);

  const commit = (next: AgentSkillItem[]) => {
    if (!sameItems(next, items)) save.mutate(next);
  };
  const toggle = (row: SkillRow, on: boolean) =>
    commit(row.attached ? setEnabled(items, row.skill.id, on) : on ? attach(items, row.skill.id) : items);
  const endDrag = () => {
    setDragId(null);
    setOverId(null);
  };

  return (
    <div style={s.wrap}>
      <div style={s.titleRow}>
        <h2 style={s.h2}>{t("skills.title")}</h2>
        <Badge color="var(--accent-text)" bg="var(--accent-bg)">
          <span data-testid="applied-count">
            {t("skills.enabledCount", { linked: appliedCount(attached), total: skillsQ.data.length })}
          </span>
        </Badge>
        <div style={s.search}>
          <Icon.Search size={13} style={s.searchIcon} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("skills.filterPlaceholder")}
            aria-label={t("skills.searchLabel")}
            style={s.searchInput}
          />
        </div>
      </div>
      <p style={s.hint}>
        {t("skills.orderHint")} {filtering && <strong>{t("skills.reorderPausedHint")}</strong>}
      </p>

      <h3 style={s.h3}>{t("skills.attachedTitle")}</h3>
      {attached.length === 0 ? (
        <p style={s.empty}>{t("skills.attachedEmpty")}</p>
      ) : (
        <ol style={s.list} aria-label={t("skills.attachedTitle")} data-testid="attached-skills">
          {shownAttached.map((row) => {
            const index = attached.indexOf(row);
            const canReorder = row.agentEnabled && !filtering;
            return (
              <AgentSkillRow
                key={row.skill.id}
                row={row}
                canReorder={canReorder}
                canMoveUp={index > 0}
                canMoveDown={index < attached.length - 1}
                dragging={dragId === row.skill.id}
                dropTarget={overId === row.skill.id && dragId !== row.skill.id}
                onToggle={(on) => toggle(row, on)}
                onDetach={() => commit(detach(items, row.skill.id))}
                onMove={(delta) => commit(moveBy(items, row.skill.id, delta))}
                onDragStart={() => setDragId(row.skill.id)}
                onDragEnd={endDrag}
                {...(dragId
                  ? {
                      onDragOver: () => setOverId(row.skill.id),
                      onDrop: () => {
                        commit(dropOn(items, dragId, row.skill.id));
                        endDrag();
                      },
                    }
                  : {})}
              />
            );
          })}
        </ol>
      )}

      <h3 style={s.h3}>{t("skills.availableTitle")}</h3>
      {available.length === 0 ? (
        <p style={s.empty}>{t("skills.availableEmpty")}</p>
      ) : (
        <ul style={s.list} aria-label={t("skills.availableTitle")} data-testid="available-skills">
          {shownAvailable.map((row) => (
            <AgentSkillRow
              key={row.skill.id}
              row={row}
              canReorder={false}
              canMoveUp={false}
              canMoveDown={false}
              dragging={false}
              dropTarget={false}
              onToggle={(on) => toggle(row, on)}
              onMove={() => undefined}
              onDragStart={() => undefined}
              onDragEnd={endDrag}
            />
          ))}
        </ul>
      )}
      {filtering && shownAttached.length === 0 && shownAvailable.length === 0 && (
        <p style={s.empty}>{t("skills.noMatch", { query })}</p>
      )}
    </div>
  );
}
